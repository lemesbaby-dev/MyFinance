<script>
  import { onMount } from 'svelte';
  import { api, hasSession, clearSession, setUnauthorizedHandler } from './lib/api.js';
  import * as db from './lib/db.js';
  import { sync } from './lib/sync.js';
  import { app, init, idle, clearApp } from './lib/app.svelte.js';
  import Login from './Login.svelte';
  import FirstRun from './FirstRun.svelte';
  import Month from './Month.svelte';
  import Accounts from './Accounts.svelte';
  import Categories from './Categories.svelte';
  import More from './More.svelte';

  const TABS = [['month', 'Mês'], ['accounts', 'Contas'], ['categories', 'Categorias'], ['more', 'Mais']];

  let needLogin = $state(!hasSession());
  let tab = $state('month');
  let error = $state('');
  let blocked = $state(false); // sobraram alterações não enviadas de outra conta neste aparelho
  let forceFirst = $state(false);
  let pendingUser = null;

  const showFirstRun = $derived(app.ready && app.accounts.length === 0 && (app.synced || forceFirst));
  const waitingData = $derived(app.ready && app.accounts.length === 0 && !app.synced && !forceFirst);

  async function boot(user) {
    error = '';
    try {
      // Offline: o usuário vem da cópia local; a rede só confirma depois.
      user ??= await db.getMeta('userInfo') ?? (await api.me());
      pendingUser = user;
      await init(user);
    } catch (e) {
      if (e.message === 'PENDING_OTHER_USER') blocked = true;
      else error = e.message;
    }
  }

  async function discardAndContinue() {
    if (!confirm('As alterações não enviadas da outra conta serão perdidas. Continuar?')) return;
    await db.wipe();
    blocked = false;
    await boot(pendingUser);
  }

  function startFresh() {
    if (confirm('Se você já usa o app em outro aparelho, começar do zero pode duplicar contas e categorias quando os dados chegarem. Começar do zero mesmo assim?')) forceFirst = true;
  }

  async function logout() {
    await sync().catch(() => {});
    const n = await db.pending();
    if (n > 0 && !confirm(`${n} alteração(ões) ainda não foram enviadas. Elas ficam guardadas neste aparelho até você entrar de novo com esta mesma conta. Sair mesmo assim?`)) return;
    try { await api.logout(); } catch { /* sem rede: encerra só localmente */ }
    clearSession();
    app.ready = false;
    forceFirst = false;
    await idle(); // extend/reload em andamento não podem regravar depois do wipe
    if (n === 0) await db.wipe(); // aparelho compartilhado: não deixa dados para trás
    clearApp();
    needLogin = true;
  }

  setUnauthorizedHandler(() => { needLogin = true; app.ready = false; }); // sessão vencida/revogada; dados locais ficam

  onMount(() => { if (!needLogin) boot(); });
</script>

{#if needLogin}
  <Login onlogin={(u) => { needLogin = false; boot(u); }} />
{:else if blocked}
  <main class="center">
    <h1>Alterações pendentes de outra conta</h1>
    <p class="muted">Este aparelho guarda alterações não enviadas de outra conta Google. Entre com ela para enviá-las, ou descarte-as.</p>
    <p><button class="btn" onclick={discardAndContinue}>Descartar e continuar</button></p>
    <p><button class="btn ghost" onclick={() => { clearSession(); blocked = false; needLogin = true; }}>Entrar com outra conta</button></p>
  </main>
{:else if !app.ready}
  <main class="center">
    {#if error}<p class="err" role="alert">{error}</p><button class="btn" onclick={() => boot()}>Tentar de novo</button>
    {:else}<p class="muted">Carregando…</p>{/if}
  </main>
{:else if showFirstRun}
  <FirstRun />
{:else}
  <div class="shell">
    {#if !app.status.online || app.status.offline || app.status.pending || app.status.error}
      <p class="statusbar" role="status">
        {#if !app.status.online || app.status.offline}Offline — suas alterações ficam guardadas neste aparelho{:else if app.status.error}Não foi possível sincronizar: {app.status.error}{:else}Enviando alterações…{/if}
        {#if app.status.pending} · {app.status.pending} por enviar{/if}
      </p>
    {/if}
    <main>
      {#if waitingData}
        <p class="pad muted">Buscando seus dados… <button class="btn small ghost" onclick={startFresh}>Começar do zero</button></p>
      {/if}
      {#if tab === 'month'}<Month />
      {:else if tab === 'accounts'}<Accounts />
      {:else if tab === 'categories'}<Categories />
      {:else}<More onlogout={logout} />{/if}
    </main>
    <nav class="tabs" aria-label="Seções">
      {#each TABS as [k, label]}
        <button class:on={tab === k} aria-current={tab === k ? 'page' : undefined} onclick={() => (tab = k)}>
          {label}{#if k === 'more' && app.status.pending}<span class="dot" aria-label="alterações por enviar"></span>{/if}
        </button>
      {/each}
    </nav>
  </div>
{/if}

<style>
  .shell main { max-width: 42rem; margin: 0 auto; padding-bottom: 8rem; }
  .center { max-width: 26rem; margin: 0 auto; padding: 3rem 1.25rem; }
  .center h1 { font-size: 1.3rem; }
  .statusbar { margin: 0; padding: 0.4rem 1.25rem; font-size: 0.8125rem; text-align: center; background: color-mix(in srgb, var(--out) 12%, transparent); color: var(--ink); }
  .tabs {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 6; display: grid; grid-template-columns: repeat(4, 1fr);
    background: var(--paper); border-top: 1px solid var(--line); padding-bottom: env(safe-area-inset-bottom);
  }
  .tabs button { border: 0; background: transparent; padding: 0.85rem 0.25rem; color: var(--muted); position: relative; }
  .tabs button.on { color: var(--ink); font-weight: 650; box-shadow: inset 0 2px 0 var(--ink); }
  .dot { position: absolute; top: 0.6rem; margin-left: 0.2rem; width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--out); }
</style>
