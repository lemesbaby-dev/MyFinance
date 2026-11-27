// Estado do app (cópia local em memória) e todas as operações de escrita.
// Toda escrita vai para o IndexedDB + fila (sync.save/remove) e depois recarrega o estado:
// a interface nunca espera a rede.
import * as db from './db.js';
import * as sync from './sync.js';
import { uuidv7 } from './uuid.js';
import { materialize, validateRule, horizon, todayISO, txDoc, splitInstallments, addDays, validCents, isValidISO, balances, adjustment, nextOccurrence } from './finance.js';

export const app = $state({
  ready: false,
  persisted: null, // o navegador prometeu não apagar os dados locais? (null = ainda não sabemos)
  synced: false, // já houve uma sincronização completa neste aparelho (evita oferecer "primeiros passos" antes de os dados chegarem)
  user: null,
  accounts: [], categories: [], recurrences: [], transactions: [],
  rejected: [],
  rejectedIds: new Set(), // ids de upserts recusados: ficam fora dos saldos e marcados na lista até descartar/corrigir
  status: { pending: 0, rejected: 0, online: true, syncing: false, error: '' },
});

const doc = (o) => {
  const { id, ...d } = o; // o id é a chave, não faz parte do documento
  return d;
};

// Item de gravação em lote (ver db.saveMany).
const put = (kind, id, data) => ({ kind, id, data });
const del = (kind, id) => ({ kind, id, remove: true });

async function load() {
  const [accounts, categories, recurrences, transactions, rejected] = await Promise.all([
    db.list('account'), db.list('category'), db.list('recurrence'), db.list('transaction'), db.getMeta('rejected', []),
  ]);
  const rejectedIds = new Set(rejected.filter((r) => r.action === 'upsert').map((r) => r.id));
  Object.assign(app, { accounts, categories, recurrences, transactions, rejected, rejectedIds });
}

// Recarrega o estado sem concorrência: uma execução em andamento + no máximo uma pendente.
let reloading = null;
let again = false;
export function reload() {
  if (reloading) { again = true; return reloading; }
  reloading = (async () => {
    try { do { again = false; await load(); } while (again); } finally { reloading = null; }
  })();
  return reloading;
}

// Operações que leem-e-regravam recorrências rodam uma por vez (senão duas extensões geram datas duplicadas).
let queue = Promise.resolve();
const serial = (fn) => {
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p;
};

// Espera o que estiver em andamento (usado antes de apagar a cópia local no logout).
export async function idle() {
  await queue;
  await reloading;
}

// Logout: nada do usuário anterior pode sobrar na memória.
export function clearApp() {
  Object.assign(app, { ready: false, synced: false, user: null, accounts: [], categories: [], recurrences: [], transactions: [], rejected: [], rejectedIds: new Set() });
}

// Cria as ocorrências que faltam (janela de 12 meses que rola a cada abertura/sincronização).
export const extendRecurrences = () => serial(async () => {
  const h = horizon(todayISO());
  const items = [];
  const rejected = await db.getMeta('rejected', []);
  for (const rec of await db.list('recurrence')) { // lê do banco: a cópia em memória pode estar velha
    // regra recusada espera o usuário (descartar ou salvar de novo): regravá-la aqui a reenviaria sozinha, todo dia
    if (rejected.some((r) => r.kind === 'recurrence' && r.id === rec.id)) continue;
    const m = materialize(rec, h, uuidv7);
    if ((m.generated_until ?? '') <= (rec.generated_until ?? '')) continue; // nunca regrava com valor menor/igual
    items.push(...m.txs.map((t) => put('transaction', t.id, t.data)), put('recurrence', rec.id, { ...doc(rec), generated_until: m.generated_until }));
  }
  if (items.length) await sync.saveMany(items);
  await reload();
});

let started = false;

export async function init(user) {
  await db.ensureUser(user.id); // lança PENDING_OTHER_USER se sobraram alterações de outra conta
  await db.setMeta('userInfo', user);
  app.user = user;
  app.synced = await db.getMeta('synced', false);
  // Pede armazenamento persistente: sem isso o navegador pode apagar o IndexedDB em falta de espaço (e o Safari após ~7 dias).
  navigator.storage?.persist?.().then((p) => (app.persisted = p)).catch(() => {});
  await reload();
  await extendRecurrences();
  app.status = await sync.status();
  if (!started) {
    started = true;
    listen(); // registra os ouvintes uma única vez e já dispara a 1ª sincronização
  } else sync.sync().catch(() => {});
  app.ready = true;
}

function listen() {
  sync.onStatus(async (s) => {
    app.status = s;
    await reload();
    if (s.syncing === false && s.ok) { // ok = push e pull completos (offline não conta)
      if (!app.synced) { app.synced = true; await db.setMeta('synced', true); }
      await extendRecurrences(); // chegaram recorrências de outro aparelho
    }
  });
  sync.startAutoSync();
}

// ---------- contas ----------

export const saveAccount = async (id, f) => {
  if (!validCents(f.initial_balance_cents)) throw new Error('Saldo inicial inválido ou fora do limite.');
  await sync.save('account', id ?? uuidv7(), {
    name: f.name.trim(), type: f.type, initial_balance_cents: f.initial_balance_cents, archived: !!f.archived,
  });
  await reload();
};

export async function deleteAccount(id) {
  const used = app.transactions.some((t) => t.account_id === id || t.transfer_account_id === id) ||
    app.recurrences.some((r) => r.account_id === id);
  if (used) throw new Error('Esta conta tem lançamentos. Arquive-a em vez de excluir.');
  await sync.remove('account', id);
  await reload();
}

// ---------- categorias ----------

export const saveCategory = async (id, f) => {
  if (id && app.categories.find((c) => c.id === id)?.is_system) throw new Error('Categoria do sistema não pode ser editada.');
  await sync.save('category', id ?? uuidv7(), { name: f.name.trim(), kind: f.kind, parent_id: f.parent_id || null, color: f.color ?? '', is_system: false });
  await reload();
};

// O servidor não cascateia: o app solta as referências antes de excluir.
export async function deleteCategory(id) {
  if (app.categories.find((c) => c.id === id)?.is_system) throw new Error('Categoria do sistema não pode ser excluída.');
  await sync.saveMany([
    ...app.transactions.filter((x) => x.category_id === id).map((t) => put('transaction', t.id, { ...doc(t), category_id: null })),
    ...app.recurrences.filter((x) => x.category_id === id).map((r) => put('recurrence', r.id, { ...doc(r), category_id: null })),
    ...app.categories.filter((x) => x.parent_id === id).map((c) => put('category', c.id, { ...doc(c), parent_id: null })),
    del('category', id),
  ]);
  await reload();
}

// ---------- lançamentos ----------

// Mesmos limites do servidor: evita gravar localmente algo que ele vai recusar (e que ficaria "fantasma").
const checkTx = (cents, date) => {
  if (!validCents(cents) || cents <= 0) throw new Error('Valor inválido ou fora do limite.');
  if (!isValidISO(date)) throw new Error('Data inválida (use uma data entre 1900 e 2200).');
};

export async function saveTx(id, fields) {
  const old = id ? app.transactions.find((t) => t.id === id) : null;
  const d = txDoc({ ...(old ? doc(old) : {}), ...fields });
  checkTx(d.amount_cents, d.date);
  await sync.save('transaction', id ?? uuidv7(), d);
  await reload();
}

export async function setPaid(t, paid) {
  await sync.save('transaction', t.id, { ...doc(t), status: paid ? 'paid' : 'pending', paid_at: paid ? todayISO() : null });
  await reload();
}

export async function createInstallments(base, n) {
  checkTx(base.amount_cents, base.date);
  const group = uuidv7();
  await sync.saveMany(splitInstallments(base.amount_cents, n, base.date).map((p) => put('transaction', uuidv7(), txDoc({
    ...base, amount_cents: p.amount_cents, date: p.date, status: 'pending', paid_at: null,
    installment_no: p.no, installment_total: p.total, installment_group: group,
  }))));
  await reload();
}

// Regra nova + ocorrências numa transação só. `rec.generated_until` é o ponto de partida (null = desde o início).
// `extra` são itens que precisam ir junto (atomicidade); `id` permite religar algo à regra antes de ela existir.
async function addRecurrence(rec, extra = [], id = uuidv7()) {
  const m = materialize({ ...rec, id }, horizon(todayISO()), uuidv7);
  // A regra vai PRIMEIRO na fila: o servidor valida que `recurrence_id` existe, então os lançamentos
  // que a referenciam (novos ou religados em `extra`) só podem chegar depois dela.
  await sync.saveMany([
    put('recurrence', id, { ...rec, generated_until: m.generated_until }),
    ...extra,
    ...m.txs.map((t) => put('transaction', t.id, t.data)),
  ]);
}

export const createRecurrence = (f) => serial(async () => {
  checkTx(f.amount_cents, f.start_date);
  const rec = { kind: f.kind, description: f.description, amount_cents: f.amount_cents, account_id: f.account_id,
    category_id: f.category_id ?? null, frequency: f.frequency, interval_n: f.interval_n ?? 1, start_date: f.start_date,
    end_date: f.end_date || null, active: true, generated_until: null };
  validateRule(rec); // materialize não valida quando a data final já passou: sem isto a regra ficaria local e o servidor recusaria
  await addRecurrence(rec);
  await reload();
});

const pendingOf = (recId) => app.transactions.filter((t) => t.recurrence_id === recId && t.status === 'pending');
const RECURRING_FIELDS = ['description', 'amount_cents', 'account_id', 'category_id'];

/**
 * Edita um lançamento que veio de uma recorrência.
 *  one       só esta ocorrência (sempre, se ela já foi paga)
 *  all       a regra e as ocorrências pendentes (só os campos compartilhados que mudaram)
 *  following esta e as próximas: a regra antiga termina no dia anterior e as pendentes seguintes passam para uma cópia dela
 * A ocorrência clicada recebe sempre todas as `changes`.
 */
export const editRecurring = (tx, scope, changes) => serial(() => editOccurrence(tx, scope, changes));
// `ruleChanges`: campos compartilhados já decididos por quem chama (editRule compara com a regra, não com a ocorrência).
async function editOccurrence(tx, scope, changes, ruleChanges) {
  const rec = app.recurrences.find((r) => r.id === tx.recurrence_id);
  if (scope === 'one' || !rec || tx.status === 'paid') return saveTx(tx.id, changes);
  const base = doc(app.transactions.find((t) => t.id === tx.id) ?? tx);
  const shared = ruleChanges ?? Object.fromEntries(RECURRING_FIELDS.filter((k) => k in changes && (changes[k] ?? null) !== (tx[k] ?? null)).map((k) => [k, changes[k]]));
  const clicked = (extra) => put('transaction', tx.id, txDoc({ ...base, ...changes, ...extra }));
  if (scope === 'following' && tx.date > rec.start_date) {
    const nid = uuidv7();
    // As pendentes seguintes são religadas (não apagadas e regeradas): mantêm id, notas e edições individuais.
    // Por isso a regra nova herda o `generated_until` (nunca antes da clicada): só gera o que ainda não existia.
    await addRecurrence({ ...doc(rec), ...shared, generated_until: rec.generated_until > tx.date ? rec.generated_until : tx.date }, [
      put('recurrence', rec.id, { ...doc(rec), end_date: addDays(tx.date, -1) }),
      ...pendingOf(rec.id).filter((t) => t.date > tx.date && t.id !== tx.id).map((t) => put('transaction', t.id, { ...doc(t), ...shared, recurrence_id: nid })),
      clicked({ recurrence_id: nid }),
    ], nid);
  } else { // 'all' (ou 'following' na primeira ocorrência, que é a regra inteira)
    const items = [clicked()];
    if (Object.keys(shared).length) {
      items.push(put('recurrence', rec.id, { ...doc(rec), ...shared }),
        ...pendingOf(rec.id).filter((t) => t.id !== tx.id).map((t) => put('transaction', t.id, { ...doc(t), ...shared })));
    }
    await sync.saveMany(items);
  }
  await reload();
}

const sharedChanges = (rec, changes) => Object.fromEntries(RECURRING_FIELDS.filter((k) => k in changes && (changes[k] ?? null) !== (rec[k] ?? null)).map((k) => [k, changes[k]]));

// Regra (gravada em `id`) + as ocorrências dela até o horizonte, pulando as datas em `taken` (já há lançamento ali).
function generate(id, rec, taken) {
  const m = materialize({ ...rec, id }, horizon(todayISO()), uuidv7);
  return {
    rule: put('recurrence', id, { ...rec, generated_until: m.generated_until }),
    txs: m.txs.filter((t) => !taken.has(t.data.date)).map((t) => put('transaction', t.id, t.data)),
  };
}

/**
 * Mudança de ritmo/dia (`frequency`, `interval_n`, `start_date` = nova data-base; sem ela, `from`) ou de data final (`end_date`).
 * Devolve null se nada disso muda; senão { items (uma gravação atômica), rhythm, gone, edited }.
 *  ritmo/dia  as datas mudam, então religar as pendentes não serve: a partir do corte (`from`, ou a data-base se for antes)
 *             as pendentes saem e uma regra nova gera as novas; a antiga termina na véspera. Antes do corte e efetivadas não mudam.
 *             Sem nada para guardar na antiga, ela mesma muda (não sobra regra vazia).
 *  data final só a regra: saem as pendentes depois dela, ou nascem as que faltavam.
 * `gone`: pendentes que saem; `edited`: quantas delas têm nota ou foram mudadas à mão (a tela avisa antes de gravar).
 */
function schedulePlan(rec, from, c, shared = {}) {
  const sched = { frequency: c.frequency ?? rec.frequency, interval_n: c.interval_n ?? rec.interval_n, end_date: 'end_date' in c ? c.end_date || null : rec.end_date ?? null };
  const start = c.start_date ?? from;
  const rhythm = sched.frequency !== rec.frequency || sched.interval_n !== rec.interval_n || (c.start_date != null && nextOccurrence(rec, start) !== start);
  if (!rhythm && sched.end_date === (rec.end_date ?? null)) return null;
  const today = todayISO();
  if (!rec.active || (rec.end_date && rec.end_date < today)) throw new Error('Esta repetição está encerrada. Use "Repetir de novo".');
  if (!isValidISO(start) || (sched.end_date && !isValidISO(sched.end_date))) throw new Error('Data inválida (use uma data entre 1900 e 2200).');
  if (sched.end_date && sched.end_date !== rec.end_date && sched.end_date < today) throw new Error('A data final não pode ser antes de hoje. Para parar agora, use "Encerrar repetição".');
  const cut = start < from ? start : from;
  const mine = app.transactions.filter((t) => t.recurrence_id === rec.id);
  const gone = mine.filter((t) => t.status === 'pending' && (rhythm ? t.date >= cut : sched.end_date && t.date > sched.end_date));
  const keep = mine.filter((t) => !gone.includes(t));
  const taken = new Set(keep.map((t) => t.date));
  const edited = gone.filter((t) => t.notes || nextOccurrence(rec, t.date) !== t.date || RECURRING_FIELDS.some((k) => (t[k] ?? null) !== (rec[k] ?? null))).length;
  let rules;
  let g;
  if (rhythm) {
    const next = { ...doc(rec), ...shared, ...sched, start_date: start, generated_until: null };
    validateRule(next);
    g = generate(keep.length ? uuidv7() : rec.id, next, taken);
    // A antiga termina na véspera do corte: nunca antes do início (o servidor recusa; aí ela é desativada) nem depois da data final que já tinha.
    const eve = addDays(cut, -1);
    const end = [rec.start_date, rec.end_date && rec.end_date < eve ? rec.end_date : eve].sort().at(-1);
    rules = keep.length ? [g.rule, put('recurrence', rec.id, { ...doc(rec), end_date: end, active: eve >= rec.start_date })] : [g.rule];
  } else {
    // O que ficava depois da data final antiga nunca foi gerado: a geração recomeça dela (e não de `generated_until`, que pode ter passado).
    const next = { ...doc(rec), end_date: sched.end_date, generated_until: rec.end_date && (rec.generated_until ?? '') > rec.end_date ? rec.end_date : rec.generated_until ?? null };
    validateRule(next);
    g = generate(rec.id, next, taken);
    rules = [g.rule];
  }
  // Regras primeiro (o servidor exige a regra antes de quem a cita); exclusões antes das novas (índice único por regra e data).
  return { items: [...rules, ...gone.map((t) => del('transaction', t.id)), ...g.txs], rhythm, gone: gone.length, edited };
}

/** O que `editRule` vai tirar ao mudar ritmo/dia/data final: { rhythm, gone, edited } (ver schedulePlan), ou null se nada disso muda. Não grava. */
export function scheduleImpact(id, from, changes) {
  const rec = app.recurrences.find((r) => r.id === id);
  const p = rec && schedulePlan(rec, from, changes);
  return p ? { rhythm: p.rhythm, gone: p.gone, edited: p.edited } : null;
}

/**
 * Edita pela regra (tela de Repetições): mudam a regra e as pendentes com data >= `from`; as anteriores e as efetivadas não.
 * Valor, descrição, conta e categoria reaproveitam editRecurring: `all` se não há pendente antes de `from`, senão `following`
 * a partir da primeira pendente dali. Ritmo, dia e data final: ver schedulePlan (com ritmo novo, esses campos já vão na regra nova).
 */
export const editRule = (id, from, changes) => serial(async () => {
  let rec = app.recurrences.find((r) => r.id === id);
  if (!rec) return;
  const shared = sharedChanges(rec, changes);
  const plan = schedulePlan(rec, from, changes, shared);
  if (!plan && !Object.keys(shared).length) return;
  checkTx(shared.amount_cents ?? rec.amount_cents, rec.start_date);
  if (plan) {
    await sync.saveMany(plan.items);
    await reload();
    if (plan.rhythm || !Object.keys(shared).length) return;
    rec = app.recurrences.find((r) => r.id === id); // a data final já foi gravada; os outros campos seguem o caminho de sempre
  }
  const mine = pendingOf(id).sort((a, b) => a.date.localeCompare(b.date));
  const tx = mine.find((t) => t.date >= from);
  if (tx) return editOccurrence(tx, tx === mine[0] ? 'all' : 'following', shared, shared);
  await sync.save('recurrence', id, { ...doc(rec), ...shared }); // nada pendente dali em diante: vale para o que ainda for gerado
  await reload();
});

/**
 * "Repetir de novo": repetição NOVA com os mesmos dados a partir de `start`, sem data final. A encerrada não é regravada
 * (guarda o histórico). Datas em que ela já tem lançamento não nascem de novo. Recusa se já há uma igual (mesmo tipo, descrição,
 * valor, conta e categoria, em qualquer ritmo) valendo nessa data: toque dobrado, a própria ainda ativa, ou a metade antiga de
 * uma repetição que só mudou de dia/ritmo. Sem isso o mesmo aluguel passaria a sair duas vezes.
 */
export const repeatAgain = (id, start) => serial(async () => {
  const rec = app.recurrences.find((r) => r.id === id);
  if (!rec) return;
  if (!isValidISO(start)) throw new Error('Data inválida (use uma data entre 1900 e 2200).');
  if (app.accounts.find((a) => a.id === rec.account_id)?.archived) throw new Error('A conta desta repetição está arquivada.');
  if (app.recurrences.some((r) => r.active && (!r.end_date || r.end_date >= start) && ['kind', ...RECURRING_FIELDS].every((k) => (r[k] ?? null) === (rec[k] ?? null))))
    throw new Error('Já existe uma repetição igual a esta valendo nessa data.');
  const g = generate(uuidv7(), { ...doc(rec), start_date: start, end_date: null, active: true, generated_until: null },
    new Set(app.transactions.filter((t) => t.recurrence_id === id).map((t) => t.date)));
  await sync.saveMany([g.rule, ...g.txs]);
  await reload();
});

/**
 * Encerra a repetição: saem as pendentes de hoje em diante; as atrasadas (data < hoje) e as efetivadas ficam.
 * Grava `end_date` (ontem; nunca antes do início, que o servidor recusa, nem depois de uma data final que já existia)
 * e desativa: nada mais é gerado. Já encerrada e sem nada a tirar: não grava de novo.
 */
export const endRecurrence = (id) => serial(async () => {
  const rec = app.recurrences.find((r) => r.id === id);
  if (!rec) return;
  const today = todayISO();
  const last = addDays(today, -1);
  const end = [rec.start_date, rec.end_date && rec.end_date < last ? rec.end_date : last].sort().at(-1);
  const gone = pendingOf(id).filter((t) => t.date >= today).map((t) => del('transaction', t.id));
  if (!gone.length && !rec.active && rec.end_date === end) return;
  await sync.saveMany([...gone, put('recurrence', id, { ...doc(rec), active: false, end_date: end })]);
  await reload();
});

/** Exclui um lançamento de recorrência: só esta, esta e as próximas, ou todas as pendentes (e encerra a regra). */
export const deleteRecurring = (tx, scope) => serial(async () => {
  const rec = app.recurrences.find((r) => r.id === tx.recurrence_id);
  if (scope === 'one' || !rec || tx.status === 'paid') {
    await sync.remove('transaction', tx.id);
  } else {
    const from = scope === 'following' ? tx.date : '0000-01-01';
    const gone = pendingOf(rec.id).filter((t) => t.date >= from || t.id === tx.id);
    const end = scope === 'following' ? addDays(tx.date, -1) : null;
    const ended = end && end >= rec.start_date ? { end_date: end } : { active: false };
    await sync.saveMany([...gone.map((t) => del('transaction', t.id)), put('recurrence', rec.id, { ...doc(rec), ...ended })]);
  }
  await reload();
});

// Ids fixos: dois aparelhos offline criando "Ajuste de saldo" gravam o MESMO documento (nunca duplica).
export const adjustCategoryId = (kind) => `sys-adjust-${kind}`;

/** Saldo atual da conta: o mesmo `balances().current_cents` do card (só efetivados). */
export const currentBalance = (id) =>
  balances(app.accounts, app.transactions, todayISO(), app.rejectedIds).all.find((a) => a.id === id)?.current_cents ?? 0;

/**
 * Lança a diferença entre o saldo real (banco) e o saldo atual da conta como receita/despesa já efetivada.
 * Devolve { id, kind, amount_cents } do lançamento criado, ou null se o saldo já confere.
 * Saldo atual: ver currentBalance.
 */
export async function adjustAccount(accountId, realCents, { date = todayISO(), categoryId = '' } = {}) {
  const acc = app.accounts.find((a) => a.id === accountId);
  if (!acc || acc.archived) throw new Error('Conta indisponível para ajuste.');
  if (!validCents(realCents)) throw new Error('Saldo inválido ou fora do limite.');
  if (!isValidISO(date)) throw new Error('Data inválida (use uma data entre 1900 e 2200).');
  const adj = adjustment(currentBalance(accountId), realCents);
  if (!adj) return null;
  checkTx(adj.amount_cents, date);
  const sysId = adjustCategoryId(adj.kind);
  const items = [];
  if (!categoryId) {
    categoryId = sysId;
    if (!app.categories.some((c) => c.id === sysId)) items.push(put('category', sysId, { name: 'Ajuste de saldo', kind: adj.kind, parent_id: null, color: '', is_system: true }));
  }
  const id = uuidv7();
  items.push(put('transaction', id, txDoc({
    ...adj, description: 'Ajuste de saldo', date, status: 'paid', paid_at: date, account_id: accountId, category_id: categoryId, is_adjustment: true,
  })));
  await sync.saveMany(items);
  await reload();
  return { id, ...adj };
}

export async function deleteTx(tx) {
  await sync.remove('transaction', tx.id);
  await reload();
}

// ---------- sincronização ----------

export async function dismissRejected(i) {
  await db.dismissRejectedAt(i);
  await reload();
  sync.sync().catch(() => {});
}
