// Cópia local dos dados (IndexedDB) + fila de envio (outbox).
// `save`/`remove` gravam o dado E a operação na MESMA transação: nunca existe uma sem a outra.
import { uuidv7 } from './uuid.js';

let dbp = null;

export function openDb(name = 'financas') {
  dbp ??= new Promise((ok, fail) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('entities', { keyPath: ['kind', 'id'] }).createIndex('kind', 'kind');
      db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
  return dbp;
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
    Promise.resolve(fn(Object.fromEntries(names.map((n) => [n, t.objectStore(n)])))).then((v) => (out = v), fail);
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
export function save(kind, id, data) {
  return tx(['entities', 'outbox'], 'readwrite', (s) => {
    s.entities.put({ kind, id, data });
    s.outbox.add({ op_id: uuidv7(), kind, id, action: 'upsert', data });
  });
}

export function remove(kind, id) {
  return tx(['entities', 'outbox'], 'readwrite', (s) => {
    s.entities.delete([kind, id]);
    s.outbox.add({ op_id: uuidv7(), kind, id, action: 'delete' });
  });
}

// Descarta só a cópia local (sem enviar nada): usado quando o servidor recusa ou já tem o item.
export const dropLocal = (kind, id) => tx(['entities'], 'readwrite', (s) => s.entities.delete([kind, id]));

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
export function applyChanges(changes, cursor) {
  return tx(['entities', 'outbox', 'meta'], 'readwrite', async (s) => {
    const queued = new Set((await wrap(s.outbox.getAll())).map((o) => o.kind + '/' + o.id));
    for (const c of changes) {
      if (queued.has(c.kind + '/' + c.id)) continue;
      if (c.deleted) s.entities.delete([c.kind, c.id]);
      else s.entities.put({ kind: c.kind, id: c.id, data: c.data });
    }
    s.meta.put({ key: 'cursor', value: cursor });
  });
}

// Apaga tudo (troca de usuário no mesmo aparelho, ou logout sem pendências).
export const wipe = () =>
  tx(['entities', 'outbox', 'meta'], 'readwrite', (s) => {
    s.entities.clear();
    s.outbox.clear();
    s.meta.clear();
  });

// Dados de outra pessoa nunca podem aparecer: se o usuário mudou, zera a cópia local.
export async function ensureUser(userId) {
  if ((await getMeta('user')) === userId) return false;
  await wipe();
  await setMeta('user', userId);
  return true;
}
