<script>
  // Detalhe de uma repetição: editar (a partir de uma data) e encerrar. Encerrada é só leitura.
  import { app, editRule, endRecurrence } from './lib/app.svelte.js';
  import { recurrenceView, rhythm } from './lib/finance.js';
  import { fullDate } from './lib/format.js';
  import Sheet from './ui/Sheet.svelte';
  import FormSheet from './ui/FormSheet.svelte';
  import Button from './ui/Button.svelte';
  import MoneyInput from './ui/MoneyInput.svelte';
  import TextInput from './ui/TextInput.svelte';
  import Select from './ui/Select.svelte';
  import { confirmDialog } from './ui/confirm.js';

  let { id, today, onclose } = $props();

  const row = $derived(recurrenceView(app.recurrences, app.transactions, today).rows.find((r) => r.rec.id === id));
  const rec = $derived(row?.rec);
  $effect(() => { if (!row) onclose(); }); // excluída em outro aparelho com o detalhe aberto

  /* svelte-ignore state_referenced_locally */
  let amount = $state(rec?.amount_cents ?? 0);
  /* svelte-ignore state_referenced_locally */
  let description = $state(rec?.description ?? '');
  /* svelte-ignore state_referenced_locally */
  let accountId = $state(rec?.account_id ?? '');
  /* svelte-ignore state_referenced_locally */
  let categoryId = $state(rec?.category_id ?? '');
  /* svelte-ignore state_referenced_locally */
  let from = $state(row?.next ?? row?.pending[0] ?? ''); // padrão: a próxima pendente
  let error = $state('');
  let errField = $state('');
  let busy = $state(false);

  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const upcoming = $derived(row ? row.pending.length - row.overdue : 0);
  const accOpts = $derived(app.accounts.filter((a) => !a.archived || a.id === rec?.account_id).map((a) => [a.id, a.name]));
  const catOpts = $derived([['', 'Sem categoria'], ...app.categories.filter((c) => c.kind === rec?.kind).map((c) => [c.id, c.name])]);
  const fromOpts = $derived([...new Set(row?.pending)].map((d) => [d, fullDate(d) + (d < today ? ' (atrasado)' : '')]));
  const facts = $derived(row && [
    `${rhythm(rec)} · desde ${fullDate(rec.start_date)}`,
    rec.end_date && (rec.end_date < today ? `parou em ${fullDate(rec.end_date)}` : !row.ended && `até ${fullDate(rec.end_date)}`),
    n(row.paid, 'efetivado', 'efetivados'),
    n(upcoming, 'pendente', 'pendentes'),
    row.overdue && n(row.overdue, 'atrasado', 'atrasados'),
  ].filter(Boolean).join(' · '));
  const err = (f) => (errField === f ? error : '');

  async function run(fn) {
    busy = true; error = ''; errField = '';
    try { await fn(); onclose(); } catch (e) { error = e.message; } finally { busy = false; }
  }

  function submit(e) {
    e.preventDefault();
    error = ''; errField = '';
    if (amount <= 0) { errField = 'amount'; error = 'Informe um valor maior que zero.'; return; }
    if (!description.trim()) { errField = 'description'; error = 'Informe a descrição.'; return; }
    run(() => editRule(id, from || today, { description: description.trim(), amount_cents: amount, account_id: accountId, category_id: categoryId || null }));
  }

  async function end() {
    const message = [
      'Ela para de se repetir a partir de hoje.',
      upcoming ? `${n(upcoming, 'lançamento pendente sai', 'lançamentos pendentes saem')} da aba Mês.` : '',
      row.paid ? `${n(row.paid, 'já efetivado continua', 'já efetivados continuam')} no histórico e nos saldos.` : '',
      row.overdue ? `${n(row.overdue, 'atrasado fica', 'atrasados ficam')} na aba Mês para você efetivar ou excluir.` : '',
    ].filter(Boolean).join(' ');
    if (await confirmDialog({ title: `Encerrar "${rec.description}"?`, message, danger: true, confirmLabel: 'Encerrar' })) run(() => endRecurrence(id));
  }
</script>

{#if row?.ended}
  <Sheet title={rec.description} {onclose}>
    <p class="note">{facts}</p>
    <p class="note">Repetição encerrada: não gera mais lançamentos. O que já foi efetivado continua no histórico e nos saldos{row.overdue ? ', e o que está atrasado continua na aba Mês' : ''}.</p>
    <Button variant="secondary" block onclick={onclose}>Fechar</Button>
  </Sheet>
{:else if row}
  <FormSheet title="Repetição" {onclose} onsubmit={submit} {busy} error={errField ? '' : error} onremove={end} removeLabel="Encerrar repetição">
    <p class="note">{facts}</p>
    <MoneyInput label="Valor (R$)" bind:value={amount} error={err('amount')} />
    <TextInput label="Descrição" bind:value={description} maxlength="200" error={err('description')} />
    <Select label="Conta" bind:value={accountId} options={accOpts} />
    <Select label="Categoria" bind:value={categoryId} options={catOpts} />
    {#if fromOpts.length}
      <Select label="Mudar a partir de" bind:value={from} options={fromOpts} help="Mudam os lançamentos pendentes dessa data em diante. Os anteriores e os já efetivados não mudam." />
    {:else}
      <p class="note">Não há lançamentos pendentes agora: a mudança vale para os próximos que forem criados.</p>
    {/if}
    <p class="note">Para mudar o ritmo, o dia ou a data final, encerre esta repetição e crie outra.</p>
  </FormSheet>
{/if}

<style>
  .note { margin: 0; font-size: var(--fs-2); color: var(--text-muted); }
</style>
