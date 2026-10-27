<script>
  import Icon from './Icon.svelte';
  // tone: neutral | income | expense | forecast | overdue | settled | pending | brand. Sempre com texto; ícone opcional.
  let { tone = 'neutral', icon = '', children } = $props();
</script>

<span class="ui-badge {tone}">{#if icon}<Icon name={icon} size="sm" />{/if}{@render children?.()}</span>

<style>
  .ui-badge { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 24px; padding: 0 var(--space-2); border-radius: var(--chip-radius); font: var(--fw-bold) var(--fs-1)/var(--lh-tight) var(--font-text); white-space: nowrap; background: var(--surface-sunken); color: var(--text-muted); }
  .income { background: var(--color-income-soft); color: var(--color-income); }
  .settled { background: var(--color-settled-soft); color: var(--color-settled); }
  .expense { background: var(--color-expense-soft); color: var(--color-expense); }
  .forecast { background: var(--color-forecast-soft); color: var(--color-forecast); }
  .overdue { background: var(--color-overdue-soft); color: var(--color-overdue); }
  .pending { background: var(--color-pending-soft); color: var(--color-pending); }
  .brand { background: var(--brand-soft); color: var(--brand-strong); }
</style>
