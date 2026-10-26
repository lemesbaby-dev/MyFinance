<script>
  // tone: raised (padrão) | brand (destaque suave, ex.: total das contas). pad=false para listas coladas na borda.
  let { tone = 'raised', pad = true, children } = $props();
</script>

<div class="ui-card {tone}" class:pad>{@render children?.()}</div>

<style>
  .ui-card { background: var(--card-bg); border-radius: var(--card-radius); border: var(--bw-1) solid var(--border-subtle); min-width: 0; }
  .pad { padding: var(--card-pad); }
  .brand { background: var(--brand-soft); border-color: transparent; }
</style>
