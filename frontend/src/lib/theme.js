// Tema e modo daltônico: só gravam preferência e põem data-theme / data-cvd no <html>; o CSS reage (tokens.css).
// Mesma lógica do public/theme-init.js (que roda antes do CSS para não piscar).
const LIGHT = '#FFF6EC', DARK = '#17110D'; // = --surface-page claro/escuro

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* sem storage: vale só nesta sessão */ } };

export const getTheme = () => { const t = read('mf.theme'); return t === 'light' || t === 'dark' ? t : 'system'; };
export const getCvd = () => read('mf.cvd') === 'on';

export function applyTheme(root = document.documentElement) {
  const t = getTheme();
  if (t === 'system') delete root.dataset.theme; else root.dataset.theme = t;
  if (getCvd()) root.dataset.cvd = 'on'; else delete root.dataset.cvd;
  // barra do navegador: tema explícito vale nos dois <meta>; "sistema" devolve cada um ao seu media
  for (const m of root.ownerDocument.querySelectorAll('meta[name="theme-color"]')) {
    m.content = t === 'system' ? (/dark/.test(m.media) ? DARK : LIGHT) : t === 'dark' ? DARK : LIGHT;
  }
}

export function setTheme(t, root) { write('mf.theme', t === 'light' || t === 'dark' ? t : null); applyTheme(root); }
export function setCvd(on, root) { write('mf.cvd', on ? 'on' : null); applyTheme(root); }
