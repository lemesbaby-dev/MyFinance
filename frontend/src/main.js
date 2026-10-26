import '@fontsource-variable/instrument-sans';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.Capacitor?.isNativePlatform?.()) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

export default mount(App, { target: document.getElementById('app') });
