<script>
  import Icon from './Icon.svelte';
  import Button from './Button.svelte';
  // Orientação + ação opcional (actionLabel/onaction). tone: brand | forecast | danger. ErrorState reusa com tone=danger.
  let { icon = 'leaf', title, text = '', tone = 'brand', actionLabel = '', onaction, role } = $props();
</script>

<div class="ui-state" {role}>
  <span class="art {tone}"><Icon name={icon} size="lg" /></span>
  <h2>{title}</h2>
  {#if text}<p>{text}</p>{/if}
  {#if actionLabel}<Button onclick={onaction}>{actionLabel}</Button>{/if}
</div>

<style>
  .ui-state { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--space-3); padding: var(--space-6) var(--space-2); }
  h2 { margin: 0; font: var(--fw-display) var(--fs-4)/var(--lh-tight) var(--font-display); color: var(--text-strong); }
  p { margin: 0; color: var(--text-muted); max-width: 30ch; font-size: var(--fs-2); }
  .art { width: var(--space-16); height: var(--space-16); border-radius: var(--radius-4); display: grid; place-items: center; background: var(--brand-soft); color: var(--brand-strong); }
  .forecast { background: var(--color-forecast-soft); color: var(--color-forecast); }
  .danger { background: var(--color-expense-soft); color: var(--color-expense); }
</style>
