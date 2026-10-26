import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moneyText, centsFromInput } from './money.js';
import { confirmDialog, registerConfirmHost } from './confirm.js';
import { dialog } from '../lib/a11y.js';

const nb = (s) => s.replace(/ /g, ' ');

test('Money: sinal por tipo e negativo', () => {
  assert.equal(nb(moneyText(123456, 'income')), '+R$ 1.234,56');
  assert.equal(nb(moneyText(5000, 'expense')), '−R$ 50,00');
  assert.equal(nb(moneyText(5000, 'forecast')), 'R$ 50,00');
  assert.equal(nb(moneyText(-5000, 'neutral')), '−R$ 50,00');
  assert.equal(nb(moneyText(5000, 'expense', false)), 'R$ 50,00');
  assert.equal(nb(moneyText(null)), 'R$ 0,00');
});

test('MoneyInput: digitação em centavos', () => {
  assert.equal(centsFromInput('1'), 1);
  assert.equal(centsFromInput('R$ 0,12'), 12);
  assert.equal(centsFromInput('R$ 1.234,56'), 123456);
  assert.equal(centsFromInput(''), 0);
  assert.ok(centsFromInput('9'.repeat(20)) < 1e14); // teto do servidor
});

test('Confirm: resolve true/false; sem host nega', async () => {
  let last;
  const off = registerConfirmHost((opts, resolve) => { last = { opts, resolve }; });
  const p1 = confirmDialog({ title: 'Excluir?', danger: true });
  last.resolve(true);
  assert.equal(await p1, true);
  const p2 = confirmDialog({ title: 'Outra' });
  last.resolve(false);
  assert.equal(await p2, false);
  off();
  assert.equal(await confirmDialog({ title: 'sem host' }), false); // sem host nem confirm() nativo: nega
});

// ---- a11y do dialog (action): DOM falso mínimo, sem jsdom ----
function fakeDom() {
  const mk = (name) => ({ name, offsetParent: {}, focus() { doc.activeElement = this; } });
  const [a, b] = [mk('a'), mk('b')];
  const opener = { ...mk('opener'), isConnected: true };
  const doc = { activeElement: opener };
  globalThis.document = doc;
  const handlers = {};
  const node = {
    querySelector: (sel) => (sel.includes('data-autofocus') ? null : sel.includes('input') ? a : null) ?? null,
    querySelectorAll: () => [a, b],
    contains: (el) => el === a || el === b,
    addEventListener: (t, f) => (handlers[t] = f),
    removeEventListener: () => {},
  };
  return { doc, a, b, opener, node, key: (k, extra = {}) => { let prevented = false; handlers.keydown({ key: k, preventDefault: () => (prevented = true), ...extra }); return prevented; } };
}

test('dialog: foca ao abrir, Escape fecha, Tab prende, destroy devolve o foco', () => {
  const { doc, a, b, opener, node, key } = fakeDom();
  let closed = 0;
  const act = dialog(node, () => closed++);
  assert.equal(doc.activeElement, a);
  key('Escape');
  assert.equal(closed, 1);
  b.focus();
  assert.equal(key('Tab'), true); // do último volta ao primeiro
  assert.equal(doc.activeElement, a);
  assert.equal(key('Tab', { shiftKey: true }), true); // do primeiro volta ao último
  assert.equal(doc.activeElement, b);
  act.destroy();
  assert.equal(doc.activeElement, opener);
});
