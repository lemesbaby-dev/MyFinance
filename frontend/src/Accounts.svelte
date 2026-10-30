<script>
  import { app, saveAccount, deleteAccount } from './lib/app.svelte.js';
  import { balances, monthEnd, monthOf, todayISO } from './lib/finance.js';
  import AdjustSheet from './AdjustSheet.svelte';
  import MoneyInput from './ui/MoneyInput.svelte';
  import FormSheet from './ui/FormSheet.svelte';
  import Card from './ui/Card.svelte';
  import Money from './ui/Money.svelte';
  import Badge from './ui/Badge.svelte';
  import Button from './ui/Button.svelte';
  import IconButton from './ui/IconButton.svelte';
  import CategoryDot from './ui/CategoryDot.svelte';
  import EmptyState from './ui/EmptyState.svelte';
  import TextInput from './ui/TextInput.svelte';
  import Select from './ui/Select.svelte';
  import Switch from './ui/Switch.svelte';
  import Icon from './ui/Icon.svelte';
  import { confirmDialog } from './ui/confirm.js';

  const TYPES = { checking: 'Conta corrente', cash: 'Dinheiro', savings: 'Poupança', investment: 'Investimento' };

  let today = $state(todayISO()); // renova ao voltar para o app (virou o dia)
  let busy = $state(false);
  let form = $state(null); // { id?, name, type, balance, archived }
  let error = $state('');
  let errField = $state('');
  const uid = $props.id();
  let showArchived = $state(false);
  let adjusting = $state(null); // conta sendo ajustada

  const bal = $derived(balances(app.accounts, app.transactions, monthEnd(monthOf(today)), app.rejectedIds));
  const by = $derived(Object.fromEntries(bal.all.map((a) => [a.id, a])));
  const list = $derived(app.accounts.filter((a) => showArchived || !a.archived).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
  const archivedCount = $derived(app.accounts.filter((a) => a.archived).length);

  const TYPE_OPTS = Object.entries(TYPES);
  const open = (a) => {
    error = ''; errField = '';
    form = a
      ? { id: a.id, name: a.name, type: a.type, balance: a.initial_balance_cents, archived: a.archived }
      : { name: '', type: 'checking', balance: 0, archived: false };
  };

  async function submit(e) {
    e.preventDefault();
    error = ''; errField = '';
    if (!form.name.trim()) { error = 'Informe o nome da conta.'; errField = 'name'; return; }
    busy = true;
    try {
      await saveAccount(form.id ?? null, { name: form.name, type: form.type, initial_balance_cents: form.balance, archived: form.archived });
      form = null;
    } catch (err) { error = err.message; } finally { busy = false; }
  }

  async function remove() {
    if (!(await confirmDialog({ title: `Excluir a conta "${form.name}"?`, danger: true, confirmLabel: 'Excluir' }))) return;
    busy = true;
    try { await deleteAccount(form.id); form = null; } catch (err) { error = err.message; } finally { busy = false; }
  }

  const a0 = (id) => app.accounts.find((a) => a.id === id);
  const refreshToday = () => (today = todayISO());
</script>

<svelte:window onfocus={refreshToday} />
<svelte:document onvisibilitychange={refreshToday} />

<section class="sec">
  <h2>Contas</h2>
  {#if list.length}
    <Card pad={false}>
      <ul>
        {#each list as a (a.id)}
          <li class:arch={a.archived}>
            <CategoryDot glyph="bank" />
            <div class="main">
              <div class="t">{a.name}{#if a.archived} <Badge>arquivada</Badge>{/if}{#if app.rejectedIds.has(a.id)} <Badge tone="overdue" icon="alert">não enviada</Badge>{/if}</div>
              <div class="m">{TYPES[a.type]}</div>
              {#if by[a.id]}<div class="m">Previsto no mês: <Money cents={by[a.id].projected_cents} /></div>{/if}
            </div>
            {#if a.archived}
              <Money cents={by[a.id]?.current_cents ?? 0} size="md" />
            {:else}
              <button type="button" class="bal" aria-label="Ajustar saldo de {a.name}" onclick={() => (adjusting = a)}>
                <Money cents={by[a.id]?.current_cents ?? 0} size="md" /><Icon name="sliders" size="sm" />
              </button>
            {/if}
            <IconButton icon="edit" label="Editar {a.name}" tone="muted" onclick={() => open(a)} />
          </li>
        {/each}
      </ul>
    </Card>
  {:else}
    <EmptyState icon="bank" title="Nenhuma conta ainda" text="Crie a conta onde seu dinheiro está." />
  {/if}
  <div class="acts">
    {#if archivedCount}<Button variant="ghost" size="sm" onclick={() => (showArchived = !showArchived)}>{showArchived ? 'Ocultar' : 'Mostrar'} arquivadas ({archivedCount})</Button>{/if}
    <Button onclick={() => open(null)}><Icon name="plus" />Nova conta</Button>
  </div>
</section>

{#if adjusting}<AdjustSheet account={adjusting} onclose={() => (adjusting = null)} />{/if}

{#if form}
  <FormSheet title={form.id ? 'Editar conta' : 'Nova conta'} onclose={() => (form = null)} onsubmit={submit} {busy} error={errField ? '' : error} onremove={form.id ? remove : undefined} removeLabel="Excluir conta">
    <TextInput label="Nome" bind:value={form.name} maxlength="200" error={errField === 'name' ? error : ''} />
    <Select label="Tipo" bind:value={form.type} options={TYPE_OPTS} />
    <MoneyInput label="Saldo inicial (R$)" bind:value={form.balance} signed help="Digite só os números; “-” alterna negativo" />
    {#if form.id && !form.archived && !a0(form.id)?.archived}
      <Button variant="secondary" block onclick={() => { adjusting = a0(form.id); form = null; }}>Ajustar saldo atual</Button>
      <p class="help">Para corrigir o saldo de hoje sem alterar o histórico, use Ajustar saldo.</p>
    {/if}
    {#if form.id}
      <div class="opt"><span id="{uid}-arq">Arquivada (some das listas e dos saldos)</span><Switch bind:checked={form.archived} labelledby="{uid}-arq" /></div>
    {/if}
  </FormSheet>
{/if}

<style>
  .sec { display: flex; flex-direction: column; gap: var(--space-3); }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; align-items: center; gap: var(--space-3); padding: var(--row-pad); }
  li + li { border-top: var(--bw-1) solid var(--border-subtle); }
  .arch .t { color: var(--text-muted); }
  .main { flex: 1; min-width: 0; }
  .t { font-weight: var(--fw-bold); color: var(--text-strong); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); }
  .m { margin-top: var(--space-1); font-size: var(--fs-1); font-weight: var(--fw-bold); color: var(--text-muted); }
  .bal { display: inline-flex; align-items: center; gap: var(--space-1); min-height: var(--tap); padding: 0 var(--space-1); background: none; border: 0; border-radius: var(--radius-2); color: var(--text-muted); cursor: pointer; }
  .bal:focus-visible { outline: var(--bw-2) solid var(--focus-ring); outline-offset: var(--bw-2); }
  .help { margin: calc(-1 * var(--space-2)) 0 0; font-size: var(--fs-1); color: var(--text-muted); }
  .acts { display: flex; flex-wrap: wrap; gap: var(--space-2); justify-content: space-between; }
  .opt { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); font: var(--fw-bold) var(--fs-2) var(--font-text); color: var(--text-strong); }
</style>
