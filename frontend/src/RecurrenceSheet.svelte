<script>
  // Detalhe de uma repetição: editar (a partir de uma data), mudar ritmo/dia/data final e encerrar. Encerrada: só "Repetir de novo".
  import { app, editRule, endRecurrence, scheduleImpact, repeatAgain } from './lib/app.svelte.js';
  import { recurrenceView, rhythm, nextOccurrence, MAX_INTERVAL } from './lib/finance.js';
  import { fullDate } from './lib/format.js';
  import Sheet from './ui/Sheet.svelte';
  import FormSheet from './ui/FormSheet.svelte';
  import Button from './ui/Button.svelte';
  import Banner from './ui/Banner.svelte';
  import Icon from './ui/Icon.svelte';
  import MoneyInput from './ui/MoneyInput.svelte';
  import TextInput from './ui/TextInput.svelte';
  import Select from './ui/Select.svelte';
  import DatePicker from './ui/DatePicker.svelte';
  import { confirmDialog } from './ui/confirm.js';
  import { toast } from './ui/toast.js';

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
  /* svelte-ignore state_referenced_locally */
  let frequency = $state(rec?.frequency ?? 'monthly');
  /* svelte-ignore state_referenced_locally */
  let interval = $state(rec?.interval_n ?? 1);
  /* svelte-ignore state_referenced_locally */
  let endDate = $state(rec?.end_date ?? '');
  // Próximo vencimento: enquanto ninguém mexe, é a data do ritmo atual a partir de "Mudar a partir de" (ou seja, o dia não muda).
  let startPick = $state(null);
  const startDefault = $derived(rec ? nextOccurrence(rec, from || today) ?? (from || today) : '');
  const start = $derived(startPick ?? startDefault);
  /* svelte-ignore state_referenced_locally */
  let again = $state((rec && nextOccurrence(rec, today)) ?? today); // recomeço: a próxima data do ritmo antigo
  const REPEATS = [['monthly', 'Todo mês'], ['weekly', 'Toda semana'], ['yearly', 'Todo ano'], ['daily', 'Todo dia']];
  const UNITS = { daily: 'dias', weekly: 'semanas', monthly: 'meses', yearly: 'anos' };
  let error = $state('');
  let errField = $state('');
  let busy = $state(false);

  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const upcoming = $derived(row ? row.pending.length - row.overdue : 0);
  const accOpts = $derived(app.accounts.filter((a) => !a.archived || a.id === rec?.account_id).map((a) => [a.id, a.name]));
  const catOpts = $derived([['', 'Sem categoria'], ...app.categories.filter((c) => c.kind === rec?.kind).map((c) => [c.id, c.name])]);
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
    if (!(Number.isInteger(+interval) && interval >= 1 && interval <= MAX_INTERVAL)) { errField = 'interval'; error = `Informe um número inteiro de 1 a ${MAX_INTERVAL}.`; return; }
    const moved = frequency !== rec.frequency || +interval !== rec.interval_n || start !== startDefault;
    if (endDate && endDate < (moved ? start : rec.start_date)) { errField = 'end'; error = `A data final não pode ser antes ${moved ? 'do próximo lançamento' : 'do início da repetição'}.`; return; }
    save(from || today, { description: description.trim(), amount_cents: amount, account_id: accountId, category_id: categoryId || null,
      frequency, interval_n: +interval, start_date: start, end_date: endDate || null });
  }

  // Mudar as datas tira pendentes: se algum tem anotação ou foi mudado à mão, avisa quantos antes de gravar.
  async function save(f, changes) {
    let hit;
    try { hit = scheduleImpact(id, f, changes); } catch (e) { error = e.message; return; }
    if (hit?.edited) {
      const what = hit.rhythm
        ? n(hit.gone, 'lançamento pendente será trocado por um novo, na data nova', 'lançamentos pendentes serão trocados por novos, nas datas novas')
        : n(hit.gone, 'lançamento pendente sai, porque fica depois da data final', 'lançamentos pendentes saem, porque ficam depois da data final');
      const lost = hit.gone === 1 ? 'Ele tem anotação ou foi mudado à mão' : hit.edited === 1 ? '1 deles tem anotação ou foi mudado à mão' : `${hit.edited} deles têm anotação ou foram mudados à mão`;
      if (!(await confirmDialog({ title: hit.rhythm ? 'Trocar os lançamentos pendentes?' : 'Tirar os lançamentos pendentes?', message: `${what}. ${lost}, e isso se perde.`, danger: true, confirmLabel: hit.rhythm ? 'Trocar' : 'Tirar' }))) return;
    }
    run(() => editRule(id, f, changes));
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
    <DatePicker label="Recomeçar em" bind:value={again} help="Cria uma repetição nova com o mesmo valor, conta, categoria e ritmo, a partir dessa data." />
    {#if error}<Banner tone="danger" icon="alert">{error}</Banner>{/if}
    <Button variant="secondary" block loading={busy} onclick={() => run(async () => { await repeatAgain(id, again); toast('Repetindo de novo', { tone: 'ok' }); })}><Icon name="refresh" />Repetir de novo</Button>
    <Button variant="ghost" block onclick={onclose}>Fechar</Button>
  </Sheet>
{:else if row}
  <FormSheet title="Repetição" {onclose} onsubmit={submit} {busy} error={errField ? '' : error} onremove={end} removeLabel="Encerrar repetição">
    <p class="note">{facts}</p>
    <MoneyInput label="Valor (R$)" bind:value={amount} error={err('amount')} />
    <TextInput label="Descrição" bind:value={description} maxlength="200" error={err('description')} />
    <Select label="Conta" bind:value={accountId} options={accOpts} />
    <Select label="Categoria" bind:value={categoryId} options={catOpts} />
    {#if row.pending.length}
      <DatePicker label="Mudar a partir de" bind:value={from} help="Mudam os lançamentos pendentes dessa data em diante. Os anteriores e os já efetivados não mudam." />
    {:else}
      <p class="note">Não há lançamentos pendentes agora: a mudança vale para os próximos que forem criados.</p>
    {/if}
    <Select label="Repete" bind:value={frequency} options={REPEATS} />
    <TextInput label="A cada quantos {UNITS[frequency]}" type="number" min="1" max={MAX_INTERVAL} inputmode="numeric" bind:value={interval} help="1 = {REPEATS.find((r) => r[0] === frequency)[1].toLowerCase()}" error={err('interval')} />
    <DatePicker label={rec.kind === 'income' ? 'Próximo recebimento' : 'Próximo vencimento'} bind:value={() => start, (v) => (startPick = v)} help="Mude a data para trocar o dia: os seguintes acompanham." />
    <DatePicker label="Termina em" bind:value={endDate} clearable placeholder="Sem data final" help="Opcional. O último lançamento é até essa data." error={err('end')} />
  </FormSheet>
{/if}

<style>
  .note { margin: 0; font-size: var(--fs-2); color: var(--text-muted); }
</style>
