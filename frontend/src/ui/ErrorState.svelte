<script>
  import EmptyState from './EmptyState.svelte';
  // Erro de tela/lista com "Tentar de novo". Mensagem em tom calmo (voz do app), sem culpar o usuário.
  let { title = 'Não deu certo', text = '', retryLabel = 'Tentar de novo', onretry } = $props();
</script>

<EmptyState icon="alert" tone="danger" role="alert" {title} {text} actionLabel={onretry ? retryLabel : ''} onaction={onretry} />
