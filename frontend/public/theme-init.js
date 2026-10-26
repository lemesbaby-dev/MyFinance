// Roda síncrono no <head>, antes do CSS: evita piscar o tema/paleta errados. Externo porque a CSP não aceita script inline.
// Mesma regra de src/lib/theme.js.
try {
  var d = document.documentElement, t = localStorage.getItem('mf.theme'), c = localStorage.getItem('mf.cvd');
  if (t === 'light' || t === 'dark') d.dataset.theme = t;
  if (c === 'on') d.dataset.cvd = 'on';
} catch (e) { /* sem storage: segue o sistema */ }
