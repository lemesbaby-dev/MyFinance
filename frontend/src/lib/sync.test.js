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
  const s = { rev: 0, rows: new Map(), seen: new Set(), online: true, loseResponse: false, forced: {}, applied: [], page: Infinity };
  globalThis.fetch = async (url, init) => {
    if (!s.online) throw new TypeError('offline');
    const path = new URL(url, 'http://x');
    let body;
    if (init.method === 'POST') {
      const results = JSON.parse(init.body).ops.map((op) => {
        if (s.seen.has(op.op_id)) return { op_id: op.op_id, status: 'dup' };
        if (s.forced[op.id]) return { op_id: op.op_id, status: s.forced[op.id], error: 'forçado' }; // só `ok` entra em seen
        s.seen.add(op.op_id);
        s.applied.push(op);
        s.rows.set(op.kind + '/' + op.id, { kind: op.kind, id: op.id, rev: ++s.rev, deleted: op.action === 'delete', data: op.data ?? {} });
        return { op_id: op.op_id, status: 'ok' };
      });
      if (s.loseResponse) throw new TypeError('rede caiu depois de aplicar');
      body = { results };
    } else {
      const since = Number(path.searchParams.get('since'));
      const all = [...s.rows.values()].filter((r) => r.rev > since).sort((a, b) => a.rev - b.rev);
      const changes = all.slice(0, s.page);
      body = { changes, cursor: changes.at(-1)?.rev ?? since, more: all.length > changes.length, rev: s.rev };
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
  await sync(); // sem pendências
  assert.equal(await db.ensureUser('bia'), true);
  assert.equal((await db.list('account')).length, 0, 'dados da Ana não aparecem para a Bia');
  assert.equal(await db.pending(), 0);
});

test('troca de usuário com pendências não apaga nada', async () => {
  await db.ensureUser('ana');
  await save('account', 'a1', acc);
  await assert.rejects(db.ensureUser('bia'), { message: 'PENDING_OTHER_USER' });
  assert.equal((await db.list('account')).length, 1);
  assert.equal(await db.pending(), 1);
  assert.equal(await db.getMeta('user'), 'ana');
});

test('tx aborta quando a escrita falha no meio: nada parcial', async () => {
  await assert.rejects(
    db.applyChanges(
      [
        { kind: 'account', id: 'ok', deleted: false, data: acc },
        { kind: 'account', id: 'ruim', deleted: false, data: { f: () => 1 } }, // não clonável
      ],
      9,
    ),
  );
  assert.equal((await db.list('account')).length, 0, 'a primeira gravação foi desfeita');
  assert.equal(await db.getMeta('cursor'), null);
});

test('op recusada não entra em seen (reenvio devolveria o mesmo status)', async () => {
  await save('transaction', 'ruim', { description: 'x' });
  srv.forced = { ruim: 'rejected' };
  const [op] = await db.nextOps(10);
  await sync();
  assert.equal(srv.seen.has(op.op_id), false);
});

test('status diferente de ok/dup zera o cursor para reconciliar o que o pull pulou', async () => {
  srv.rows.set('account/x', { kind: 'account', id: 'x', rev: ++srv.rev, deleted: false, data: acc });
  await sync();
  assert.equal(await db.getMeta('cursor'), 1);
  await save('transaction', 'ruim', { description: 'x' });
  srv.forced = { ruim: 'rejected' };
  const since = [];
  const f = globalThis.fetch;
  globalThis.fetch = (url, init) => (init.method === 'GET' && since.push(new URL(url, 'http://x').searchParams.get('since')), f(url, init));
  await sync();
  assert.equal(since[0], '0', 'pull refeito do zero');
});

test('pull pagina enquanto more=true', async () => {
  for (const id of ['a', 'b', 'c']) srv.rows.set('account/' + id, { kind: 'account', id, rev: ++srv.rev, deleted: false, data: acc });
  srv.page = 2;
  await sync();
  assert.equal((await db.list('account')).length, 3);
  assert.equal(await db.getMeta('cursor'), 3);
});

test('servidor restaurado de backup (cursor > rev): reenfileira tudo e refaz o pull', async () => {
  await save('account', 'a1', acc);
  await sync();
  await db.setMeta('cursor', 50); // o app já tinha visto rev 50; o servidor voltou atrás
  srv.rows.clear();
  srv.rev = 0;
  srv.seen.clear();
  srv.applied.length = 0;
  assert.deepEqual(await sync(), { ok: true });
  assert.equal(srv.rows.has('account/a1'), true, 'a cópia local voltou para o servidor');
  assert.equal(await db.pending(), 0);
  assert.equal((await db.list('account')).length, 1);
  assert.equal(await db.getMeta('cursor'), 1);
});

// ---------- recusados, gone, lotes que dão 400/413, db ----------

const failWith = (status, when) => {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    if (init.method === 'POST') {
      const ops = JSON.parse(init.body).ops;
      sent.push(ops.length);
      if (when(ops)) return { ok: false, status, json: async () => ({ error: status === 413 ? 'corpo grande demais' : 'JSON inválido' }) };
    }
    return real(url, init);
  };
  return sent;
};

test('gone entra na lista de recusados com mensagem clara (e some do local pelo tombstone)', async () => {
  await save('transaction', 'tx1', { description: 'Mercado' });
  srv.forced = { tx1: 'gone' };
  srv.rows.set('transaction/tx1', { kind: 'transaction', id: 'tx1', rev: ++srv.rev, deleted: true, data: {} });
  await sync();
  const rej = await db.getMeta('rejected');
  assert.equal(rej.length, 1);
  assert.deepEqual([rej[0].id, rej[0].error, rej[0].label], ['tx1', 'foi excluído em outro aparelho', 'Mercado']);
  assert.equal(await db.pending(), 0);
  assert.equal(await db.get('transaction', 'tx1'), null);
});

test('corrigir (gravar de novo) um recusado tira da lista; descartar é atômico e reconcilia', async () => {
  await save('transaction', 'ruim', { description: 'x' });
  srv.forced = { ruim: 'rejected' };
  await sync();
  assert.equal((await db.getMeta('rejected')).length, 1);
  await save('transaction', 'ruim', { description: 'corrigido' });
  assert.equal((await db.getMeta('rejected')).length, 0, 'regravar = corrigir');
  srv.forced = { ruim: 'rejected' };
  await sync();
  assert.equal((await db.getMeta('rejected')).length, 1);
  assert.equal((await db.dismissRejectedAt(0)).id, 'ruim');
  assert.equal((await db.getMeta('rejected')).length, 0);
  assert.equal(await db.get('transaction', 'ruim'), null, 'cópia que nunca chegou ao servidor é descartada');
  assert.equal(await db.getMeta('cursor'), 0);
});

test('400 no lote: divide ao meio até achar a op ruim, que vai para recusados sem travar a fila', async () => {
  for (const id of ['a', 'b', 'poison', 'd', 'e']) await save('transaction', id, { description: id });
  const sent = failWith(400, (ops) => ops.some((o) => o.id === 'poison'));
  assert.deepEqual(await sync(), { ok: true });
  assert.equal(await db.pending(), 0, 'fila esvaziou');
  assert.deepEqual([...srv.rows.keys()].sort(), ['transaction/a', 'transaction/b', 'transaction/d', 'transaction/e']);
  const rej = await db.getMeta('rejected');
  assert.deepEqual(rej.map((r) => [r.id, r.error]), [['poison', 'JSON inválido']]);
  assert.ok(sent.includes(1) && sent[0] === 5, `tentou o lote inteiro e depois pedaços: ${sent}`);
});

test('413: lote grande demais é dividido e tudo chega', async () => {
  for (let i = 0; i < 6; i++) await save('transaction', 't' + i, { description: 'x' });
  failWith(413, (ops) => ops.length > 2);
  assert.deepEqual(await sync(), { ok: true });
  assert.equal(srv.rows.size, 6);
  assert.equal((await db.getMeta('rejected', [])).length, 0);
});

test('lote respeita o limite de bytes (~600 KB)', async () => {
  const big = 'x'.repeat(250_000);
  for (let i = 0; i < 5; i++) await save('transaction', 'g' + i, { description: big });
  const sent = failWith(200, () => false);
  await sync();
  assert.ok(sent.every((n) => n <= 2), `lotes: ${sent}`);
  assert.equal(srv.rows.size, 5);
});

test('openDb: promise rejeitada não fica guardada; reabre depois', async () => {
  const real = globalThis.indexedDB;
  await db.closeDb();
  globalThis.indexedDB = { open() { throw new Error('storage indisponível'); } };
  await assert.rejects(db.list('account'), /storage indisponível/);
  globalThis.indexedDB = real;
  assert.deepEqual(await db.list('account'), [], 'a segunda tentativa funciona');
});

test('onversionchange fecha a conexão para a outra aba poder atualizar', async () => {
  await db.list('account'); // abre
  const upgraded = await new Promise((ok, fail) => {
    const r = indexedDB.open('financas', 2);
    r.onsuccess = () => (r.result.close(), ok(true));
    r.onerror = () => fail(r.error);
    r.onblocked = () => fail(new Error('nossa conexão não fechou'));
  });
  assert.equal(upgraded, true);
});

test('applyChanges confere a geração dentro da transação', async () => {
  const g = db.generation();
  await db.wipe(); // sobe a geração: um pull em andamento não pode gravar nada depois
  await assert.rejects(db.applyChanges([{ kind: 'account', id: 'x', deleted: false, data: acc }], 5, g), /usuário mudou/);
  assert.equal((await db.list('account')).length, 0);
  assert.equal(await db.getMeta('cursor'), null);
});
