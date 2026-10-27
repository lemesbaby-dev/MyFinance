<script>
  import { onMount } from 'svelte';
  import Toast from './Toast.svelte';
  import { subscribeToast, dismissToast } from './toast.js';
  // Host único (montado no App): mostra o primeiro da fila; some sozinho após t.ms (0 = só ao dispensar).
  let cur = $state(null);
  onMount(() => subscribeToast((t) => (cur = t)));
  $effect(() => {
    const t = cur;
    if (!t?.ms) return;
    const h = setTimeout(() => dismissToast(t.id), t.ms);
    return () => clearTimeout(h);
  });
  const act = (t) => { t.onaction?.(); dismissToast(t.id); };
</script>

{#if cur}
    <div class="host"><Toast msg={cur.msg} tone={cur.tone} actionLabel={cur.actionLabel} onaction={() => act(cur)} ondismiss={() => dismissToast(cur.id)} /></div>
{/if}

<style>
  .host { position: fixed; left: var(--space-4); right: var(--space-4); bottom: calc(var(--tabbar-h) + var(--space-3) + env(safe-area-inset-bottom)); max-width: 28rem; margin: 0 auto; z-index: var(--z-toast); }
</style>
