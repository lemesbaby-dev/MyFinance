<script>
  import Icon from './Icon.svelte';
  // tabs: [[id, rótulo, ícone, avisoOpcional]]. Aviso (texto) = bolinha sobre o ícone, com rótulo acessível. Ícone + rótulo, aba ativa com pílula e aria-current. onselect(id).
  let { tabs = [], value, onselect, label = 'Navegação principal' } = $props();
</script>

<nav class="ui-tabs" aria-label={label}>
  {#each tabs as [id, text, icon, note] (id)}
    <button type="button" class:on={id === value} aria-current={id === value ? 'page' : undefined} onclick={() => onselect?.(id)}>
      <span class="pill"><Icon name={icon} />{#if note}<i class="dot" role="img" aria-label={note}></i>{/if}</span>{text}
    </button>
  {/each}
</nav>

<style>
  .ui-tabs { display: flex; background: var(--tabbar-bg); border-top: var(--bw-1) solid var(--border-subtle); padding: var(--space-1) var(--space-2) calc(var(--space-1) + env(safe-area-inset-bottom)); min-height: var(--tabbar-h); }
  button { flex: 1; min-height: var(--tap); border: 0; background: transparent; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-1); font: var(--fw-bold) var(--fs-1)/var(--lh-tight) var(--font-text); color: var(--text-muted); }
  .pill { position: relative; display: grid; place-items: center; width: var(--space-12); height: var(--space-8); border-radius: var(--radius-2); }
  .dot { position: absolute; top: var(--space-1); right: var(--space-2); width: var(--space-2); height: var(--space-2); border-radius: var(--radius-pill); background: var(--color-expense); }
  .on { color: var(--tabbar-active-fg); }
  .on .pill { background: var(--tabbar-active-bg); }
  button:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: calc(var(--bw-2) * -1); border-radius: var(--radius-2); }
</style>
