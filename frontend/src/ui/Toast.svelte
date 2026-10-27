<script>
  import Icon from './Icon.svelte';
  // Apresentação do toast (usada pelo ToastHost; pode ficar inline na /design).
  let { msg, tone = 'info', actionLabel = '', onaction, ondismiss } = $props();
  const ICON = { info: 'info', ok: 'check', warn: 'alert' };
</script>

<div class="ui-toast" role="status">
  <Icon name={ICON[tone] ?? 'info'} />
  <span class="m">{msg}</span>
  {#if actionLabel}<button class="act" type="button" onclick={onaction}>{actionLabel}</button>{/if}
  <button class="x" type="button" aria-label="Fechar aviso" onclick={ondismiss}><Icon name="x" size="sm" /></button>
</div>

<style>
  .ui-toast { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4); min-height: var(--tap); border-radius: var(--radius-2); background: var(--toast-bg); color: var(--toast-fg); box-shadow: var(--shadow-lift); font: var(--fw-bold) var(--fs-2)/var(--lh-snug) var(--font-text); }
  .m { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  button { min-width: var(--tap); min-height: var(--tap); border: 0; background: transparent; color: inherit; font: inherit; display: grid; place-items: center; border-radius: var(--radius-1); }
  .act { text-decoration: underline; padding: 0 var(--space-2); }
  button:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: calc(var(--bw-2) * -1); }
</style>
