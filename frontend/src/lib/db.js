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
    const rej = (await wrap(s.meta.get('rejected')))?.value ?? [];
    for (const { kind, id, data, remove: del } of items) {
      if (del) {
        s.entities.delete([kind, id]);
        s.outbox.add({ op_id: uuidv7(), kind, id, action: 'delete' });
      } else {
        // create: o servidor nunca teve este documento (não havia cópia local, ou o envio anterior foi recusado).
        // Marca só local (não vai no push); replaceAll usa para não recriar o que foi excluído em outro aparelho.
        const create = !(await wrap(s.entities.get([kind, id]))) || rej.some((r) => r.action === 'upsert' && r.kind === kind && r.id === id);
        s.entities.put({ kind, id, data });
        s.outbox.add({ op_id: uuidv7(), kind, id, action: 'upsert', data, create });
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

// Ressincronização completa: o servidor já descartou exclusões que esta cópia não viu (GC de tombstones), então o
// pull incremental não serve. `changes` é a leitura inteira do servidor; a cópia local passa a ser esse estado
// MAIS a fila pendente, que não é tocada (como em applyChanges, item na fila não é sobrescrito).
// Exceção: upsert na fila de um documento que o servidor não tem e que não é criação editaria algo já excluído.
// Enviá-lo recriaria o documento; ele sai da fila e vira "recusado" (mesmo destino do `gone` no push).
export function replaceAll(changes, cursor, g) {
  return tx(['entities', 'outbox', 'meta'], 'readwrite', async (s) => {
    checkGen(g);
    const key = (o) => o.kind + '/' + o.id;
    const server = new Map(changes.map((c) => [key(c), c])); // páginas em ordem de rev: a última versão vence
    const alive = new Set([...server.values()].filter((c) => !c.deleted).map(key)); // existe no servidor (ou vai existir, pela fila)
    const list = (await wrap(s.meta.get('rejected')))?.value ?? [];
    const queued = new Set();
    const parked = new Set(list.filter((r) => r.action === 'upsert').map(key)); // recusados: a cópia local espera o usuário
    const gone = new Map();
    for (const op of await wrap(s.outbox.getAll())) {
      const k = key(op);
      if (op.action === 'delete') alive.delete(k);
      else if (alive.has(k) || op.create) alive.add(k);
      else {
        s.outbox.delete(op.seq);
        gone.set(k, { kind: op.kind, id: op.id, action: 'upsert', label: op.data?.name ?? op.data?.description ?? '', error: 'foi excluído em outro aparelho' });
        // Fila gravada por versão anterior do app não tem a marca: pode ser criação. Na dúvida a cópia local fica
        // (como qualquer recusado: fora dos saldos, o usuário descarta ou salva de novo).
        if (op.create === undefined) parked.add(k);
        continue;
      }
      queued.add(k);
    }
    for (const [kind, id] of await wrap(s.entities.getAllKeys())) {
      const k = kind + '/' + id;
      if (!queued.has(k) && !parked.has(k) && !server.has(k)) s.entities.delete([kind, id]);
    }
    for (const [k, c] of server) {
      if (queued.has(k)) continue;
      if (c.deleted) s.entities.delete([c.kind, c.id]);
      else s.entities.put({ kind: c.kind, id: c.id, data: c.data });
    }
    if (gone.size) s.meta.put({ key: 'rejected', value: [...list, ...gone.values()] });
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
      s.outbox.add({ op_id: uuidv7(), kind: r.kind, id: r.id, action: 'upsert', data: r.data, create: true }); // o servidor perdeu: é criação
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

// "Começar do zero": limpa dados, fila e recusados; mantém usuário e `synced` (o app volta aos primeiros passos).
export const resetLocal = () => (
  gen++,
  tx(['entities', 'outbox', 'meta'], 'readwrite', (s) => {
    s.entities.clear();
    s.outbox.clear();
    s.meta.delete('rejected');
    s.meta.delete('cursor');
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
