<script>
  import { ICONS } from './icons.js';
  // Decorativo por padrão (aria-hidden). Para ícone com significado, passe `label`.
  let { name, size = 'md', label = '' } = $props();
</script>

<svg class="ico {size}" viewBox="0 0 24 24" role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : 'true'}>{@html ICONS[name] ?? ''}</svg>

<style>
  .ico { width: 20px; height: 20px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
  .sm { width: 16px; height: 16px; }
  .lg { width: 28px; height: 28px; }
</style>
