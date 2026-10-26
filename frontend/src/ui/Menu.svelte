<script>
  import { tick } from 'svelte';
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import { nextIndex, menuSide } from './logic.js';
  // Menu de ações secundárias (⋯). items: [{label, icon?, danger?, onselect}].
  // Teclado: Enter/Espaço/↓ abrem; ↑↓ Home End navegam; Escape fecha e devolve o foco ao gatilho; Tab fecha; clique fora fecha.
  let { label = 'Mais ações', items = [], icon = 'dots' } = $props();
  const id = $props.id();
  let open = $state(false);
  let up = $state(false);
  let root;
  const trigger = () => root.querySelector('button[aria-haspopup]');
  const entries = () => [...root.querySelectorAll('[role="menuitem"]')];

  async function show() {
    open = true;
    await tick();
    const list = root.querySelector('[role="menu"]');
    up = menuSide(trigger().getBoundingClientRect(), list.offsetHeight, innerHeight) === 'up';
    entries()[0]?.focus();
  }
  function close(refocus = true) { open = false; if (refocus) trigger()?.focus(); }
  function pick(it) { close(); it.onselect?.(); }
  function onTriggerKey(e) { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); show(); } }
  function onMenuKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return close(); }
    if (e.key === 'Tab') return close(false);
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const list = entries();
    e.preventDefault();
    list[nextIndex(list.indexOf(document.activeElement), e.key, list.length)]?.focus();
  }
</script>

<svelte:window onpointerdown={(e) => open && !root.contains(e.target) && close(false)} />

<div class="ui-menu" bind:this={root}>
  <IconButton {label} {icon} tone="muted" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-m` : undefined} onclick={() => (open ? close() : show())} onkeydown={onTriggerKey} />
  {#if open}
    <div class="pop" class:up id="{id}-m" role="menu" aria-label={label} tabindex="-1" onkeydown={onMenuKey}>
      {#each items as it (it.label)}
        <button type="button" role="menuitem" class:danger={it.danger} onclick={() => pick(it)}>{#if it.icon}<Icon name={it.icon} />{/if}{it.label}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .ui-menu { position: relative; }
  .pop { position: absolute; right: 0; top: 100%; z-index: var(--z-sticky); min-width: var(--menu-w); padding: var(--space-1); background: var(--surface-raised); border: var(--bw-1) solid var(--border-strong); border-radius: var(--radius-2); box-shadow: var(--shadow-lift); display: flex; flex-direction: column; }
  .pop.up { top: auto; bottom: 100%; }
  button { display: flex; align-items: center; gap: var(--space-3); min-height: var(--tap); padding: 0 var(--space-3); border: 0; background: transparent; color: var(--text-body); font: var(--fw-bold) var(--fs-2) var(--font-text); border-radius: var(--radius-1); text-align: left; width: 100%; }
  button:hover, button:focus-visible { background: var(--surface-sunken); }
  button:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: calc(var(--bw-2) * -1); }
  .danger { color: var(--color-expense); }
</style>
