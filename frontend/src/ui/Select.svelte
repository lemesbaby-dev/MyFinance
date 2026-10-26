<script>
  import Field from './Field.svelte';
  // options: [[valor, rótulo], ...]
  let { label, help = '', error = '', value = $bindable(''), options = [], ...rest } = $props();
</script>

<Field {label} {help} {error}>
  {#snippet children(a)}
    <select class="ui-input" bind:value {...a} {...rest}>
      {#each options as [v, text] (v)}<option value={v}>{text}</option>{/each}
    </select>
  {/snippet}
</Field>

<style>
  .ui-input { width: 100%; min-height: var(--field-h); background: var(--field-bg); border: var(--bw-2) solid var(--border-subtle); border-radius: var(--field-radius); padding: 0 var(--space-3); font-weight: var(--fw-bold); color: var(--text-strong); }
  .ui-input[aria-invalid='true'] { border-color: var(--color-expense); background: var(--surface-raised); }
  .ui-input:disabled { opacity: 0.5; }
  .ui-input:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: 0; border-color: var(--focus-ring); }
</style>
