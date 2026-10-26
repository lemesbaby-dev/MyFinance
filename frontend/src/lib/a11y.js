// Action para sheets/diálogos: foca o primeiro campo ao abrir e fecha com Escape.
export function dialog(node, onclose) {
  (node.querySelector('input, select, textarea') ?? node.querySelector('button:not([disabled])'))?.focus();
  const key = (e) => e.key === 'Escape' && onclose();
  node.addEventListener('keydown', key);
  return { update: (fn) => (onclose = fn), destroy: () => node.removeEventListener('keydown', key) };
}
