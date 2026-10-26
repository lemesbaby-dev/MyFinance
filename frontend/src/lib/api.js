// Cliente da API. No navegador servido pelo Go, a base é a mesma origem ('').
// `token` é a sessão emitida pelo servidor após o login com Google; `userId` é de quem ela é
// (lib/session.js só grava os dois depois de conferir a cópia local).
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
export const clearSession = () => saveConn({ ...loadConn(), token: '', userId: '' });

// 401 tratado num lugar só: limpa a sessão e avisa quem se registrou (App.svelte).
let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

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
  if (res.status === 401 && token) {
    clearSession();
    onUnauthorized?.();
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erro ${res.status}`);
  return data;
}

export const api = {
  authConfig: () => call('GET', '/api/auth/config'),
  loginGoogle: (id_token) => call('POST', '/api/auth/google', { id_token, device: navigator.userAgent.slice(0, 80) }),
  me: () => call('GET', '/api/auth/me'),
  push: (ops) => call('POST', '/api/sync', { ops }),
  pull: (since) => call('GET', `/api/sync?since=${since}`),
  logout: () => call('POST', '/api/auth/logout', {}),
  exportData: () => call('GET', '/api/export?format=json'),
  deleteAccount: (confirm_email) => call('DELETE', '/api/account', { confirm_email }),
};
