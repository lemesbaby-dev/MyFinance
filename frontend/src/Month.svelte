<script>
  import { app, setPaid, deleteTx, deleteRecurring } from './lib/app.svelte.js';
  import { balances, monthView, monthEnd, monthOf, shiftMonth, todayISO } from './lib/finance.js';
  import { money, shortDate } from './lib/format.js';
  import TxForm from './TxForm.svelte';
  import Scope from './Scope.svelte';

  const today = todayISO();
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const FILTERS = [['all', 'Todos'], ['pending', 'Pendentes'], ['paid', 'Efetivados']];
  const TOTAL_LABEL = { all: 'Previsto do mês', pending: 'A realizar', paid: 'Realizado' };

  const saved = (() => { try { return localStorage.getItem('financas.filter'); } catch { return null; } })();
  let month = $state(monthOf(today));
  let filter = $state(FILTERS.some(([k]) => k === saved) ? saved : 'all');
  let form = $state(null); // { tx } | {}
  let scopeFor = $state(null);
  let error = $state('');

  const until = $derived(monthEnd(month));
  const bal = $derived(balances(app.accounts, app.transactions, until));
  const nowBal = $derived(balances(app.accounts, app.transactions, today));
  const view = $derived(monthView(app.transactions, month, filter, today));
  const maxSpend = $derived(Math.max(1, ...view.spending.map((s) => s.cents)));
  const label = $derived(`${MONTHS[+month.slice(5, 7) - 1]} de ${month.slice(0, 4)}`);
  const hasAccounts = $derived(app.accounts.some((a) => !a.archived));

  const accName = (id) => app.accounts.find((a) => a.id === id)?.name ?? '';
  const catName = (id) => app.categories.find((c) => c.id === id)?.name ?? '';
  const sign = (t) => (t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : '');

  function setFilter(k) {
    filter = k;
    try { localStorage.setItem('financas.filter', k); } catch { /* sem armazenamento: só não lembra */ }
  }

  const guard = (fn) => async (...a) => { error = ''; try { await fn(...a); } catch (e) { error = e.message; } };
  const toggle = guard((t) => setPaid(t, t.status !== 'paid'));
  const removeOne = guard(async (t) => {
    if (t.recurrence_id) { scopeFor = t; return; }
    if (confirm(`Excluir "${t.description}"?`)) await deleteTx(t);
  });
  const removeScoped = guard(async (scope) => { const t = scopeFor; scopeFor = null; await deleteRecurring(t, scope); });
</script>

{#snippet row(t, late)}
  <li class:late class:done={t.status === 'paid'}>
    <div class="grow">
      <strong>{t.description}{#if t.installment_total} <span class="muted">{t.installment_no}/{t.installment_total}</span>{/if}</strong>
      <span class="muted small">
        {shortDate(t.date)}{#if late} · atrasado{/if}{#if t.recurrence_id} · repete{/if}
        · {accName(t.account_id)}{#if t.kind === 'transfer'} → {accName(t.transfer_account_id)}{/if}{#if t.category_id} · {catName(t.category_id)}{/if}
      </span>
    </div>
    <span class="num {t.kind === 'income' ? 'in' : t.kind === 'expense' ? 'out' : ''}">{sign(t)}{money(t.amount_cents)}</span>
    <div class="acts">
      <button class="btn small ghost" onclick={() => toggle(t)}>{t.status === 'paid' ? 'Desfazer' : t.kind === 'income' ? 'Recebi' : 'Paguei'}</button>
      <button class="btn small ghost" onclick={() => (form = { tx: t })} aria-label="Editar {t.description}">✎</button>
      <button class="btn small ghost" onclick={() => removeOne(t)} aria-label="Excluir {t.description}">✕</button>
    </div>
  </li>
{/snippet}

<header class="hero">
  <div>
    <p class="label">Saldo hoje</p>
    <p class="big num">{money(nowBal.current_cents)}</p>
  </div>
  <div class="bridge" aria-hidden="true"><span></span></div>
  <div class="proj">
    <p class="label">Previsto até {shortDate(until)}</p>
    <p class="big num" style="color: var(--proj)">{money(bal.projected_cents)}</p>
  </div>
</header>

<nav class="months pad" aria-label="Mês">
  <button class="btn small ghost" onclick={() => (month = shiftMonth(month, -1))} aria-label="Mês anterior">‹</button>
  <strong>{label}</strong>
  <button class="btn small ghost" onclick={() => (month = shiftMonth(month, 1))} aria-label="Próximo mês">›</button>
</nav>

<div class="pad">
  <div class="seg" role="group" aria-label="Mostrar">
    {#each FILTERS as [k, text]}
      <button class:on={filter === k} aria-pressed={filter === k} onclick={() => setFilter(k)}>{text}</button>
    {/each}
  </div>
  <p class="totals muted">
    {TOTAL_LABEL[filter]}: <span class="in num">+{money(view.income_cents)}</span> ·
    <span class="out num">−{money(view.expense_cents)}</span> ·
    <strong class="num {view.result_cents < 0 ? 'out' : 'in'}">{money(view.result_cents)}</strong>
  </p>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
</div>

<section class="pad">
  {#if view.overdue.length}
    <h2>Atrasados de meses anteriores</h2>
    <ul class="rows">{#each view.overdue as t (t.id)}{@render row(t, true)}{/each}</ul>
  {/if}

  <h2>Lançamentos</h2>
  {#if view.rows.length === 0}
    <p class="muted">{hasAccounts ? 'Nada neste filtro. Use “Lançar” para registrar.' : 'Crie uma conta na aba Contas para começar.'}</p>
  {:else}
    <ul class="rows">{#each view.rows as t (t.id)}{@render row(t, t.status === 'pending' && t.date < today)}{/each}</ul>
  {/if}
</section>

<section class="pad">
  <h2>Gastos por categoria</h2>
  {#if !view.spending.length}
    <p class="muted">Sem despesas neste filtro.</p>
  {:else}
    <ul class="bars">
      {#each view.spending as s (s.category_id ?? 'none')}
        <li>
          <div class="line"><span>{s.category_id ? catName(s.category_id) : 'Sem categoria'}</span><span class="num">{money(s.cents)}</span></div>
          <div class="track" role="img" aria-label="{money(s.cents)}"><i style="width:{(s.cents / maxSpend) * 100}%"></i></div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if hasAccounts}<button class="fab btn" onclick={() => (form = {})}>Lançar</button>{/if}
{#if form}<TxForm tx={form.tx ?? null} onclose={() => (form = null)} />{/if}
{#if scopeFor}<Scope verb="Excluir" onpick={removeScoped} onclose={() => (scopeFor = null)} />{/if}

<style>
  .hero { display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; gap: 0.75rem; padding: 1.5rem 1.25rem 0.5rem; }
  .label { margin: 0; color: var(--muted); font-size: 0.875rem; }
  .big { margin: 0; font-size: clamp(1.4rem, 6.4vw, 2.2rem); font-weight: 650; line-height: 1.15; }
  .proj { text-align: right; }
  .bridge { align-self: center; width: clamp(1rem, 8vw, 3rem); height: 1px; border-top: 2px dashed var(--proj); opacity: 0.6; margin-bottom: 0.4rem; }
  .months { display: flex; align-items: center; justify-content: space-between; margin: 1rem 0 0.75rem; }
  .months strong::first-letter { text-transform: uppercase; }
  .totals { margin: -0.25rem 0 0.5rem; font-size: 0.9rem; }
  .bars li { margin-bottom: 0.8rem; }
  .line { display: flex; justify-content: space-between; margin-bottom: 0.25rem; }
  .track { display: flex; height: 0.5rem; background: color-mix(in srgb, var(--line) 55%, transparent); border-radius: 99px; overflow: hidden; }
  .track i { background: var(--out); }
  .fab { position: fixed; right: 1.25rem; bottom: calc(4.5rem + env(safe-area-inset-bottom)); box-shadow: 0 6px 18px rgb(0 0 0 / 0.25); padding: 0.85rem 1.4rem; z-index: 5; }
</style>
