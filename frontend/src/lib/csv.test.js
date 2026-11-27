import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCSV } from './csv.js';

const accounts = [{ id: 'a1', name: 'Carteira' }, { id: 'a2', name: 'Banco; "Roxo"' }];
const categories = [{ id: 'c1', name: 'Mercado' }];
const tx = (f) => ({ kind: 'expense', description: 'x', amount_cents: 100, date: '2026-10-30', status: 'paid', account_id: 'a1', transfer_account_id: null, category_id: null, installment_no: null, installment_total: null, notes: '', ...f });
const lines = (csv) => csv.slice(1).split('\r\n');

test('toCSV: BOM, cabeçalho, CRLF e ordem por data', () => {
  const csv = toCSV([tx({ description: 'depois', date: '2026-11-02' }), tx({ description: 'antes', date: '2026-01-15', category_id: 'c1', installment_no: 2, installment_total: 10, status: 'pending' })], accounts, categories);
  assert.equal(csv[0], '\uFEFF');
  assert.deepEqual(lines(csv), [
    'Data;Descrição;Tipo;Valor;Situação;Conta;Conta de destino;Categoria;Parcela;Notas',
    '15/01/2026;antes;Despesa;-1,00;Pendente;Carteira;;Mercado;2 de 10;',
    '02/11/2026;depois;Despesa;-1,00;Efetivado;Carteira;;;;',
    '',
  ]);
});

test('toCSV: valor sai de centavos inteiros, com vírgula e sem float', () => {
  const cases = { 5: '0,05', 99: '0,99', 100: '1,00', 123456: '1234,56', 1999: '19,99', 99999999999999: '999999999999,99' };
  for (const [c, want] of Object.entries(cases)) {
    assert.equal(lines(toCSV([tx({ kind: 'income', amount_cents: +c })], accounts, categories))[1].split(';')[3], want, c);
  }
  assert.equal(lines(toCSV([tx({ amount_cents: 1050 })], accounts, categories))[1].split(';')[3], '-10,50');
});

test('toCSV: escapa separador, aspas e quebra de linha', () => {
  const row = lines(toCSV([tx({ description: 'pão; "francês"', notes: 'linha 1\nlinha 2', account_id: 'a2' })], accounts, categories))[1];
  assert.equal(row, '30/10/2026;"pão; ""francês""";Despesa;-1,00;Efetivado;"Banco; ""Roxo""";;;;"linha 1\nlinha 2"');
});

test('toCSV: neutraliza célula que começaria fórmula', () => {
  const row = (f) => lines(toCSV([tx(f)], [{ id: 'm1', name: '+55 11' }, ...accounts], [{ id: 'm2', name: '-desconto' }]))[1];
  assert.equal(row({ description: '=1+1', notes: '@SUM(A1)', account_id: 'm1', category_id: 'm2' }), "30/10/2026;'=1+1;Despesa;-1,00;Efetivado;'+55 11;;'-desconto;;'@SUM(A1)");
  assert.equal(row({ description: '\tx', notes: '\rx' }), '30/10/2026;\'\tx;Despesa;-1,00;Efetivado;Carteira;;;;"\'\rx"');
  assert.equal(lines(toCSV([tx({ description: '=HYPERLINK("x";"y")' })], accounts, categories))[1].split(';Despesa')[0], '30/10/2026;"\'=HYPERLINK(""x"";""y"")"');
});

test('toCSV: transferência traz conta de destino e valor sem sinal', () => {
  const row = lines(toCSV([tx({ kind: 'transfer', description: 'Transferência', amount_cents: 25000, transfer_account_id: 'a2' })], accounts, categories))[1];
  assert.equal(row, '30/10/2026;Transferência;Transferência;250,00;Efetivado;Carteira;"Banco; ""Roxo""";;;');
});
