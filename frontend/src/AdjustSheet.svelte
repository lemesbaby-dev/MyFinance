<script>
  import { app, adjustAccount, currentBalance, deleteTx } from './lib/app.svelte.js';
  import { todayISO, adjustment } from './lib/finance.js';
  import { money } from './lib/format.js';
  import FormSheet from './ui/FormSheet.svelte';
  import MoneyInput from './ui/MoneyInput.svelte';
  import DatePicker from './ui/DatePicker.svelte';
  import Select from './ui/Select.svelte';
  import Button from './ui/Button.svelte';
  import { toast } from './ui/toast.js';

  // Informa o saldo real do banco; o app lança a diferença como receita/despesa efetivada ("Ajuste de saldo").
  let { account, onclose } = $props();

  // Mesmo cálculo de adjustAccount (currentBalance): a prévia acompanha o que será gravado.
  const current = $derived(currentBalance(account.id));
  /* svelte-ignore state_referenced_locally */
  let real = $state(current);
  let date = $state(todayISO());
  let categoryId = $state('');
  let more = $state(false);
  let busy = $state(false);
  let error = $state('');

  const adj = $derived(adjustment(current, real));
  const catOpts = $derived([['', 'Ajuste de saldo'], ...app.categories.filter((c) => !c.is_system && c.kind === adj?.kind).map((c) => [c.id, c.name])]);

  async function submit(e) {
    e.preventDefault();
    if (!adj) return;
    busy = true; error = '';
    try {
      const r = await adjustAccount(account.id, real, { date, categoryId });
      onclose();
      if (!r) return toast('Saldo já confere');
      toast('Saldo ajustado', { tone: 'ok', actionLabel: 'Desfazer', onaction: () => deleteTx({ id: r.id }).catch(() => {}) });
    } catch (err) { error = err.message; } finally { busy = false; }
  }
</script>

<FormSheet title="Ajustar saldo · {account.name}" {onclose} onsubmit={submit} {busy} {error} canSave={!!adj}>
  <p class="info">Saldo no app: <strong>{money(current)}</strong></p>
  <MoneyInput label="Saldo real no banco (R$)" bind:value={real} signed help="Digite só os números; “-” alterna negativo" />
  <p class="prev" class:income={adj?.kind === 'income'} class:expense={adj?.kind === 'expense'} aria-live="polite">
    {#if !adj}Saldo já confere{:else}Será lançada {adj.kind === 'income' ? 'uma receita' : 'uma despesa'} de {money(adj.amount_cents)} — Ajuste de saldo{/if}
  </p>
  <Button variant="ghost" size="sm" onclick={() => (more = !more)}>{more ? 'Menos opções' : 'Mais opções'}</Button>
  {#if more}
    <DatePicker label="Data" bind:value={date} />
    <Select label="Categoria" bind:value={categoryId} options={catOpts} />
  {/if}
</FormSheet>

<style>
  .info, .prev { margin: 0; font-size: var(--fs-2); color: var(--text-muted); }
  .info strong { color: var(--text-strong); }
  .prev { font-weight: var(--fw-bold); }
  .prev.income { color: var(--color-income); }
  .prev.expense { color: var(--color-expense); }
</style>
