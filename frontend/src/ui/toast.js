// Fila de toasts: `toast('Salvo')`. O host único (ToastHost, montado no App) mostra o primeiro e chama dismissToast.
// Sem host a fila fica limitada (nada vaza). Um por vez: os demais esperam.
const MAX = 5;
let queue = [];
let seq = 0;
const subs = new Set();
const emit = () => subs.forEach((f) => f(queue[0] ?? null));

/** @param {string} msg @param {{tone?: 'info'|'ok'|'warn', actionLabel?: string, onaction?: () => void, ms?: number}} [opts] ms=0: fica até dispensar. */
export function toast(msg, opts = {}) {
  const t = { id: ++seq, msg, tone: 'info', ms: opts.actionLabel ? 8000 : 4000, ...opts };
  queue.push(t);
  if (queue.length > MAX) queue.splice(1, 1); // descarta o mais antigo que ainda não apareceu
  emit();
  return t.id;
}

export function dismissToast(id) {
  const i = queue.findIndex((t) => t.id === id);
  if (i < 0) return;
  queue.splice(i, 1);
  emit();
}

export function subscribeToast(fn) {
  subs.add(fn);
  fn(queue[0] ?? null);
  return () => subs.delete(fn);
}

export const _resetToasts = () => { queue = []; emit(); };
