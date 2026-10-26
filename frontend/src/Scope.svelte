<script>
  // "Só esta / Esta e as próximas / Todas as pendentes" para lançamentos que vêm de uma recorrência.
  import Sheet from './ui/Sheet.svelte';
  import Button from './ui/Button.svelte';
  let { verb = 'Aplicar', onpick, onclose } = $props();
</script>

<Sheet center title="{verb} em quais lançamentos?" {onclose}>
  <p class="note">Este lançamento faz parte de uma repetição.</p>
  <div class="stack">
    <Button variant="secondary" block onclick={() => onpick('one')}>Só este</Button>
    <Button variant="secondary" block onclick={() => onpick('following')}>Este e os próximos</Button>
    <Button variant="secondary" block onclick={() => onpick('all')}>Todos os pendentes</Button>
    <Button variant="ghost" block onclick={onclose}>Cancelar</Button>
  </div>
</Sheet>

<style>
  .note { margin: 0; font-size: var(--fs-2); color: var(--text-muted); }
  .stack { display: flex; flex-direction: column; gap: var(--space-2); }
</style>
