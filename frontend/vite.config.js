import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    // em dev, as chamadas /api vão para o Go local
    proxy: { '/api': 'http://localhost:8080' },
  },
});
