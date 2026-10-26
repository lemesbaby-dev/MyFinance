// Vetores portados de backend/internal/finance/finance_test.go (que deixou de existir) + saldos e visão do mês.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money, parseMoney } from './format.js';
import {
  addMonths, addDays, occurrences, splitInstallments, balances, monthView, materialize, horizon, shiftMonth, monthEnd,
  validateRule, parseISO, txDoc,
} from './finance.js';

const nbsp = (s) => s.replace(/ /g, ' ');

test('money: formata BRL', () => {
  const cases = { 0: 'R$ 0,00', 5: 'R$ 0,05', 123456: 'R$ 1.234,56', 100000000: 'R$ 1.000.000,00', [-2550]: '-R$ 25,50' };
  for (const [c, want] of Object.entries(cases)) assert.equal(nbsp(money(+c)), want);
});

test('parseMoney: aceita formatos brasileiros e rejeita lixo', () => {
  const cases = { '1.234,56': 123456, '1234,56': 123456, '1234.56': 123456, 'R$ 12,5': 1250, 12: 1200, '0,99': 99, '-10,00': -1000, '1.000': 100000 };
  for (const [s, want] of Object.entries(cases)) assert.equal(parseMoney(s), want, s);
  for (const bad of ['', 'abc', 'R$']) assert.equal(parseMoney(bad), null, bad);
});

test('datas: validação e aritmética', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '01/10/2026', '', null]) assert.throws(() => parseISO(bad), bad);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(addMonths('2026-01-15', -2), '2025-11-15');
  assert.equal(monthEnd('2028-02'), '2028-02-29');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

const rule = (o) => ({ frequency: 'monthly', interval_n: 1, start_date: '2026-01-31', end_date: null, ...o });

test('mensal: dia 31 encolhe em mês curto e volta (31/01 → 28/02 → 31/03)', () => {
  assert.deepEqual(occurrences(rule({}), '2026-01-01', '2026-05-31'),
    ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
});

test('mensal: ano bissexto', () => {
  assert.deepEqual(occurrences(rule({ start_date: '2028-01-31' }), '2028-02-01', '2028-02-29'), ['2028-02-29']);
});

test('intervalo e data final', () => {
  assert.deepEqual(occurrences(rule({ interval_n: 3, start_date: '2026-01-15', end_date: '2026-12-01' }), '2026-01-01', '2030-01-01'),
    ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']);
});

test('janela começa depois do início da regra', () => {
  assert.deepEqual(occurrences(rule({ frequency: 'weekly', interval_n: 2, start_date: '2026-01-01' }), '2026-01-20', '2026-02-20'),
    ['2026-01-29', '2026-02-12']);
});

test('anual: 29/02', () => {
  assert.deepEqual(occurrences(rule({ frequency: 'yearly', start_date: '2028-02-29' }), '2028-01-01', '2030-12-31'),
    ['2028-02-29', '2029-02-28', '2030-02-28']);
});

test('regra inválida é recusada', () => {
  for (const bad of [{ frequency: 'x' }, { interval_n: 0 }, { interval_n: 1001 }, { interval_n: 1.5 }, { end_date: '2025-01-01' }, { start_date: '2026-02-30' }]) {
    assert.throws(() => validateRule(rule(bad)), JSON.stringify(bad));
  }
});

test('parcelas: soma = total, sobra nas primeiras, mês curto', () => {
  const ps = splitInstallments(10000, 3, '2026-01-31');
  assert.deepEqual(ps.map((p) => p.amount_cents), [3334, 3333, 3333]);
  assert.deepEqual(ps.map((p) => p.date), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.deepEqual(ps.map((p) => p.no), [1, 2, 3]);
  assert.equal(ps.reduce((s, p) => s + p.amount_cents, 0), 10000);
  assert.throws(() => splitInstallments(0, 3, '2026-01-01'));
  assert.throws(() => splitInstallments(100, 0, '2026-01-01'));
  assert.throws(() => splitInstallments(100, 121, '2026-01-01'));
  for (const n of [1, 7, 60, 120]) assert.equal(splitInstallments(99999, n, '2026-01-01').reduce((s, p) => s + p.amount_cents, 0), 99999);
});

// ---- saldos (mesmos números do antigo TestSaldosAtualEPrevisto do Go) ----
const accounts = [
  { id: 'nu', name: 'Nubank', type: 'checking', initial_balance_cents: 100000, archived: false },
  { id: 'ca', name: 'Carteira', type: 'cash', initial_balance_cents: 5000, archived: false },
];
const tx = (o) => txDoc({ account_id: 'nu', description: 'x', ...o });
const txs = [
  tx({ id: 1, kind: 'income', amount_cents: 500000, date: '2026-10-05', status: 'paid', paid_at: '2026-10-05' }),
  tx({ id: 2, kind: 'expense', amount_cents: 150000, date: '2026-10-10', status: 'paid', paid_at: '2026-10-10' }),
  tx({ id: 3, kind: 'transfer', amount_cents: 20000, date: '2026-10-12', status: 'paid', paid_at: '2026-10-12', transfer_account_id: 'ca' }),
  tx({ id: 4, kind: 'expense', amount_cents: 30000, date: '2026-10-20' }),
  tx({ id: 5, kind: 'expense', amount_cents: 12000, date: '2026-10-30' }),
  tx({ id: 6, kind: 'income', amount_cents: 80000, date: '2026-11-10' }),
];

test('saldo atual e previsto, por conta e total', () => {
  const b = balances(accounts, txs, '2026-10-31');
  assert.equal(b.current_cents, 455000);
  assert.equal(b.projected_cents, 413000);
  const by = Object.fromEntries(b.accounts.map((a) => [a.id, a]));
  assert.deepEqual([by.nu.current_cents, by.nu.projected_cents], [430000, 388000]);
  assert.deepEqual([by.ca.current_cents, by.ca.projected_cents], [25000, 25000]);
  assert.equal(balances(accounts, txs, '2026-11-30').projected_cents, 493000);
});

test('pagar muda o atual, não o previsto; atrasado entra no previsto', () => {
  const t = [tx({ kind: 'expense', amount_cents: 4000, date: '2026-10-15' })];
  const a = [{ ...accounts[0], initial_balance_cents: 10000 }];
  let b = balances(a, t, '2026-10-31');
  assert.deepEqual([b.current_cents, b.projected_cents], [10000, 6000]);
  b = balances(a, [{ ...t[0], status: 'paid', paid_at: '2026-10-15' }], '2026-10-31');
  assert.deepEqual([b.current_cents, b.projected_cents], [6000, 6000]);
  b = balances(a, [tx({ kind: 'expense', amount_cents: 500, date: '2020-01-01' })], '2026-10-31'); // atrasado
  assert.equal(b.projected_cents, 9500);
});

test('conta arquivada fica fora dos saldos', () => {
  const b = balances([{ ...accounts[0], archived: true }, accounts[1]], txs, '2026-10-31');
  assert.deepEqual(b.accounts.map((a) => a.id), ['ca']);
});

// ---- visão do mês: Todos / Pendentes / Efetivados ----
const month = '2026-10';
const today = '2026-10-15';
const mtx = [...txs, tx({ id: 7, kind: 'expense', amount_cents: 777, date: '2026-09-25', category_id: 'c1' }), // atrasado de setembro
  tx({ id: 8, kind: 'expense', amount_cents: 2500, date: '2026-10-25', category_id: 'c1' })];

test('filtro Todos soma pagos e pendentes; transferência fica fora dos totais', () => {
  const v = monthView(mtx, month, 'all', today);
  assert.equal(v.rows.length, 6); // ids 1-5 e 8 (o 6 é de novembro e o 7, de setembro)
  assert.equal(v.income_cents, 500000);
  assert.equal(v.expense_cents, 150000 + 30000 + 12000 + 2500);
  assert.equal(v.result_cents, v.income_cents - v.expense_cents);
  assert.ok(v.rows.some((r) => r.kind === 'transfer'), 'transferência aparece na lista');
});

test('filtro Pendentes e Efetivados separam lista, totais e categorias', () => {
  const p = monthView(mtx, month, 'pending', today);
  assert.deepEqual(p.rows.map((r) => r.id), [4, 8, 5]);
  assert.equal(p.expense_cents, 30000 + 2500 + 12000);
  assert.equal(p.income_cents, 0);
  const f = monthView(mtx, month, 'paid', today);
  assert.deepEqual(f.rows.map((r) => r.id), [1, 2, 3]);
  assert.equal(f.income_cents, 500000);
  assert.equal(f.expense_cents, 150000);
  assert.deepEqual(f.spending, [{ category_id: null, cents: 150000 }]);
  assert.deepEqual(p.spending[0], { category_id: null, cents: 42000 });
  assert.deepEqual(p.spending[1], { category_id: 'c1', cents: 2500 });
});

test('atrasados de meses anteriores: aparecem em Todos/Pendentes no mês atual e futuros, nunca em Efetivados', () => {
  assert.deepEqual(monthView(mtx, month, 'all', today).overdue.map((r) => r.id), [7]);
  assert.deepEqual(monthView(mtx, month, 'pending', today).overdue.map((r) => r.id), [7]);
  assert.deepEqual(monthView(mtx, month, 'paid', today).overdue, []);
  assert.deepEqual(monthView(mtx, '2026-09', 'all', today).overdue, [], 'mês passado: o atrasado é da própria lista');
  assert.deepEqual(monthView(mtx, '2026-09', 'pending', today).rows.map((r) => r.id), [7]);
});

// ---- materialização de recorrências ----
let seq = 0;
const newId = () => 'id' + ++seq;
const rec = { id: 'r1', kind: 'expense', description: 'Academia', amount_cents: 9900, account_id: 'nu', category_id: null,
  frequency: 'monthly', interval_n: 1, start_date: '2026-10-01', end_date: null, active: true, generated_until: null };

test('horizonte: hoje + 12 meses, sem estourar no dia 31', () => {
  assert.equal(horizon('2026-10-15'), '2027-10-15');
  assert.equal(horizon('2026-08-31', 6), '2027-02-28');
});

test('materializar: 13 ocorrências, idempotente, janela rola, exclusão não ressuscita', () => {
  const h = horizon('2026-10-15'); // 2027-10-15
  const m1 = materialize(rec, h, newId);
  assert.equal(m1.txs.length, 13); // out/26 ... out/27
  assert.equal(m1.txs[0].data.recurrence_id, 'r1');
  assert.equal(m1.txs[0].data.status, 'pending');
  const recAfter = { ...rec, generated_until: m1.generated_until };

  assert.equal(materialize(recAfter, h, newId).txs.length, 0, 'rodar de novo não duplica');

  // usuário exclui uma ocorrência já gerada; reabrir o app não a recria
  const m2 = materialize(recAfter, horizon('2026-12-15'), newId); // horizonte avança 2 meses
  assert.deepEqual(m2.txs.map((t) => t.data.date), ['2027-11-01', '2027-12-01']);
  assert.equal(m2.generated_until, '2027-12-15');

  assert.equal(materialize({ ...rec, active: false }, h, newId).txs.length, 0);
  assert.equal(materialize({ ...rec, end_date: '2026-12-31' }, h, newId).txs.length, 3);
});
