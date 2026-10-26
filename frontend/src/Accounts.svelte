<script>
  import { app, saveAccount, deleteAccount } from './lib/app.svelte.js';
  import { balances, monthEnd, monthOf, todayISO } from './lib/finance.js';
  import { money, parseMoney } from './lib/format.js';

  const TYPES = { checking: 'Conta corrente', cash: 'Dinheiro', savings: 'Poupança', investment: 'Investimento' };
  const today = todayISO();

  let form = $state(null); // { id?, name, type, balance, archived }
  let error = $state('');
  let showArchived = $state(false);

  const bal = $derived(balances(app.accounts, app.transactions, monthEnd(monthOf(today))));
  const by = $derived(Object.fromEntries(bal.accounts.map((a) => [a.id, a])));
  const list = $derived(app.accounts.filter((a) => showArchived || !a.archived).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
  const archivedCount = $derived(app.accounts.filter((a) => a.archived).length);

  const open = (a) => {
    error = '';
    form = a
      ? { id: a.id, name: a.name, type: a.type, balance: (a.initial_balance_cents / 100).toFixed(2).replace('.', ','), archived: a.archived }
      : { name: '', type: 'checking', balance: '0,00', archived: false };
  };

  async function submit(e) {
    e.preventDefault();
    const cents = parseMoney(form.balance);
    if (cents === null) { error = 'Saldo inválido. Exemplo: 1.250,00'; return; }
    if (!form.name.trim()) { error = 'Informe o nome da conta.'; return; }
    try {
      await saveAccount(form.id ?? null, { name: form.name, type: form.type, initial_balance_cents: cents, archived: form.archived });
      form = null;
    } catch (err) { error = err.message; }
  }

  async function remove() {
    if (!confirm(`Excluir a conta "${form.name}"?`)) return;
    try { await deleteAccount(form.id); form = null; } catch (err) { error = err.message; }
  }
</script>

<section class="pad">
  <h2>Contas</h2>
  <ul class="rows">
    {#each list as a (a.id)}
      <li class:done={a.archived}>
        <div class="grow"><strong>{a.name}{#if a.archived} <span class="badge">arquivada</span>{/if}</strong>
          <span class="muted small">{TYPES[a.type]}{#if by[a.id]} · previsto no mês <span class="num">{money(by[a.id].projected_cents)}</span>{/if}</span></div>
        <span class="num">{money(by[a.id]?.current_cents ?? 0)}</span>
        <button class="btn small ghost" onclick={() => open(a)} aria-label="Editar {a.name}">✎</button>
      </li>
    {:else}
      <li><span class="muted">Nenhuma conta ainda.</span></li>
    {/each}
  </ul>
  {#if archivedCount}
    <p><button class="btn small ghost" onclick={() => (showArchived = !showArchived)}>{showArchived ? 'Ocultar' : 'Mostrar'} arquivadas ({archivedCount})</button></p>
  {/if}
  <p><button class="btn" onclick={() => open(null)}>Nova conta</button></p>
</section>

{#if form}
  <div class="scrim" role="presentation" onclick={() => (form = null)}></div>
  <form class="sheet" onsubmit={submit} aria-label="Conta">
    <h3>{form.id ? 'Editar conta' : 'Nova conta'}</h3>
    <label class="field"><span>Nome</span><input bind:value={form.name} maxlength="200" required /></label>
    <label class="field"><span>Tipo</span>
      <select bind:value={form.type}>{#each Object.entries(TYPES) as [k, v]}<option value={k}>{v}</option>{/each}</select></label>
    <label class="field"><span>Saldo inicial (R$)</span><input bind:value={form.balance} inputmode="decimal" required /></label>
    {#if form.id}<label class="check"><input type="checkbox" bind:checked={form.archived} /> Arquivada (some das listas e dos saldos)</label>{/if}
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <div class="actions">
      <button type="button" class="btn ghost" onclick={() => (form = null)}>Cancelar</button>
      <button class="btn">Salvar</button>
    </div>
    {#if form.id}<p><button type="button" class="btn small ghost" onclick={remove}>Excluir conta</button></p>{/if}
  </form>
{/if}
