<script>
  import Icon from './Icon.svelte';
  // tone: info (marca, padrão: offline/pendências) | warn (recusados/atenção) | danger (só erro real). Sem alarmismo: texto calmo, ação opcional.
  let { tone = 'info', icon = 'info', detail = '', action, children } = $props();
</script>

<div class="ui-banner {tone}" role={tone === 'danger' ? 'alert' : 'status'}>
  <Icon name={icon} />
  <div class="grow">{@render children?.()}{#if detail}<small>{detail}</small>{/if}</div>
  {@render action?.()}
</div>

<style>
  .ui-banner { display: flex; gap: var(--space-3); align-items: center; padding: var(--space-2) var(--space-3); min-height: var(--tap); border-radius: var(--radius-2); background: var(--brand-soft); color: var(--text-strong); font: var(--fw-bold) var(--fs-2)/var(--lh-tight) var(--font-text); }
  .ui-banner > :global(.ico) { color: var(--brand-strong); }
  .grow { flex: 1; min-width: 0; }
  small { display: block; margin-top: var(--space-1); font-weight: var(--fw-medium); font-size: var(--fs-1); color: var(--text-muted); }
  .warn { background: var(--color-overdue-soft); } .warn > :global(.ico) { color: var(--color-overdue); }
  .danger { background: var(--color-expense-soft); } .danger > :global(.ico) { color: var(--color-expense); }
</style>
