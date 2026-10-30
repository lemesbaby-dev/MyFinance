<script>
  import CategoryDot from './CategoryDot.svelte';
  import Money from './Money.svelte';
  import Badge from './Badge.svelte';
  import Button from './Button.svelte';
  import Menu from './Menu.svelte';
  import { STATE_META } from './logic.js';
  // Linha de lançamento: UMA ação principal (actionLabel: "Efetivar"/"Recebi", só se não efetivado) + menu secundário ⋯.
  // state: pending | overdue | paid (ver rowState em logic.js) — sempre ícone + rótulo, nunca só cor.
  // cat: 1..10 (cor + glifo); sem cat = tile neutro. meta: texto curto (conta, recorrência...).
  let { title, meta = '', cents, kind = 'expense', state = 'pending', cat = 0, glyph = 'tag', actionLabel = '', tag = '', onaction, menu = [], menuLabel = '' } = $props();
  const s = $derived(STATE_META[state] ?? STATE_META.pending);
</script>

<div class="ui-row {state}" role="listitem">
  <CategoryDot n={cat} {glyph} />
  <div class="main">
    <div class="t">{title}</div>
    {#if meta}<div class="m">{meta}</div>{/if}
  </div>
  <Money {cents} {kind} />
  <div class="act">
    <span class="tags"><Badge tone={s.tone} icon={s.icon}>{s.label}</Badge>{#if tag}<Badge tone="brand">{tag}</Badge>{/if}</span>
    <div class="grp">
      {#if actionLabel && state !== 'paid'}<Button size="sm" onclick={onaction} aria-label="{actionLabel}: {title}">{actionLabel}</Button>{/if}
      {#if menu.length}<Menu label={menuLabel || `Mais ações: ${title}`} items={menu} />{/if}
    </div>
  </div>
</div>

<style>
  .ui-row { display: grid; grid-template-columns: var(--row-icon) 1fr auto; gap: 0 var(--row-gap); align-items: center; padding: var(--row-pad); min-height: calc(var(--tap) + var(--space-3)); }
  .act { grid-column: 1 / 4; display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-width: 0; }
  .tags { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); }
  .grp { display: flex; align-items: center; gap: var(--space-1); }
  .main { min-width: 0; }
  .t { font-weight: var(--fw-bold); color: var(--text-strong); line-height: var(--lh-tight); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .m { margin-top: var(--space-1); font-size: var(--fs-1); font-weight: var(--fw-bold); color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .overdue { background: var(--color-overdue-soft); }
  .paid .t { color: var(--text-muted); }
  .paid :global(.ui-dot) { opacity: 0.62; }
</style>
