<script>
  import IconButton from './IconButton.svelte';
  // label: "Outubro de 2026" (formatação fica com quem usa). ←/→ no grupo também navegam.
  let { label, onprev, onnext, prevLabel = 'Mês anterior', nextLabel = 'Próximo mês' } = $props();
  function key(e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); onprev?.(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); onnext?.(); }
  }
</script>

<div class="ui-month" role="group" aria-label="Mês" tabindex="-1" onkeydown={key}>
  <IconButton icon="left" label={prevLabel} tone="soft" onclick={onprev} />
  <span class="n" aria-live="polite">{label}</span>
  <IconButton icon="right" label={nextLabel} tone="soft" onclick={onnext} />
</div>

<style>
  .ui-month { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
  .n { font: var(--fw-display) var(--fs-4)/var(--lh-tight) var(--font-display); color: var(--text-strong); text-align: center; }
</style>
