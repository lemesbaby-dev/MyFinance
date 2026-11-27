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
  const s = { rev: 0, gcRev: 0, rows: new Map(), seen: new Set(), online: true, loseResponse: false, forced: {}, applied: [], page: Infinity };
  // GC do servidor real: descarta os tombstones e guarda o maior rev descartado.
  s.gc = () => {
    for (const [k, r] of s.rows) if (r.deleted) (s.rows.delete(k), (s.gcRev = Math.max(s.gcRev, r.rev)));
  };
  const resync = { ok: false, status: 409, json: async () => ({ error: 'aparelho muito tempo sem sincronizar', resync: true }) };
  globalThis.fetch = async (url, init) => {
    if (!s.online) throw new TypeError('offline');
    const path = new URL(url, 'http://x');
    let body;
    if (init.method === 'POST') {
      const sent = JSON.parse(init.body);
      // o servidor real recusa campo desconhecido: marcas locais da fila (seq, create) não podem vazar
      if (sent.ops.some((op) => Object.keys(op).some((k) => !['op_id', 'kind', 'id', 'action', 'data'].includes(k)))) {
        return { ok: false, status: 400, json: async () => ({ error: 'JSON inválido: campo desconhecido' }) };
      }
      if ((sent.cursor ?? 0) < s.gcRev) return resync;
      const results = sent.ops.map((op) => {
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
      if (since < s.gcRev && path.searchParams.get('full') !== '1') return resync;
      const changes = all.slice(0, s.page);
      const more = all.length > changes.length;
      body = { changes, cursor: Math.max(changes.at(-1)?.rev ?? since, more ? 0 : s.gcRev), more, rev: s.rev };
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

test('resetLocal limpa dados, fila, recusados e cursor, mas mantém usuário e synced', async () => {
  await db.setMeta('user', 'u1');
  await db.setMeta('synced', true);
  await db.setMeta('cursor', 7);
  await db.setMeta('rejected', [{ kind: 'account', id: 'r', action: 'upsert' }]);
  await db.save('account', uuidv7(), acc);
  await db.resetLocal();
  assert.equal((await db.list('account')).length, 0);
  assert.equal(await db.pending(), 0);
  assert.equal(await db.unsent(), 0);
  assert.equal(await db.getMeta('cursor'), null);
  assert.equal(await db.getMeta('user'), 'u1');
  assert.equal(await db.getMeta('synced'), true);
});

// ---------- GC de tombstones no servidor: cópia local antiga demais é refeita ----------

const put = (id, data, deleted = false) => srv.rows.set('account/' + id, { kind: 'account', id, rev: ++srv.rev, deleted, data });
const names = async () => (await db.list('account')).map((a) => a.id + '=' + a.name).sort();

test('ressincronização: a cópia local fica igual à do servidor e a fila pendente sobrevive', async () => {
  for (const id of ['a', 'b', 'c']) put(id, { ...acc, name: id });
  await sync();
  srv.online = false; // o aparelho some por muito tempo, com alterações na fila
  await save('account', 'b', { ...acc, name: 'b editado offline' });
  await save('account', 'novo', { ...acc, name: 'criado offline' });
  await remove('account', 'c');
  await sync();
  assert.equal(await db.pending(), 3);

  put('a', {}, true); // outro aparelho exclui `a` e cria `d`; o GC descarta o tombstone de `a`
  put('d', { ...acc, name: 'd' });
  srv.gc();
  assert.equal(srv.rows.has('account/a'), false);

  // só a troca da cópia local, ainda sem enviar nada: o que o servidor tem + a fila reaplicada
  await db.replaceAll([...srv.rows.values()], srv.rev);
  assert.deepEqual(await names(), ['b=b editado offline', 'd=d', 'novo=criado offline'], '`a` saiu; a fila continua valendo');
  assert.equal(await db.pending(), 3, 'a fila sobrevive');
  assert.equal((await db.getMeta('rejected', [])).length, 0);
});

test('ressincronização pelo sync: push recusado, cópia refeita em páginas, fila reenviada', async () => {
  for (const id of ['a', 'b', 'c']) put(id, { ...acc, name: id });
  await sync();
  srv.online = false;
  await save('account', 'b', { ...acc, name: 'b editado offline' });
  await save('account', 'novo', { ...acc, name: 'criado offline' });
  await sync();
  srv.online = true;
  put('a', {}, true);
  put('d', { ...acc, name: 'd' });
  srv.gc();
  srv.page = 2;

  assert.deepEqual(await sync(), { ok: true });
  assert.deepEqual(await names(), ['b=b editado offline', 'c=c', 'd=d', 'novo=criado offline']);
  const live = [...srv.rows.values()].filter((r) => !r.deleted).map((r) => r.id + '=' + r.data.name).sort();
  assert.deepEqual(live, await names(), 'local e servidor iguais');
  assert.equal(await db.pending(), 0);
  assert.equal((await db.getMeta('rejected', [])).length, 0);
  assert.ok((await db.getMeta('cursor')) >= srv.gcRev, 'cursor passou do marco: o próximo sync é incremental');
  const gets = [];
  const f = globalThis.fetch;
  globalThis.fetch = (url, init) => (init.method === 'GET' && gets.push(url), f(url, init));
  assert.deepEqual(await sync(), { ok: true });
  assert.ok(gets.length === 1 && !gets[0].includes('full'), `segue incremental: ${gets}`);
});

test('ressincronização sem documento com rev alto: o cursor alcança o marco e não entra em laço', async () => {
  put('a', { ...acc, name: 'a' });
  put('b', { ...acc, name: 'b' });
  await sync();
  put('b', {}, true);
  srv.gc(); // sobra só `a` (rev 1); marco = 3
  assert.deepEqual(await sync(), { ok: true });
  assert.deepEqual(await names(), ['a=a']);
  assert.equal(await db.getMeta('cursor'), srv.gcRev);
  await save('account', 'z', { ...acc, name: 'z' });
  assert.deepEqual(await sync(), { ok: true }, 'o push seguinte não é mais recusado');
  assert.equal(srv.rows.has('account/z'), true);
});

test('ressincronização: edição pendente de documento excluído e já coletado não o ressuscita', async () => {
  put('a', { ...acc, name: 'a' });
  put('conta', { ...acc, name: 'conta' });
  await sync();
  srv.online = false;
  await save('account', 'a', { ...acc, name: 'a editado offline' }); // edição: o servidor já conhecia `a`
  await sync();
  srv.online = true;
  put('a', {}, true);
  srv.gc();

  assert.deepEqual(await sync(), { ok: true });
  assert.equal(srv.rows.has('account/a'), false, 'não voltou para o servidor');
  assert.equal(await db.get('account', 'a'), null, 'nem ficou na cópia local');
  assert.equal(await db.pending(), 0);
  const rej = await db.getMeta('rejected');
  assert.deepEqual(rej.map((r) => [r.id, r.action, r.label, r.error]), [['a', 'upsert', 'a editado offline', 'foi excluído em outro aparelho']]);
  assert.deepEqual(await names(), ['conta=conta']);
});

test('ressincronização: criar e depois editar offline continua sendo criação', async () => {
  put('a', { ...acc, name: 'a' });
  await sync();
  srv.online = false;
  await save('account', 'novo', { ...acc, name: 'v1' });
  await save('account', 'novo', { ...acc, name: 'v2' });
  await sync();
  srv.online = true;
  put('a', {}, true);
  srv.gc();
  assert.deepEqual(await sync(), { ok: true });
  assert.equal(srv.rows.get('account/novo').data.name, 'v2');
  assert.equal((await db.getMeta('rejected', [])).length, 0);
});

test('ressincronização: operação enfileirada pelo app antigo (sem a marca) não é enviada nem perdida', async () => {
  put('a', { ...acc, name: 'a' });
  await sync();
  srv.online = false;
  await save('account', 'x', { ...acc, name: 'pode ser novo ou excluído' });
  await sync();
  srv.online = true;
  const idb = await db.openDb(); // fila gravada antes desta versão: sem `create`
  await new Promise((ok, fail) => {
    const t = idb.transaction('outbox', 'readwrite');
    const st = t.objectStore('outbox');
    st.getAll().onsuccess = (e) => e.target.result.forEach(({ create, ...op }) => st.put(op));
    t.oncomplete = ok;
    t.onerror = () => fail(t.error);
  });
  put('a', {}, true);
  srv.gc();

  assert.deepEqual(await sync(), { ok: true });
  assert.equal(srv.rows.has('account/x'), false, 'na dúvida, não recria no servidor');
  assert.equal((await db.get('account', 'x')).name, 'pode ser novo ou excluído', 'e não apaga o que o usuário digitou');
  // sem a marca não dá para afirmar que foi excluído em outro aparelho: a mensagem diz o que fazer
  assert.deepEqual((await db.getMeta('rejected')).map((r) => [r.id, r.error]), [['x', 'não foi enviado; salve de novo para manter']], 'fica como recusado para o usuário decidir');
  await save('account', 'x', { ...acc, name: 'salvo de novo' }); // salvar de novo = recriar
  assert.deepEqual(await sync(), { ok: true });
  assert.equal(srv.rows.get('account/x').data.name, 'salvo de novo');
});

test('ressincronização: recusado que nunca chegou ao servidor continua local', async () => {
  await save('account', 'ruim', { ...acc, name: 'recusado' });
  srv.forced = { ruim: 'rejected' };
  await sync();
  put('a', { ...acc, name: 'a' });
  put('a', {}, true);
  srv.gc();
  assert.deepEqual(await sync(), { ok: true });
  assert.equal((await db.get('account', 'ruim')).name, 'recusado');
  assert.equal((await db.getMeta('rejected')).length, 1);
});

test('replaceAll confere a geração dentro da transação', async () => {
  const g = db.generation();
  await db.wipe();
  await assert.rejects(db.replaceAll([{ kind: 'account', id: 'x', deleted: false, data: acc }], 5, g), /usuário mudou/);
  assert.equal((await db.list('account')).length, 0);
});

test('recusas em lotes diferentes, com marco de GC no servidor: um sync só resolve, sem erro falso', async () => {
  put('a', { ...acc, name: 'a' });
  put('b', { ...acc, name: 'b' });
  put('b', {}, true);
  srv.gc(); // marco = 3
  assert.deepEqual(await sync(), { ok: true });
  assert.equal(await db.getMeta('cursor'), srv.gcRev, 'aparelho em dia');

  // três lotes na fila (200 por lote), com recusa nos dois primeiros
  await db.saveMany(Array.from({ length: 450 }, (_, i) => ({ kind: 'account', id: 'n' + i, data: { ...acc, name: 'n' + i } })));
  srv.forced = { n0: 'rejected', n220: 'rejected' };
  assert.deepEqual(await sync(), { ok: true });
  assert.equal(await db.pending(), 0);
  assert.deepEqual((await db.getMeta('rejected')).map((r) => r.id), ['n0', 'n220']);
  assert.equal(srv.applied.filter((o) => o.id.startsWith('n')).length, 448);
});

test('salvar de novo um recusado é criação (o servidor nunca teve o documento)', async () => {
  await save('account', 'x', acc);
  srv.forced = { x: 'rejected' };
  await sync();
  assert.equal((await db.getMeta('rejected')).length, 1);
  assert.ok(await db.get('account', 'x'), 'a cópia local do recusado continua');
  await save('account', 'x', { ...acc, name: 'corrigido' });
  assert.deepEqual((await db.nextOps(10)).map((o) => [o.id, o.create]), [['x', true]]);
  await save('account', 'x', { ...acc, name: 'de novo' }); // já saiu dos recusados e há cópia local: edição comum
  assert.deepEqual((await db.nextOps(10)).map((o) => o.create), [true, false]);
});

test('requeueAll marca tudo como criação (o servidor restaurado perdeu os documentos)', async () => {
  await save('account', 'a', acc);
  await save('account', 'a', { ...acc, name: 'editado' }); // a 2ª gravação é edição (create: false)
  await sync();
  assert.equal(await db.pending(), 0);
  await db.requeueAll();
  assert.deepEqual((await db.nextOps(10)).map((o) => [o.id, o.create]), [['a', true]]);
});
