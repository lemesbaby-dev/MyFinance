<script>
  import Field from './Field.svelte';
  // Atributos explícitos (sem spread): o spread puxa set_attributes do Svelte para o bundle.
  let { label, help = '', error = '', value = $bindable(''), type = 'text', placeholder, maxlength, min, max, inputmode, autocomplete, required, disabled } = $props();
</script>

<Field {label} {help} {error}>
  {#snippet children(a)}<input class="ui-input" {type} {value} oninput={(e) => (value = e.currentTarget.value)} id={a.id} aria-invalid={a['aria-invalid']} aria-describedby={a['aria-describedby']} {placeholder} {maxlength} {min} {max} {inputmode} {autocomplete} {required} {disabled} />{/snippet}
</Field>

<style>
  .ui-input { width: 100%; min-height: var(--field-h); background: var(--field-bg); border: var(--bw-2) solid var(--border-subtle); border-radius: var(--field-radius); padding: 0 var(--space-3); font-weight: var(--fw-bold); color: var(--text-strong); accent-color: var(--focus-ring); }
  .ui-input[aria-invalid='true'] { border-color: var(--color-expense); background: var(--surface-raised); }
  .ui-input:disabled { opacity: 0.5; }
  .ui-input:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: 0; border-color: var(--focus-ring); }
</style>
