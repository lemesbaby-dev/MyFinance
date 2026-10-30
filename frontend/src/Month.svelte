<script>
  import { app, setPaid, deleteTx, deleteRecurring } from './lib/app.svelte.js';
  import { balances, monthView, monthEnd, monthOf, shiftMonth, todayISO } from './lib/finance.js';
  import { shortDate } from './lib/format.js';
  import TxForm from './TxForm.svelte';
  import Scope from './Scope.svelte';
  import BalanceHero from './ui/BalanceHero.svelte';
  import MonthNav from './ui/MonthNav.svelte';
  import Segmented from './ui/Segmented.svelte';
  import Card from './ui/Card.svelte';
  import Stat from './ui/Stat.svelte';
  import ListGroup from './ui/ListGroup.svelte';
  import ListRow from './ui/ListRow.svelte';
  import CategoryBar from './ui/CategoryBar.svelte';
  import EmptyState from './ui/EmptyState.svelte';
  import Banner from './ui/Banner.svelte';
  import Button from './ui/Button.svelte';
  import Icon from './ui/Icon.svelte';
  import { confirmDialog } from './ui/confirm.js';
  import { rowState, groupByDate, catOf, catMap } from './ui/logic.js';

  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const FILTERS = [['all', 'Todos'], ['pending', 'Pendentes'], ['paid', 'Efetivados']];
  const TOTAL_LABEL = { all: 'Previsto do mês', pending: 'A realizar', paid: 'Realizado' };
  const DO_LABEL = { income: 'Recebi', expense: 'Efetivar', transfer: 'Transferi' };
  const GLYPH = { income: 'down', expense: 'tag', transfer: 'swap' };

  const saved = (() => { try { return localStorage.getItem('financas.filter'); } catch { return null; } })();
  let today = $state(todayISO()); // renova ao voltar para o app (virou o dia)
  let month = $state(monthOf(todayISO()));
  let filter = $state(FILTERS.some(([k]) => k === saved) ? saved : 'all');
  let form = $state(null); // { tx } | {}
  let scopeFor = $state(null);
  let error = $state('');

  const until = $derived(monthEnd(month));
  const bal = $derived(balances(app.accounts, app.transactions, until, app.rejectedIds));
  const nowBal = $derived(balances(app.accounts, app.transactions, today, app.rejectedIds));
  const archived = $derived(new Set(app.accounts.filter((a) => a.archived).map((a) => a.id)));
  const view = $derived(monthView(app.transactions, month, filter, today, archived, app.rejectedIds));
  // Quanto do movimento do mês já foi efetivado (trilha do hero); independe do filtro da lista. Uma passada só.
  const flow = $derived.by(() => {
    const o = { paid: 0, pending: 0 };
    for (const t of app.transactions) {
      if (t.kind === 'transfer' || t.is_adjustment || !(t.status in o) || archived.has(t.account_id) || app.rejectedIds.has(t.id) || monthOf(t.date) !== month) continue;
      o[t.status] += t.amount_cents;
    }
    return o;
  });
  const done = $derived(flow.paid);
  const todo = $derived(flow.pending);
  const catColor = $derived(catMap(app.categories.map((c) => c.id)));
  const label = $derived(`${MONTHS[+month.slice(5, 7) - 1]} de ${month.slice(0, 4)}`.replace(/^./, (c) => c.toUpperCase()));
  const hasAccounts = $derived(app.accounts.some((a) => !a.archived));
  const days = $derived(groupByDate(view.rows));
  const spending = $derived(view.spending.map((s) => ({ label: s.category_id ? catName(s.category_id) : 'Sem categoria', cents: s.cents, n: s.category_id ? catOf(s.category_id, catColor) : 10 })));

  const accName = (id) => app.accounts.find((a) => a.id === id)?.name ?? '';
  const catName = (id) => app.categories.find((c) => c.id === id)?.name ?? '';

  function setFilter(k) {
    try { localStorage.setItem('financas.filter', k); } catch { /* sem armazenamento: só não lembra */ }
  }

  const guard = (fn) => async (...a) => { error = ''; try { await fn(...a); } catch (e) { error = e.message; } };
  const toggle = guard((t) => setPaid(t, t.status !== 'paid'));
  const removeOne = guard(async (t) => {
    if (t.recurrence_id && t.status === 'pending') { scopeFor = t; return; }
    const nota = t.recurrence_id ? 'Já efetivado: exclui só este lançamento.' : '';
    if (await confirmDialog({ title: `Excluir "${t.description}"?`, message: nota, danger: true, confirmLabel: 'Excluir' })) await deleteTx(t);
  });
  const removeScoped = guard(async (scope) => { const t = scopeFor; scopeFor = null; await deleteRecurring(t, scope); });
  const refreshToday = () => (today = todayISO());

  const metaOf = (t, withDate) => [
    withDate ? shortDate(t.date) : '',
    accName(t.account_id) + (t.kind === 'transfer' ? ` → ${accName(t.transfer_account_id)}` : ''),
    t.category_id ? catName(t.category_id) : '',
    t.recurrence_id ? 'repete' : '',
    app.rejectedIds.has(t.id) ? 'não enviado' : '',
  ].filter(Boolean).join(' · ');
  const menuOf = (t) => [
    { label: 'Editar', icon: 'edit', onselect: () => (form = { tx: t }) },
    ...(t.status === 'paid' && !t.is_adjustment ? [{ label: 'Desfazer', icon: 'undo', onselect: () => toggle(t) }] : []),
    { label: 'Excluir', icon: 'trash', danger: true, onselect: () => removeOne(t) },
  ];
</script>

<svelte:window onfocus={refreshToday} />
<svelte:document onvisibilitychange={refreshToday} />

{#snippet row(t, withDate)}
  <ListRow
    title={t.description + (t.installment_total ? ` ${t.installment_no}/${t.installment_total}` : '')}
    meta={metaOf(t, withDate)}
    cents={t.amount_cents}
    kind={t.kind}
    state={rowState({ paid: t.status === 'paid', date: t.date, today })}
    cat={t.category_id ? catOf(t.category_id, catColor) : 0}
    glyph={GLYPH[t.kind]}
    tag={t.is_adjustment ? 'Ajuste' : ''}
    actionLabel={DO_LABEL[t.kind]}
    onaction={() => toggle(t)}
    menu={menuOf(t)}
    menuLabel="Mais ações: {t.description}" />
{/snippet}

<BalanceHero now={nowBal.current_cents} forecast={bal.projected_cents} {done} {todo} forecastLabel="Previsto até {shortDate(until)}" />

<MonthNav {label} onprev={() => (month = shiftMonth(month, -1))} onnext={() => (month = shiftMonth(month, 1))} />

<Segmented label="Mostrar" options={FILTERS} bind:value={filter} onchange={setFilter} />

<Card>
  <p class="cap">{TOTAL_LABEL[filter]}</p>
  <div class="tot">
    <Stat label="Receitas" cents={view.income_cents} kind="income" />
    <Stat label="Despesas" cents={view.expense_cents} kind="expense" />
    <Stat label="Resultado" cents={view.result_cents} />
  </div>
</Card>

{#if error}<Banner tone="danger" icon="alert">{error}</Banner>{/if}

{#if view.overdue.length}
  <ListGroup title="Atrasados de meses anteriores" note="{view.overdue.length}">
    {#each view.overdue as t (t.id)}{@render row(t, true)}{/each}
  </ListGroup>
{/if}

<section class="list">
  <h2>Lançamentos</h2>
  {#if view.rows.length === 0}
    <EmptyState title={hasAccounts ? 'Nada neste filtro' : 'Nenhuma conta ainda'} text={hasAccounts ? 'Use “Lançar” para registrar.' : 'Crie uma conta na aba Contas para começar.'} />
  {:else}
    {#each days as d (d.date)}
      <ListGroup title={d.date === today ? 'Hoje' : shortDate(d.date)} today={d.date === today}>
        {#each d.items as t (t.id)}{@render row(t, false)}{/each}
      </ListGroup>
    {/each}
  {/if}
</section>

<section class="list">
  <h2>Gastos por categoria</h2>
  {#if !spending.length}
    <p class="muted">Sem despesas neste filtro.</p>
  {:else}
    <Card><CategoryBar items={spending} /></Card>
  {/if}
</section>

{#if hasAccounts}<div class="fab"><Button onclick={() => (form = {})}><Icon name="plus" />Lançar</Button></div>{/if}
{#if form}<TxForm tx={form.tx ?? null} onclose={() => (form = null)} />{/if}
{#if scopeFor}<Scope verb="Excluir" onpick={removeScoped} onclose={() => (scopeFor = null)} />{/if}

<style>
  .cap { margin: 0 0 var(--space-2); font: var(--fw-bold) var(--fs-2)/var(--lh-tight) var(--font-text); color: var(--text-muted); }
  .tot { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2) var(--space-3); container-type: inline-size; }
  /* Três colunas sempre: a fonte segue a largura do card (como no BalanceHero) para "+R$ 5.000,00" caber. */
  .tot :global(.ui-money) { font-size: clamp(var(--fs-2), 4.6cqw, var(--fs-4)); }
  .list { display: flex; flex-direction: column; gap: var(--space-2); }
  .fab { position: fixed; right: var(--space-4); bottom: calc(var(--tabbar-h) + var(--space-3) + env(safe-area-inset-bottom)); z-index: var(--z-sticky); box-shadow: var(--shadow-lift); border-radius: var(--radius-pill); }
</style>
