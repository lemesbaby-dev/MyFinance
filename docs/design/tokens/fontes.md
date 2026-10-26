# Fontes da direção B — decisão

**Recomendação: Fredoka + Nunito variáveis, self-host, só subset latin, 2 arquivos woff2.** Cabe no orçamento.

## Medido (npm pack @fontsource-variable/*@5.3.0, arquivos `*-latin-wght-normal.woff2`)

| Arquivo | Bytes | Uso |
|---|---|---|
| fredoka-latin-wght-normal.woff2 | 29.732 (29,0 KB) | títulos, valor grande (600) |
| nunito-latin-wght-normal.woff2 | 39.128 (38,2 KB) | texto/valores (500/700/800) |
| **Total B** | **68.860 (67,2 KB)** | 2 arquivos |
| (hoje) instrument-sans-latin-wght-normal.woff2 | 30.092 (29,4 KB) | a ser substituída |

- woff2 já é comprimido: gzip não reduz; tamanho em rede = tamanho em disco.
- Fontes não entram nos orçamentos de JS (≤40 KB gz) nem CSS (≤15 KB gz); só o `@font-face` (~0,5 KB gz) entra no CSS. Entram no precache do PWA: +38 KB líquidos sobre a Instrument Sans atual (some uma, entram duas).
- Latin cobre pt-BR completo (U+0000-00FF: ã, ç, é, ê…, mais "−" U+2212 e "€"). Não precisa de latin-ext.
- Eixo variável cobre 500/700/800 (Nunito 200–1000) e 600 (Fredoka 300–700) sem arquivos extras.

## Como integrar (patch pequeno)

NÃO usar `import '@fontsource-variable/fredoka'`: o `index.css` declara todos os subsets (cirílico, hebraico, vietnamita, latin-ext…) e o Vite emite todos os woff2 em `dist/`, que o service worker pode pré-cachear (centenas de KB desnecessários).

Escolha mais simples: manter as 2 devDependencies só como fonte do arquivo, copiar os 2 woff2 para `frontend/src/fonts/` e declarar:

```css
@font-face { font-family:'Fredoka Variable'; font-style:normal; font-display:swap; font-weight:300 700;
  src:url(./fonts/fredoka-latin-wght-normal.woff2) format('woff2-variations'); }
@font-face { font-family:'Nunito Variable'; font-style:normal; font-display:swap; font-weight:200 1000;
  src:url(./fonts/nunito-latin-wght-normal.woff2) format('woff2-variations'); }
```

(Os nomes batem com `--font-display`/`--font-text` de tokens.css, que já têm fallback `ui-rounded, system-ui`.) Alternativa sem copiar arquivos: importar `@fontsource-variable/{fredoka,nunito}/files/...` não é exportado pelo pacote; por isso a cópia. Licença: ambas OFL (redistribuição permitida; manter o LICENSE junto).

Remover `@fontsource-variable/instrument-sans` e o import em `main.js` na migração.

## Preload e fallback
- `font-display: swap` com fallback `ui-rounded/system-ui`: o app é legível antes da fonte; o salto de layout é pequeno em Nunito (métricas próximas de system-ui).
- Pré-carregar só a Nunito (texto, acima da dobra): `<link rel="preload" as="font" type="font/woff2" crossorigin>`. Fredoka pode carregar depois (só títulos/hero).

## Se estourar
Não estoura. Se o orçamento apertar: (1) trocar Fredoka por `ui-rounded` apenas nos valores pequenos, ou (2) usar só Nunito (800 nos números grandes) e dispensar Fredoka (−29 KB), ao custo da personalidade da direção B.
