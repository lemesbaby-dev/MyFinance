<script>
  import { onMount } from 'svelte';
  import { api } from './lib/api.js';
  import { accept } from './lib/session.js';
  import Header from './ui/Header.svelte';
  import Banner from './ui/Banner.svelte';
  let { onlogin } = $props();
  let error = $state('');
  let btn;

  // Google Identity Services: o botão devolve um ID token (JWT) que o servidor valida.
  const loadGsi = () =>
    new Promise((ok, fail) => {
      if (window.google?.accounts?.id) return ok();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = ok;
      s.onerror = () => fail(new Error('Sem conexão: o login com Google precisa de internet.'));
      document.head.appendChild(s);
    });

  async function onCredential({ credential }) {
    error = '';
    try {
      const { token, user } = await api.loginGoogle(credential);
      // O token só é gravado depois de conferir a cópia local deste aparelho (session.js).
      onlogin(user, await accept(token, user));
    } catch (e) {
      error = e.message;
    }
  }

  onMount(async () => {
    try {
      const { google_client_id } = await api.authConfig();
      if (!google_client_id) throw new Error('Servidor sem GOOGLE_CLIENT_ID configurado.');
      await loadGsi();
      google.accounts.id.initialize({ client_id: google_client_id, callback: onCredential });
      google.accounts.id.renderButton(btn, { theme: 'outline', size: 'large', text: 'signin_with', locale: 'pt-BR' });
    } catch (e) {
      error = e.message;
    }
  });
</script>

<main>
  <Header title="Finanças" />
  <p class="muted">Entre com sua conta Google. Seus dados ficam separados dos de outras pessoas.</p>
  <div bind:this={btn} class="gbtn"></div>
  {#if error}<Banner tone="danger" icon="alert">{error}</Banner>{/if}
</main>

<style>
  main { max-width: 26rem; margin: 0 auto; padding: var(--space-12) var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
  p { margin: 0; }
  .gbtn { margin: var(--space-4) 0; min-height: var(--tap); }
</style>
