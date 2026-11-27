// Regras de dinheiro, puras (sem DOM nem rede): saldos, recorrência, parcelas e visão do mês.
// Valores em CENTAVOS inteiros. Datas são strings "YYYY-MM-DD" (nunca Date com fuso: evita o
// dia "andar" por causa do horário de verão/UTC); comparar as strings já ordena corretamente.

export const MAX_INTERVAL = 1000;
export const MAX_INSTALLMENTS = 120;
const MAX_OCCURRENCES = 5000; // por chamada; materialize continua de onde parou na próxima abertura
// Mesmos limites do servidor (store/validate.go): valor em centavos < 1e14, ano 1900..2200.
export const MAX_CENTS = 1e14;
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2200;
export const validCents = (c) => Number.isSafeInteger(c) && Math.abs(c) < MAX_CENTS;

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];

// ---------- datas ----------

const pad = (n, w = 2) => String(n).padStart(w, '0');
// Ano fora de 1900..2200 é erro (nunca vira 19xx por causa do Date.UTC nem passa batido ao somar datas).
const ymd = (y, m, d) => {
  if (y < MIN_YEAR || y > MAX_YEAR) throw new Error(`data fora do intervalo ${MIN_YEAR}-${MAX_YEAR}`);
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`; // m = 1..12
};
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (y >= MIN_YEAR && y <= MAX_YEAR && mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo)) return { y, m: mo, d };
  }
  throw new Error(`data inválida: ${s}`);
}

/** Validador de data compartilhado pelos formulários e pelo app (YYYY-MM-DD real, ano 1900..2200). */
export const isValidISO = (s) => {
  try { parseISO(s); return true; } catch { return false; }
};

/** Soma meses mantendo o dia, "encolhendo" em mês curto: 31/01 +1 → 28/02. */
export function addMonths(iso, n) {
  const { y, m, d } = parseISO(iso);
  const t = m - 1 + n;
  const yy = y + Math.floor(t / 12);
  const mm = ((t % 12) + 12) % 12 + 1;
  return ymd(yy, mm, Math.min(d, daysIn(yy, mm)));
}

export function addDays(iso, n) {
  const { y, m, d } = parseISO(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export const monthOf = (iso) => iso.slice(0, 7);

/** Grade de calendário de um mês ("YYYY-MM"): 42 datas ISO (null fora de 1900..2200), semanas de domingo a sábado, com dias dos meses vizinhos. */
export function monthGrid(month) {
  const first = month + '-01';
  const { y, m } = parseISO(first);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  // null = dia vizinho fora de 1900..2200 (addDays lança)
  return Array.from({ length: 42 }, (_, i) => { try { return addDays(first, i - lead); } catch { return null; } });
}
export const monthStart = (month) => month + '-01';
export const monthEnd = (month) => ymd(+month.slice(0, 4), +month.slice(5, 7), daysIn(+month.slice(0, 4), +month.slice(5, 7)));
export const shiftMonth = (month, n) => monthOf(addMonths(monthStart(month), n));

/** Hoje no fuso do aparelho, como "YYYY-MM-DD". */
export const todayISO = () => {
  const d = new Date();
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
};

// ---------- recorrência ----------

export function validateRule(r) {
  if (!FREQUENCIES.includes(r.frequency)) throw new Error('frequência inválida');
  if (!Number.isInteger(r.interval_n) || r.interval_n < 1 || r.interval_n > MAX_INTERVAL) {
    throw new Error(`intervalo deve estar entre 1 e ${MAX_INTERVAL}`);
  }
  parseISO(r.start_date);
  if (r.end_date != null) {
    parseISO(r.end_date);
    if (r.end_date < r.start_date) throw new Error('data final anterior à inicial');
  }
}

// n-ésima ocorrência (n=0 é o início). Mensal/anual calculam a partir do início a cada vez:
// 31/01 → 28/02 → 31/03 (e não 28/03, que é o que acontece ao encadear a anterior).
function nth(r, n) {
  const step = n * r.interval_n;
  switch (r.frequency) {
    case 'daily': return addDays(r.start_date, step);
    case 'weekly': return addDays(r.start_date, 7 * step);
    case 'monthly': return addMonths(r.start_date, step);
    default: return addMonths(r.start_date, 12 * step);
  }
}

// Primeiro n que vale testar para a janela começar em `from` (recua 1 por segurança).
// Evita que regras diárias antigas esgotem o teto andando desde o início.
function startN(r, from) {
  if (from <= r.start_date) return 0;
  const a = parseISO(r.start_date), b = parseISO(from);
  let n;
  if (r.frequency === 'daily' || r.frequency === 'weekly') {
    const days = (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000;
    n = Math.floor(days / ((r.frequency === 'daily' ? 1 : 7) * r.interval_n));
  } else {
    n = Math.floor(((b.y - a.y) * 12 + (b.m - a.m)) / ((r.frequency === 'monthly' ? 1 : 12) * r.interval_n));
  }
  return Math.max(0, n - 1);
}

/** Datas da regra com from <= data <= to, respeitando end_date. */
export const occurrences = (rule, from, to) => scan(rule, from, to).dates;

// capped = parou no teto (ainda havia datas até `to`), não por ter chegado ao fim.
function scan(rule, from, to) {
  validateRule(rule);
  const dates = [];
  let capped = true;
  for (let i = 0, n = startN(rule, from); i < MAX_OCCURRENCES; i++, n++) {
    let d;
    try { d = nth(rule, n); } catch { capped = false; break; } // passou do ano 2200: acabou
    if (d > to || (rule.end_date && d > rule.end_date)) { capped = false; break; }
    if (d >= from) dates.push(d);
  }
  return { dates, capped };
}

/** Primeira data do ritmo da regra de `from` em diante, sem olhar a data final (null: não há até 2200 ou `from` inválida). */
export function nextOccurrence(rule, from) {
  try {
    for (let n = startN(rule, from); ; n++) {
      const d = nth(rule, n);
      if (d >= from) return d;
    }
  } catch { return null; }
}

/** Até onde materializar as ocorrências: hoje + N meses. */
export const horizon = (today, months = 12) => addMonths(today, months);

/** Documento de lançamento completo (todos os campos que o servidor conhece). */
export const txDoc = (f) => ({
  kind: 'expense', description: '', amount_cents: 0, date: '', status: 'pending', paid_at: null,
  account_id: '', transfer_account_id: null, category_id: null, recurrence_id: null,
  installment_no: null, installment_total: null, installment_group: null, notes: '', is_adjustment: false, ...f,
});

/**
 * Ocorrências que faltam de uma recorrência até `horizonISO`.
 * Só gera depois de `generated_until`: uma ocorrência que o usuário excluiu não volta.
 * Devolve { txs: [{id, data}], generated_until } — quem chama grava lançamentos e a regra atualizada.
 */
export function materialize(rec, horizonISO, newId) {
  if (!rec.active) return { txs: [], generated_until: rec.generated_until ?? null };
  const from = rec.generated_until ? addDays(rec.generated_until, 1) : rec.start_date;
  if (from > horizonISO || (rec.end_date && from > rec.end_date)) return { txs: [], generated_until: rec.generated_until ?? null };
  const { dates, capped } = scan(rec, from, horizonISO);
  const txs = dates.map((date) => ({
    id: newId(),
    data: txDoc({
      kind: rec.kind, description: rec.description, amount_cents: rec.amount_cents, date,
      account_id: rec.account_id, category_id: rec.category_id ?? null, recurrence_id: rec.id,
    }),
  }));
  // No teto, só avançamos até a última data realmente gerada (o resto vem nas próximas aberturas).
  return { txs, generated_until: capped ? dates.at(-1) : horizonISO };
}

// ---------- parcelas ----------

/**
 * Divide `total` em n parcelas mensais a partir de `firstISO`. A soma é sempre igual ao total;
 * os centavos que sobram vão para as primeiras (R$ 100,00 em 3x → 33,34 / 33,33 / 33,33).
 */
export function splitInstallments(total, n, firstISO) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_INSTALLMENTS) throw new Error(`parcelas deve estar entre 1 e ${MAX_INSTALLMENTS}`);
  if (!Number.isInteger(total) || total <= 0) throw new Error('valor deve ser positivo');
  const base = Math.floor(total / n);
  const rest = total % n;
  return Array.from({ length: n }, (_, i) => ({
    no: i + 1, total: n, amount_cents: base + (i < rest ? 1 : 0), date: addMonths(firstISO, i),
  }));
}

// ---------- ajuste de saldo ----------

/** Diferença entre o saldo real (banco) e o do app, em centavos inteiros. Devolve o lançamento que fecha a conta, ou null se já confere. */
export function adjustment(currentCents, realCents) {
  const diff = realCents - currentCents;
  return diff === 0 ? null : { kind: diff > 0 ? 'income' : 'expense', amount_cents: Math.abs(diff) };
}

// ---------- saldos ----------

// Efeito do lançamento em cada conta (com sinal). Transferência: sai de uma, entra na outra.
function movements(t) {
  const v = t.amount_cents;
  if (t.kind === 'income') return [[t.account_id, v]];
  if (t.kind === 'expense') return [[t.account_id, -v]];
  return [[t.account_id, -v], [t.transfer_account_id, v]];
}

/**
 * Saldo atual  = saldo inicial + tudo que já foi pago/recebido.
 * Saldo previsto até `until` = atual + pendentes com vencimento <= until (inclui atrasados).
 * Calcula TODAS as contas (uma transferência para conta arquivada não perde o crédito), mas os totais
 * e `accounts` só têm as ativas; `all` traz também as arquivadas (com `archived`) para exibir o valor real.
 * `excluded`: Set de ids recusados pelo servidor (contas e lançamentos); ficam fora dos saldos.
 */
export function balances(accounts, txs, until, excluded = new Set()) {
  const by = new Map(
    accounts.filter((a) => !excluded.has(a.id)).map((a) => [a.id, { id: a.id, name: a.name, type: a.type, archived: !!a.archived, current_cents: a.initial_balance_cents, projected_cents: a.initial_balance_cents }]),
  );
  for (const t of txs) {
    if (excluded.has(t.id)) continue;
    const paid = t.status === 'paid';
    if (!paid && t.date > until) continue;
    for (const [acc, d] of movements(t)) {
      const b = by.get(acc);
      if (!b) continue;
      if (paid) b.current_cents += d;
      b.projected_cents += d;
    }
  }
  const all = [...by.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const list = all.filter((a) => !a.archived);
  return {
    all,
    accounts: list,
    current_cents: list.reduce((s, a) => s + a.current_cents, 0),
    projected_cents: list.reduce((s, a) => s + a.projected_cents, 0),
  };
}

// ---------- visão do mês ----------

/**
 * filter: 'all' | 'pending' | 'paid'. Muda a lista, os totais e os gastos por categoria;
 * os saldos (balances) não dependem dele. Transferência aparece na lista mas fica fora dos totais.
 * `overdue`: pendentes vencidos antes do mês exibido (só no mês atual/futuro e fora do filtro 'paid').
 * `archived`: Set de ids de contas arquivadas; os lançamentos delas ficam de fora.
 * `excluded`: ids de lançamentos recusados pelo servidor: continuam na lista (a interface os marca), mas não somam nos totais.
 */
export function monthView(allTxs, month, filter, today, archived = new Set(), excluded = new Set()) {
  const txs = archived.size ? allTxs.filter((t) => !archived.has(t.account_id)) : allTxs;
  const order = (a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description, 'pt-BR');
  const keep = (t) => filter === 'all' || t.status === filter;
  const rows = txs.filter((t) => monthOf(t.date) === month && keep(t)).sort(order);
  const overdue =
    filter !== 'paid' && month >= monthOf(today)
      ? txs.filter((t) => t.status === 'pending' && t.date < today && monthOf(t.date) < month).sort(order)
      : [];
  let income = 0, expense = 0;
  const spend = new Map();
  for (const t of rows) {
    if (excluded.has(t.id) || t.is_adjustment) continue; // ajuste muda o saldo, não as análises
    if (t.kind === 'income') income += t.amount_cents;
    else if (t.kind === 'expense') {
      expense += t.amount_cents;
      const k = t.category_id ?? '';
      spend.set(k, (spend.get(k) ?? 0) + t.amount_cents);
    }
  }
  const spending = [...spend].map(([category_id, cents]) => ({ category_id: category_id || null, cents })).sort((a, b) => b.cents - a.cents);
  return { rows, overdue, income_cents: income, expense_cents: expense, result_cents: income - expense, spending };
}

const fold = (s) => (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Busca e filtros da aba Mês, aplicados à lista ANTES de `monthView` (que segue cuidando de mês, situação e totais).
 * `q`: texto procurado em descrição e notas, sem diferenciar maiúsculas nem acentos.
 * `accountId`: a conta do lançamento; em transferência vale a de origem ou a de destino.
 * `categoryId`: a categoria ou qualquer subcategoria dela (`categories` dá o `parent_id`).
 */
export function filterTxs(txs, { q = '', accountId = '', categoryId = '' } = {}, categories = []) {
  const needle = fold(q).trim();
  if (!needle && !accountId && !categoryId) return txs;
  const cats = new Set([categoryId, ...categories.filter((c) => c.parent_id === categoryId).map((c) => c.id)]);
  return txs.filter((t) =>
    (!accountId || t.account_id === accountId || t.transfer_account_id === accountId) &&
    (!categoryId || cats.has(t.category_id)) &&
    (!needle || fold(t.description).includes(needle) || fold(t.notes).includes(needle)));
}

// ---------- repetições (tela) ----------

const WEEKDAYS = ['aos domingos', 'às segundas', 'às terças', 'às quartas', 'às quintas', 'às sextas', 'aos sábados'];

/** Ritmo da regra em linguagem de leigo: "Todo mês, dia 5", "A cada 2 semanas, às segundas". */
export function rhythm(r) {
  const { y, m, d } = parseISO(r.start_date);
  const [one, many, when] = {
    daily: ['Todo dia', 'dias', ''],
    weekly: ['Toda semana', 'semanas', WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]],
    monthly: ['Todo mês', 'meses', `dia ${d}`],
    yearly: ['Todo ano', 'anos', `em ${pad(d)}/${pad(m)}`],
  }[r.frequency];
  return (r.interval_n === 1 ? one : `A cada ${r.interval_n} ${many}`) + (when && `, ${when}`);
}

/**
 * Visão da tela de Repetições, a partir das regras e dos lançamentos ligados a elas.
 * rows: { rec, paid, pending (datas pendentes em ordem), overdue (quantas são < hoje), next (próxima de hoje em diante), ended },
 *   ordenadas pelo que vence antes (atrasado primeiro).
 * ended: regra desativada, com data final no passado, ou com data final e nada mais por vir.
 * income_cents/expense_cents: pendentes de repetições nos 30 dias a partir de hoje (hoje a hoje + 29).
 *   Ficam fora os ids recusados (`excluded`) e os lançamentos de conta arquivada (`archived`), como na aba Mês.
 */
export function recurrenceView(recs, txs, today, excluded = new Set(), archived = new Set()) {
  const until = addDays(today, 30);
  const by = new Map(recs.map((rec) => [rec.id, { rec, paid: 0, pending: [] }]));
  const sum = { income: 0, expense: 0 };
  for (const t of txs) {
    const row = by.get(t.recurrence_id);
    if (!row) continue;
    if (t.status === 'paid') { row.paid++; continue; }
    row.pending.push(t.date);
    if (t.date >= today && t.date < until && t.kind in sum && !excluded.has(t.id) && !archived.has(t.account_id)) sum[t.kind] += t.amount_cents;
  }
  const rows = [...by.values()].map((row) => {
    const { rec, pending } = row;
    pending.sort();
    const overdue = pending.filter((d) => d < today).length;
    const next = pending[overdue] ?? null;
    const ended = !rec.active || (!!rec.end_date && (rec.end_date < today || (!next && (rec.generated_until ?? '') >= rec.end_date)));
    return { ...row, overdue, next, ended };
  }).sort((a, b) => (a.pending[0] ?? '9').localeCompare(b.pending[0] ?? '9') || a.rec.description.localeCompare(b.rec.description, 'pt-BR'));
  return { rows, income_cents: sum.income, expense_cents: sum.expense };
}
