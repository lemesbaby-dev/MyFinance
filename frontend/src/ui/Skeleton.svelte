<script>
  // kind: line (texto) | row (linha de lista). count repete. Pulso só sem prefers-reduced-motion.
  let { kind = 'row', count = 1 } = $props();
</script>

<div class="sk" role="status" aria-busy="true" aria-label="Carregando">
  {#each Array(count) as _, i (i)}
    {#if kind === 'row'}
      <div class="row"><i class="av"></i><div class="tx"><i class="ln lg"></i><i class="ln short"></i></div><i class="ln val"></i></div>
    {:else}<i class="ln lg"></i>{/if}
  {/each}
</div>

<style>
  .sk { display: flex; flex-direction: column; gap: var(--space-3); }
  i { display: block; background: var(--surface-sunken); border-radius: var(--radius-1); }
  .row { display: flex; align-items: center; gap: var(--space-3); min-height: var(--row-min-h); }
  .av { width: var(--row-icon); height: var(--row-icon); border-radius: var(--radius-2); flex: none; }
  .tx { flex: 1; display: flex; flex-direction: column; gap: var(--space-2); }
  .ln { height: var(--space-3); } .lg { height: var(--space-4); } .short { width: 60%; } .val { width: var(--space-16); flex: none; }
  @media (prefers-reduced-motion: no-preference) { i { animation: pulse 1.4s ease-in-out infinite; } }
  @keyframes pulse { 50% { opacity: 0.5; } }
</style>
