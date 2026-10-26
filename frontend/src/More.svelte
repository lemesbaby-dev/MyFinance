<script>
  import { app, dismissRejected } from './lib/app.svelte.js';
  import { sync } from './lib/sync.js';
  import { api } from './lib/api.js';

  import { onMount } from 'svelte';

  let { onlogout, ondelete } = $props();
  let busy = $state(false);
  let canPrompt = $state(!!window.__installPrompt);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);

  onMount(() => {
    const on = () => (canPrompt = !!window.__installPrompt);
    window.addEventListener('installable', on);
    return () => window.removeEventListener('installable', on);
  });

  async function install() {
    const e = window.__installPrompt;
    window.__installPrompt = null;
    canPrompt = false;
    await e?.prompt();
  }

  const NAMES = { account: 'Conta', category: 'Categoria', recurrence: 'Recorrência', transaction: 'Lançamento' };
  const describe = (r) => {
    const doc = app[{ account: 'accounts', category: 'categories', recurrence: 'recurrences', transaction: 'transactions' }[r.kind]].find((x) => x.id === r.id);
    const name = doc?.name ?? doc?.description ?? r.label; // excluído em outro aparelho: o rótulo foi guardado com o recusado
    return `${NAMES[r.kind]}${name ? ` "${name}"` : ''}`;
  };

  // Exportar e excluir a conta (LGPD): o servidor é a fonte; precisa de rede.
  let dataError = $state('');
  let deleting = $state(false);
  let confirmEmail = $state('');
  let dataBusy = $state(false);

  async function exportData() {
    dataBusy = true; dataError = '';
    try {
      const data = await api.exportData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: 'financas-export.json' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { dataError = e.message; } finally { dataBusy = false; }
  }

  async function removeAccount(e) {
    e.preventDefault();
    dataBusy = true; dataError = '';
    try { await ondelete(confirmEmail.trim()); } catch (err) { dataError = err.message; } finally { dataBusy = false; }
  }

  async function now() {
    busy = true;
    try { await sync(); } finally { busy = false; }
  }
</script>

<section class="pad">
  <h2>Cartão de crédito <span class="badge">Em breve</span></h2>
  <p class="muted">Fatura com fechamento e vencimento, e compras entrando na fatura do ciclo. Por enquanto, lance compras parceladas na aba Mês.</p>
</section>

{#if !standalone && (canPrompt || ios)}
  <section class="pad">
    <h2>Instalar o app</h2>
    {#if canPrompt}
      <p class="muted">Instale na tela inicial para abrir como um app, mesmo sem internet.</p>
      <button class="btn small" onclick={install}>Instalar</button>
    {:else}
      <p class="muted">No Safari: toque em Compartilhar e escolha <strong>Adicionar à Tela de Início</strong>. Instalado, o iPhone não apaga seus dados locais por falta de uso.</p>
    {/if}
  </section>
{/if}

<section class="pad">
  <h2>Sincronização</h2>
  <p>
    {#if !app.status.online || app.status.offline}<span class="badge warn">Offline</span> Tudo continua funcionando; envio quando a rede voltar.
    {:else if app.status.syncing}Sincronizando…
    {:else if app.status.pending}<span class="badge warn">{app.status.pending} alteração(ões) por enviar</span>
    {:else}<span class="badge">Tudo sincronizado</span>{/if}
  </p>
  {#if app.status.error}<p class="err" role="alert">{app.status.error}</p>{/if}
  {#if app.persisted === false}<p class="muted small">O navegador pode apagar os dados locais se faltar espaço. Instale o app e mantenha a sincronização em dia.</p>{/if}
  <button class="btn small ghost" onclick={now} disabled={busy}>Sincronizar agora</button>
</section>

{#if app.rejected.length}
  <section class="pad">
    <h2>Recusados pelo servidor ({app.rejected.length})</h2>
    <p class="muted small">Estas alterações não foram aceitas e não entram nos saldos. Descarte para voltar ao que o servidor tem, ou edite o item e salve de novo.</p>
    <ul class="rows">
      {#each app.rejected as r, i (i)}
        <li>
          <div class="grow"><strong>{describe(r)}</strong><span class="muted small">{r.error}</span></div>
          <button class="btn small ghost" onclick={() => dismissRejected(i)}>Descartar</button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section class="pad">
  <h2>Conta</h2>
  <p class="muted">{app.user?.email ?? ''}</p>
  <button class="btn ghost" onclick={onlogout}>Sair</button>
</section>

<section class="pad">
  <h2>Seus dados</h2>
  <p class="muted small">Baixe uma cópia de tudo que está no servidor ou apague sua conta de vez. Precisa de internet.</p>
  <p><button class="btn small ghost" onclick={exportData} disabled={dataBusy}>Exportar meus dados</button></p>
  {#if !deleting}
    <button class="btn small ghost" onclick={() => (deleting = true)}>Excluir minha conta</button>
  {:else}
    <form onsubmit={removeAccount}>
      <p class="muted small">Isto apaga sua conta e todos os seus dados, neste aparelho e no servidor, e não tem volta. Para confirmar, digite seu e-mail ({app.user?.email}).</p>
      <label class="field"><span>E-mail</span><input type="email" bind:value={confirmEmail} autocomplete="off" required /></label>
      <div class="actions">
        <button type="button" class="btn ghost" onclick={() => { deleting = false; confirmEmail = ''; }}>Cancelar</button>
        <button class="btn" disabled={dataBusy || confirmEmail.trim().toLowerCase() !== (app.user?.email ?? '').toLowerCase()}>Excluir para sempre</button>
      </div>
    </form>
  {/if}
  {#if dataError}<p class="err" role="alert">{dataError}</p>{/if}
</section>
