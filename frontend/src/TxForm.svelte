<script>
  import { app, saveTx, createInstallments, createRecurrence, editRecurring } from './lib/app.svelte.js';
  import { MAX_INSTALLMENTS, isValidISO, todayISO } from './lib/finance.js';
  import Scope from './Scope.svelte';
  import FormSheet from './ui/FormSheet.svelte';
  import Segmented from './ui/Segmented.svelte';
  import MoneyInput from './ui/MoneyInput.svelte';
  import TextInput from './ui/TextInput.svelte';
  import Select from './ui/Select.svelte';
  import DatePicker from './ui/DatePicker.svelte';
  import Switch from './ui/Switch.svelte';

  // tx = lançamento existente (edição); sem tx = novo.
  let { tx = null, onclose } = $props();

  const editing = $derived(!!tx);
  const recurring = $derived(!!tx?.recurrence_id);
  /* svelte-ignore state_referenced_locally */
  let kind = $state(tx?.kind ?? 'expense');
  /* svelte-ignore state_referenced_locally */
  let amount = $state(tx?.amount_cents ?? 0); // centavos (MoneyInput)
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
  const uid = $props.id();
  let error = $state('');
  let errField = $state(''); // campo do erro de validação; vazio = erro geral (Banner)
  let busy = $state(false);
  let askScope = $state(false);

  const accounts = $derived(app.accounts.filter((a) => !a.archived || a.id === tx?.account_id));
  const cats = $derived(app.categories.filter((c) => c.kind === kind));
  const KINDS = [['expense', 'Despesa'], ['income', 'Receita'], ['transfer', 'Transferência']];
  const REPEATS = [['none', 'Não repete'], ['monthly', 'Todo mês'], ['weekly', 'Toda semana'], ['yearly', 'Todo ano'], ['daily', 'Todo dia']];
  const accOpts = $derived(accounts.map((a) => [a.id, a.name]));
  const catOpts = $derived([['', 'Sem categoria'], ...cats.map((c) => [c.id, c.name])]);
  const err = (f) => (errField === f ? error : '');
  const doneLabel = $derived(kind === 'income' ? 'Já recebi' : kind === 'transfer' ? 'Já transferi' : 'Já paguei');

  const bad = (field, msg) => Object.assign(new Error(msg), { field });
  function fields() {
    const cents = amount;
    if (cents <= 0) throw bad('amount', 'Informe um valor maior que zero.');
    if (!isValidISO(date)) throw bad('date', 'Data inválida. Use uma data entre 1900 e 2200.');
    if (!accountId) throw bad('', 'Crie uma conta primeiro (aba Contas).');
    if (kind === 'transfer' && (!toAccountId || toAccountId === accountId)) throw bad('to', 'Escolha uma conta de destino diferente.');
    if (!editing && kind === 'expense' && repeat === 'none' && !(Number.isInteger(+installments) && installments >= 1 && installments <= MAX_INSTALLMENTS)) throw bad('installments', `Parcelas: informe de 1 a ${MAX_INSTALLMENTS}.`);
    const d = description.trim() || (kind === 'transfer' ? 'Transferência' : '');
    if (!d) throw bad('description', 'Informe a descrição.');
    return {
      kind, description: d, amount_cents: cents, date, account_id: accountId,
      transfer_account_id: kind === 'transfer' ? toAccountId : null,
      category_id: kind !== 'transfer' && categoryId ? categoryId : null,
    };
  }

  const paidFields = (f) => ({ ...f, status: done ? 'paid' : 'pending', paid_at: done ? (tx?.paid_at ?? date) : null });

  async function run(fn) {
    busy = true; error = ''; errField = '';
    try { await fn(); onclose(); } catch (e) { error = e.message; errField = e.field ?? ''; } finally { busy = false; }
  }

  function submit(e) {
    e.preventDefault();
    let f;
    error = ''; errField = '';
    try { f = fields(); } catch (err) { error = err.message; errField = err.field ?? ''; return; }
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

<FormSheet title={editing ? 'Editar lançamento' : 'Novo lançamento'} {onclose} onsubmit={submit} {busy} error={errField ? '' : error}>
  <Segmented label="Tipo" options={KINDS} bind:value={kind} onchange={() => { categoryId = ''; installments = 1; repeat = 'none'; }} />

  <MoneyInput label="Valor (R$)" bind:value={amount} error={err('amount')} />
  <TextInput label="Descrição" bind:value={description} maxlength="200" placeholder={kind === 'income' ? 'Ex.: Salário' : 'Ex.: Aluguel'} error={err('description')} />
  <DatePicker label={kind === 'income' ? 'Data de recebimento' : 'Vencimento'} bind:value={date} error={err('date')} />

  <Select label={kind === 'transfer' ? 'Sai da conta' : 'Conta'} bind:value={accountId} options={accOpts} />

  {#if kind === 'transfer'}
    <Select label="Entra na conta" bind:value={toAccountId} options={accOpts} error={err('to')} />
  {:else}
    <Select label="Categoria" bind:value={categoryId} options={catOpts} />
    {#if !editing}
      <Select label="Repetir" bind:value={repeat} options={REPEATS} />
      {#if kind === 'expense' && repeat === 'none'}
        <TextInput label="Parcelas" type="number" min="1" max={MAX_INSTALLMENTS} bind:value={installments} error={err('installments')} />
      {/if}
    {/if}
  {/if}

  {#if editing || (repeat === 'none' && installments <= 1)}
    <div class="opt"><span id="{uid}-done">{doneLabel}</span><Switch bind:checked={done} labelledby="{uid}-done" /></div>
  {/if}
  {#if recurring}<p class="note">{tx.status === 'paid' ? 'Faz parte de uma repetição, mas já foi efetivado: a mudança vale só para este lançamento.' : 'Faz parte de uma repetição: ao salvar, você escolhe quais lançamentos mudam.'}</p>{/if}
</FormSheet>

{#if askScope}
  <Scope verb="Salvar" onpick={pickScope} onclose={() => (askScope = false)} />
{/if}

<style>
  .opt { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); font: var(--fw-bold) var(--fs-2) var(--font-text); color: var(--text-strong); }
  .note { margin: 0; font-size: var(--fs-1); color: var(--text-muted); }
</style>
