// API promise-based: `if (await confirmDialog({ title, message, danger })) ...`
// O host (ConfirmHost.svelte, montado uma vez no App) se registra aqui. Sem host cai no confirm() nativo.
let host = null;

export function registerConfirmHost(fn) {
  host = fn;
  return () => { if (host === fn) host = null; };
}

/** @param {{title: string, message?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean}} opts */
export function confirmDialog(opts) {
  return new Promise((resolve) => {
    if (host) host(opts, resolve);
    else resolve(globalThis.confirm?.(opts.message || opts.title) ?? false);
  });
}
