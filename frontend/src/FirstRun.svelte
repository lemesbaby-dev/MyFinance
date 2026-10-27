<script>
  import { app, saveAccount, saveCategory } from './lib/app.svelte.js';
  import { parseMoney } from './lib/format.js';
  import Header from './ui/Header.svelte';
  import TextInput from './ui/TextInput.svelte';
  import Switch from './ui/Switch.svelte';
  import Button from './ui/Button.svelte';
  import Banner from './ui/Banner.svelte';

  let name = $state('Conta principal');
  let balance = $state('0,00');
  let seed = $state(app.categories.length === 0);
  let error = $state('');
  let errField = $state('');
  let busy = $state(false);

  const DEFAULTS = {
    expense: ['Moradia', 'Mercado', 'Transporte', 'Saúde', 'Lazer', 'Educação', 'Assinaturas', 'Outros'],
    income: ['Salário', 'Rendimentos', 'Outras receitas'],
  };

  async function start(e) {
    e.preventDefault();
    const cents = parseMoney(balance);
    errField = '';
    if (cents === null) { error = 'Saldo inválido ou fora do limite. Exemplo: 1.250,00'; errField = 'balance'; return; }
    busy = true; error = '';
    try {
      await saveAccount(null, { name, type: 'checking', initial_balance_cents: cents });
      if (seed) for (const kind of ['expense', 'income']) for (const n of DEFAULTS[kind]) await saveCategory(null, { name: n, kind });
    } catch (err) { error = err.message; } finally { busy = false; }
  }
</script>

<main>
  <Header title="Vamos começar" />
  <p class="muted">Crie a conta onde seu dinheiro está hoje. O saldo inicial é o ponto de partida do cálculo. Funciona mesmo sem internet.</p>
  <form onsubmit={start}>
    <TextInput label="Nome da conta" bind:value={name} required />
    <TextInput label="Saldo hoje (R$)" bind:value={balance} inputmode="decimal" required error={errField === 'balance' ? error : ''} />
    <div class="opt"><span id="seed-l">Criar categorias padrão (Moradia, Mercado, Salário…)</span><Switch bind:checked={seed} labelledby="seed-l" /></div>
    {#if error && !errField}<Banner tone="danger" icon="alert">{error}</Banner>{/if}
    <Button type="submit" block loading={busy}>{busy ? 'Criando…' : 'Criar conta'}</Button>
  </form>
</main>

<style>
  main { max-width: 26rem; margin: 0 auto; padding: var(--space-12) var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
  p { margin: 0; }
  form { display: flex; flex-direction: column; gap: var(--space-3); }
  .opt { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); font: var(--fw-bold) var(--fs-2) var(--font-text); color: var(--text-strong); }
</style>
