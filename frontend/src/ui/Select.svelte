<script>
  import Field from './Field.svelte';
  // options: [[valor, rótulo], ...]
  let { label, help = '', error = '', value = $bindable(''), options = [], disabled } = $props();
</script>

<Field {label} {help} {error}>
  {#snippet children(a)}
    <select class="ui-input" onchange={(e) => (value = e.currentTarget.value)} id={a.id} aria-invalid={a['aria-invalid']} aria-describedby={a['aria-describedby']} {disabled}>
      {#each options as [v, text] (v)}<option value={v} selected={v === value}>{text}</option>{/each}
    </select>
  {/snippet}
</Field>

<style>
  .ui-input { width: 100%; min-height: var(--field-h); background: var(--field-bg) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' fill='none' stroke='%23999' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M1 1.5l5 5 5-5'/%3E%3C/svg%3E") no-repeat right var(--space-4) center; appearance: none; border: var(--bw-2) solid var(--border-subtle); border-radius: var(--field-radius); padding: 0 var(--space-10) 0 var(--space-4); font: var(--fw-bold) var(--fs-3, 1rem)/1.2 var(--font-text); color: var(--text-strong); text-overflow: ellipsis; }
  option { background: var(--surface-raised); color: var(--text-strong); padding: var(--space-2) var(--space-3); font-weight: var(--fw-bold); }
  .ui-input[aria-invalid='true'] { border-color: var(--color-expense); background-color: var(--surface-raised); }
  .ui-input:disabled { opacity: 0.5; }
  .ui-input:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: 0; border-color: var(--focus-ring); }
</style>
