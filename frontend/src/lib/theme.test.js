import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTheme, getCvd, setTheme, setCvd, applyTheme } from './theme.js';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const root = { dataset: {}, ownerDocument: { querySelectorAll: () => [] } };

test('tema e daltonismo: gravam, aplicam no <html> e "sistema" remove o atributo', () => {
  assert.equal(getTheme(), 'system');
  setTheme('dark', root); assert.equal(root.dataset.theme, 'dark'); assert.equal(store.get('mf.theme'), 'dark');
  setCvd(true, root); assert.equal(root.dataset.cvd, 'on'); assert.equal(getCvd(), true);
  setTheme('system', root); assert.equal(root.dataset.theme, undefined); assert.equal(store.has('mf.theme'), false);
  setCvd(false, root); assert.equal(root.dataset.cvd, undefined); assert.equal(store.has('mf.cvd'), false);
});

test('valor inválido ou storage quebrado cai no padrão', () => {
  store.set('mf.theme', 'roxo');
  assert.equal(getTheme(), 'system');
  globalThis.localStorage = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  assert.doesNotThrow(() => { setTheme('light', root); applyTheme(root); });
  assert.equal(getCvd(), false);
});
