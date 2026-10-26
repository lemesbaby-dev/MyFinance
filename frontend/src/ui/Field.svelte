<script>
  // Rótulo + ajuda + erro ligados ao controle por id/aria-describedby/aria-invalid.
  // O controle chega pelo snippet: {#snippet children(a)}<input {...a} />{/snippet}
  let { label, help = '', error = '', children } = $props();
  const id = $props.id();
  const a = $derived({ id, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error ? `${id}-e` : help ? `${id}-h` : undefined });
</script>

<div class="field">
  <label for={id}>{label}</label>
  {@render children(a)}
  {#if error}<p class="msg err" id="{id}-e" role="alert">{error}</p>{:else if help}<p class="msg" id="{id}-h">{help}</p>{/if}
</div>

<style>
  .field { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
  label { font: var(--fw-bold) var(--fs-2)/var(--lh-tight) var(--font-text); color: var(--text-muted); }
  .msg { margin: 0; font-size: var(--fs-1); color: var(--text-muted); }
  .err { color: var(--color-expense); font-weight: var(--fw-bold); }
</style>
