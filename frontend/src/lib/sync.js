// Sincronização: envia a fila (outbox) e depois busca as mudanças do servidor.
// Sem rede não é erro: a fila fica guardada e tentamos de novo quando a rede voltar.
import { api, ApiError } from './api.js';
import * as db from './db.js';

const BATCH = 200; // o servidor aceita até 500 por lote

const listeners = new Set();
export const onStatus = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = (s) => listeners.forEach((fn) => fn(s));

export async function status(extra = {}) {
  return {
    pending: await db.pending(),
    rejected: (await db.getMeta('rejected', [])).length,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    ...extra,
  };
}

async function push() {
  for (;;) {
    const ops = await db.nextOps(BATCH);
    if (!ops.length) return;
    const { results } = await api.push(ops.map(({ seq, ...op }) => op));
    const byId = new Map(results.map((r) => [r.op_id, r]));
    const done = [];
    for (const op of ops) {
      const r = byId.get(op.op_id);
      if (!r) continue; // sem resposta: continua na fila
      if (r.status === 'conflict') await db.dropLocal(op.kind, op.id); // outro aparelho já gerou este item
      if (r.status === 'rejected') {
        const list = await db.getMeta('rejected', []);
        await db.setMeta('rejected', [...list, { kind: op.kind, id: op.id, action: op.action, error: r.error }]);
      }
      done.push(op.seq);
    }
    if (!done.length) throw new Error('servidor não respondeu às operações');
    await db.ack(done);
  }
}

async function pull() {
  for (;;) {
    const { changes, cursor, more } = await api.pull(await db.getMeta('cursor', 0));
    await db.applyChanges(changes, cursor);
    if (!more) return;
  }
}

let running = null;

// Resolve { ok, offline, error }. Chamadas simultâneas compartilham a mesma execução.
export function sync() {
  running ??= (async () => {
    emit(await status({ syncing: true }));
    let result = { ok: true };
    try {
      await push();
      await pull();
    } catch (e) {
      // status 0 = sem conexão; 401 já foi tratado por api.js (volta ao login)
      result = e instanceof ApiError && e.status === 0 ? { ok: false, offline: true } : { ok: false, error: e.message };
    }
    emit(await status({ syncing: false, error: result.error ?? '' }));
    return result;
  })().finally(() => (running = null));
  return running;
}

let timer = null;
// Agenda um envio logo após gravar (junta várias gravações seguidas).
export function syncSoon(ms = 1500) {
  clearTimeout(timer);
  timer = setTimeout(sync, ms);
}

// O que a interface usa para gravar: local primeiro, rede depois.
export const save = async (kind, id, data) => (await db.save(kind, id, data), emit(await status()), syncSoon());
export const remove = async (kind, id) => (await db.remove(kind, id), emit(await status()), syncSoon());

// Sincroniza ao abrir, ao voltar a rede e ao voltar para o app.
export function startAutoSync() {
  const go = () => sync();
  addEventListener('online', go);
  addEventListener('offline', async () => emit(await status()));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && go());
  go();
}
