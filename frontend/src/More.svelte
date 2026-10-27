<script>
  import { app, dismissRejected } from './lib/app.svelte.js';
  import { sync } from './lib/sync.js';
  import { api } from './lib/api.js';
  import { getTheme, getCvd, setTheme, setCvd } from './lib/theme.js';
  import Card from './ui/Card.svelte';
  import Segmented from './ui/Segmented.svelte';
  import Switch from './ui/Switch.svelte';
  import Button from './ui/Button.svelte';
  import Badge from './ui/Badge.svelte';
  import Banner from './ui/Banner.svelte';
  import TextInput from './ui/TextInput.svelte';
  import { confirmDialog } from './ui/confirm.js';

  import { onMount } from 'svelte';

  let { onlogout, ondelete, onreset } = $props();
  let theme = $state(getTheme());
  let cvd = $state(getCvd());
  const THEMES = [['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Escuro']];
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

  async function resetData() {
    if (!(await confirmDialog({ title: 'Começar do zero?', message: 'Apaga todas as suas contas, categorias, recorrências e lançamentos, neste aparelho e no servidor, e não tem volta. Sua conta de acesso continua. Outro aparelho com alterações ainda não enviadas pode recriar parte dos dados quando voltar a ficar online: sincronize os demais antes. Se quiser guardar uma cópia, exporte seus dados antes.', danger: true, confirmLabel: 'Apagar tudo' }))) return;
    dataBusy = true; dataError = '';
    try { await onreset(); } catch (err) { dataError = err.message; } finally { dataBusy = false; }
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

<section class="sec">
  <h2>Aparência</h2>
  <Card>
    <div class="stack">
      <Segmented label="Tema" options={THEMES} bind:value={theme} onchange={setTheme} />
      <div class="opt">
        <div class="grow"><strong id="cvd-l">Cores para daltonismo</strong><span class="muted small">Usa uma paleta separável por luminância e matiz azul-laranja</span></div>
        <Switch bind:checked={cvd} labelledby="cvd-l" onchange={setCvd} />
      </div>
    </div>
  </Card>
</section>

<section class="sec">
  <h2>Cartão de crédito <Badge tone="brand">Em breve</Badge></h2>
  <p class="muted">Fatura com fechamento e vencimento, e compras entrando na fatura do ciclo. Por enquanto, lance compras parceladas na aba Mês.</p>
</section>

{#if !standalone && (canPrompt || ios)}
  <section class="sec">
    <h2>Instalar o app</h2>
    {#if canPrompt}
      <p class="muted">Instale na tela inicial para abrir como um app, mesmo sem internet.</p>
      <div><Button onclick={install}>Instalar</Button></div>
    {:else}
      <p class="muted">No Safari: toque em Compartilhar e escolha <strong>Adicionar à Tela de Início</strong>. Instalado, o iPhone não apaga seus dados locais por falta de uso.</p>
    {/if}
  </section>
{/if}

<section class="sec">
  <h2>Sincronização</h2>
  {#if !app.status.online || app.status.offline}<Banner icon="cloud-off">Offline. Tudo continua funcionando; envio quando a rede voltar.</Banner>
  {:else if app.status.syncing}<Banner icon="refresh">Sincronizando…</Banner>
  {:else if app.status.pending}<Banner tone="warn" icon="clock">{app.status.pending} alteração(ões) por enviar</Banner>
  {:else}<Banner icon="check">Tudo sincronizado</Banner>{/if}
  {#if app.status.error}<Banner tone="danger" icon="alert">{app.status.error}</Banner>{/if}
  {#if app.persisted === false}<p class="muted small">O navegador pode apagar os dados locais se faltar espaço. Instale o app e mantenha a sincronização em dia.</p>{/if}
  <div><Button variant="secondary" onclick={now} loading={busy}>Sincronizar agora</Button></div>
</section>

{#if app.rejected.length}
  <section class="sec">
    <h2>Recusados pelo servidor ({app.rejected.length})</h2>
    <p class="muted small">Estas alterações não foram aceitas e não entram nos saldos. Descarte para voltar ao que o servidor tem, ou edite o item e salve de novo.</p>
    <Card pad={false}>
      <ul>
        {#each app.rejected as r, i (i)}
          <li>
            <div class="grow"><strong>{describe(r)}</strong><span class="muted small">{r.error}</span></div>
            <Button variant="secondary" size="sm" onclick={() => dismissRejected(i)}>Descartar</Button>
          </li>
        {/each}
      </ul>
    </Card>
  </section>
{/if}

<section class="sec">
  <h2>Conta</h2>
  <p class="muted">{app.user?.email ?? ''}</p>
  <div><Button variant="secondary" onclick={onlogout}>Sair</Button></div>
</section>

<section class="sec">
  <h2>Seus dados</h2>
  <p class="muted small">Baixe uma cópia de tudo que está no servidor, recomece com a conta vazia ou apague sua conta de vez. Precisa de internet.</p>
  <div><Button variant="secondary" onclick={exportData} disabled={dataBusy}>Exportar meus dados</Button></div>
  <div><Button variant="danger" onclick={resetData} disabled={dataBusy}>Começar do zero</Button></div>
  {#if !deleting}
    <div><Button variant="danger" onclick={() => (deleting = true)}>Excluir minha conta</Button></div>
  {:else}
    <form onsubmit={removeAccount}>
      <p class="muted small">Isto apaga sua conta e todos os seus dados, neste aparelho e no servidor, e não tem volta. Para confirmar, digite seu e-mail ({app.user?.email}).</p>
      <TextInput label="E-mail" type="email" bind:value={confirmEmail} autocomplete="off" />
      <div class="actions">
        <Button variant="secondary" onclick={() => { deleting = false; confirmEmail = ''; }}>Cancelar</Button>
        <Button variant="danger" type="submit" disabled={dataBusy || confirmEmail.trim().toLowerCase() !== (app.user?.email ?? '').toLowerCase()}>Excluir para sempre</Button>
      </div>
    </form>
  {/if}
  {#if dataError}<Banner tone="danger" icon="alert">{dataError}</Banner>{/if}
</section>

<style>
  .sec { display: flex; flex-direction: column; gap: var(--space-3); }
  .sec p { margin: 0; }
  .stack { display: flex; flex-direction: column; gap: var(--space-4); }
  .opt { display: flex; align-items: center; gap: var(--space-3); }
  .grow { flex: 1; display: grid; gap: var(--space-1); min-width: 0; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; align-items: center; gap: var(--space-3); padding: var(--row-pad); }
  li + li { border-top: var(--bw-1) solid var(--border-subtle); }
  form { display: flex; flex-direction: column; gap: var(--space-3); }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
</style>
