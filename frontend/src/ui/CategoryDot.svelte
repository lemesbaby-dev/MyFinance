<script>
  import Icon from './Icon.svelte';
  import { catIndex } from './logic.js';
  // n: 1..10 -> --cat-N (+ glifo, cor nunca é o único canal). Sem n: tile neutro de marca. size: sm (16) | md (row-icon).
  let { n = 0, glyph = 'tag', size = 'md' } = $props();
  const i = $derived(n ? catIndex(n) : 0);
</script>

<span class="ui-dot {size}" class:soft={!i} style:--c={i ? `var(--cat-${i})` : null} style:--ci={i ? `var(--cat-${i}-ink)` : null} aria-hidden="true"><Icon name={glyph} size={size === 'sm' ? 'sm' : 'md'} /></span>

<style>
  .ui-dot { width: var(--row-icon); height: var(--row-icon); border-radius: var(--radius-2); display: inline-grid; place-items: center; background: var(--c); color: var(--ci); flex: none; }
  .sm { width: var(--space-4); height: var(--space-4); border-radius: var(--space-1); }
  .soft { background: var(--brand-soft); color: var(--brand-strong); }
</style>
