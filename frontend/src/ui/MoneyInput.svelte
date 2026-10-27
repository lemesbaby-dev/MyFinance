<script>
  import Field from './Field.svelte';
  import { money } from '../lib/format.js';
  import { centsFromInput, signCents } from './money.js';
  // value = centavos (inteiro). Digitação "pela direita": 1 → 0,01; 12 → 0,12; 123 → 1,23.
  // signed: aceita negativo (botão "Negativo" ou tecla "-"), p.ex. saldo inicial no cheque especial.
  let { label, help = '', error = '', value = $bindable(0), signed = false } = $props();
  let neg = $state(value < 0);
  // Valor vindo de fora manda no sinal; com 0 vale a escolha do usuário.
  $effect.pre(() => { if (value < 0) neg = true; else if (value > 0) neg = false; });
  // O valor entra pela direita: o cursor fica sempre no fim (um toque no meio do texto não pode embaralhar os dígitos).
  const toEnd = (e) => { const el = e.currentTarget, n = el.value.length; requestAnimationFrame(() => el.setSelectionRange(n, n)); };
  function oninput(e) {
    const text = e.currentTarget.value;
    if (signed && /[-−]/.test(text) && !text.startsWith('-')) neg = !neg; // '-' digitado pelo teclado (inclui virtual)
    value = signCents(centsFromInput(text), neg);
    e.currentTarget.value = money(value);
  }
  function flip(el) { neg = !neg; value = signCents(Math.abs(value), neg); if (el) el.value = money(value); }
  function onkeydown(e) {
    if (!signed || (e.key !== '-' && e.key !== '−')) return;
    e.preventDefault();
    flip(e.currentTarget);
  }
</script>

<Field {label} {help} {error}>
  {#snippet children(a)}
    <input class="ui-money" inputmode="numeric" autocomplete="off" value={money(value)} {oninput} {onkeydown} onfocus={toEnd} onclick={toEnd} id={a.id} aria-invalid={a['aria-invalid']} aria-describedby={a['aria-describedby']} />
    {#if signed}<button type="button" class="neg" aria-pressed={neg} onclick={(e) => flip(e.currentTarget.previousElementSibling)}>{neg ? 'Negativo' : 'Tornar negativo'}</button>{/if}
  {/snippet}
</Field>

<style>
  .ui-money { width: 100%; min-height: var(--field-h); background: var(--field-bg); border: var(--bw-2) solid var(--border-subtle); border-radius: var(--field-radius); padding: var(--space-2) var(--space-4); text-align: center; font: var(--money-lg-weight) var(--money-lg-size)/var(--money-lg-lh) var(--money-lg-font); font-variant-numeric: var(--num-features); color: var(--text-strong); }
  .ui-money[aria-invalid='true'] { border-color: var(--color-expense); background: var(--surface-raised); }
  .ui-money:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: 0; border-color: var(--focus-ring); }
  .neg { align-self: flex-start; min-height: var(--tap); padding: 0 var(--space-3); background: none; border: 0; font: var(--fw-bold) var(--fs-2)/var(--lh-tight) var(--font-text); color: var(--text-muted); cursor: pointer; }
  .neg[aria-pressed='true'] { color: var(--color-expense); }
</style>
