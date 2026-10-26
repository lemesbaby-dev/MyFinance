<script>
  import { app, saveAccount, saveCategory } from './lib/app.svelte.js';
  import { parseMoney } from './lib/format.js';

  let name = $state('Conta principal');
  let balance = $state('0,00');
  let seed = $state(app.categories.length === 0);
  let error = $state('');
  let busy = $state(false);

  const DEFAULTS = {
    expense: ['Moradia', 'Mercado', 'Transporte', 'Saúde', 'Lazer', 'Educação', 'Assinaturas', 'Outros'],
    income: ['Salário', 'Rendimentos', 'Outras receitas'],
  };

  async function start(e) {
    e.preventDefault();
    const cents = parseMoney(balance);
    if (cents === null) { error = 'Saldo inválido. Exemplo: 1.250,00'; return; }
    busy = true; error = '';
    try {
      await saveAccount(null, { name, type: 'checking', initial_balance_cents: cents });
      if (seed) for (const kind of ['expense', 'income']) for (const n of DEFAULTS[kind]) await saveCategory(null, { name: n, kind });
    } catch (err) { error = err.message; } finally { busy = false; }
  }
</script>

<main>
  <h1>Vamos começar</h1>
  <p class="muted">Crie a conta onde seu dinheiro está hoje. O saldo inicial é o ponto de partida do cálculo. Funciona mesmo sem internet.</p>
  <form onsubmit={start}>
    <label class="field"><span>Nome da conta</span><input bind:value={name} required /></label>
    <label class="field"><span>Saldo hoje (R$)</span><input bind:value={balance} inputmode="decimal" required /></label>
    <label class="check"><input type="checkbox" bind:checked={seed} /> Criar categorias padrão (Moradia, Mercado, Salário…)</label>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <button class="btn" disabled={busy}>{busy ? 'Criando…' : 'Criar conta'}</button>
  </form>
</main>

<style>
  main { max-width: 26rem; margin: 0 auto; padding: 3rem 1.25rem; }
  h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
</style>
