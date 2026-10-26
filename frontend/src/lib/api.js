// Cliente da API. No navegador servido pelo Go, a base é a mesma origem ('').
// No APK (Capacitor) é preciso informar a URL do servidor na primeira abertura.
const KEY = 'financas.conn';

export const isNative = () => !!window.Capacitor?.isNativePlatform?.();

export function loadConn() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? { url: '', token: '' };
  } catch {
    return { url: '', token: '' };
  }
}
export const saveConn = (c) => localStorage.setItem(KEY, JSON.stringify(c));
export const needsSetup = () => isNative() && !loadConn().url;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(method, path, body) {
  const { url, token } = loadConn();
  let res;
  try {
    res = await fetch(url.replace(/\/$/, '') + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erro ${res.status}`);
  return data;
}

export const api = {
  health: () => call('GET', '/api/health'),
  summary: (until) => call('GET', '/api/summary' + (until ? `?until=${until}` : '')),
  categories: () => call('GET', '/api/categories'),
  transactions: (q = {}) => call('GET', '/api/transactions?' + new URLSearchParams(q)),
  createTransaction: (t) => call('POST', '/api/transactions', t),
  pay: (id) => call('POST', `/api/transactions/${id}/pay`, {}),
  unpay: (id) => call('POST', `/api/transactions/${id}/unpay`),
  remove: (id) => call('DELETE', `/api/transactions/${id}`),
  createRecurrence: (r) => call('POST', '/api/recurrences', r),
  createAccount: (a) => call('POST', '/api/accounts', a),
  createCategory: (c) => call('POST', '/api/categories', c),
};
