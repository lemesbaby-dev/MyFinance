<script>
  // Subaba "Repetições" da aba Mês: as regras (contas que se repetem), não os lançamentos de um mês.
  import { app } from './lib/app.svelte.js';
  import { recurrenceView, rhythm } from './lib/finance.js';
  import { shortDate, fullDate } from './lib/format.js';
  import Card from './ui/Card.svelte';
  import Stat from './ui/Stat.svelte';
  import ListGroup from './ui/ListGroup.svelte';
  import CategoryDot from './ui/CategoryDot.svelte';
  import Money from './ui/Money.svelte';
  import Badge from './ui/Badge.svelte';
  import EmptyState from './ui/EmptyState.svelte';
  import { catOf, catMap } from './ui/logic.js';

  // onopen(id): abre o detalhe da repetição. onnew: abre "Novo lançamento" já repetindo (ausente = sem conta ainda).
  let { today, onopen, onnew } = $props();

  const view = $derived(recurrenceView(app.recurrences, app.transactions, today, app.rejectedIds));
  const groups = $derived([['A pagar', 'expense'], ['A receber', 'income']].map(([title, kind]) => ({ title, rows: view.rows.filter((r) => !r.ended && r.rec.kind === kind) })));
  const ended = $derived(view.rows.filter((r) => r.ended));
  const catColor = $derived(catMap(app.categories.map((c) => c.id)));
  const accName = (id) => app.accounts.find((a) => a.id === id)?.name ?? '';
</script>

{#snippet row(r)}
  <div role="listitem">
    <button type="button" class="row" class:late={r.overdue} class:off={r.ended} onclick={() => onopen(r.rec.id)}>
      <CategoryDot n={r.rec.category_id ? catOf(r.rec.category_id, catColor) : 0} glyph={r.rec.kind === 'income' ? 'down' : 'tag'} />
      <span class="main"><span class="t">{r.rec.description}</span><span class="m">{rhythm(r.rec)} · {accName(r.rec.account_id)}</span></span>
      <Money cents={r.rec.amount_cents} kind={r.rec.kind} />
      <span class="tags">
        {#if r.overdue}<Badge tone="overdue" icon="alert">{r.overdue === 1 ? 'Atrasado' : `${r.overdue} atrasados`} · {shortDate(r.pending[0])}</Badge>{/if}
        {#if r.ended}
          <Badge>Encerrada{r.rec.end_date < today ? ` · parou em ${fullDate(r.rec.end_date)}` : ''}</Badge>
        {:else}
          {#if r.next}<Badge tone="forecast" icon="clock">Próximo · {shortDate(r.next)}</Badge>{/if}
          {#if r.rec.end_date}<Badge tone="brand">Até {fullDate(r.rec.end_date)}</Badge>{/if}
        {/if}
      </span>
    </button>
  </div>
{/snippet}

{#if !view.rows.length}
  <EmptyState icon="refresh" title="Nenhuma repetição ainda" text="Aluguel, salário, academia: lance uma vez e o MyFinance repete para você." actionLabel={onnew ? 'Nova repetição' : ''} onaction={onnew} />
{:else}
  <Card>
    <p class="cap">Próximos 30 dias</p>
    <div class="tot">
      <Stat label="A receber" cents={view.income_cents} kind="income" />
      <Stat label="A pagar" cents={view.expense_cents} kind="expense" />
      <Stat label="Sobra" cents={view.income_cents - view.expense_cents} />
    </div>
  </Card>

  <h2>Contas que se repetem</h2>
  {#each groups as g (g.title)}
    {#if g.rows.length}
      <ListGroup title={g.title} note={g.rows.length}>
        {#each g.rows as r (r.rec.id)}{@render row(r)}{/each}
      </ListGroup>
    {/if}
  {/each}

  {#if ended.length}
    <details>
      <summary>Encerradas ({ended.length})</summary>
      <ListGroup title="Não geram mais lançamentos">
        {#each ended as r (r.rec.id)}{@render row(r)}{/each}
      </ListGroup>
    </details>
  {/if}
{/if}

<style>
  .cap { margin: 0 0 var(--space-2); font: var(--fw-bold) var(--fs-2)/var(--lh-tight) var(--font-text); color: var(--text-muted); }
  .tot { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2) var(--space-3); container-type: inline-size; }
  .tot :global(.ui-money) { font-size: clamp(var(--fs-2), 4.6cqw, var(--fs-4)); }
  .row { display: grid; grid-template-columns: var(--row-icon) 1fr auto; gap: var(--space-1) var(--row-gap); align-items: center; width: 100%; min-height: calc(var(--tap) + var(--space-3)); padding: var(--row-pad); border: 0; border-radius: inherit; background: transparent; color: inherit; font: inherit; text-align: left; }
  .row:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: calc(var(--bw-2) * -1); }
  [role='listitem'] { border-radius: inherit; }
  .main { min-width: 0; }
  .t, .m { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .t { font-weight: var(--fw-bold); color: var(--text-strong); line-height: var(--lh-tight); }
  .m { margin-top: var(--space-1); font-size: var(--fs-1); font-weight: var(--fw-bold); color: var(--text-muted); }
  .tags { grid-column: 1 / 4; display: flex; flex-wrap: wrap; gap: var(--space-1); }
  .late { background: var(--color-overdue-soft); }
  .off .t { color: var(--text-muted); }
  .off :global(.ui-dot) { opacity: 0.62; }
  summary { padding: var(--space-3) var(--space-1); font: var(--fw-bold) var(--fs-2) var(--font-text); color: var(--text-strong); cursor: pointer; }
  summary:focus-visible { outline: var(--bw-2) solid var(--focus-ring); border-radius: var(--radius-1); }
</style>
