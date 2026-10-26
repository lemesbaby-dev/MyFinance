<script>
  import { app, saveTx, createInstallments, createRecurrence, editRecurring } from './lib/app.svelte.js';
  import { parseMoney } from './lib/format.js';
  import { MAX_INSTALLMENTS, isValidISO, todayISO } from './lib/finance.js';
  import Scope from './Scope.svelte';
  import { dialog } from './lib/a11y.js';

  // tx = lançamento existente (edição); sem tx = novo.
  let { tx = null, onclose } = $props();

  const editing = $derived(!!tx);
  const recurring = $derived(!!tx?.recurrence_id);
  /* svelte-ignore state_referenced_locally */
  let kind = $state(tx?.kind ?? 'expense');
  /* svelte-ignore state_referenced_locally */
  let amount = $state(tx ? (tx.amount_cents / 100).toFixed(2).replace('.', ',') : '');
  /* svelte-ignore state_referenced_locally */
  let description = $state(tx?.description ?? '');
  /* svelte-ignore state_referenced_locally */
  let date = $state(tx?.date ?? todayISO());
  /* svelte-ignore state_referenced_locally */
  let accountId = $state(tx?.account_id ?? app.accounts.find((a) => !a.archived)?.id);
  /* svelte-ignore state_referenced_locally */
  let toAccountId = $state(tx?.transfer_account_id ?? app.accounts.filter((a) => !a.archived)[1]?.id);
  /* svelte-ignore state_referenced_locally */
  let categoryId = $state(tx?.category_id ?? '');
  /* svelte-ignore state_referenced_locally */
  let done = $state(tx?.status === 'paid');
  let repeat = $state('none'); // none | daily | weekly | monthly | yearly
  let installments = $state(1);
  let error = $state('');
  let busy = $state(false);
  let askScope = $state(false);

  const accounts = $derived(app.accounts.filter((a) => !a.archived || a.id === tx?.account_id));
  const cats = $derived(app.categories.filter((c) => c.kind === kind));
  const KINDS = [['expense', 'Despesa'], ['income', 'Receita'], ['transfer', 'Transferência']];

  function fields() {
    const cents = parseMoney(amount);
    if (cents === null) throw new Error('Valor inválido ou acima de R$ 1 trilhão.');
    if (cents <= 0) throw new Error('Informe um valor maior que zero.');
    if (!isValidISO(date)) throw new Error('Data inválida. Use uma data entre 1900 e 2200.');
    if (!accountId) throw new Error('Crie uma conta primeiro (aba Contas).');
    if (kind === 'transfer' && (!toAccountId || toAccountId === accountId)) throw new Error('Escolha uma conta de destino diferente.');
    const d = description.trim() || (kind === 'transfer' ? 'Transferência' : '');
    if (!d) throw new Error('Informe a descrição.');
    return {
      kind, description: d, amount_cents: cents, date, account_id: accountId,
      transfer_account_id: kind === 'transfer' ? toAccountId : null,
      category_id: kind !== 'transfer' && categoryId ? categoryId : null,
    };
  }

  const paidFields = (f) => ({ ...f, status: done ? 'paid' : 'pending', paid_at: done ? (tx?.paid_at ?? date) : null });

  async function run(fn) {
    busy = true; error = '';
    try { await fn(); onclose(); } catch (e) { error = e.message; } finally { busy = false; }
  }

  function submit(e) {
    e.preventDefault();
    let f;
    try { f = fields(); } catch (err) { error = err.message; return; }
    if (editing && recurring && tx.status === 'pending') { askScope = true; return; } // paga: só esta, sem perguntar
    run(async () => {
      if (editing) return saveTx(tx.id, paidFields(f));
      if (kind !== 'transfer' && repeat !== 'none') {
        return createRecurrence({ ...f, frequency: repeat, interval_n: 1, start_date: date });
      }
      if (kind === 'expense' && installments > 1) return createInstallments(f, Number(installments));
      return saveTx(null, paidFields(f));
    });
  }

  function pickScope(scope) {
    askScope = false;
    run(() => editRecurring(tx, scope, paidFields(fields())));
  }
</script>

<div class="scrim" role="presentation" onclick={onclose}></div>
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<form class="sheet" role="dialog" aria-modal="true" use:dialog={onclose} onsubmit={submit} aria-label={editing ? 'Editar lançamento' : 'Novo lançamento'}>
  <div class="seg" role="group" aria-label="Tipo">
    {#each KINDS as [k, label]}
      <button type="button" class:on={kind === k} aria-pressed={kind === k} onclick={() => { kind = k; categoryId = ''; installments = 1; repeat = 'none'; }}>{label}</button>
    {/each}
  </div>

  <label class="field"><span>Valor (R$)</span><input bind:value={amount} inputmode="decimal" placeholder="0,00" required /></label>
  <label class="field"><span>Descrição</span><input bind:value={description} maxlength="200" placeholder={kind === 'income' ? 'Ex.: Salário' : 'Ex.: Aluguel'} /></label>
  <label class="field"><span>{kind === 'income' ? 'Data de recebimento' : 'Vencimento'}</span><input type="date" bind:value={date} required /></label>

  <label class="field"><span>{kind === 'transfer' ? 'Sai da conta' : 'Conta'}</span>
    <select bind:value={accountId}>{#each accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}</select></label>

  {#if kind === 'transfer'}
    <label class="field"><span>Entra na conta</span>
      <select bind:value={toAccountId}>{#each accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}</select></label>
  {:else}
    <label class="field"><span>Categoria</span>
      <select bind:value={categoryId}><option value="">Sem categoria</option>{#each cats as c (c.id)}<option value={c.id}>{c.name}</option>{/each}</select></label>
    {#if !editing}
      <label class="field"><span>Repetir</span>
        <select bind:value={repeat}>
          <option value="none">Não repete</option><option value="monthly">Todo mês</option>
          <option value="weekly">Toda semana</option><option value="yearly">Todo ano</option><option value="daily">Todo dia</option>
        </select></label>
      {#if kind === 'expense' && repeat === 'none'}
        <label class="field"><span>Parcelas</span><input type="number" min="1" max={MAX_INSTALLMENTS} bind:value={installments} /></label>
      {/if}
    {/if}
  {/if}

  {#if editing || (repeat === 'none' && installments <= 1)}
    <label class="check"><input type="checkbox" bind:checked={done} /> {kind === 'income' ? 'Já recebi' : kind === 'transfer' ? 'Já transferi' : 'Já paguei'}</label>
  {/if}
  {#if recurring}<p class="muted small">{tx.status === 'paid' ? 'Faz parte de uma repetição, mas já foi efetivado: a mudança vale só para este lançamento.' : 'Faz parte de uma repetição: ao salvar, você escolhe quais lançamentos mudam.'}</p>{/if}

  {#if error}<p class="err" role="alert">{error}</p>{/if}
  <div class="actions">
    <button type="button" class="btn ghost" onclick={onclose}>Cancelar</button>
    <button class="btn" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
  </div>
</form>

{#if askScope}
  <Scope verb="Salvar" onpick={pickScope} onclose={() => (askScope = false)} />
{/if}
