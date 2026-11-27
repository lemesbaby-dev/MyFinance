// CSV dos lançamentos para Excel/Sheets pt-BR: ";" como separador, BOM UTF-8, CRLF e vírgula decimal.
const KIND = { income: 'Receita', expense: 'Despesa', transfer: 'Transferência' };
const STATUS = { paid: 'Efetivado', pending: 'Pendente' };

// Texto livre: neutraliza fórmula (CSV injection) e escapa separador, aspas e quebra de linha.
const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** centavos (inteiro) -> "1234,56", sem float; despesa sai negativa para a coluna somar certo. */
const amount = (t) => {
  const c = Math.abs(t.amount_cents ?? 0);
  const s = String(c).padStart(3, '0');
  return (t.kind === 'expense' && c ? '-' : '') + s.slice(0, -2) + ',' + s.slice(-2);
};

export function toCSV(transactions, accounts, categories) {
  const name = (list) => { const m = new Map(list.map((x) => [x.id, x.name])); return (id) => m.get(id) ?? ''; };
  const acc = name(accounts), cat = name(categories);
  const rows = [...transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((t) => [
    cell(t.date.slice(0, 10).split('-').reverse().join('/')),
    cell(t.description),
    KIND[t.kind] ?? cell(t.kind),
    amount(t), // gerado aqui, só dígitos, vírgula e sinal: não passa pela neutralização
    STATUS[t.status] ?? cell(t.status),
    cell(acc(t.account_id)),
    cell(acc(t.transfer_account_id)),
    cell(cat(t.category_id)),
    t.installment_total ? `${t.installment_no}/${t.installment_total}` : '',
    cell(t.notes),
  ].join(';'));
  return '﻿' + ['Data;Descrição;Tipo;Valor;Situação;Conta;Conta de destino;Categoria;Parcela;Notas', ...rows].join('\r\n') + '\r\n';
}
