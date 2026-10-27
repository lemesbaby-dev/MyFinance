<script>
  import { tick } from 'svelte';
  import Field from './Field.svelte';
  import Icon from './Icon.svelte';
  import { menuSide } from './logic.js';
  import { addDays, addMonths, isValidISO, monthGrid, monthOf, todayISO } from '../lib/finance.js';
  // Calendário próprio (o nativo não aceita estilo). value = "YYYY-MM-DD".
  // Teclado: ↓ abre; ←→ ±1 dia, ↑↓ ±1 semana, PageUp/PageDown ±1 mês; Enter escolhe; Escape fecha e devolve o foco; Tab fecha.
  let { label, help = '', error = '', value = $bindable(''), disabled } = $props();
  const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const KEYS = { ArrowLeft: (c) => addDays(c, -1), ArrowRight: (c) => addDays(c, 1), ArrowUp: (c) => addDays(c, -7), ArrowDown: (c) => addDays(c, 7), PageUp: (c) => addMonths(c, -1), PageDown: (c) => addMonths(c, 1) };
  const longDate = (d) => `${+d.slice(8)} de ${MONTHS[+d.slice(5, 7) - 1]} de ${d.slice(0, 4)}`;
  let open = $state(false);
  let up = $state(false);
  let cur = $state(''); // data com foco no grid
  let root;
  const today = $derived(todayISO());
  const month = $derived(monthOf(cur || today));
  const grid = $derived(monthGrid(month));
  const monthLabel = $derived(`${MONTHS[+month.slice(5, 7) - 1]} de ${month.slice(0, 4)}`);
  const shown = $derived(isValidISO(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : '');
  const trigger = () => root.querySelector('button[aria-haspopup]');
  async function focusCur() { await tick(); root.querySelector('[data-d][tabindex="0"]')?.focus(); }
  function move(fn) { try { cur = fn(cur); } catch { /* fora de 1900..2200: ignora */ } focusCur(); }

  async function show() {
    cur = isValidISO(value) ? value : today;
    open = true;
    await tick();
    up = menuSide(trigger().getBoundingClientRect(), root.querySelector('[role="dialog"]').offsetHeight, innerHeight) === 'up';
    focusCur();
  }
  function close(refocus = true) { open = false; if (refocus) trigger()?.focus(); }
  function pick(iso) { value = iso; close(); }
  $effect(() => {
    if (!open) return;
    const h = (e) => { if (!root.contains(e.target)) close(false); };
    addEventListener('pointerdown', h);
    return () => removeEventListener('pointerdown', h);
  });
  function onTriggerKey(e) { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); show(); } }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return close(); }
    if (e.key === 'Tab') return close(false);
    if (!e.target.dataset.d || !KEYS[e.key]) return; // setas só valem com o foco num dia; Enter ativa o botão
    e.preventDefault();
    move(KEYS[e.key]);
  }
</script>

<Field {label} {help} {error}>
  {#snippet children(a)}
    <div class="ui-date" bind:this={root}>
      <button type="button" class="trg" class:bad={!!error} id={a.id} aria-haspopup="dialog" aria-expanded={open} aria-describedby={a['aria-describedby']} {disabled} onclick={() => (open ? close() : show())} onkeydown={onTriggerKey}>
        <span>{shown || 'Escolha a data'}</span><Icon name="calendar" />
      </button>
      {#if open}
        <div class="pop" class:up role="dialog" tabindex="-1" aria-label="Escolher data" onkeydown={onKey}>
          <div class="head">
            <button type="button" class="nav" aria-label="Mês anterior" onclick={() => move((c) => addMonths(c, -1))}><Icon name="left" /></button>
            <span class="mlabel" aria-live="polite">{monthLabel}</span>
            <button type="button" class="nav" aria-label="Próximo mês" onclick={() => move((c) => addMonths(c, 1))}><Icon name="right" /></button>
          </div>
          <div class="grid">
            {#each WEEK as w, i (i)}<span class="wd" aria-hidden="true">{w}</span>{/each}
            {#each grid as d (d)}
              <button type="button" class="day" data-d={d} class:out={monthOf(d) !== month} class:sel={d === value} class:today={d === today} tabindex={d === cur ? 0 : -1} aria-pressed={d === value} aria-label={longDate(d)} onclick={() => pick(d)}>{+d.slice(8)}</button>
            {/each}
          </div>
          <div class="foot"><button type="button" class="link" onclick={() => pick(today)}>Hoje</button></div>
        </div>
      {/if}
    </div>
  {/snippet}
</Field>

<style>
  .ui-date { position: relative; }
  .trg { width: 100%; min-height: var(--field-h); display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); background: var(--field-bg); border: var(--bw-2) solid var(--border-subtle); border-radius: var(--field-radius); padding: 0 var(--space-3); font: var(--fw-bold) var(--fs-3) var(--font-text); color: var(--text-strong); text-align: left; cursor: pointer; }
  .trg :global(.ico) { color: var(--text-muted); }
  .trg.bad { border-color: var(--color-expense); background: var(--surface-raised); }
  .trg:disabled { opacity: 0.5; }
  .trg:focus-visible, .trg[aria-expanded='true'] { outline: var(--bw-2) solid var(--focus-ring); outline-offset: 0; border-color: var(--focus-ring); }
  .pop { position: absolute; left: 0; right: 0; top: 100%; margin-top: var(--space-1); z-index: var(--z-sticky); padding: var(--space-3); background: var(--surface-raised); border: var(--bw-1) solid var(--border-strong); border-radius: var(--radius-2); box-shadow: var(--shadow-lift); display: flex; flex-direction: column; gap: var(--space-2); }
  .pop.up { top: auto; bottom: 100%; margin: 0 0 var(--space-1); }
  .head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
  .mlabel { font: var(--fw-bold) var(--fs-3) var(--font-text); color: var(--text-strong); }
  .mlabel::first-letter { text-transform: uppercase; }
  .nav, .day, .link { border: 0; background: transparent; color: var(--text-body); font: var(--fw-bold) var(--fs-2) var(--font-text); cursor: pointer; }
  .nav { width: var(--tap); height: var(--tap); display: grid; place-items: center; border-radius: var(--radius-2); }
  .grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: var(--space-1); text-align: center; }
  .wd { font: var(--fw-bold) var(--fs-1) var(--font-text); color: var(--text-muted); padding: var(--space-1) 0; }
  .day { aspect-ratio: 1; min-height: 2.25rem; border-radius: var(--radius-2); font-variant-numeric: var(--num-features); }
  .day.out { color: var(--text-muted); opacity: 0.55; }
  .day.today { box-shadow: inset 0 0 0 var(--bw-2) var(--border-strong); }
  .nav:hover, .day:hover, .link:hover { background: var(--surface-sunken); }
  .day.sel, .day.sel:hover { background: var(--brand); color: var(--on-brand); opacity: 1; }
  .nav:focus-visible, .day:focus-visible, .link:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: 0; }
  .foot { display: flex; justify-content: flex-end; }
  .link { min-height: var(--tap); padding: 0 var(--space-3); border-radius: var(--radius-2); color: var(--brand-strong); }
</style>
