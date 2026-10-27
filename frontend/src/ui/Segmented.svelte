<script>
  // options: [[valor, rótulo], ...]. Grupo de botões aria-pressed (mesmo contrato do More › Aparência).
  let { options, value = $bindable(), label, onchange } = $props();
</script>

<div class="ui-seg" role="group" aria-label={label}>
  {#each options as [v, text] (v)}
    <button type="button" class:on={value === v} aria-pressed={value === v} onclick={() => { value = v; onchange?.(v); }}>{text}</button>
  {/each}
</div>

<style>
  .ui-seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: var(--space-1); padding: var(--space-1); background: var(--surface-sunken); border-radius: var(--radius-2); }
  button { min-height: var(--tap); border: var(--bw-1) solid transparent; border-radius: var(--radius-1); background: transparent; font: var(--fw-bold) var(--fs-2) var(--font-text); color: var(--text-muted); }
  button.on { background: var(--surface-raised); color: var(--text-strong); border-color: var(--border-subtle); }
  button:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: var(--bw-2); }
</style>
