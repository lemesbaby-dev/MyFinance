<script>
  import { onMount } from 'svelte';
  import { api, ApiError, hasSession, clearSession } from './lib/api.js';
  import { money, shortDate, endOfMonthISO, isoToday } from './lib/format.js';
  import Login from './Login.svelte';
  import TxForm from './TxForm.svelte';
  import FirstRun from './FirstRun.svelte';

  let ready = $state(false);
  let needLogin = $state(!hasSession());
  let user = $state(null);
  let error = $state('');
  let summary = $state(null);
  let pending = $state([]);
  let categories = $state([]);
  let showForm = $state(false);
  let until = $state(endOfMonthISO());
  const today = isoToday();

  const accounts = $derived(summary?.accounts ?? []);
  const toPay = $derived(pending.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.amount_cents, 0));
  const toReceive = $derived(pending.filter((t) => t.kind === 'income').reduce((s, t) => s + t.amount_cents, 0));
  const delta = $derived((summary?.projected_cents ?? 0) - (summary?.current_cents ?? 0));
  const maxSpend = $derived(Math.max(1, ...(summary?.spending ?? []).map((c) => c.paid_cents + c.pending_cents)));
  const catName = (id) => categories.find((c) => c.id === id)?.name ?? '';
  const accName = (id) => accounts.find((a) => a.id === id)?.name ?? '';

  async function load() {
    error = '';
    try {
      [summary, pending, categories] = await Promise.all([
        api.summary(until),
        api.transactions({ status: 'pending', to: until }),
        api.categories(),
      ]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { clearSession(); needLogin = true; } // sessão vencida/revogada
      error = e.message;
    } finally {
      ready = true;
    }
  }

  async function pay(t) {
    try { await api.pay(t.id); await load(); } catch (e) { error = e.message; }
  }
  async function remove(t) {
    if (!confirm(`Excluir "${t.description}"?`)) return;
    try { await api.remove(t.id); await load(); } catch (e) { error = e.message; }
  }

  async function logout() {
    try { await api.logout(); } catch { /* sem rede: encerra só localmente */ }
    clearSession();
    summary = null; pending = []; categories = []; user = null;
    needLogin = true;
  }

  function loggedIn(u) { user = u; needLogin = false; ready = false; load(); }

  onMount(async () => {
    if (needLogin) { ready = true; return; }
    api.me().then((u) => (user = u)).catch(() => {});
    load();
  });
</script>

{#if needLogin}
  <Login onlogin={loggedIn} />
{:else if !ready}
  <p class="muted pad">Carregando…</p>
{:else if summary && accounts.length === 0}
  <FirstRun {categories} ondone={load} />
{:else}
  <main>
    {#if error}<p class="err pad" role="alert">{error}</p>{/if}

    <header class="hero">
      <div>
        <p class="label">Saldo hoje</p>
        <p class="big num">{money(summary?.current_cents)}</p>
      </div>
      <div class="bridge" aria-hidden="true"><span></span></div>
      <div class="proj">
        <p class="label">Previsto até {shortDate(until)}</p>
        <p class="big num" style="color: var(--proj)">{money(summary?.projected_cents)}</p>
      </div>
    </header>
    <p class="delta muted pad">
      Falta pagar <strong class="out num">{money(toPay)}</strong> e receber <strong class="in num">{money(toReceive)}</strong>
      {#if delta !== 0}— o saldo {delta < 0 ? 'cai' : 'sobe'} <span class="num">{money(Math.abs(delta))}</span>{/if}.
    </p>

    <section class="pad">
      <h2>A pagar e receber</h2>
      {#if pending.length === 0}
        <p class="muted">Nada pendente até {shortDate(until)}. Use “Lançar” para registrar uma conta.</p>
      {:else}
        <ul class="rows">
          {#each pending as t (t.id)}
            <li class:late={t.date < today}>
              <div class="grow">
                <strong>{t.description}{#if t.installment_total} <span class="muted">{t.installment_no}/{t.installment_total}</span>{/if}</strong>
                <span class="muted small">
                  {shortDate(t.date)}{#if t.date < today} · atrasado{/if}
                  · {accName(t.account_id)}{#if t.category_id} · {catName(t.category_id)}{/if}
                </span>
              </div>
              <span class="num {t.kind === 'income' ? 'in' : t.kind === 'expense' ? 'out' : ''}">
                {t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : ''}{money(t.amount_cents)}
              </span>
              <button class="btn small ghost" onclick={() => pay(t)}>{t.kind === 'income' ? 'Recebi' : 'Paguei'}</button>
              <button class="btn small ghost" onclick={() => remove(t)} aria-label="Excluir {t.description}">✕</button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="pad">
      <h2>Gastos do mês por categoria</h2>
      {#if !summary?.spending?.length}
        <p class="muted">Sem despesas neste mês.</p>
      {:else}
        <ul class="bars">
          {#each summary.spending as c (c.category_id)}
            <li>
              <div class="line"><span>{c.category}</span><span class="num">{money(c.paid_cents + c.pending_cents)}</span></div>
              <div class="track" role="img" aria-label="{c.category}: {money(c.paid_cents)} pago, {money(c.pending_cents)} pendente">
                <i class="paid" style="width:{(c.paid_cents / maxSpend) * 100}%"></i><i class="pend" style="width:{(c.pending_cents / maxSpend) * 100}%"></i>
              </div>
            </li>
          {/each}
        </ul>
        <p class="muted small">Cheio = já pago · listrado = ainda pendente.</p>
      {/if}
    </section>

    <section class="pad">
      <h2>Contas</h2>
      <ul class="rows">
        {#each accounts as a (a.id)}
          <li>
            <div class="grow"><strong>{a.name}</strong>
              <span class="muted small">previsto <span class="num">{money(a.projected_cents)}</span></span></div>
            <span class="num">{money(a.current_cents)}</span>
          </li>
        {/each}
      </ul>
    </section>

    <p class="pad muted small">
      {#if user}{user.email} · {/if}<button class="btn small ghost" onclick={logout}>Sair</button>
    </p>

    <button class="fab btn" onclick={() => (showForm = true)}>Lançar</button>
  </main>

  {#if showForm}
    <TxForm {accounts} {categories} onclose={() => (showForm = false)} onsaved={() => { showForm = false; load(); }} />
  {/if}
{/if}

<style>
  main { max-width: 42rem; margin: 0 auto; padding-bottom: 6rem; }
  .pad { padding: 0 1.25rem; }
  .hero { display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; gap: 0.75rem; padding: 2rem 1.25rem 0.5rem; }
  .label { margin: 0; color: var(--muted); font-size: 0.875rem; }
  .big { margin: 0; font-size: clamp(1.4rem, 6.4vw, 2.2rem); font-weight: 650; line-height: 1.15; }
  .proj { text-align: right; }
  .bridge { align-self: center; width: clamp(1rem, 8vw, 3rem); height: 1px; border-top: 2px dashed var(--proj); opacity: 0.6; margin-bottom: 0.4rem; }
  .delta { margin: 0.5rem 0 1.5rem; }
  h2 { font-size: 1rem; margin: 1.75rem 0 0.5rem; font-weight: 650; }
  .rows, .bars { list-style: none; margin: 0; padding: 0; }
  .rows li { display: flex; align-items: center; gap: 0.6rem; padding: 0.7rem 0; border-top: 1px solid var(--line); }
  .rows li:last-child { border-bottom: 1px solid var(--line); }
  .rows .grow { flex: 1; display: grid; min-width: 0; }
  .rows .grow strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .small { font-size: 0.8125rem; }
  .late strong { color: var(--out); }
  .bars li { margin-bottom: 0.8rem; }
  .line { display: flex; justify-content: space-between; margin-bottom: 0.25rem; }
  .track { display: flex; height: 0.5rem; background: color-mix(in srgb, var(--line) 55%, transparent); border-radius: 99px; overflow: hidden; }
  .track .paid { background: var(--out); }
  .track .pend { background: repeating-linear-gradient(135deg, var(--out) 0 3px, transparent 3px 6px); }
  .fab { position: fixed; right: 1.25rem; bottom: calc(1.25rem + env(safe-area-inset-bottom)); box-shadow: 0 6px 18px rgb(0 0 0 / 0.25); padding: 0.85rem 1.4rem; }
</style>
