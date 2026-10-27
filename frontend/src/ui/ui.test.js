import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moneyText, centsFromInput, signCents } from './money.js';
import { confirmDialog, registerConfirmHost } from './confirm.js';
import { dialog } from '../lib/a11y.js';
import { monthGrid } from '../lib/finance.js';

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

test('MoneyInput: sinal negativo; zero nunca vira -0', () => {
  assert.equal(signCents(5000, true), -5000);
  assert.equal(signCents(5000, false), 5000);
  assert.ok(Object.is(signCents(0, true), 0));
  assert.equal(centsFromInput('-R$ 50,00'), 5000); // o '-' do texto não conta como dígito
});

test('monthGrid: 42 dias, começa no domingo, contém o mês inteiro', () => {
  const g = monthGrid('2026-10'); // 01/10/2026 é quinta
  assert.equal(g.length, 42);
  assert.equal(g[0], '2026-09-27');
  assert.ok(g.includes('2026-10-01') && g.includes('2026-10-31'));
  assert.equal(monthGrid('2026-02')[0], '2026-02-01'); // 01/02/2026 é domingo: sem dias do mês anterior
});

test('monthGrid: extremos 1900-01 e 2200-12 não lançam; vizinhos fora do intervalo viram null', () => {
  const a = monthGrid('1900-01'); // 01/01/1900 é segunda: domingo anterior é 1899
  assert.equal(a.length, 42);
  assert.equal(a[0], null);
  assert.equal(a[1], '1900-01-01');
  const b = monthGrid('2200-12'); // sábado 1 + 41 dias entram em 2201
  assert.equal(b.length, 42);
  assert.ok(b.includes('2200-12-31') && b.at(-1) === null);
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

// ---- compostos (Fase 3): lógica pura ----
import { pct, catIndex, trailPct, rowState, nextIndex, menuSide, STATE_META } from './logic.js';
import { toast, dismissToast, subscribeToast, _resetToasts } from './toast.js';

test('barras: pct relativo, limites e entradas inválidas', () => {
  assert.equal(pct(50, 200), 25);
  assert.equal(pct(1, 3), 33.3);
  assert.equal(pct(300, 200), 100);
  assert.equal(pct(0, 200), 0);
  assert.equal(pct(5, 0), 0);
  assert.equal(pct(-5, 10), 0);
});

test('categoria: índice cai sempre em 1..10', () => {
  assert.deepEqual([0, 1, 10, 11, 23, -1, undefined].map(catIndex), [1, 1, 10, 1, 3, 9, 1]);
});

test('trilha: parte efetivada do movimento; sem movimento = 0', () => {
  assert.equal(trailPct(25000, 75000), 25);
  assert.equal(trailPct(-300, 100), 75); // usa módulo: despesas efetivadas contam
  assert.equal(trailPct(0, 0), 0);
  assert.equal(trailPct(100, 0), 100);
});

test('ListRow: estado efetivado > atrasado > pendente; todo estado tem ícone e rótulo', () => {
  assert.equal(rowState({ paid: true, date: '2020-01-01', today: '2026-10-26' }), 'paid');
  assert.equal(rowState({ paid: false, date: '2026-10-25', today: '2026-10-26' }), 'overdue');
  assert.equal(rowState({ paid: false, date: '2026-10-26', today: '2026-10-26' }), 'pending');
  assert.equal(rowState({ paid: false }), 'pending');
  for (const s of Object.values(STATE_META)) assert.ok(s.icon && s.label);
});

test('Menu: navegação circular por teclado e abertura para cima só se precisar', () => {
  assert.equal(nextIndex(0, 'ArrowUp', 3), 2);
  assert.equal(nextIndex(2, 'ArrowDown', 3), 0);
  assert.equal(nextIndex(1, 'Home', 3), 0);
  assert.equal(nextIndex(0, 'End', 3), 2);
  assert.equal(nextIndex(0, 'ArrowDown', 0), -1);
  assert.equal(menuSide({ top: 100, bottom: 144 }, 150, 800), 'down');
  assert.equal(menuSide({ top: 700, bottom: 744 }, 150, 800), 'up');
  assert.equal(menuSide({ top: 20, bottom: 64 }, 150, 100), 'down'); // sem espaço em cima também: fica embaixo
});

test('Toast: fila FIFO, um por vez, teto de 5, dismiss avança', () => {
  _resetToasts();
  const seen = [];
  const off = subscribeToast((t) => seen.push(t?.msg ?? null));
  const a = toast('a'); toast('b');
  assert.equal(seen.at(-1), 'a');
  dismissToast(a);
  assert.equal(seen.at(-1), 'b');
  dismissToast(9999); // id inexistente: nada
  _resetToasts();
  for (let i = 0; i < 9; i++) toast(`m${i}`);
  assert.equal(seen.at(-1), 'm0'); // o que já aparecia é preservado
  assert.ok(toast('x') > a);
  off();
  _resetToasts();
});

import { groupByDate, catOf, catMap } from './logic.js';
test('catMap: até 9 categorias nunca repetem cor e nenhuma usa a 10', () => {
  const ids = ['k', 'a', 'z', 'b', 'q', 'c', 'm', 'd', 'x'];
  const m = catMap(ids);
  assert.equal(new Set(ids.map((id) => catOf(id, m))).size, 9);
  assert.ok(ids.every((id) => catOf(id, m) <= 9));
});
test('groupByDate agrupa dias consecutivos; catOf é estável e 1..9', () => {
  const g = groupByDate([{ date: 'a', id: 1 }, { date: 'a', id: 2 }, { date: 'b', id: 3 }]);
  assert.deepEqual(g.map((x) => [x.date, x.items.length]), [['a', 2], ['b', 1]]);
  assert.deepEqual(groupByDate([]), []);
  for (const id of ['x', 'abc-123', '', null]) { const n = catOf(id); assert.ok(n >= 1 && n <= 9); assert.equal(n, catOf(id)); }
});
