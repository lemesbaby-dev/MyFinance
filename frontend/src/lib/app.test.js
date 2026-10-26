// node --test  (app.svelte.js usa runas do Svelte: compilamos com compileModule e rodamos sobre fake-indexeddb)
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModule } from 'svelte/compiler';

globalThis.localStorage = { getItem: () => JSON.stringify({ url: '', token: 't' }), setItem() {} };
globalThis.addEventListener = () => {};
globalThis.document = { addEventListener() {}, visibilityState: 'hidden' };
// sem envio automático 1,5 s depois de cada gravação (o servidor falso só entra nos testes que pedem)
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (f, ms, ...a) => (ms === 1500 ? 0 : realSetTimeout(f, ms, ...a));
let online = false;
let pullRev = 0;
globalThis.fetch = async (url, init) => {
  if (!online) throw new TypeError('offline');
  const body = init.method === 'POST'
    ? { results: JSON.parse(init.body).ops.map((o) => ({ op_id: o.op_id, status: 'ok' })) }
    : { changes: [], cursor: 0, more: false, rev: pullRev };
  return { ok: true, status: 200, json: async () => body };
};

const lib = (n) => new URL(`./${n}`, import.meta.url).href;
const dir = mkdtempSync(join(tmpdir(), 'app-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));
let code = readFileSync(new URL('./app.svelte.js', import.meta.url), 'utf8').replace(/from '\.\/([\w.]+)'/g, (m, n) => `from '${lib(n)}'`);
code = compileModule(code, { generate: 'client', filename: 'app.svelte.js' }).js.code
  .replace(/from 'svelte\/internal\/client'/g, `from '${new URL('../../node_modules/svelte/src/internal/client/index.js', import.meta.url).href}'`);
writeFileSync(join(dir, 'app.svelte.mjs'), code);

const db = await import('./db.js');
const sync = await import('./sync.js');
const A = await import(pathToFileURL(join(dir, 'app.svelte.mjs')).href);
const { app } = A;
const { addMonths, addDays, horizon, todayISO } = await import('./finance.js');

beforeEach(async () => {
  await A.idle();
  await db.closeDb();
  globalThis.indexedDB = new IDBFactory();
  A.clearApp();
  online = false;
});

const Y = new Date().getFullYear();
const START = `${Y - 1}-01-31`; // dia 31, no passado: gera ocorrências vencidas e futuras até o horizonte
const byDate = (a, b) => a.date.localeCompare(b.date);
const occ = (rid) => app.transactions.filter((t) => t.recurrence_id === rid).sort(byDate);

async function seed(over = {}) {
  if (!app.accounts.length) await A.saveAccount(null, { name: 'Conta', type: 'checking', initial_balance_cents: 0 });
  const id = over.id ?? `rec${Math.random().toString(36).slice(2)}`;
  await db.save('recurrence', id, {
    kind: 'expense', description: 'Aluguel', amount_cents: 10000, account_id: app.accounts[0].id, category_id: null,
    frequency: 'monthly', interval_n: 1, start_date: START, end_date: null, active: true, generated_until: null, ...over,
  });
  await A.reload();
  await A.extendRecurrences();
  return app.recurrences.find((r) => r.id === id);
}
const rule = (id) => app.recurrences.find((r) => r.id === id);
const anchored = (start, d) => Array.from({ length: 60 }, (_, k) => addMonths(start, k)).includes(d);

test('1. offline na 1ª abertura NÃO marca synced; só push+pull completos marcam', async () => {
  await A.init({ id: 'u1', email: 'a@x.com' });
  await sync.sync(); // offline
  assert.equal(app.synced, false);
  assert.equal(await db.getMeta('synced', false), false);
  assert.equal((await sync.sync()).ok, false);

  online = true;
  assert.deepEqual(await sync.sync(), { ok: true });
  for (let i = 0; i < 50 && !app.synced; i++) await new Promise((r) => realSetTimeout(r, 10));
  assert.equal(app.synced, true);
  assert.equal(await db.getMeta('synced', false), true);
});

test('db.saveMany é tudo ou nada', async () => {
  await assert.rejects(db.saveMany([
    { kind: 'account', id: 'a', data: { name: 'ok' } },
    { kind: 'account', id: 'b', data: { f() {} } }, // não clonável: aborta a transação
  ]));
  assert.equal((await db.list('account')).length, 0);
  assert.equal(await db.pending(), 0);
});

test('createRecurrence: atômica (regra+ocorrências+fila) e idempotente', async () => {
  await A.saveAccount(null, { name: 'Conta', type: 'checking', initial_balance_cents: 0 });
  const before = await db.pending();
  await A.createRecurrence({ kind: 'expense', description: 'Gym', amount_cents: 9900, account_id: app.accounts[0].id, frequency: 'monthly', start_date: START });
  const r = app.recurrences[0];
  const txs = occ(r.id);
  assert.equal(r.generated_until, horizon(todayISO()));
  assert.ok(txs.length >= 24);
  assert.equal(await db.pending(), before + txs.length + 1);
  const n = await db.pending();
  await A.extendRecurrences();
  assert.equal(occ(r.id).length, txs.length, 'estender de novo não duplica');
  assert.equal(await db.pending(), n, 'nem regrava a regra');
  assert.equal(new Set(txs.map((t) => t.date)).size, txs.length);
});

test('extendRecurrences concorrente não duplica datas', async () => {
  await A.saveAccount(null, { name: 'Conta', type: 'checking', initial_balance_cents: 0 });
  const id = 'r-conc';
  await db.save('recurrence', id, { kind: 'expense', description: 'X', amount_cents: 1, account_id: app.accounts[0].id, category_id: null,
    frequency: 'monthly', interval_n: 1, start_date: START, end_date: null, active: true, generated_until: null });
  await A.reload();
  await Promise.all([A.extendRecurrences(), A.extendRecurrences(), A.extendRecurrences(), A.extendRecurrences()]);
  const dates = occ(id).map((t) => t.date);
  assert.ok(dates.length >= 24);
  assert.equal(new Set(dates).size, dates.length);
});

test('editRecurring one: só a ocorrência', async () => {
  const r = await seed();
  const t = occ(r.id)[5];
  await A.editRecurring(t, 'one', { description: 'Só esta', date: t.date });
  assert.equal(app.transactions.find((x) => x.id === t.id).description, 'Só esta');
  assert.equal(occ(r.id).filter((x) => x.description === 'Só esta').length, 1);
  assert.deepEqual(rule(r.id), r);
});

test('editRecurring following: corta a regra, mantém a clicada, copia a regra (dia 31, end_date) sem duplicar', async () => {
  const end = addMonths(START, 30);
  const r = await seed({ end_date: end });
  const all = occ(r.id);
  const t = all[5];
  const total = all.length;
  await A.editRecurring(t, 'following', { amount_cents: 20000, date: t.date, description: 'Aluguel', status: 'pending', paid_at: null });
  const old = rule(r.id);
  assert.equal(old.end_date, addDays(t.date, -1));
  assert.deepEqual(occ(r.id).map((x) => x.date), all.slice(0, 5).map((x) => x.date), 'sobram só as anteriores na regra antiga');

  const nr = app.recurrences.find((x) => x.id !== r.id);
  assert.equal(nr.start_date, START);
  assert.equal(nr.end_date, end);
  assert.equal(nr.amount_cents, 20000);
  assert.equal(nr.frequency, 'monthly');
  assert.ok(nr.generated_until >= horizon(todayISO()) || nr.generated_until >= end);
  const mine = occ(nr.id);
  assert.equal(mine[0].id, t.id, 'a clicada foi religada à regra nova');
  assert.equal(mine[0].amount_cents, 20000);
  assert.equal(mine.length + 5, total, 'mesmo total de ocorrências (até end_date)');
  const dates = mine.map((x) => x.date);
  assert.equal(new Set(dates).size, dates.length, 'sem datas duplicadas');
  for (const d of dates) assert.ok(anchored(START, d), `${d} deveria manter o dia-âncora 31`);
  assert.ok(dates.every((d) => d <= end));
  assert.ok(mine.slice(1).every((x) => x.amount_cents === 20000));
});

test('editRecurring following em ocorrência paga ou na 1ª ocorrência', async () => {
  const r = await seed();
  const all = occ(r.id);
  await A.setPaid(all[3], true);
  await A.editRecurring(app.transactions.find((x) => x.id === all[3].id), 'following', { amount_cents: 777, date: all[3].date });
  assert.equal(app.recurrences.length, 1, 'paga: só esta, sem regra nova');
  assert.equal(app.transactions.find((x) => x.id === all[3].id).amount_cents, 777);
  assert.equal(occ(r.id).filter((x) => x.amount_cents === 777).length, 1);
  assert.equal(rule(r.id).end_date, null);

  await A.editRecurring(all[0], 'following', { amount_cents: 555, date: all[0].date });
  assert.equal(app.recurrences.length, 1, '1ª ocorrência = regra inteira');
  assert.equal(rule(r.id).amount_cents, 555);
  assert.ok(occ(r.id).filter((x) => x.status === 'pending').every((x) => x.amount_cents === 555 || x.id === all[3].id));
});

test('editRecurring all: só campos compartilhados que mudaram; pagas intactas; clicada recebe tudo', async () => {
  const r = await seed();
  const all = occ(r.id);
  await A.setPaid(all[1], true);
  await A.saveTx(all[2].id, { description: 'Especial' }); // edição individual anterior
  const t = app.transactions.find((x) => x.id === all[6].id);
  const newDate = addDays(t.date, 3);
  await A.editRecurring(t, 'all', { description: t.description, amount_cents: 5000, account_id: t.account_id, category_id: null, date: newDate });
  assert.equal(rule(r.id).amount_cents, 5000);
  assert.equal(rule(r.id).description, 'Aluguel');
  const now = Object.fromEntries(occ(r.id).map((x) => [x.id, x]));
  assert.equal(now[all[1].id].amount_cents, 10000, 'paga não muda');
  assert.equal(now[all[2].id].description, 'Especial', 'campo que não mudou não é propagado');
  assert.equal(now[all[2].id].amount_cents, 5000);
  assert.equal(now[all[8].id].amount_cents, 5000);
  assert.equal(now[t.id].date, newDate, 'a clicada recebe a data');
  assert.equal(now[all[7].id].date, all[7].date, 'as outras não mudam de data');
});

test('deleteRecurring: one / following / all, pago e end_date', async () => {
  const r = await seed();
  const all = occ(r.id);
  await A.setPaid(all[2], true);
  await A.deleteRecurring(app.transactions.find((x) => x.id === all[2].id), 'all'); // paga: só esta
  assert.equal(occ(r.id).length, all.length - 1);
  assert.equal(rule(r.id).active, true);

  await A.deleteRecurring(all[4], 'one');
  assert.equal(occ(r.id).length, all.length - 2);

  await A.deleteRecurring(all[8], 'following');
  assert.deepEqual(occ(r.id).map((x) => x.date), all.slice(0, 8).filter((x) => x.id !== all[2].id && x.id !== all[4].id).map((x) => x.date));
  assert.equal(rule(r.id).end_date, addDays(all[8].date, -1));
  assert.equal(rule(r.id).active, true);

  await A.setPaid(all[0], true);
  await A.deleteRecurring(app.transactions.find((x) => x.id === all[5].id), 'all');
  assert.deepEqual(occ(r.id).map((x) => x.id), [all[0].id]);
  assert.ok(occ(r.id).every((x) => x.status === 'paid'));
  assert.equal(rule(r.id).active, false);
  await A.extendRecurrences();
  assert.ok(occ(r.id).every((x) => x.status === 'paid'), 'regra encerrada não gera mais');
});

test('deleteRecurring following na 1ª ocorrência desativa a regra', async () => {
  const r = await seed();
  await A.deleteRecurring(occ(r.id)[0], 'following');
  assert.equal(occ(r.id).length, 0);
  assert.equal(rule(r.id).active, false);
});

test('deleteCategory: cascata atômica (lançamentos, recorrências e filhas soltam a referência)', async () => {
  await A.saveAccount(null, { name: 'Conta', type: 'checking', initial_balance_cents: 0 });
  await A.saveCategory('cat1', { name: 'Casa', kind: 'expense' });
  await A.saveCategory('cat2', { name: 'Luz', kind: 'expense', parent_id: 'cat1' });
  const r = await seed({ category_id: 'cat1' });
  await A.saveTx(null, { kind: 'expense', description: 'x', amount_cents: 1, date: START, account_id: app.accounts[0].id, category_id: 'cat1' });
  await A.deleteCategory('cat1');
  assert.deepEqual(app.categories.map((c) => c.id), ['cat2']);
  assert.equal(app.categories[0].parent_id, null);
  assert.equal(rule(r.id).category_id, null);
  assert.ok(app.transactions.every((t) => t.category_id === null));
  const ops = await db.nextOps(1000);
  assert.ok(ops.some((o) => o.kind === 'category' && o.id === 'cat1' && o.action === 'delete'));
});

// O servidor valida referências: a regra precisa chegar ANTES dos lançamentos que a citam.
// (Regressão real: com a regra no fim da fila, todas as ocorrências voltavam "recorrência inválida".)
async function assertRuleBeforeOccurrences() {
  const ops = await db.nextOps(100000);
  const firstRule = new Map();
  ops.forEach((o, i) => { if (o.kind === 'recurrence' && o.action === 'upsert' && !firstRule.has(o.id)) firstRule.set(o.id, i); });
  let checked = 0;
  ops.forEach((o, i) => {
    const rid = o.kind === 'transaction' && o.action === 'upsert' ? o.data.recurrence_id : null;
    if (rid && firstRule.has(rid)) {
      checked++;
      assert.ok(firstRule.get(rid) < i, `lançamento ${o.id} na posição ${i} antes da regra ${rid} (${firstRule.get(rid)})`);
    }
  });
  assert.ok(checked > 0, 'o teste precisa ter verificado alguma ocorrência');
}

test('ordem da fila: regra antes das ocorrências (criar e "este e os próximos")', async () => {
  await A.saveAccount(null, { name: 'Conta', type: 'checking', initial_balance_cents: 0 });
  await A.createRecurrence({ kind: 'expense', description: 'Gym', amount_cents: 9900, account_id: app.accounts[0].id, frequency: 'monthly', start_date: START });
  await assertRuleBeforeOccurrences();
  const r = app.recurrences[0];
  const t = occ(r.id)[5];
  await A.editRecurring(t, 'following', { amount_cents: 12000, date: t.date, description: 'Gym', status: 'pending', paid_at: null });
  await assertRuleBeforeOccurrences();
});
