// Lógica pura dos compostos (testada em ui.test.js): sem DOM, sem Svelte.
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

/** Percentual de `value` sobre `max`, 0..100, 1 casa. Barras de categoria (largura) e participação (rótulo). */
export function pct(value, max) {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.round(clamp((value / max) * 100, 0, 100) * 10) / 10;
}

/** Índice de cor de categoria 1..10 (--cat-N). Qualquer inteiro cai na paleta; 0/inválido -> 1. */
export const catIndex = (n) => ((((Math.trunc(n) || 1) - 1) % 10) + 10) % 10 + 1;

/** Quanto do caminho "hoje -> previsto" já foi efetivado: done/(done+todo), 0..100. Sem movimento previsto = 0. */
export function trailPct(done, todo) {
  const d = Math.abs(done ?? 0), t = Math.abs(todo ?? 0);
  return pct(d, d + t);
}

/** Estado de uma linha: efetivado, atrasado (vencido e não efetivado) ou pendente. Datas ISO (aaaa-mm-dd) comparam como texto. */
export function rowState({ paid, date, today }) {
  if (paid) return 'paid';
  return date && today && date < today ? 'overdue' : 'pending';
}
// Nunca só cor: todo estado tem ícone + rótulo.
export const STATE_META = {
  paid: { icon: 'check', label: 'Efetivado', tone: 'settled' },
  pending: { icon: 'clock', label: 'Pendente', tone: 'pending' },
  overdue: { icon: 'alert', label: 'Atrasado', tone: 'overdue' },
};

/** Próximo item do menu por tecla (roving focus). */
export function nextIndex(i, key, n) {
  if (!n) return -1;
  if (key === 'ArrowDown') return (i + 1) % n;
  if (key === 'ArrowUp') return (i - 1 + n) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return i;
}

/** Abre para cima só se não couber embaixo e couber em cima. rect = {top, bottom} do gatilho. */
export const menuSide = (rect, menuH, vh) => (rect.bottom + menuH > vh && rect.top > menuH ? 'up' : 'down');
