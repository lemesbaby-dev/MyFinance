<script>
  import { api } from './lib/api.js';
  import { parseMoney, isoToday } from './lib/format.js';
  let { accounts, categories, onclose, onsaved } = $props();

  let kind = $state('expense');
  let amount = $state('');
  let description = $state('');
  let date = $state(isoToday());
  // O formulário é montado já com as contas carregadas; o valor inicial basta.
  // svelte-ignore state_referenced_locally
  let accountId = $state(accounts[0]?.id);
  // svelte-ignore state_referenced_locally
  let toAccountId = $state(accounts[1]?.id);
  let categoryId = $state('');
  let done = $state(false); // já paguei / já recebi
  let repeat = $state('none'); // none | monthly | weekly | yearly
  let installments = $state(1);
  let error = $state('');
  let busy = $state(false);

  const cats = $derived(categories.filter((c) => c.kind === kind));
  const KINDS = [['expense', 'Despesa'], ['income', 'Receita'], ['transfer', 'Transferência']];

  async function submit(e) {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (!cents || cents <= 0) { error = 'Informe um valor maior que zero.'; return; }
    if (kind === 'transfer' && (!toAccountId || toAccountId === accountId)) { error = 'Escolha uma conta de destino diferente.'; return; }
    busy = true; error = '';
    try {
      const base = {
        kind, description: description.trim() || (kind === 'transfer' ? 'Transferência' : ''),
        amount_cents: cents, date, account_id: Number(accountId),
        category_id: kind !== 'transfer' && categoryId ? Number(categoryId) : null,
      };
      if (!base.description) { error = 'Informe a descrição.'; busy = false; return; }
      if (kind !== 'transfer' && repeat !== 'none') {
        await api.createRecurrence({ kind, description: base.description, amount_cents: cents,
          account_id: base.account_id, category_id: base.category_id,
          frequency: repeat, interval_n: 1, start_date: date });
      } else if (kind === 'transfer') {
        await api.createTransaction({ ...base, transfer_account_id: Number(toAccountId), status: done ? 'paid' : 'pending' });
      } else if (installments > 1) {
        await api.createTransaction({ ...base, installments: Number(installments) });
      } else {
        await api.createTransaction({ ...base, status: done ? 'paid' : 'pending' });
      }
      onsaved();
    } catch (err) { error = err.message; } finally { busy = false; }
  }
</script>

<div class="scrim" role="presentation" onclick={onclose}></div>
<form class="sheet" onsubmit={submit} aria-label="Novo lançamento">
  <div class="seg" role="group" aria-label="Tipo">
    {#each KINDS as [k, label]}
      <button type="button" class:on={kind === k} aria-pressed={kind === k} onclick={() => { kind = k; categoryId = ''; }}>{label}</button>
    {/each}
  </div>

  <label class="field"><span>Valor (R$)</span><input bind:value={amount} inputmode="decimal" placeholder="0,00" required /></label>
  <label class="field"><span>Descrição</span><input bind:value={description} placeholder={kind === 'income' ? 'Ex.: Salário' : 'Ex.: Aluguel'} /></label>
  <label class="field"><span>{kind === 'income' ? 'Data de recebimento' : 'Vencimento'}</span><input type="date" bind:value={date} required /></label>

  <label class="field"><span>{kind === 'transfer' ? 'Sai da conta' : 'Conta'}</span>
    <select bind:value={accountId}>{#each accounts as a}<option value={a.id}>{a.name}</option>{/each}</select></label>

  {#if kind === 'transfer'}
    <label class="field"><span>Entra na conta</span>
      <select bind:value={toAccountId}>{#each accounts as a}<option value={a.id}>{a.name}</option>{/each}</select></label>
  {:else}
    <label class="field"><span>Categoria</span>
      <select bind:value={categoryId}><option value="">Sem categoria</option>{#each cats as c}<option value={c.id}>{c.name}</option>{/each}</select></label>
    <label class="field"><span>Repetir</span>
      <select bind:value={repeat}>
        <option value="none">Não repete</option><option value="monthly">Todo mês</option>
        <option value="weekly">Toda semana</option><option value="yearly">Todo ano</option>
      </select></label>
    {#if kind === 'expense' && repeat === 'none'}
      <label class="field"><span>Parcelas</span><input type="number" min="1" max="60" bind:value={installments} /></label>
    {/if}
  {/if}

  {#if repeat === 'none' && installments <= 1}
    <label class="check"><input type="checkbox" bind:checked={done} /> {kind === 'income' ? 'Já recebi' : 'Já paguei'}</label>
  {/if}

  {#if error}<p class="err" role="alert">{error}</p>{/if}
  <div class="actions">
    <button type="button" class="btn ghost" onclick={onclose}>Cancelar</button>
    <button class="btn" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
  </div>
</form>

<style>
  .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / 0.45); }
  .sheet {
    position: fixed; left: 0; right: 0; bottom: 0; max-height: 92dvh; overflow-y: auto;
    max-width: 42rem; margin: 0 auto; padding: 1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom));
    background: var(--paper); border-radius: 18px 18px 0 0; border-top: 1px solid var(--line);
  }
  .seg { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--line); border-radius: var(--radius); margin-bottom: 1rem; overflow: hidden; }
  .seg button { border: 0; background: transparent; padding: 0.6rem 0.25rem; }
  .seg button.on { background: var(--ink); color: var(--paper); font-weight: 600; }
  .check { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem; }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
</style>
