<script>
  import { tick } from 'svelte';
  import { app, setPaid, deleteTx, deleteRecurring } from './lib/app.svelte.js';
  import { balances, filterTxs, monthView, monthEnd, monthOf, shiftMonth, todayISO } from './lib/finance.js';
  import { shortDate } from './lib/format.js';
  import TxForm from './TxForm.svelte';
  import Recurrences from './Recurrences.svelte';
  import RecurrenceSheet from './RecurrenceSheet.svelte';
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
  import IconButton from './ui/IconButton.svelte';
  import Sheet from './ui/Sheet.svelte';
  import TextInput from './ui/TextInput.svelte';
  import Select from './ui/Select.svelte';
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
  let form = $state(null); // { tx } | { repeating } | {}
  let sub = $state('tx'); // subaba: tx (Lançamentos) | rec (Repetições)
  let ruleId = $state(null); // repetição com o detalhe aberto
  let find = $state({ q: '', accountId: '', categoryId: '' }); // busca e filtros: valem enquanto a aba Mês está aberta
  let finding = $state(false);
  let bar = $state();
  let subs = $state();
  let scopeFor = $state(null);
  let error = $state('');

  const until = $derived(monthEnd(month));
  const bal = $derived(balances(app.accounts, app.transactions, until, app.rejectedIds));
  const nowBal = $derived(balances(app.accounts, app.transactions, today, app.rejectedIds));
  const archived = $derived(new Set(app.accounts.filter((a) => a.archived).map((a) => a.id)));
  const view = $derived(monthView(filterTxs(app.transactions, find, app.categories), month, filter, today, archived, app.rejectedIds));
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

  const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
  const accOpts = $derived([['', 'Todas as contas'], ...app.accounts.filter((a) => !a.archived).map((a) => [a.id, a.name])]);
  const catOpts = $derived([['', 'Todas as categorias'], ...app.categories.filter((c) => !c.parent_id && !c.is_system).sort(byName)
    .flatMap((c) => [[c.id, c.name], ...app.categories.filter((k) => k.parent_id === c.id).sort(byName).map((k) => [k.id, `${c.name} › ${k.name}`])])]);
  const found = $derived([find.q.trim() && `“${find.q.trim()}”`, find.accountId && (accName(find.accountId) || 'conta excluída'), find.categoryId && (catName(find.categoryId) || 'categoria excluída')].filter(Boolean).join(' · '));
  // O botão que limpou some junto com o filtro: o foco volta para quem abre a busca.
  const clearFind = () => { find = { q: '', accountId: '', categoryId: '' }; finding = false; bar?.querySelector('.ui-iconbtn')?.focus(); };

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
  // Encerrar tira da tela a linha que abriu o detalhe: sem ter para onde voltar, o foco vai para a subaba atual.
  async function closeRule() {
    ruleId = null;
    await tick();
    if (document.activeElement === document.body) subs?.querySelector('.on')?.focus();
  }

  const metaOf = (t, withDate) => [
    withDate ? shortDate(t.date) : '',
    accName(t.account_id) + (t.kind === 'transfer' ? ` → ${accName(t.transfer_account_id)}` : ''),
    t.category_id ? catName(t.category_id) : '',
    t.recurrence_id ? 'repete' : '',
    app.rejectedIds.has(t.id) ? 'não enviado' : '',
  ].filter(Boolean).join(' · ');
  const menuOf = (t) => [
    { label: 'Editar', icon: 'edit', onselect: () => (form = { tx: t }) },
    ...(app.recurrences.some((r) => r.id === t.recurrence_id) ? [{ label: 'Ver repetição', icon: 'refresh', onselect: () => (ruleId = t.recurrence_id) }] : []),
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

<div class="subs" bind:this={subs} role="group" aria-label="Seções de Mês">
  {#each [['tx', 'Lançamentos'], ['rec', 'Repetições']] as [k, text] (k)}
    <button type="button" class:on={sub === k} aria-pressed={sub === k} onclick={() => (sub = k)}>{text}</button>
  {/each}
</div>

{#if sub === 'rec'}
<Recurrences {today} onopen={(id) => (ruleId = id)} />
{:else}
<BalanceHero now={nowBal.current_cents} forecast={bal.projected_cents} {done} {todo} forecastLabel="Previsto até {shortDate(until)}" />

<MonthNav {label} onprev={() => (month = shiftMonth(month, -1))} onnext={() => (month = shiftMonth(month, 1))} />

<div class="bar" bind:this={bar}>
  <Segmented label="Mostrar" options={FILTERS} bind:value={filter} onchange={setFilter} />
  <IconButton icon="sliders" label={found ? 'Buscar e filtrar (filtro ativo)' : 'Buscar e filtrar'} aria-haspopup="dialog" tone={found ? 'brand' : 'soft'} onclick={() => (finding = true)} />
</div>
{#if found}
  <div class="found">
    <p>Filtrando por <b>{found}</b></p>
    <Button variant="secondary" size="sm" onclick={clearFind}><Icon name="x" />Limpar</Button>
  </div>
{/if}

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
    {#if found}
      <EmptyState title="Nada encontrado" text="Nenhum lançamento deste mês bate com a busca e os filtros." actionLabel="Limpar filtros" onaction={clearFind} />
    {:else}
      <EmptyState title={hasAccounts ? 'Nada neste filtro' : 'Nenhuma conta ainda'} text={hasAccounts ? 'Use “Lançar” para registrar.' : 'Crie uma conta na aba Contas para começar.'} />
    {/if}
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
{/if}

{#if hasAccounts}<div class="fab"><Button onclick={() => (form = { repeating: sub === 'rec' })}><Icon name="plus" />{sub === 'rec' ? 'Nova repetição' : 'Lançar'}</Button></div>{/if}
{#if finding}
  <Sheet title="Buscar e filtrar" onclose={() => (finding = false)}>
    <TextInput label="Buscar" placeholder="Descrição ou notas" bind:value={find.q} autocomplete="off" />
    <Select label="Conta" bind:value={find.accountId} options={accOpts} />
    <Select label="Categoria" bind:value={find.categoryId} options={catOpts} />
    <div class="acts">
      <Button variant="secondary" disabled={!found} onclick={clearFind}>Limpar</Button>
      <Button onclick={() => (finding = false)}>Ver lançamentos</Button>
    </div>
  </Sheet>
{/if}
{#if form}<TxForm tx={form.tx ?? null} repeating={!!form.repeating} onclose={() => (form = null)} />{/if}
{#if ruleId}<RecurrenceSheet id={ruleId} {today} onclose={closeRule} />{/if}
{#if scopeFor}<Scope verb="Excluir" onpick={removeScoped} onclose={() => (scopeFor = null)} />{/if}

<style>
  .cap { margin: 0 0 var(--space-2); font: var(--fw-bold) var(--fs-2)/var(--lh-tight) var(--font-text); color: var(--text-muted); }
  .tot { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2) var(--space-3); container-type: inline-size; }
  /* Três colunas sempre: a fonte segue a largura do card (como no BalanceHero) para "+R$ 5.000,00" caber. */
  .tot :global(.ui-money) { font-size: clamp(var(--fs-2), 4.6cqw, var(--fs-4)); }
  .subs { display: grid; grid-template-columns: 1fr 1fr; border-bottom: var(--bw-1) solid var(--border-subtle); }
  .subs button { min-height: var(--tap); border: 0; border-bottom: var(--bw-2) solid transparent; background: transparent; font: var(--fw-bold) var(--fs-3) var(--font-text); color: var(--text-muted); }
  .subs .on { color: var(--brand-strong); border-bottom-color: var(--brand-strong); }
  .subs button:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: calc(var(--bw-2) * -1); }
  .bar { display: flex; align-items: center; gap: var(--space-2); }
  .bar :global(.ui-seg) { flex: 1; min-width: 0; }
  .found { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
  .found p { margin: 0; min-width: 0; font-size: var(--fs-2); color: var(--text-muted); overflow-wrap: anywhere; }
  .found b { color: var(--text-strong); }
  .acts { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
  .list { display: flex; flex-direction: column; gap: var(--space-2); }
  .fab { position: fixed; right: var(--space-4); bottom: calc(var(--tabbar-h) + var(--space-3) + env(safe-area-inset-bottom)); z-index: var(--z-sticky); box-shadow: var(--shadow-lift); border-radius: var(--radius-pill); }
</style>
