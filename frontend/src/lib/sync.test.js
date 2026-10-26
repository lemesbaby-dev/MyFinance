// node --test  (IndexedDB simulado por fake-indexeddb; o "servidor" é um fetch falso em memória)
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => JSON.stringify({ url: '', token: 't' }), setItem() {} };

const db = await import('./db.js');
const { sync, save, remove } = await import('./sync.js');
const { uuidv7 } = await import('./uuid.js');

// Servidor falso com a mesma semântica do real: dup por op_id, rev crescente, tombstone.
function fakeServer() {
  const s = { rev: 0, rows: new Map(), seen: new Set(), online: true, loseResponse: false, forced: {}, applied: [] };
  globalThis.fetch = async (url, init) => {
    if (!s.online) throw new TypeError('offline');
    const path = new URL(url, 'http://x');
    let body;
    if (init.method === 'POST') {
      const results = JSON.parse(init.body).ops.map((op) => {
        if (s.seen.has(op.op_id)) return { op_id: op.op_id, status: 'dup' };
        s.seen.add(op.op_id);
        if (s.forced[op.id]) return { op_id: op.op_id, status: s.forced[op.id], error: 'forçado' };
        s.applied.push(op);
        s.rows.set(op.kind + '/' + op.id, { kind: op.kind, id: op.id, rev: ++s.rev, deleted: op.action === 'delete', data: op.data ?? {} });
        return { op_id: op.op_id, status: 'ok' };
      });
      if (s.loseResponse) throw new TypeError('rede caiu depois de aplicar');
      body = { results };
    } else {
      const since = Number(path.searchParams.get('since'));
      const changes = [...s.rows.values()].filter((r) => r.rev > since).sort((a, b) => a.rev - b.rev);
      body = { changes, cursor: changes.at(-1)?.rev ?? since, more: false };
    }
    return { ok: true, status: 200, json: async () => body };
  };
  return s;
}

let srv;
beforeEach(async () => {
  await db.closeDb();
  globalThis.indexedDB = new IDBFactory(); // banco limpo por teste
  srv = fakeServer();
});

const acc = { name: 'Nubank', type: 'checking', initial_balance_cents: 0, archived: false };

test('uuidv7: formato, versão e ordem de criação', async () => {
  const a = uuidv7();
  await new Promise((r) => setTimeout(r, 3));
  const b = uuidv7();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(a < b, 'ids novos ordenam depois');
});

test('offline: grava local e enfileira; ao voltar a rede, envia tudo', async () => {
  srv.online = false;
  await save('account', 'acc1', acc);
  await save('transaction', 'tx1', { description: 'Mercado' });
  assert.equal((await db.list('account')).length, 1, 'visível localmente sem rede');
  assert.equal(await db.pending(), 2);
  assert.deepEqual(await sync(), { ok: false, offline: true });
  assert.equal(await db.pending(), 2, 'nada se perde sem rede');

  srv.online = true;
  assert.deepEqual(await sync(), { ok: true });
  assert.equal(await db.pending(), 0);
  assert.deepEqual(srv.applied.map((o) => o.id), ['acc1', 'tx1'], 'ordem da fila preservada');
});

test('rede cai DEPOIS de o servidor aplicar: reenvio com o mesmo op_id não duplica', async () => {
  await save('account', 'acc1', acc);
  srv.loseResponse = true;
  const r1 = await sync();
  assert.equal(r1.ok, false);
  assert.equal(await db.pending(), 1, 'sem confirmação, continua na fila');
  const [op] = await db.nextOps(10);

  srv.loseResponse = false;
  assert.deepEqual(await sync(), { ok: true });
  assert.equal(await db.pending(), 0);
  assert.equal(srv.applied.length, 1, 'o servidor aplicou uma única vez');
  assert.equal(srv.seen.has(op.op_id), true);
});

test('pull traz mudanças de outro aparelho e tombstone apaga o local', async () => {
  srv.rows.set('account/acc9', { kind: 'account', id: 'acc9', rev: ++srv.rev, deleted: false, data: acc });
  await sync();
  assert.equal((await db.list('account'))[0].id, 'acc9');
  assert.equal(await db.getMeta('cursor'), 1);

  srv.rows.set('account/acc9', { kind: 'account', id: 'acc9', rev: ++srv.rev, deleted: true, data: {} });
  await sync();
  assert.equal((await db.list('account')).length, 0);
  assert.equal(await db.getMeta('cursor'), 2);
});

test('edição local pendente não é sobrescrita pelo pull', async () => {
  await db.applyChanges([{ kind: 'account', id: 'a', deleted: false, data: { ...acc, name: 'Antigo' } }], 1);
  await db.save('account', 'a', { ...acc, name: 'Editado offline' });
  await db.applyChanges([{ kind: 'account', id: 'a', deleted: false, data: { ...acc, name: 'Servidor' } }], 2);
  assert.equal((await db.get('account', 'a')).name, 'Editado offline');
});

test('excluir: some local, vira operação de delete', async () => {
  await save('account', 'acc1', acc);
  await sync();
  await remove('account', 'acc1');
  assert.equal((await db.list('account')).length, 0);
  await sync();
  assert.equal(srv.rows.get('account/acc1').deleted, true);
});

test('conflict descarta a cópia local; rejected fica registrado para a interface', async () => {
  await save('transaction', 'dup', { description: 'ocorrência duplicada' });
  await save('transaction', 'ruim', { description: 'x' });
  srv.forced = { dup: 'conflict', ruim: 'rejected' };
  await sync();
  assert.equal(await db.pending(), 0, 'respondidas, saem da fila');
  assert.equal(await db.get('transaction', 'dup'), null, 'duplicata local descartada');
  const rej = await db.getMeta('rejected');
  assert.equal(rej.length, 1);
  assert.equal(rej[0].id, 'ruim');
  assert.equal(rej[0].error, 'forçado');
});

test('troca de usuário no mesmo aparelho zera a cópia local', async () => {
  assert.equal(await db.ensureUser('ana'), true);
  await save('account', 'a1', acc);
  assert.equal(await db.ensureUser('ana'), false, 'mesmo usuário preserva');
  assert.equal((await db.list('account')).length, 1);
  assert.equal(await db.ensureUser('bia'), true);
  assert.equal((await db.list('account')).length, 0, 'dados da Ana não aparecem para a Bia');
  assert.equal(await db.pending(), 0);
});
