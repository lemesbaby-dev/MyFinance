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
      // O botão do Google é um iframe (CSS não alcança): casa com o tema pelas opções dele.
      const dark = document.documentElement.dataset.theme === 'dark'
        || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
      google.accounts.id.renderButton(btn, {
        theme: dark ? 'filled_black' : 'outline', size: 'large', shape: 'pill', text: 'continue_with', locale: 'pt-BR',
        width: Math.min(400, Math.max(200, btn.clientWidth)),
      });
    } catch (e) {
      error = e.message;
    }
  });
</script>

<main>
  <img class="logo" src="/icon.svg" alt="" width="64" height="64" />
  <Header title="MyFinance" />
  <p class="lead">Seu dinheiro em ordem, sem complicação.</p>
  <div bind:this={btn} class="gbtn"></div>
  {#if error}<Banner tone="danger" icon="alert">{error}</Banner>{/if}
  <p class="note">Primeira vez por aqui? É só entrar: sua conta é criada na hora.</p>
  <p class="note">Seus dados são só seus: nenhuma outra conta tem acesso a eles. Pedimos ao Google apenas seu nome e e-mail.</p>
</main>

<style>
  main { max-width: 22rem; margin: 0 auto; padding: var(--space-16) var(--space-4); display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--space-3); }
  p { margin: 0; }
  .logo { border-radius: var(--radius-2); box-shadow: var(--shadow-soft); margin-bottom: var(--space-2); }
  main :global(h1) { font-size: var(--fs-6); }
  .lead { font: var(--fw-medium) var(--fs-3)/var(--lh-body) var(--font-text); color: var(--text-body); }
  /* O botão do Google é um iframe de documento claro: com o app em color-scheme dark o navegador pinta um
     fundo branco opaco atrás dele. Declarar light aqui deixa o iframe transparente. */
  .gbtn { width: 100%; margin: var(--space-4) 0 var(--space-2); min-height: var(--tap); display: flex; justify-content: center; color-scheme: light; }
  .note { font: var(--fw-medium) var(--fs-2)/var(--lh-body) var(--font-text); color: var(--text-muted); }
</style>
