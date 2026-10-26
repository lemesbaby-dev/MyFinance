<script>
  import { pct } from './logic.js';
  // Barra única. `label` vira aria-label (role=img); cor vem de `color` (ex.: var(--cat-3)) ou da marca.
  let { value, max, label, color = '' } = $props();
  const p = $derived(pct(value, max));
</script>

<div class="tr" role="img" aria-label={label}><i style:width="{p}%" style:--c={color || null}></i></div>

<style>
  .tr { height: var(--space-2); background: var(--field-bg); border-radius: var(--radius-1); overflow: hidden; }
  i { display: block; height: 100%; background: var(--c, var(--brand)); border-radius: var(--radius-1); }
</style>
