// Action para sheets/diálogos: foca o primeiro campo ao abrir, prende o Tab dentro do diálogo,
// fecha com Escape e devolve o foco ao elemento que o abriu quando fecha.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function dialog(node, onclose) {
  const opener = document.activeElement;
  (node.querySelector('input, select, textarea') ?? node.querySelector('button:not([disabled])'))?.focus();
  const key = (e) => {
    if (e.key === 'Escape') return onclose();
    if (e.key !== 'Tab') return;
    const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) return e.preventDefault();
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  };
  node.addEventListener('keydown', key);
  return {
    update: (fn) => (onclose = fn),
    destroy: () => {
      node.removeEventListener('keydown', key);
      if (opener?.isConnected) opener.focus?.();
    },
  };
}
