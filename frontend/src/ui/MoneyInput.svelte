<script>
  import Field from './Field.svelte';
  import { money } from '../lib/format.js';
  import { centsFromInput } from './money.js';
  // value = centavos (inteiro). Digitação "pela direita": 1 → 0,01; 12 → 0,12; 123 → 1,23.
  let { label, help = '', error = '', value = $bindable(0) } = $props();
  // O valor entra pela direita: o cursor fica sempre no fim (um toque no meio do texto não pode embaralhar os dígitos).
  const toEnd = (e) => { const el = e.currentTarget, n = el.value.length; requestAnimationFrame(() => el.setSelectionRange(n, n)); };
  function oninput(e) {
    value = centsFromInput(e.currentTarget.value);
    e.currentTarget.value = money(value);
  }
</script>

<Field {label} {help} {error}>
  {#snippet children(a)}<input class="ui-money" inputmode="numeric" autocomplete="off" value={money(value)} {oninput} onfocus={toEnd} onclick={toEnd} id={a.id} aria-invalid={a['aria-invalid']} aria-describedby={a['aria-describedby']} />{/snippet}
</Field>

<style>
  .ui-money { width: 100%; min-height: var(--field-h); background: var(--field-bg); border: var(--bw-2) solid var(--border-subtle); border-radius: var(--field-radius); padding: var(--space-2) var(--space-4); text-align: center; font: var(--money-lg-weight) var(--money-lg-size)/var(--money-lg-lh) var(--money-lg-font); font-variant-numeric: var(--num-features); color: var(--text-strong); }
  .ui-money[aria-invalid='true'] { border-color: var(--color-expense); background: var(--surface-raised); }
  .ui-money:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: 0; border-color: var(--focus-ring); }
</style>
