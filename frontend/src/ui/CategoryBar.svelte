<script>
  import CategoryDot from './CategoryDot.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import Money from './Money.svelte';
  import { moneyText } from './money.js';
  import { pct, catIndex } from './logic.js';
  // items: [{label, cents, n (1..10), glyph}]. Largura relativa à maior; rótulo = participação no total. kind: cor/sinal do valor.
  let { items = [], kind = 'expense' } = $props();
  const total = $derived(items.reduce((s, x) => s + Math.max(0, x.cents), 0));
  const max = $derived(Math.max(0, ...items.map((x) => x.cents)));
  const share = (c) => Math.round(pct(c, total));
</script>

<ul class="bars">
  {#each items as it (it.label)}
    <li>
      <div class="h">
        <span class="l"><CategoryDot n={it.n} glyph={it.glyph} size="sm" />{it.label}</span>
        <span class="v"><small>{share(it.cents)}%</small><Money cents={it.cents} {kind} /></span>
      </div>
      <ProgressBar value={it.cents} {max} color="var(--cat-{catIndex(it.n)})" label="{it.label}: {share(it.cents)}% do total, {moneyText(it.cents, kind)}" />
    </li>
  {/each}
</ul>

<style>
  .bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
  .h { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); margin-bottom: var(--space-1); font: var(--fw-bold) var(--fs-2)/var(--lh-tight) var(--font-text); color: var(--text-strong); }
  .l { display: flex; gap: var(--space-2); align-items: center; min-width: 0; }
  .v { display: flex; gap: var(--space-2); align-items: baseline; flex: none; }
  small { font-size: var(--fs-1); color: var(--text-muted); font-weight: var(--fw-bold); }
</style>
