// Cópia local dos dados (IndexedDB) + fila de envio (outbox).
// `save`/`remove` gravam o dado E a operação na MESMA transação: nunca existe uma sem a outra.
import { uuidv7 } from './uuid.js';

let dbp = null;

export function openDb(name = 'financas') {
  if (dbp) return dbp;
  const p = new Promise((ok, fail) => {
    const req = indexedDB.open(name, 1);
    let blocked = false;
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('entities', { keyPath: ['kind', 'id'] }).createIndex('kind', 'kind');
      db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      if (blocked) return db.close(); // já falhamos para quem esperava; não deixa conexão pendurada
      // Outra aba/versão quer atualizar o banco: solta a conexão e esquece-a (a próxima chamada reabre).
      db.onversionchange = () => {
        db.close();
        if (dbp === p) dbp = null;
      };
      ok(db);
    };
    req.onerror = () => fail(req.error);
    req.onblocked = () => {
      blocked = true;
      fail(new Error('Feche as outras abas do app para atualizar o armazenamento local.'));
    };
  });
  dbp = p;
  // Promise rejeitada não fica guardada para sempre: a próxima chamada tenta de novo.
  p.catch(() => { if (dbp === p) dbp = null; });
  return p;
}

// Só para testes: fecha e esquece a conexão atual.
export async function closeDb() {
  if (dbp) (await dbp).close();
  dbp = null;
}

const wrap = (req) =>
  new Promise((ok, fail) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });

// Roda fn(stores) numa transação e resolve quando ela COMMITA.
async function tx(names, mode, fn) {
  const db = await openDb();
  return new Promise((ok, fail) => {
    const t = db.transaction(names, mode);
    let out;
    t.oncomplete = () => ok(out);
    t.onerror = () => fail(t.error);
    t.onabort = () => fail(t.error);
    // erro em fn (síncrono ou promise rejeitada): aborta, para nunca commitar escrita parcial
    const bail = (e) => {
      try {
        t.abort();
      } catch {}
      fail(e);
    };
    try {
      Promise.resolve(fn(Object.fromEntries(names.map((n) => [n, t.objectStore(n)])))).then((v) => (out = v), bail);
    } catch (e) {
      bail(e);
    }
  });
}

const flat = (r) => ({ id: r.id, ...r.data });

export async function list(kind) {
  const rows = await tx(['entities'], 'readonly', (s) => wrap(s.entities.index('kind').getAll(kind)));
  return rows.map(flat);
}

export async function get(kind, id) {
  const r = await tx(['entities'], 'readonly', (s) => wrap(s.entities.get([kind, id])));
  return r ? flat(r) : null;
}

// Cria ou substitui o documento inteiro. `data` não leva o id.
export const save = (kind, id, data) => saveMany([{ kind, id, data }]);

export const remove = (kind, id) => saveMany([{ kind, id, remove: true }]);

// Gravar de novo um item recusado é "corrigir": sai da lista de recusados (se o servidor recusar outra vez, volta).
async function forgetRejected(meta, items) {
  const list = (await wrap(meta.get('rejected')))?.value ?? [];
  const keep = list.filter((r) => !items.some((i) => i.kind === r.kind && i.id === r.id));
  if (keep.length !== list.length) meta.put({ key: 'rejected', value: keep });
}

// Várias gravações numa transação só (tudo ou nada). item = {kind,id,data} ou {kind,id,remove:true}.
export function saveMany(items) {
  return tx(['entities', 'outbox', 'meta'], 'readwrite', async (s) => {
    for (const { kind, id, data, remove: del } of items) {
      if (del) {
        s.entities.delete([kind, id]);
        s.outbox.add({ op_id: uuidv7(), kind, id, action: 'delete' });
      } else {
        s.entities.put({ kind, id, data });
        s.outbox.add({ op_id: uuidv7(), kind, id, action: 'upsert', data });
      }
    }
    await forgetRejected(s.meta, items);
  });
}

// Descarta só a cópia local (sem enviar nada): usado quando o servidor recusa ou já tem o item.
export const dropLocal = (kind, id) => tx(['entities'], 'readwrite', (s) => s.entities.delete([kind, id]));

// Alterações que ainda não chegaram ao servidor: na fila ou recusadas (as recusadas também se perdem num wipe).
export const unsent = async () => (await pending()) + (await getMeta('rejected', [])).length;

// Resposta do servidor ao lote, numa transação só (tira da fila, registra recusados, descarta cópias, zera cursor):
// uma queda no meio nunca deixa recusado duplicado nem fila fora de sincronia com o que foi registrado.
export function settle({ ack: seqs, rejected = [], drop = [], resetCursor = false }, g) {
  return tx(['entities', 'outbox', 'meta'], 'readwrite', async (s) => {
    checkGen(g);
    seqs.forEach((q) => s.outbox.delete(q));
    drop.forEach(([kind, id]) => s.entities.delete([kind, id]));
    if (rejected.length) {
      const list = (await wrap(s.meta.get('rejected')))?.value ?? [];
      s.meta.put({ key: 'rejected', value: [...list, ...rejected] });
    }
    if (resetCursor) s.meta.put({ key: 'cursor', value: 0 });
  });
}

// Descarta o i-ésimo recusado (lê, remove e regrava na MESMA transação: um push simultâneo não perde entrada).
export function dismissRejectedAt(i) {
  return tx(['entities', 'meta'], 'readwrite', async (s) => {
    const list = (await wrap(s.meta.get('rejected')))?.value ?? [];
    const [r] = list.splice(i, 1);
    s.meta.put({ key: 'rejected', value: list });
    if (r?.action === 'upsert') s.entities.delete([r.kind, r.id]); // a cópia local nunca chegou ao servidor
    s.meta.put({ key: 'cursor', value: 0 }); // o próximo pull reconcilia com o que o servidor tem
    return r;
  });
}

export const pending = () => tx(['outbox'], 'readonly', (s) => wrap(s.outbox.count()));

export const nextOps = (n) => tx(['outbox'], 'readonly', (s) => wrap(s.outbox.getAll(null, n)));

export const ack = (seqs) =>
  tx(['outbox'], 'readwrite', (s) => {
    seqs.forEach((q) => s.outbox.delete(q));
  });

export async function getMeta(key, dflt = null) {
  const r = await tx(['meta'], 'readonly', (s) => wrap(s.meta.get(key)));
  return r ? r.value : dflt;
}

export const setMeta = (key, value) => tx(['meta'], 'readwrite', (s) => s.meta.put({ key, value }));

// Aplica o pull. Itens com alteração local ainda não enviada NÃO são sobrescritos:
// a versão do usuário vai para o servidor no próximo envio e volta no pull seguinte.
export function applyChanges(changes, cursor, g) {
  return tx(['entities', 'outbox', 'meta'], 'readwrite', async (s) => {
    checkGen(g); // a geração é conferida DENTRO da transação: um wipe entre o fetch e aqui aborta tudo
    const queued = new Set((await wrap(s.outbox.getAll())).map((o) => o.kind + '/' + o.id));
    for (const c of changes) {
      if (queued.has(c.kind + '/' + c.id)) continue;
      if (c.deleted) s.entities.delete([c.kind, c.id]);
      else s.entities.put({ kind: c.kind, id: c.id, data: c.data });
    }
    s.meta.put({ key: 'cursor', value: cursor });
  });
}

// Geração da cópia local: sobe a cada wipe, para um sync em andamento descartar o resultado.
let gen = 0;
export const generation = () => gen;
export const checkGen = (g) => {
  if (g !== undefined && g !== gen) throw new Error('usuário mudou durante a sincronização');
};

// Reenfileira um upsert de cada entidade local (servidor restaurado de um backup mais antigo).
export const requeueAll = () =>
  tx(['entities', 'outbox'], 'readwrite', async (s) => {
    for (const r of await wrap(s.entities.getAll())) {
      s.outbox.add({ op_id: uuidv7(), kind: r.kind, id: r.id, action: 'upsert', data: r.data });
    }
  });

// Apaga tudo (troca de usuário no mesmo aparelho, ou logout sem pendências).
export const wipe = () => (
  gen++,
  tx(['entities', 'outbox', 'meta'], 'readwrite', (s) => {
    s.entities.clear();
    s.outbox.clear();
    s.meta.clear();
  })
);

// Dados de outra pessoa nunca podem aparecer: se o usuário mudou, zera a cópia local.
// Com pendências do usuário anterior não apaga nada: a interface decide (M4).
export async function ensureUser(userId) {
  if ((await getMeta('user')) === userId) return false;
  if ((await unsent()) > 0) throw new Error('PENDING_OTHER_USER');
  await wipe();
  await setMeta('user', userId);
  return true;
}
