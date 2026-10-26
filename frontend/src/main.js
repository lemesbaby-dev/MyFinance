import '@fontsource-variable/instrument-sans';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Chrome/Android avisa que dá para instalar; guardamos o evento para o botão "Instalar" (aba Mais).
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__installPrompt = e;
  window.dispatchEvent(new Event('installable'));
});

export default mount(App, { target: document.getElementById('app') });
