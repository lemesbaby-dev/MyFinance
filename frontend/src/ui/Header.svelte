<script>
  // Cabeçalho de tela: h1 + linha de apoio opcional (ex.: "Oi, Josias") + ações à direita (snippet).
  let { title, hello = '', children } = $props();
</script>

<header class="ui-header">
  <div>{#if hello}<div class="hello">{hello}</div>{/if}<h1>{title}</h1></div>
  {#if children}<div class="acts">{@render children()}</div>{/if}
</header>

<style>
  .ui-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-height: var(--tap); }
  h1 { margin: 0; font: var(--fw-display) var(--fs-5)/var(--lh-tight) var(--font-display); color: var(--text-strong); }
  .hello { font: var(--fw-bold) var(--fs-2)/var(--lh-tight) var(--font-text); color: var(--text-muted); }
  .acts { display: flex; align-items: center; gap: var(--space-1); }
</style>
