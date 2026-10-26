<script>
  // variant: primary | secondary | ghost | danger. size: md | sm (ambos com alvo >= 44px).
  let { variant = 'primary', size = 'md', loading = false, disabled = false, block = false, type = 'button', onclick, autofocus = false, children } = $props();
</script>

<button class="ui-btn {variant} {size}" class:block {type} disabled={disabled || loading} aria-busy={loading || undefined} {onclick} data-autofocus={autofocus || undefined}>
  {#if loading}<span class="spin" aria-hidden="true"></span>{/if}
  {@render children?.()}
</button>

<style>
  .ui-btn {
    min-height: var(--btn-h); padding: 0 var(--btn-px); border-radius: var(--btn-radius); border: var(--bw-2) solid transparent;
    font: var(--fw-bold) var(--fs-3)/var(--lh-tight) var(--font-text); display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);
    background: var(--btn-quiet-bg); color: var(--btn-quiet-fg); transition: background var(--dur-fast) var(--ease-out);
  }
  .sm { padding: 0 var(--space-3); font-size: var(--fs-2); }
  .block { width: 100%; }
  .primary { background: var(--btn-primary-bg); color: var(--btn-primary-fg); }
  .secondary { background: transparent; color: var(--text-strong); border-color: var(--border-strong); }
  .ghost { background: transparent; color: var(--text-muted); }
  .danger { background: var(--color-expense-soft); color: var(--color-expense); border-color: var(--color-expense); }
  .ui-btn:disabled { opacity: 0.5; cursor: default; }
  .ui-btn:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: var(--bw-2); }
  .spin { width: 16px; height: 16px; border-radius: var(--radius-pill); border: var(--bw-2) solid currentColor; border-right-color: transparent; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 3s; } }
</style>
