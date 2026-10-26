// Estado do app (cópia local em memória) e todas as operações de escrita.
// Toda escrita vai para o IndexedDB + fila (sync.save/remove) e depois recarrega o estado:
// a interface nunca espera a rede.
import * as db from './db.js';
import * as sync from './sync.js';
import { uuidv7 } from './uuid.js';
import { materialize, horizon, todayISO, txDoc, splitInstallments, addDays } from './finance.js';

export const app = $state({
  ready: false,
  persisted: null, // o navegador prometeu não apagar os dados locais? (null = ainda não sabemos)
  synced: false, // já houve uma sincronização completa neste aparelho (evita oferecer "primeiros passos" antes de os dados chegarem)
  user: null,
  accounts: [], categories: [], recurrences: [], transactions: [],
  rejected: [],
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
  Object.assign(app, { accounts, categories, recurrences, transactions, rejected });
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
  Object.assign(app, { ready: false, synced: false, user: null, accounts: [], categories: [], recurrences: [], transactions: [], rejected: [] });
}

// Cria as ocorrências que faltam (janela de 12 meses que rola a cada abertura/sincronização).
export const extendRecurrences = () => serial(async () => {
  const h = horizon(todayISO());
  const items = [];
  for (const rec of await db.list('recurrence')) { // lê do banco: a cópia em memória pode estar velha
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
  await sync.save('category', id ?? uuidv7(), { name: f.name.trim(), kind: f.kind, parent_id: f.parent_id || null, color: f.color ?? '' });
  await reload();
};

// O servidor não cascateia: o app solta as referências antes de excluir.
export async function deleteCategory(id) {
  await sync.saveMany([
    ...app.transactions.filter((x) => x.category_id === id).map((t) => put('transaction', t.id, { ...doc(t), category_id: null })),
    ...app.recurrences.filter((x) => x.category_id === id).map((r) => put('recurrence', r.id, { ...doc(r), category_id: null })),
    ...app.categories.filter((x) => x.parent_id === id).map((c) => put('category', c.id, { ...doc(c), parent_id: null })),
    del('category', id),
  ]);
  await reload();
}

// ---------- lançamentos ----------

export async function saveTx(id, fields) {
  const old = id ? app.transactions.find((t) => t.id === id) : null;
  await sync.save('transaction', id ?? uuidv7(), txDoc({ ...(old ? doc(old) : {}), ...fields }));
  await reload();
}

export async function setPaid(t, paid) {
  await sync.save('transaction', t.id, { ...doc(t), status: paid ? 'paid' : 'pending', paid_at: paid ? todayISO() : null });
  await reload();
}

export async function createInstallments(base, n) {
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
  await addRecurrence({ kind: f.kind, description: f.description, amount_cents: f.amount_cents, account_id: f.account_id,
    category_id: f.category_id ?? null, frequency: f.frequency, interval_n: f.interval_n ?? 1, start_date: f.start_date,
    end_date: null, active: true, generated_until: null });
  await reload();
});

const pendingOf = (recId) => app.transactions.filter((t) => t.recurrence_id === recId && t.status === 'pending');
const RECURRING_FIELDS = ['description', 'amount_cents', 'account_id', 'category_id'];

/**
 * Edita um lançamento que veio de uma recorrência.
 *  one       só esta ocorrência (sempre, se ela já foi paga)
 *  all       a regra e as ocorrências pendentes (só os campos compartilhados que mudaram)
 *  following esta e as próximas: a regra antiga termina no dia anterior e nasce uma cópia a partir desta
 * A ocorrência clicada recebe sempre todas as `changes`.
 */
export const editRecurring = (tx, scope, changes) => serial(async () => {
  const rec = app.recurrences.find((r) => r.id === tx.recurrence_id);
  if (scope === 'one' || !rec || tx.status === 'paid') return saveTx(tx.id, changes);
  const base = doc(app.transactions.find((t) => t.id === tx.id) ?? tx);
  const shared = Object.fromEntries(RECURRING_FIELDS.filter((k) => k in changes && (changes[k] ?? null) !== (tx[k] ?? null)).map((k) => [k, changes[k]]));
  const clicked = (extra) => put('transaction', tx.id, txDoc({ ...base, ...changes, ...extra }));
  if (scope === 'following' && tx.date > rec.start_date) {
    const nid = uuidv7();
    await addRecurrence({ ...doc(rec), ...shared, generated_until: tx.date }, [
      put('recurrence', rec.id, { ...doc(rec), end_date: addDays(tx.date, -1) }),
      ...pendingOf(rec.id).filter((t) => t.date > tx.date && t.id !== tx.id).map((t) => del('transaction', t.id)),
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

export async function deleteTx(tx) {
  await sync.remove('transaction', tx.id);
  await reload();
}

// ---------- sincronização ----------

export async function dismissRejected(i) {
  const list = await db.getMeta('rejected', []);
  const [r] = list.splice(i, 1);
  await db.setMeta('rejected', list);
  if (r?.action === 'upsert') await db.dropLocal(r.kind, r.id); // a cópia local nunca chegou ao servidor
  await db.setMeta('cursor', 0); // o próximo pull reconcilia com o que o servidor tem
  await reload();
  sync.sync().catch(() => {});
}
