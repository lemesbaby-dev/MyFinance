<script>
  import Money from './Money.svelte';
  // Rótulo + valor. Passe `cents` (+ kind/size) ou um snippet no lugar do valor.
  let { label, cents, kind = 'neutral', size = 'md', children } = $props();
</script>

<div class="ui-stat">
  <span class="l">{label}</span>
  {#if children}{@render children()}{:else}<Money {cents} {kind} {size} />{/if}
</div>

<style>
  .ui-stat { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
  .l { font: var(--fw-bold) var(--fs-2)/var(--lh-tight) var(--font-text); color: var(--text-muted); }
</style>
