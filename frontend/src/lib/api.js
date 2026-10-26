// Cliente da API. No navegador servido pelo Go, a base é a mesma origem ('').
// `token` é a sessão emitida pelo servidor após o login com Google.
const KEY = 'financas.conn';

export function loadConn() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? { url: '', token: '' };
  } catch {
    return { url: '', token: '' };
  }
}
export const saveConn = (c) => localStorage.setItem(KEY, JSON.stringify(c));
export const hasSession = () => !!loadConn().token;
export const clearSession = () => saveConn({ ...loadConn(), token: '' });

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
  authConfig: () => call('GET', '/api/auth/config'),
  loginGoogle: (id_token) => call('POST', '/api/auth/google', { id_token, device: navigator.userAgent.slice(0, 80) }),
  me: () => call('GET', '/api/auth/me'),
  logout: () => call('POST', '/api/auth/logout', {}),
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
