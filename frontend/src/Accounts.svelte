<script>
  import { app, saveAccount, deleteAccount } from './lib/app.svelte.js';
  import { balances, monthEnd, monthOf, todayISO } from './lib/finance.js';
  import { parseMoney } from './lib/format.js';
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

  const bal = $derived(balances(app.accounts, app.transactions, monthEnd(monthOf(today)), app.rejectedIds));
  const by = $derived(Object.fromEntries(bal.all.map((a) => [a.id, a])));
  const list = $derived(app.accounts.filter((a) => showArchived || !a.archived).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
  const archivedCount = $derived(app.accounts.filter((a) => a.archived).length);

  const TYPE_OPTS = Object.entries(TYPES);
  const open = (a) => {
    error = ''; errField = '';
    form = a
      ? { id: a.id, name: a.name, type: a.type, balance: (a.initial_balance_cents / 100).toFixed(2).replace('.', ','), archived: a.archived }
      : { name: '', type: 'checking', balance: '0,00', archived: false };
  };

  async function submit(e) {
    e.preventDefault();
    const cents = parseMoney(form.balance);
    error = ''; errField = '';
    if (cents === null) { error = 'Saldo inválido ou fora do limite. Exemplo: 1.250,00'; errField = 'balance'; return; }
    if (!form.name.trim()) { error = 'Informe o nome da conta.'; errField = 'name'; return; }
    busy = true;
    try {
      await saveAccount(form.id ?? null, { name: form.name, type: form.type, initial_balance_cents: cents, archived: form.archived });
      form = null;
    } catch (err) { error = err.message; } finally { busy = false; }
  }

  async function remove() {
    if (!(await confirmDialog({ title: `Excluir a conta "${form.name}"?`, danger: true, confirmLabel: 'Excluir' }))) return;
    busy = true;
    try { await deleteAccount(form.id); form = null; } catch (err) { error = err.message; } finally { busy = false; }
  }

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
            <Money cents={by[a.id]?.current_cents ?? 0} size="md" />
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

{#if form}
  <FormSheet title={form.id ? 'Editar conta' : 'Nova conta'} onclose={() => (form = null)} onsubmit={submit} {busy} error={errField ? '' : error} onremove={form.id ? remove : undefined} removeLabel="Excluir conta">
    <TextInput label="Nome" bind:value={form.name} maxlength="200" error={errField === 'name' ? error : ''} />
    <Select label="Tipo" bind:value={form.type} options={TYPE_OPTS} />
    <TextInput label="Saldo inicial (R$)" bind:value={form.balance} inputmode="decimal" error={errField === 'balance' ? error : ''} />
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
  .acts { display: flex; flex-wrap: wrap; gap: var(--space-2); justify-content: space-between; }
  .opt { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); font: var(--fw-bold) var(--fs-2) var(--font-text); color: var(--text-strong); }
</style>
