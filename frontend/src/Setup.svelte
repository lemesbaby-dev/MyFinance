<script>
  import { api, loadConn, saveConn, isNative } from './lib/api.js';
  let { onsaved } = $props();
  const initial = loadConn();
  let url = $state(initial.url);
  let token = $state(initial.token);
  let error = $state('');
  let busy = $state(false);

  async function save(e) {
    e.preventDefault();
    busy = true; error = '';
    saveConn({ url: url.trim(), token: token.trim() });
    try {
      await api.health();
      await api.summary(); // valida o token também
      onsaved();
    } catch (err) {
      error = err.status === 401 ? 'Token incorreto.' : 'Não foi possível acessar o servidor. Confira o endereço.';
    } finally { busy = false; }
  }
</script>

<main>
  <h1>Conectar ao servidor</h1>
  <p class="muted">Informe onde sua API está rodando. Isso fica salvo só neste aparelho.</p>
  <form onsubmit={save}>
    <label class="field"><span>Endereço do servidor{isNative() ? '' : ' (deixe vazio para usar este site)'}</span>
      <input bind:value={url} placeholder="https://financas.exemplo.com.br" inputmode="url" autocapitalize="off" required={isNative()} /></label>
    <label class="field"><span>Token de acesso</span>
      <input bind:value={token} type="password" autocomplete="off" /></label>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <button class="btn" disabled={busy}>{busy ? 'Testando…' : 'Conectar'}</button>
  </form>
</main>

<style>
  main { max-width: 26rem; margin: 0 auto; padding: 3rem 1.25rem; }
  h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
</style>
