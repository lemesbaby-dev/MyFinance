<script>
  // "Só esta / Esta e as próximas / Todas as pendentes" para lançamentos que vêm de uma recorrência.
  let { verb = 'Aplicar', onpick, onclose } = $props();
</script>

<div class="scrim" role="presentation" onclick={onclose}></div>
<div class="sheet" role="dialog" aria-label="{verb} em quais lançamentos?">
  <h3>{verb} em quais lançamentos?</h3>
  <p class="muted small">Este lançamento faz parte de uma repetição.</p>
  <div class="stack">
    <button class="btn ghost" onclick={() => onpick('one')}>Só este</button>
    <button class="btn ghost" onclick={() => onpick('following')}>Este e os próximos</button>
    <button class="btn ghost" onclick={() => onpick('all')}>Todos os pendentes</button>
    <button class="btn ghost" onclick={onclose}>Cancelar</button>
  </div>
</div>

<style>
  .stack { display: grid; gap: 0.5rem; }
</style>
