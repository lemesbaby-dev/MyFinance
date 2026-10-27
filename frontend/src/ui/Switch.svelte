<script>
  // Um dos dois: `label` (aria-label) ou `labelledby` (id de um texto visível).
  let { checked = $bindable(false), label = '', labelledby = '', disabled = false, onchange } = $props();
  function toggle() { checked = !checked; onchange?.(checked); }
</script>

<button type="button" class="ui-switch" class:on={checked} role="switch" aria-checked={checked} aria-label={label || undefined} aria-labelledby={labelledby || undefined} {disabled} onclick={toggle}><i></i></button>

<style>
  .ui-switch { position: relative; flex: none; width: 52px; height: var(--tap); border: 0; padding: 0; background: transparent; }
  .ui-switch::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 30px; margin-top: -15px; border-radius: var(--radius-pill); background: var(--border-strong); transition: background var(--dur-base) var(--ease-out); }
  .on::before { background: var(--brand); }
  i { position: absolute; top: 50%; left: 3px; width: 24px; height: 24px; margin-top: -12px; border-radius: var(--radius-pill); background: var(--surface-raised); transition: transform var(--dur-base) var(--ease-out); }
  .on i { transform: translateX(22px); background: var(--on-brand); }
  .ui-switch:disabled { opacity: 0.5; }
  .ui-switch:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: var(--bw-2); border-radius: var(--radius-pill); }
</style>
