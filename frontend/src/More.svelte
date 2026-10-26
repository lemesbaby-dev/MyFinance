<script>
  import { app, dismissRejected } from './lib/app.svelte.js';
  import { sync } from './lib/sync.js';

  let { onlogout } = $props();
  let busy = $state(false);

  const NAMES = { account: 'Conta', category: 'Categoria', recurrence: 'Recorrência', transaction: 'Lançamento' };
  const describe = (r) => {
    const doc = app[{ account: 'accounts', category: 'categories', recurrence: 'recurrences', transaction: 'transactions' }[r.kind]].find((x) => x.id === r.id);
    return `${NAMES[r.kind]}${doc?.name ?? doc?.description ? ` "${doc.name ?? doc.description}"` : ''}`;
  };

  async function now() {
    busy = true;
    try { await sync(); } finally { busy = false; }
  }
</script>

<section class="pad">
  <h2>Cartão de crédito <span class="badge">Em breve</span></h2>
  <p class="muted">Fatura com fechamento e vencimento, e compras entrando na fatura do ciclo. Por enquanto, lance compras parceladas na aba Mês.</p>
</section>

<section class="pad">
  <h2>Sincronização</h2>
  <p>
    {#if !app.status.online || app.status.offline}<span class="badge warn">Offline</span> Tudo continua funcionando; envio quando a rede voltar.
    {:else if app.status.syncing}Sincronizando…
    {:else if app.status.pending}<span class="badge warn">{app.status.pending} alteração(ões) por enviar</span>
    {:else}<span class="badge">Tudo sincronizado</span>{/if}
  </p>
  {#if app.status.error}<p class="err" role="alert">{app.status.error}</p>{/if}
  <button class="btn small ghost" onclick={now} disabled={busy}>Sincronizar agora</button>
</section>

{#if app.rejected.length}
  <section class="pad">
    <h2>Recusados pelo servidor</h2>
    <p class="muted small">Estas alterações não foram aceitas. Descarte para voltar ao que o servidor tem.</p>
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
