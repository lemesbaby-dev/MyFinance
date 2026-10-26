// Estado do app (cópia local em memória) e todas as operações de escrita.
// Toda escrita vai para o IndexedDB + fila (sync.save/remove) e depois recarrega o estado:
// a interface nunca espera a rede.
import * as db from './db.js';
import * as sync from './sync.js';
import { uuidv7 } from './uuid.js';
import { materialize, horizon, todayISO, txDoc, splitInstallments, addDays } from './finance.js';

export const app = $state({
  ready: false,
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

export async function reload() {
  const [accounts, categories, recurrences, transactions, rejected] = await Promise.all([
    db.list('account'), db.list('category'), db.list('recurrence'), db.list('transaction'), db.getMeta('rejected', []),
  ]);
  Object.assign(app, { accounts, categories, recurrences, transactions, rejected });
}

// Cria as ocorrências que faltam (janela de 12 meses que rola a cada abertura/sincronização).
export async function extendRecurrences() {
  const h = horizon(todayISO());
  for (const rec of app.recurrences) {
    const m = materialize(rec, h, uuidv7);
    if (m.generated_until === (rec.generated_until ?? null)) continue;
    for (const t of m.txs) await sync.save('transaction', t.id, t.data);
    await sync.save('recurrence', rec.id, { ...doc(rec), generated_until: m.generated_until });
  }
  await reload();
}

let started = false;

export async function init(user) {
  await db.ensureUser(user.id); // lança PENDING_OTHER_USER se sobraram alterações de outra conta
  await db.setMeta('userInfo', user);
  app.user = user;
  app.synced = await db.getMeta('synced', false);
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
    if (s.syncing === false && !s.error) {
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
  for (const t of app.transactions.filter((x) => x.category_id === id)) await sync.save('transaction', t.id, { ...doc(t), category_id: null });
  for (const r of app.recurrences.filter((x) => x.category_id === id)) await sync.save('recurrence', r.id, { ...doc(r), category_id: null });
  for (const c of app.categories.filter((x) => x.parent_id === id)) await sync.save('category', c.id, { ...doc(c), parent_id: null });
  await sync.remove('category', id);
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
  for (const p of splitInstallments(base.amount_cents, n, base.date)) {
    await sync.save('transaction', uuidv7(), txDoc({
      ...base, amount_cents: p.amount_cents, date: p.date, status: 'pending', paid_at: null,
      installment_no: p.no, installment_total: p.total, installment_group: group,
    }));
  }
  await reload();
}

export async function createRecurrence(f) {
  const id = uuidv7();
  const rec = { kind: f.kind, description: f.description, amount_cents: f.amount_cents, account_id: f.account_id,
    category_id: f.category_id ?? null, frequency: f.frequency, interval_n: f.interval_n ?? 1, start_date: f.start_date,
    end_date: null, active: true, generated_until: null };
  await sync.save('recurrence', id, rec);
  const m = materialize({ ...rec, id }, horizon(todayISO()), uuidv7);
  for (const t of m.txs) await sync.save('transaction', t.id, t.data);
  await sync.save('recurrence', id, { ...rec, generated_until: m.generated_until });
  await reload();
}

const pendingOf = (recId) => app.transactions.filter((t) => t.recurrence_id === recId && t.status === 'pending');
const RECURRING_FIELDS = ['description', 'amount_cents', 'account_id', 'category_id'];

/**
 * Edita um lançamento que veio de uma recorrência.
 *  one       só esta ocorrência
 *  all       a regra e todas as ocorrências pendentes
 *  following esta e as próximas: a regra antiga termina no dia anterior e nasce uma nova a partir desta
 */
export async function editRecurring(tx, scope, changes) {
  const rec = app.recurrences.find((r) => r.id === tx.recurrence_id);
  if (scope === 'one' || !rec) return saveTx(tx.id, changes);
  const shared = Object.fromEntries(RECURRING_FIELDS.filter((k) => k in changes).map((k) => [k, changes[k]]));
  if (scope === 'following' && tx.date > rec.start_date) {
    await sync.save('recurrence', rec.id, { ...doc(rec), end_date: addDays(tx.date, -1) });
    for (const t of pendingOf(rec.id).filter((t) => t.date >= tx.date)) await sync.remove('transaction', t.id);
    await createRecurrence({ ...doc(rec), ...shared, frequency: rec.frequency, interval_n: rec.interval_n, start_date: tx.date });
    return;
  }
  // 'all' (ou 'following' na primeira ocorrência, que é a regra inteira)
  await sync.save('recurrence', rec.id, { ...doc(rec), ...shared });
  for (const t of pendingOf(rec.id)) await sync.save('transaction', t.id, { ...doc(t), ...shared });
  if (tx.status === 'pending') await saveTx(tx.id, changes); // a data e o resto desta ocorrência
  await reload();
}

/** Exclui um lançamento de recorrência: só esta, esta e as próximas, ou todas as pendentes (e encerra a regra). */
export async function deleteRecurring(tx, scope) {
  const rec = app.recurrences.find((r) => r.id === tx.recurrence_id);
  if (scope === 'one' || !rec) {
    await sync.remove('transaction', tx.id);
  } else {
    const from = scope === 'following' ? tx.date : '0000-01-01';
    for (const t of pendingOf(rec.id).filter((t) => t.date >= from)) await sync.remove('transaction', t.id);
    const end = scope === 'following' ? addDays(tx.date, -1) : null;
    if (end && end >= rec.start_date) await sync.save('recurrence', rec.id, { ...doc(rec), end_date: end });
    else await sync.save('recurrence', rec.id, { ...doc(rec), active: false });
  }
  await reload();
}

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
