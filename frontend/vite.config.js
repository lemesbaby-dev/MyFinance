import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ compilerOptions: { discloseVersion: false } })],
  // Alvo ES2022 (Safari 15.4+/Chrome 94+, PWA moderno): sem down-level de campos de classe etc.; sem polyfill de modulepreload.
  build: { target: 'es2022', modulePreload: { polyfill: false } },
  server: {
    // em dev, as chamadas /api vão para o Go local
    proxy: { '/api': 'http://localhost:8080' },
  },
});
