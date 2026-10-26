// Fluxo de troca de conta no mesmo aparelho: o token de B nunca é persistido nem usado enquanto
// a cópia local é de A com pendências, e recarregar não abre como A com o token de B.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
const conn = () => JSON.parse(store.get('financas.conn') ?? '{}');

const db = await import('./db.js');
const session = await import('./session.js');
const { sync, save } = await import('./sync.js');
const { api } = await import('./api.js');

const calls = []; // { method, path, auth }
const meOf = { tokA: { id: 'A' }, tokB: { id: 'B' } };
beforeEach(async () => {
  await db.closeDb();
  globalThis.indexedDB = new IDBFactory();
  store.clear();
  calls.length = 0;
  session.abandon();
  globalThis.fetch = async (url, init) => {
    const auth = init.headers.Authorization;
    calls.push({ method: init.method, path: new URL(url, 'http://x').pathname, auth });
    const path = new URL(url, 'http://x').pathname;
    const body = path === '/api/auth/me' ? meOf[auth?.slice(7)] : init.method === 'POST'
      ? { results: JSON.parse(init.body).ops.map((o) => ({ op_id: o.op_id, status: 'ok' })) }
      : { changes: [], cursor: 0, more: false, rev: 0 };
    return { ok: true, status: 200, json: async () => body };
  };
});

const acc = { name: 'da Ana', type: 'checking', initial_balance_cents: 0, archived: false };
const A = { id: 'A', email: 'a@x.com' };
const B = { id: 'B', email: 'b@x.com' };

async function anaComPendencia() {
  assert.equal(await session.accept('tokA', A), 'ok');
  assert.deepEqual(conn(), { url: '', token: 'tokA', userId: 'A' });
  await save('account', 'a1', acc); // fica na fila (nenhum sync rodou)
  store.set('financas.conn', JSON.stringify({ url: '', token: '', userId: '' })); // saiu da conta com pendência (logout)
}

test('B loga com a cópia de A pendente: token de B não é gravado, nada é enviado, A não é sobrescrito', async () => {
  await anaComPendencia();
  assert.equal(await session.accept('tokB', B), 'blocked');
  assert.equal(conn().token, '', 'o token de B não foi para o localStorage');
  assert.equal(session.isBlocked(), true);

  calls.length = 0;
  const r = await sync();
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0, 'nem push nem pull com o token de B');
  assert.equal(await db.pending(), 1, 'a pendência de A continua na fila');
  assert.equal((await db.list('account'))[0].name, 'da Ana');
  assert.equal(await db.getMeta('user'), 'A');

  // recarregar (sem token salvo) não abre nada; o estado em memória some, mas o localStorage continua sem token
  assert.equal(conn().token, '');
});

test('"Descartar e continuar": só então a cópia de A é apagada e o token de B é persistido', async () => {
  await anaComPendencia();
  await session.accept('tokB', B);
  assert.deepEqual(await session.discardAndContinue(), B);
  assert.deepEqual(conn(), { url: '', token: 'tokB', userId: 'B' });
  assert.equal(await db.getMeta('user'), 'B');
  assert.equal((await db.list('account')).length, 0);
  assert.equal(await db.pending(), 0);
  assert.equal(session.isBlocked(), false);
  assert.equal((await sync()).ok, true);
});

test('"Entrar com outra conta": volta a A e a pendência dela segue para o servidor', async () => {
  await anaComPendencia();
  await session.accept('tokB', B);
  session.abandon();
  assert.equal(await session.accept('tokA', A), 'ok');
  calls.length = 0;
  assert.equal((await sync()).ok, true);
  assert.ok(calls.every((c) => c.auth === 'Bearer tokA'));
  assert.equal(await db.pending(), 0);
});

test('recarregar com token de B mas cópia de A: tela de bloqueio, não abre como A', async () => {
  await db.ensureUser('A');
  await save('account', 'a1', acc);
  store.set('financas.conn', JSON.stringify({ url: '', token: 'tokB', userId: 'B' })); // o estado que o bug antigo deixava
  assert.deepEqual(await session.resume(), { state: 'blocked' });
  calls.length = 0;
  assert.equal((await sync()).ok, false);
  assert.equal(calls.length, 0);
});

test('sessão antiga sem userId: o servidor diz de quem é o token; divergência bloqueia', async () => {
  await db.ensureUser('A');
  store.set('financas.conn', JSON.stringify({ url: '', token: 'tokA' }));
  assert.deepEqual(await session.resume(), { state: 'ok', user: { id: 'A' } });
  assert.equal(conn().userId, 'A', 'passa a ter userId');

  store.set('financas.conn', JSON.stringify({ url: '', token: 'tokB' }));
  assert.deepEqual(await session.resume(), { state: 'blocked' });
});

test('mesma conta e aparelho novo: persiste e libera o sync', async () => {
  assert.equal(await session.accept('tokA', A), 'ok');
  assert.equal((await session.resume()).state, 'ok'); // sem userInfo local, pergunta ao servidor
  assert.equal((await sync()).ok, true);
  assert.equal((await api.me()).id, 'A');
});

test('recusados também bloqueiam a troca de conta (não são apagados sem aviso)', async () => {
  await db.ensureUser('A');
  await db.settle({ ack: [], rejected: [{ kind: 'account', id: 'x', action: 'upsert', error: 'cota' }] });
  assert.equal(await session.accept('tokB', B), 'blocked');
  assert.equal((await db.getMeta('rejected')).length, 1);
});
