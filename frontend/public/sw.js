// Service worker: guarda o "casco" do app (HTML, JS, CSS, fontes, ícones) para abrir sem rede.
// Os DADOS ficam no IndexedDB do app; /api/ NUNCA passa por aqui (saldo velho é pior que erro).
//
//  - instalação: baixa "/" e tudo que ele referencia (JS/CSS e as fontes citadas nos CSS), para o app abrir
//    offline já na primeira visita (sem isso, os arquivos carregados antes do SW existir ficariam de fora).
//  - /assets/* (nome com hash, imutável): cache primeiro; o que faltar é baixado e guardado.
//  - páginas e demais arquivos: rede primeiro, com limite de 3 s (wifi sem internet não trava), depois cache.
//    A navegação só entra no cache se for HTML e citar /assets/ (um portal cativo ou página de erro
//    não pode sobrescrever o casco do app).
//  Mudou a lógica deste arquivo? Suba o número em CACHE: a ativação apaga os caches antigos.
// ponytail: arquivos /assets/ de versões antigas ficam no cache até o próximo bump de CACHE (poucas centenas de KB).
const CACHE = 'financas-shell-v4';
const STATIC = ['/theme-init.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

const refs = (text, re) => [...text.matchAll(re)].map((m) => m[1]);

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const res = await fetch('/', { cache: 'no-store' });
    if (!res.ok) throw new Error('index indisponível');
    const html = await res.clone().text();
    await cache.put('/', res);
    for (const url of refs(html, /(?:src|href)="(\/assets\/[^"]+)"/g)) {
      const r = await fetch(url);
      if (!r.ok) throw new Error('asset indisponível: ' + url);
      await cache.put(url, r.clone());
      if (url.endsWith('.css')) {
        for (const f of refs(await r.text(), /url\(["']?(\/assets\/[^)"']+)["']?\)/g)) await cache.add(f);
      }
    }
    await cache.addAll(STATIC);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Devolve a resposta só se parecer o casco do app (HTML que referencia /assets/).
const shellFrom = async (res) => {
  if (!(res.headers.get('content-type') ?? '').includes('text/html')) return null;
  return (await res.clone().text()).includes('/assets/') ? res : null;
};

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const page = req.mode === 'navigate';

  if (url.pathname.startsWith('/assets/')) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await withTimeout(fetch(req), 3000);
      if (res.ok && !page) cache.put(req, res.clone());
      if (res.ok && page) e.waitUntil(shellFrom(res.clone()).then((r) => r && cache.put('/', r)));
      return res;
    } catch {
      // Página: devolve o app (é uma SPA). Outros arquivos: só o que já foi guardado.
      return (await cache.match(page ? '/' : req)) ?? new Response('Sem conexão', { status: 503 });
    }
  })());
});
