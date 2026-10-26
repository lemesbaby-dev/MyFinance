// Sincronização: envia a fila (outbox) e depois busca as mudanças do servidor.
// Sem rede não é erro: a fila fica guardada e tentamos de novo quando a rede voltar.
import { api, ApiError } from './api.js';
import * as db from './db.js';
import * as session from './session.js';

const BATCH = 200; // o servidor aceita até 500 por lote
const MAX_BYTES = 600_000; // e 1 MB por requisição: ficamos bem abaixo

const listeners = new Set();
export const onStatus = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = (s) => listeners.forEach((fn) => fn(s));

// Última tentativa falhou por falta de rede (navigator.onLine nem sempre percebe: wifi sem internet).
let offline = false;

export async function status(extra = {}) {
  return {
    offline,
    pending: await db.pending(),
    rejected: (await db.getMeta('rejected', [])).length,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    ...extra,
  };
}

const changed = db.checkGen;

// Primeiros ops da fila até BATCH ou ~MAX_BYTES (sempre pelo menos 1).
const take = (ops) => {
  let bytes = 0;
  const out = [];
  for (const op of ops) {
    bytes += JSON.stringify(op).length;
    if (out.length && bytes > MAX_BYTES) break;
    out.push(op);
  }
  return out;
};

// Envia o lote; se o servidor responder 400/413, divide ao meio e tenta de novo (até 1 op).
// Uma op que sozinha continua dando 400/413 vira "rejected" local, para não travar a fila.
async function send(ops, g) {
  try {
    const { results } = await api.push(ops.map(({ seq, ...op }) => op));
    changed(g);
    return results;
  } catch (e) {
    if (!(e instanceof ApiError) || (e.status !== 400 && e.status !== 413)) throw e;
    if (ops.length === 1) return [{ op_id: ops[0].op_id, status: 'rejected', error: e.message }];
    const mid = ops.length >> 1;
    const first = await send(ops.slice(0, mid), g);
    return [...first, ...(await send(ops.slice(mid), g))];
  }
}

const labelOf = (op) => op.data?.name ?? op.data?.description ?? '';

async function push(g) {
  for (;;) {
    const ops = take(await db.nextOps(BATCH));
    if (!ops.length) return;
    const results = await send(ops, g);
    const byId = new Map(results.map((r) => [r.op_id, r]));
    const done = [], drop = [], rejected = [];
    let reset = false;
    for (const op of ops) {
      const r = byId.get(op.op_id);
      if (!r) continue; // sem resposta: continua na fila
      if (r.status !== 'ok' && r.status !== 'dup') reset = true;
      if (r.status === 'conflict') drop.push([op.kind, op.id]); // outro aparelho já gerou este item
      // gone = excluído em outro aparelho (o pull traz o tombstone): também fica visível para o usuário
      if (r.status === 'gone') rejected.push({ kind: op.kind, id: op.id, action: op.action, label: labelOf(op), error: 'foi excluído em outro aparelho' });
      if (r.status === 'rejected') rejected.push({ kind: op.kind, id: op.id, action: op.action, label: labelOf(op), error: r.error });
      done.push(op.seq);
    }
    if (!done.length) throw new Error('servidor não respondeu às operações');
    // o pull pulou itens que estavam na fila: refaz a leitura completa (idempotente, dados pequenos)
    await db.settle({ ack: done, rejected, drop, resetCursor: reset }, g);
  }
}

// Devolve true se o servidor estava ATRÁS do app (backup restaurado): tudo local foi reenfileirado.
async function pull(g) {
  let since = await db.getMeta('cursor', 0);
  let restored = false;
  for (;;) {
    const { changes, cursor, more, rev } = await api.pull(since);
    changed(g);
    if (!restored && rev !== undefined && since > rev) {
      await db.requeueAll();
      await db.setMeta('cursor', 0);
      since = 0;
      restored = true;
      continue;
    }
    await db.applyChanges(changes, cursor, g);
    since = cursor;
    if (!more) return restored;
  }
}

let running = null;

// Resolve { ok, offline, error }; ok só quando push e pull completaram. Chamadas simultâneas compartilham a mesma execução.
export function sync() {
  running ??= (async () => {
    let result = { ok: true };
    try {
      // Conta bloqueada ou token de outro usuário: nada é enviado nem baixado.
      if (!(await session.canSync())) throw new Error('conta não confirmada neste aparelho');
      const g = db.generation();
      emit(await status({ syncing: true }));
      await push(g);
      if (await pull(g)) {
        await push(g);
        await pull(g);
      }
    } catch (e) {
      // status 0 = sem conexão; 401 já foi tratado por api.js (volta ao login)
      result = e instanceof ApiError && e.status === 0 ? { ok: false, offline: true } : { ok: false, error: e.message };
    }
    offline = !!result.offline;
    try {
      emit(await status({ syncing: false, ok: result.ok, error: result.error ?? '' }));
    } catch (e) {
      result = { ok: false, error: e.message };
    }
    return result;
  })().finally(() => (running = null));
  return running;
}

let timer = null;
// Agenda um envio logo após gravar (junta várias gravações seguidas).
export function syncSoon(ms = 1500) {
  clearTimeout(timer);
  timer = setTimeout(() => sync().catch(() => {}), ms);
}

// O que a interface usa para gravar: local primeiro, rede depois.
export const save = async (kind, id, data) => (await db.save(kind, id, data), emit(await status()), syncSoon());
export const remove = async (kind, id) => (await db.remove(kind, id), emit(await status()), syncSoon());
// Várias gravações atômicas, um único aviso de status. Ver db.saveMany para o formato dos itens.
export const saveMany = async (items) => (await db.saveMany(items), emit(await status()), syncSoon());

// Sincroniza ao abrir, ao voltar a rede e ao voltar para o app.
export function startAutoSync() {
  const go = () => sync().catch(() => {});
  addEventListener('online', go);
  addEventListener('offline', () => status().then(emit).catch(() => {}));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && go());
  go();
}
