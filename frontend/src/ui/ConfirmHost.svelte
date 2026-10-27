<script>
  import { onMount } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Button from './Button.svelte';
  import { registerConfirmHost } from './confirm.js';
  // Host único (montado no App). Pedido novo com um aberto: o anterior resolve false.
  let cur = $state(null);
  onMount(() => registerConfirmHost((opts, resolve) => { cur?.resolve(false); cur = { opts, resolve }; }));
  function done(v) { const c = cur; cur = null; c?.resolve(v); }
</script>

{#if cur}
  <Sheet center title={cur.opts.title} onclose={() => done(false)}>
    {#if cur.opts.message}<p class="msg">{cur.opts.message}</p>{/if}
    <div class="stack">
      <Button variant={cur.opts.danger ? 'danger' : 'primary'} block onclick={() => done(true)}>{cur.opts.confirmLabel ?? 'Confirmar'}</Button>
      <Button variant="ghost" block autofocus onclick={() => done(false)}>{cur.opts.cancelLabel ?? 'Cancelar'}</Button>
    </div>
  </Sheet>
{/if}

<style>
  .msg { margin: 0; color: var(--text-muted); font-size: var(--fs-2); }
  .stack { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-1); }
</style>
