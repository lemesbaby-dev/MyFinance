<script>
  // Grupo de linhas sob um cabeçalho (ex.: dia). title="Hoje" + today destaca; note = total/resumo curto à direita.
  let { title, note = '', today = false, children } = $props();
  const id = $props.id();
</script>

<section class="ui-group" aria-labelledby="{id}-h">
  <div class="day" class:today><b id="{id}-h">{title}</b>{#if note}<span>{note}</span>{/if}</div>
  <div class="list" role="list">{@render children?.()}</div>
</section>

<style>
  .day { display: flex; justify-content: space-between; align-items: baseline; padding: var(--space-1); }
  b { font: var(--fw-bold) var(--fs-2) var(--font-text); color: var(--text-strong); }
  .today b { color: var(--brand-strong); }
  span { font-size: var(--fs-1); font-weight: var(--fw-bold); color: var(--text-muted); }
  .list { background: var(--surface-raised); border-radius: var(--card-radius); border: var(--bw-1) solid var(--border-subtle); }
  .list > :global(*:first-child) { border-radius: var(--card-radius) var(--card-radius) 0 0; }
  .list > :global(*:last-child) { border-radius: 0 0 var(--card-radius) var(--card-radius); }
  .list > :global(*:only-child) { border-radius: var(--card-radius); }
  .list > :global(* + *) { border-top: var(--bw-1) solid var(--border-subtle); }
</style>
