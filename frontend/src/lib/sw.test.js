// Roda public/sw.js num sandbox com Cache API falsa: o casco só é sobrescrito por HTML que cita /assets/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function load() {
  const cache = new Map();
  const listeners = {};
  const net = { res: null };
  const box = {
    URL, Response, Promise, setTimeout, console,
    location: { origin: 'https://app.x' },
    caches: {
      open: async () => ({
        match: async (k) => cache.get(typeof k === 'string' ? k : new URL(k.url).pathname)?.clone(),
        put: async (k, r) => void cache.set(typeof k === 'string' ? k : new URL(k.url).pathname, r),
        addAll: async () => {}, add: async () => {},
      }),
      keys: async () => [], delete: async () => true,
    },
    fetch: async () => net.res.clone(),
    self: { addEventListener: (n, f) => (listeners[n] = f), skipWaiting() {}, clients: { claim() {} } },
  };
  vm.runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), box);
  const navigate = async () => {
    let out, waits = [];
    listeners.fetch({
      request: { method: 'GET', url: 'https://app.x/', mode: 'navigate' },
      respondWith: (p) => (out = p), waitUntil: (p) => waits.push(p),
    });
    const res = await out;
    await Promise.all(waits);
    return res;
  };
  return { cache, net, navigate, listeners };
}

const html = (body, type = 'text/html; charset=utf-8') => new Response(body, { headers: { 'content-type': type } });

test('sw: navegação com HTML do app entra no cache; portal cativo e não-HTML não sobrescrevem o casco', async () => {
  const sw = load();
  sw.net.res = html('<script src="/assets/index-1.js"></script>');
  await sw.navigate();
  assert.match(await sw.cache.get('/').clone().text(), /assets\/index-1/);

  sw.net.res = html('<html>Faça login no wifi do hotel</html>'); // portal cativo: 200, HTML, sem /assets/
  const res = await sw.navigate();
  assert.match(await res.text(), /wifi do hotel/, 'a página é entregue ao usuário');
  assert.match(await sw.cache.get('/').clone().text(), /assets\/index-1/, 'mas o casco guardado continua o do app');

  sw.net.res = html('{"x":"/assets/"}', 'application/json');
  await sw.navigate();
  assert.match(await sw.cache.get('/').clone().text(), /assets\/index-1/, 'JSON citando /assets/ também não entra');
});

test('sw: cache v3', () => {
  assert.match(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), /financas-shell-v3/);
});
