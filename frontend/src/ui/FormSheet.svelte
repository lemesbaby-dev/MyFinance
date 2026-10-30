<script>
  import Sheet from './Sheet.svelte';
  import Button from './Button.svelte';
  import Banner from './Banner.svelte';
  // Folha de formulário: campos (children), erro geral (Banner), Cancelar/Salvar e, se houver, ação destrutiva (onremove).
  // Erros de campo ficam nos próprios <Field>; `error` aqui é só o que não é de um campo.
  let { title, onclose, onsubmit, busy = false, error = '', onremove, removeLabel = 'Excluir', canSave = true, children } = $props();
</script>

<Sheet {title} {onclose}>
  <form novalidate {onsubmit}>
    {@render children?.()}
    {#if error}<Banner tone="danger" icon="alert">{error}</Banner>{/if}
    <div class="actions">
      <Button variant="secondary" onclick={onclose}>Cancelar</Button>
      <Button type="submit" loading={busy} disabled={!canSave}>{busy ? 'Salvando…' : 'Salvar'}</Button>
    </div>
    {#if onremove}<Button variant="danger" block onclick={onremove} disabled={busy}>{removeLabel}</Button>{/if}
  </form>
</Sheet>

<style>
  form { display: flex; flex-direction: column; gap: var(--space-3); }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
</style>
