<script>
  import Icon from './Icon.svelte';
  // `label` é obrigatório: vira aria-label (e title). Sem ele o botão fica mudo para leitor de tela.
  let { label, icon, tone = 'plain', disabled = false, type = 'button', onclick, ...rest } = $props();
  $effect(() => { if (import.meta.env.DEV && !label) console.error('IconButton: "label" (aria-label) é obrigatório'); });
</script>

<button class="ui-iconbtn {tone}" {type} {disabled} aria-label={label} title={label} {onclick} {...rest}><Icon name={icon} /></button>

<style>
  .ui-iconbtn { width: var(--tap); height: var(--tap); border-radius: var(--radius-2); border: 0; background: transparent; color: var(--text-strong); display: grid; place-items: center; flex: none; }
  .soft { background: var(--surface-sunken); }
  .brand { background: var(--btn-primary-bg); color: var(--btn-primary-fg); }
  .muted { color: var(--text-muted); }
  .ui-iconbtn:disabled { opacity: 0.5; cursor: default; }
  .ui-iconbtn:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: var(--bw-2); }
</style>
