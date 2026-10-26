<script>
  import { onMount } from 'svelte';
  import { dialog } from '../lib/a11y.js';
  // Montar condicionalmente: {#if open}<Sheet title onclose>…</Sheet>{/if}. center = Dialog (centrado).
  // Foco preso, Escape, devolução de foco: lib/a11y.js. Scroll da página travado enquanto aberto (contador: sheets empilhados).
  let { title, onclose, center = false, children } = $props();
  const id = $props.id();
  onMount(() => {
    const n = (globalThis.__mfScrollLocks ?? 0) + 1;
    globalThis.__mfScrollLocks = n;
    document.body.style.overflow = 'hidden';
    return () => { if (!(globalThis.__mfScrollLocks = globalThis.__mfScrollLocks - 1)) document.body.style.overflow = ''; };
  });
</script>

<div class="scrim" class:center role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="panel" class:center role="dialog" aria-modal="true" aria-labelledby="{id}-t" use:dialog={onclose}>
    {#if !center}<span class="grab" aria-hidden="true"></span>{/if}
    <h2 id="{id}-t">{title}</h2>
    {@render children?.()}
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; background: var(--surface-overlay); z-index: var(--z-sheet); display: flex; flex-direction: column; justify-content: flex-end; }
  .scrim.center { justify-content: center; padding: var(--space-5); z-index: var(--z-dialog); }
  .panel { width: 100%; max-width: 42rem; margin: 0 auto; max-height: 92dvh; overflow-y: auto; background: var(--surface-raised); color: var(--text-body); display: flex; flex-direction: column; gap: var(--space-3);
    border-radius: var(--sheet-radius) var(--sheet-radius) 0 0; padding: var(--space-2) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom)); }
  .panel.center { max-width: 26rem; border-radius: var(--radius-4); padding: var(--space-5) var(--space-4) var(--space-4); box-shadow: var(--shadow-lift); }
  .grab { width: 40px; height: 4px; border-radius: var(--radius-1); background: var(--border-strong); margin: var(--space-1) auto 0; }
  h2 { margin: 0; font: var(--fw-display) var(--fs-4)/var(--lh-tight) var(--font-display); color: var(--text-strong); }
  @media (prefers-reduced-motion: no-preference) { .panel:not(.center) { animation: up var(--dur-slow) var(--ease-out); } }
  @keyframes up { from { transform: translateY(24px); opacity: 0; } }
</style>
