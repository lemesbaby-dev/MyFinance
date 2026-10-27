<script>
  import { onMount } from 'svelte';
  import { api, hasSession, clearSession, setUnauthorizedHandler } from './lib/api.js';
  import * as db from './lib/db.js';
  import * as session from './lib/session.js';
  import { sync } from './lib/sync.js';
  import { app, init, idle, clearApp, reload } from './lib/app.svelte.js';
  import Login from './Login.svelte';
  import FirstRun from './FirstRun.svelte';
  import Month from './Month.svelte';
  import Accounts from './Accounts.svelte';
  import Categories from './Categories.svelte';
  import More from './More.svelte';
  import ConfirmHost from './ui/ConfirmHost.svelte';
  import { confirmDialog } from './ui/confirm.js';
  import Header from './ui/Header.svelte';
  import TabBar from './ui/TabBar.svelte';
  import Banner from './ui/Banner.svelte';
  import Button from './ui/Button.svelte';
  import Skeleton from './ui/Skeleton.svelte';
  import EmptyState from './ui/EmptyState.svelte';

  const TABS = [['month', 'Mês', 'home'], ['accounts', 'Contas', 'wallet'], ['categories', 'Categorias', 'tag'], ['more', 'Mais', 'sliders']];

  let needLogin = $state(!hasSession());
  let tab = $state('month');
  let error = $state('');
  let blocked = $state(false); // sobraram alterações não enviadas de outra conta neste aparelho
  let forceFirst = $state(false);
  let Design = $state(null); // /design: só em dev; o import dinâmico some do build de produção (DEV vira false)
  if (import.meta.env.DEV && location.hash === '#/design') import('./Design.svelte').then((m) => (Design = m.default));

  // Com itens recusados pendentes o app abre normal: o aviso fica na aba Mais e não pode ser escondido pelos "primeiros passos".
  const showFirstRun = $derived(app.ready && app.accounts.length === 0 && app.rejected.length === 0 && (app.synced || forceFirst));
  const tabbed = $derived(TABS.map(([k, t, i]) => (k === 'more' && (app.status.pending || app.status.rejected) ? [k, t, i, app.status.rejected ? 'alterações recusadas pelo servidor' : 'alterações por enviar'] : [k, t, i])));
  const waitingData = $derived(app.ready && app.accounts.length === 0 && !app.synced && !forceFirst);

  async function boot(user) {
    error = '';
    try {
      if (!user) {
        // Offline: o usuário vem da cópia local; token e cópia precisam ser da mesma conta (session.js).
        const r = await session.resume();
        if (r.state === 'blocked') { blocked = true; return; }
        user = r.user;
      }
      await init(user);
    } catch (e) {
      if (e.message === 'PENDING_OTHER_USER') blocked = true;
      else error = e.message;
    }
  }

  async function discardAndContinue() {
    if (!(await confirmDialog({ title: 'Descartar alterações?', message: 'As alterações não enviadas da outra conta serão perdidas. Continuar?', danger: true, confirmLabel: 'Descartar' }))) return;
    try {
      const user = await session.discardAndContinue();
      blocked = false;
      await boot(user);
    } catch (e) { error = e.message; }
  }

  function otherAccount() {
    session.abandon();
    blocked = false;
    needLogin = true;
  }

  async function startFresh() {
    if (await confirmDialog({ title: 'Começar do zero?', message: 'Se você já usa o app em outro aparelho, começar do zero pode duplicar contas e categorias quando os dados chegarem. Começar do zero mesmo assim?', confirmLabel: 'Começar do zero' })) forceFirst = true;
  }

  async function logout() {
    await sync().catch(() => {});
    const n = await db.unsent(); // na fila ou recusadas: as duas se perderiam num wipe
    if (n > 0 && !(await confirmDialog({ title: 'Sair mesmo assim?', message: `${n} alteração(ões) ainda não foram enviadas ou foram recusadas pelo servidor. Elas ficam guardadas neste aparelho até você entrar de novo com esta mesma conta. Sair mesmo assim?`, danger: true, confirmLabel: 'Sair' }))) return;
    try { await api.logout(); } catch { /* sem rede: encerra só localmente */ }
    clearSession();
    app.ready = false;
    forceFirst = false;
    await idle(); // extend/reload em andamento não podem regravar depois do wipe
    if (n === 0) await db.wipe(); // aparelho compartilhado: não deixa dados para trás
    clearApp();
    needLogin = true;
  }

  async function resetData() {
    await sync().catch(() => {}); // esvazia a fila antes: uma op enviada depois do reset recriaria dados
    await api.resetData(); // sem rede: erro volta para a tela
    await idle();
    await db.resetLocal();
    forceFirst = false;
    await reload();
    sync().catch(() => {});
  }

  async function deleteAccount(email) {
    await api.deleteAccount(email); // o servidor confere o e-mail; erro volta para o formulário
    clearSession();
    app.ready = false;
    forceFirst = false;
    await idle();
    await db.wipe(); // a conta não existe mais: nada para guardar
    clearApp();
    needLogin = true;
  }

  setUnauthorizedHandler(() => { needLogin = true; app.ready = false; }); // sessão vencida/revogada; dados locais ficam

  onMount(() => { if (!needLogin) boot(); });
</script>

{#if Design}
  <Design />
{:else if needLogin}
  <Login onlogin={(u, state) => { needLogin = false; if (state === 'blocked') blocked = true; else boot(u); }} />
{:else if blocked}
  <main class="center">
    <Header title="Alterações pendentes de outra conta" />
    <p class="muted">Este aparelho guarda alterações não enviadas de outra conta Google. Entre com ela para enviá-las, ou descarte-as.</p>
    <Button variant="danger" block onclick={discardAndContinue}>Descartar e continuar</Button>
    {#if error}<Banner tone="danger" icon="alert">{error}</Banner>{/if}
    <Button variant="secondary" block onclick={otherAccount}>Entrar com outra conta</Button>
  </main>
{:else if !app.ready}
  <main class="center">
    {#if error}<EmptyState icon="alert" tone="danger" role="alert" title="Não deu certo" text={error} actionLabel="Tentar de novo" onaction={() => boot()} />
    {:else}<Skeleton kind="row" count={3} />{/if}
  </main>
{:else if showFirstRun}
  <FirstRun />
{:else}
  <div class="shell">
    <main>
      {#if !app.status.online || app.status.offline || app.status.pending || app.status.rejected || app.status.error}
        <Banner tone={app.status.rejected || (app.status.error && app.status.online && !app.status.offline) ? 'warn' : 'info'} icon={!app.status.online || app.status.offline ? 'cloud-off' : app.status.error ? 'alert' : 'refresh'}>
          {#if !app.status.online || app.status.offline}Offline — suas alterações ficam guardadas neste aparelho{:else if app.status.error}Não foi possível sincronizar: {app.status.error}{:else if app.status.pending}Enviando alterações…{/if}
          {#if app.status.pending} · {app.status.pending} por enviar{/if}
          {#if app.status.rejected}{#if !app.status.online || app.status.offline || app.status.error || app.status.pending} · {/if}<strong>{app.status.rejected} recusado(s) pelo servidor</strong> (veja em Mais){/if}
        </Banner>
      {/if}
      <Header title={TABS.find(([k]) => k === tab)[1]} />
      {#if waitingData}
        <Skeleton kind="row" count={2} />
        <p class="muted wait">Buscando seus dados… <Button variant="ghost" size="sm" onclick={startFresh}>Começar do zero</Button></p>
      {/if}
      {#if tab === 'month'}<Month />
      {:else if tab === 'accounts'}<Accounts />
      {:else if tab === 'categories'}<Categories />
      {:else}<More onlogout={logout} ondelete={deleteAccount} onreset={resetData} />{/if}
    </main>
    <div class="tabs"><TabBar label="Seções" tabs={tabbed} value={tab} onselect={(k) => (tab = k)} /></div>
  </div>
{/if}
<ConfirmHost />

<style>
  .shell main { max-width: 42rem; margin: 0 auto; padding: var(--space-4) var(--space-4) calc(var(--tabbar-h) + var(--space-16)); display: flex; flex-direction: column; gap: var(--space-4); }
  .center { max-width: 26rem; margin: 0 auto; padding: var(--space-12) var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
  .center p, .wait { margin: 0; }
  .tabs { position: fixed; left: 0; right: 0; bottom: 0; z-index: var(--z-tabbar); }
</style>
