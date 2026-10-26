<script>
  import { app, saveCategory, deleteCategory } from './lib/app.svelte.js';
  import Sheet from './ui/Sheet.svelte';
  import Card from './ui/Card.svelte';
  import Badge from './ui/Badge.svelte';
  import Button from './ui/Button.svelte';
  import IconButton from './ui/IconButton.svelte';
  import CategoryDot from './ui/CategoryDot.svelte';
  import EmptyState from './ui/EmptyState.svelte';
  import Banner from './ui/Banner.svelte';
  import Icon from './ui/Icon.svelte';
  import Segmented from './ui/Segmented.svelte';
  import TextInput from './ui/TextInput.svelte';
  import Select from './ui/Select.svelte';
  import { confirmDialog } from './ui/confirm.js';
  import { catOf } from './ui/logic.js';

  const KINDS = [['expense', 'Despesas'], ['income', 'Receitas']];
  let form = $state(null); // { id?, name, kind, parent_id }
  let error = $state('');
  let errField = $state('');
  let busy = $state(false);

  const tops = (kind) => app.categories.filter((c) => c.kind === kind && !c.parent_id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const kids = (id) => app.categories.filter((c) => c.parent_id === id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  // 1 nível de subcategoria: só categorias principais do mesmo tipo (e nunca ela mesma) servem de mãe.
  const parents = $derived(form ? tops(form.kind).filter((c) => c.id !== form.id) : []);
  const hasKids = $derived(form?.id ? kids(form.id).length > 0 : false);

  const parentOpts = $derived([['', '(categoria principal)'], ...parents.map((p) => [p.id, p.name])]);
  const open = (c, kind = 'expense') => {
    error = ''; errField = '';
    form = c ? { id: c.id, name: c.name, kind: c.kind, parent_id: c.parent_id ?? '' } : { name: '', kind, parent_id: '' };
  };

  async function submit(e) {
    e.preventDefault();
    error = ''; errField = '';
    if (!form.name.trim()) { error = 'Informe o nome.'; errField = 'name'; return; }
    busy = true;
    try {
      await saveCategory(form.id ?? null, { name: form.name, kind: form.kind, parent_id: hasKids ? null : form.parent_id });
      form = null;
    } catch (err) { error = err.message; } finally { busy = false; }
  }

  async function remove() {
    if (!(await confirmDialog({ title: `Excluir "${form.name}"?`, message: 'Os lançamentos dela ficam sem categoria.', danger: true, confirmLabel: 'Excluir' }))) return;
    busy = true;
    try { await deleteCategory(form.id); form = null; } catch (err) { error = err.message; } finally { busy = false; }
  }
</script>

{#each KINDS as [kind, title]}
  <section class="sec">
    <h2>{title}</h2>
    {#if tops(kind).length}
      <Card pad={false}>
        <ul>
          {#each tops(kind) as c (c.id)}
            <li>
              <CategoryDot n={catOf(c.id)} />
              <span class="t">{c.name}</span>
              <IconButton icon="edit" label="Editar {c.name}" tone="muted" onclick={() => open(c)} />
            </li>
            {#each kids(c.id) as k (k.id)}
              <li class="sub">
                <CategoryDot n={catOf(k.id)} size="sm" />
                <span class="t">{k.name}</span>
                <IconButton icon="edit" label="Editar {k.name}" tone="muted" onclick={() => open(k)} />
              </li>
            {/each}
          {/each}
        </ul>
      </Card>
    {:else}
      <EmptyState icon="tag" title="Nenhuma categoria" />
    {/if}
    <div><Button variant="secondary" size="sm" onclick={() => open(null, kind)}><Icon name="plus" />Nova categoria</Button></div>
  </section>
{/each}

{#if form}
  <Sheet title={form.id ? 'Editar categoria' : 'Nova categoria'} onclose={() => (form = null)}>
    <form novalidate onsubmit={submit}>
      {#if form.id}
        <div><Badge tone="brand">{KINDS.find(([k]) => k === form.kind)?.[1]}</Badge></div>
      {:else}
        <Segmented label="Tipo" options={KINDS} bind:value={form.kind} onchange={() => (form.parent_id = '')} />
      {/if}
      <TextInput label="Nome" bind:value={form.name} maxlength="200" error={errField === 'name' ? error : ''} />
      {#if !hasKids}<Select label="Dentro de" bind:value={form.parent_id} options={parentOpts} />{/if}
      {#if error && !errField}<Banner tone="danger" icon="alert">{error}</Banner>{/if}
      <div class="actions">
        <Button variant="secondary" onclick={() => (form = null)}>Cancelar</Button>
        <Button type="submit" loading={busy}>Salvar</Button>
      </div>
      {#if form.id}<Button variant="danger" block onclick={remove} disabled={busy}>Excluir categoria</Button>{/if}
    </form>
  </Sheet>
{/if}

<style>
  .sec { display: flex; flex-direction: column; gap: var(--space-3); }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; align-items: center; gap: var(--space-3); padding: var(--row-pad); }
  li + li { border-top: var(--bw-1) solid var(--border-subtle); }
  .sub { padding-left: var(--space-8); }
  .t { flex: 1; min-width: 0; font-weight: var(--fw-bold); color: var(--text-strong); }
  .sub .t { font-weight: var(--fw-medium); }
  form { display: flex; flex-direction: column; gap: var(--space-3); }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
</style>
