<script>
  import { onMount } from 'svelte';
  import { api, loadConn, saveConn } from './lib/api.js';
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
      saveConn({ ...loadConn(), token });
      onlogin(user);
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
  <h1>Finanças</h1>
  <p class="muted">Entre com sua conta Google. Seus dados ficam separados dos de outras pessoas.</p>
  <div bind:this={btn} class="gbtn"></div>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
</main>

<style>
  main { max-width: 26rem; margin: 0 auto; padding: 3rem 1.25rem; }
  h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
  .gbtn { margin: 1.5rem 0; min-height: 44px; }
</style>
