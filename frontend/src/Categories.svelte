<script>
  import { app, saveCategory, deleteCategory } from './lib/app.svelte.js';
  import { dialog } from './lib/a11y.js';

  const KINDS = [['expense', 'Despesas'], ['income', 'Receitas']];
  let form = $state(null); // { id?, name, kind, parent_id }
  let error = $state('');
  let busy = $state(false);

  const tops = (kind) => app.categories.filter((c) => c.kind === kind && !c.parent_id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const kids = (id) => app.categories.filter((c) => c.parent_id === id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  // 1 nível de subcategoria: só categorias principais do mesmo tipo (e nunca ela mesma) servem de mãe.
  const parents = $derived(form ? tops(form.kind).filter((c) => c.id !== form.id) : []);
  const hasKids = $derived(form?.id ? kids(form.id).length > 0 : false);

  const open = (c, kind = 'expense') => {
    error = '';
    form = c ? { id: c.id, name: c.name, kind: c.kind, parent_id: c.parent_id ?? '' } : { name: '', kind, parent_id: '' };
  };

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) { error = 'Informe o nome.'; return; }
    busy = true;
    try {
      await saveCategory(form.id ?? null, { name: form.name, kind: form.kind, parent_id: hasKids ? null : form.parent_id });
      form = null;
    } catch (err) { error = err.message; } finally { busy = false; }
  }

  async function remove() {
    if (!confirm(`Excluir "${form.name}"? Os lançamentos dela ficam sem categoria.`)) return;
    busy = true;
    try { await deleteCategory(form.id); form = null; } catch (err) { error = err.message; } finally { busy = false; }
  }
</script>

{#each KINDS as [kind, title]}
  <section class="pad">
    <h2>{title}</h2>
    <ul class="rows">
      {#each tops(kind) as c (c.id)}
        <li>
          <div class="grow"><strong>{c.name}</strong></div>
          <button class="btn small ghost" onclick={() => open(c)} aria-label="Editar {c.name}">✎</button>
        </li>
        {#each kids(c.id) as k (k.id)}
          <li class="sub">
            <div class="grow"><span>↳ {k.name}</span></div>
            <button class="btn small ghost" onclick={() => open(k)} aria-label="Editar {k.name}">✎</button>
          </li>
        {/each}
      {:else}
        <li><span class="muted">Nenhuma categoria.</span></li>
      {/each}
    </ul>
    <p><button class="btn small ghost" onclick={() => open(null, kind)}>Nova categoria</button></p>
  </section>
{/each}

{#if form}
  <div class="scrim" role="presentation" onclick={() => (form = null)}></div>
  <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
  <form class="sheet" role="dialog" aria-modal="true" use:dialog={() => (form = null)} onsubmit={submit} aria-label="Categoria">
    <h3>{form.id ? 'Editar categoria' : 'Nova categoria'}</h3>
    <div class="seg" role="group" aria-label="Tipo">
      {#each KINDS as [k, text]}
        <button type="button" class:on={form.kind === k} disabled={!!form.id} onclick={() => { form.kind = k; form.parent_id = ''; }}>{text}</button>
      {/each}
    </div>
    <label class="field"><span>Nome</span><input bind:value={form.name} maxlength="200" required /></label>
    {#if !hasKids}
      <label class="field"><span>Dentro de</span>
        <select bind:value={form.parent_id}><option value="">(categoria principal)</option>{#each parents as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></label>
    {/if}
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <div class="actions">
      <button type="button" class="btn ghost" onclick={() => (form = null)}>Cancelar</button>
      <button class="btn" disabled={busy}>Salvar</button>
    </div>
    {#if form.id}<p><button type="button" class="btn small ghost" onclick={remove} disabled={busy}>Excluir categoria</button></p>{/if}
  </form>
{/if}

<style>
  .sub { padding-left: 1rem; }
</style>
