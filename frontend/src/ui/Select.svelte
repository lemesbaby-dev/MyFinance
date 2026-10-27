<script>
  import { tick } from 'svelte';
  import Field from './Field.svelte';
  import Icon from './Icon.svelte';
  import { nextIndex, menuSide } from './logic.js';
  // Lista própria (o <select> nativo não aceita estilo). options: [[valor, rótulo], ...]
  // Teclado: Enter/Espaço/↓ abrem; ↑↓ Home End navegam; Enter/Espaço escolhe; Escape fecha e devolve o foco; Tab fecha.
  let { label, help = '', error = '', value = $bindable(''), options = [], disabled } = $props();
  let open = $state(false);
  let up = $state(false);
  let root;
  const current = $derived(options.find(([v]) => v === value));
  const trigger = () => root.querySelector('button[aria-haspopup]');
  const entries = () => [...root.querySelectorAll('[role="option"]')];

  async function show() {
    open = true;
    await tick();
    const list = root.querySelector('[role="listbox"]');
    up = menuSide(trigger().getBoundingClientRect(), list.offsetHeight, innerHeight) === 'up';
    (root.querySelector('[aria-selected="true"]') ?? entries()[0])?.focus();
  }
  function close(refocus = true) { open = false; if (refocus) trigger()?.focus(); }
  function pick(v) { value = v; close(); }
  $effect(() => {
    if (!open) return;
    const h = (e) => { if (!root.contains(e.target)) close(false); };
    addEventListener('pointerdown', h);
    return () => removeEventListener('pointerdown', h);
  });
  function onTriggerKey(e) { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); show(); } }
  function onListKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return close(); }
    if (e.key === 'Tab') return close(false);
    const list = entries();
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); return pick(options[list.indexOf(document.activeElement)]?.[0] ?? value); }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    list[nextIndex(list.indexOf(document.activeElement), e.key, list.length)]?.focus();
  }
</script>

<Field {label} {help} {error}>
  {#snippet children(a)}
    <div class="ui-select" bind:this={root}>
      <button type="button" class="trg" class:bad={!!error} id={a.id} aria-haspopup="listbox" aria-expanded={open} aria-describedby={a['aria-describedby']} {disabled} onclick={() => (open ? close() : show())} onkeydown={onTriggerKey}>
        <span class="txt">{current?.[1] ?? ''}</span><Icon name="down" />
      </button>
      {#if open}
        <div class="pop" class:up role="listbox" aria-labelledby={a.id} tabindex="-1" onkeydown={onListKey}>
          {#each options as [v, text] (v)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div role="option" tabindex="-1" aria-selected={v === value} onclick={() => pick(v)}>{text}{#if v === value}<Icon name="check" />{/if}</div>
          {/each}
        </div>
      {/if}
    </div>
  {/snippet}
</Field>

<style>
  .ui-select { position: relative; }
  .trg { width: 100%; min-height: var(--field-h); display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); background: var(--field-bg); border: var(--bw-2) solid var(--border-subtle); border-radius: var(--field-radius); padding: 0 var(--space-3); font: var(--fw-bold) var(--fs-3) var(--font-text); color: var(--text-strong); text-align: left; cursor: pointer; }
  .txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .trg :global(.ico) { color: var(--text-muted); }
  .trg.bad { border-color: var(--color-expense); background: var(--surface-raised); }
  .trg:disabled { opacity: 0.5; }
  .trg:focus-visible, .trg[aria-expanded='true'] { outline: var(--bw-2) solid var(--focus-ring); outline-offset: 0; border-color: var(--focus-ring); }
  .pop { position: absolute; left: 0; right: 0; top: 100%; margin-top: var(--space-1); z-index: var(--z-sticky); max-height: 16rem; overflow-y: auto; padding: var(--space-1); background: var(--surface-raised); border: var(--bw-1) solid var(--border-strong); border-radius: var(--radius-2); box-shadow: var(--shadow-lift); }
  .pop.up { top: auto; bottom: 100%; margin: 0 0 var(--space-1); }
  [role='option'] { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); min-height: var(--tap); padding: 0 var(--space-3); border-radius: var(--radius-1); color: var(--text-body); font: var(--fw-bold) var(--fs-2) var(--font-text); cursor: pointer; }
  [role='option']:hover, [role='option']:focus-visible { background: var(--surface-sunken); }
  [role='option']:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: calc(var(--bw-2) * -1); }
  [role='option'][aria-selected='true'] { background: var(--brand-soft); color: var(--brand-strong); }
</style>
