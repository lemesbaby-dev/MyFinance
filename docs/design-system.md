# Design system — MyFinance (direção B, "calorosa")

Direção: **acolhedor · leve · claro-de-relance** (`design/mockups/b-calorosa/direcao.md`). Sem biblioteca de UI/CSS de terceiros: tokens em CSS + componentes Svelte em `frontend/src/ui/`.

## 1. Princípios
1. **Números primeiro**, legíveis de relance (valor > rótulo > metadado).
2. **Uma ação principal por contexto** (ex.: "Efetivar" na linha; o resto no menu ⋯).
3. **Offline e pendências sempre visíveis, sem alarmismo** (Banner calmo; atraso é informação, não punição).
4. **Acessível por padrão**: contraste AA, foco visível, alvo ≥ 44 px, rótulos, `prefers-reduced-motion`. Cor nunca é o único canal (ícone, sinal +/−, texto).
5. **Leve**: ver orçamento (seção 8).

## 2. Camadas de tokens
Fonte única: `docs/design/tokens/tokens.css`. O app usa a cópia `frontend/src/tokens.css` (**não edite à mão**).

| Camada | Exemplos | Regra |
|---|---|---|
| 1. Primitivos | `--apricot-600`, `--cream-50`, `--space-4`, `--radius-2` | só aqui existem valores brutos |
| 2. Semânticos | `--brand`, `--surface-page`, `--surface-raised`, `--text-muted`, `--color-income/expense/forecast/overdue/pending/settled/transfer`, `--focus-ring`, `--cat-1..10`, `--money-{lg,md,sm}-*` | **componentes usam só estes** |
| 3. De componente | `--btn-h`, `--row-gap`, `--card-radius`, `--field-h` | derivados dos semânticos, quando o componente precisa de um botão de ajuste |

Temas: claro, escuro (segue o sistema; override `data-theme="light|dark"` em `<html>`) e modo daltônico (`data-cvd="on"`, troca só `--cat-*` e `--color-*`). Persistência em `localStorage` (`mf.theme`, `mf.cvd`), aplicada antes do CSS por `public/theme-init.js` (sem flash). Contrato completo: `design/tokens/tokens.md`.

Escalas: espaço de 4 px (`--space-1..16`), raios `--radius-1..4` + `--radius-pill`, bordas `--bw-1/2`, sombras `--shadow-soft/lift`, z-index nomeados (`--z-*`), movimento `--dur-fast/base/slow` + `--ease-*` (zeram com `prefers-reduced-motion`), alvo de toque `--tap` (44 px), tipografia `--fs-1..6` (12 a 34 px), Fredoka 600 (títulos, valores grandes) e Nunito (texto, valores de lista), 2 arquivos woff2 self-host.

## 3. Como usar e estender
- **Nunca** hex, `rgb()`, `px` de espaçamento ou `font-family` literal em `.svelte`/`app.css`: o `npm run lint:css` falha. Use `var(--...)`.
- Precisa de um valor que não existe? Adicione o primitivo e o semântico em `docs/design/tokens/tokens.css`, rode `npm run sync:tokens` e `node docs/design/tokens/contraste.mjs`. O teste `tokens-sync.test.js` falha se a cópia divergir da fonte.
- Cor nova de estado/valor: precisa de claro, escuro **e** `data-cvd` (o `contraste.mjs` exige AA e ΔE mínimo).
- Estilo vive no componente (`<style>` escopado) usando tokens; `app.css` guarda só reset e base.

## 4. Convenções de nomes
- Primitivos: `--<familia>-<passo>` (`--brown-800`). Semânticos: `--<papel>` ou `--<grupo>-<papel>` (`--text-muted`, `--color-income`). Componente: `--<componente>-<propriedade>` (`--btn-h`).
- Componentes: `PascalCase.svelte`; ícones em kebab-case de significado em inglês curto (`wallet`, `tag`); textos de UI em pt-BR.
- Props de mecânica em inglês (`tone`, `size`, `kind`, `state`); textos que o usuário lê, em pt-BR (`actionLabel`, `title`).
- `tone`: aparência/ênfase (`brand`, `danger`...). `kind`: natureza financeira (`income|expense|transfer|forecast|overdue`). `state`: status do lançamento (`paid|pending|overdue`).

## 5. Componente novo ou variante?
- **Variante** (prop em componente existente) se muda só aparência/tamanho/cor ou um texto, e a estrutura DOM e o comportamento são os mesmos.
- **Componente novo** se há comportamento (teclado, foco, estado) ou estrutura própria **e** serve a duas ou mais telas. Composição de componentes existentes, usada em uma tela só, fica na tela.
- Antes de criar: procure em `ui/` e na página `/design`. Se criar, mostre todos os estados na `/design` e cubra a lógica pura em `ui/logic.js` + `ui.test.js`.

## 6. Inventário (`frontend/src/ui/`)
| Grupo | Componente | Props principais |
|---|---|---|
| Ações | `Button` | `variant` primary/secondary/ghost/danger, `size` md/sm, `loading`, `disabled`, `block`, `type`, `onclick` |
| | `IconButton` | `label` (**obrigatório**, vira aria-label), `icon`, `tone`, `disabled`, `onclick`, `aria-*` de menu |
| Formulário | `Field` | `label`, `help`, `error` (liga por id/`aria-describedby`/`aria-invalid`) |
| | `TextInput` | `label`, `help`, `error`, `value` (bindable), `type`, `placeholder`, `maxlength`, `inputmode`... |
| | `MoneyInput` | `label`, `help`, `error`, `value` em centavos (bindable); digita "pela direita" |
| | `Select` | `label`, `help`, `error`, `value`, `options [[valor, rótulo]]` |
| | `Switch` | `checked`, `label` ou `labelledby`, `onchange` |
| | `Segmented` | `options [[valor, rótulo]]`, `value`, `label`, `onchange` |
| Dados | `Money` | `cents`, `kind`, `size` lg/md/sm, `signed` |
| | `Stat` | `label`, `cents`, `kind`, `size` |
| | `Badge` | `tone`, `icon` + texto |
| | `ListGroup` / `ListRow` | grupo: `title`, `note`, `today`; linha: `title`, `meta`, `cents`, `kind`, `state`, `cat`, `glyph`, `actionLabel`, `onaction`, `menu`, `menuLabel` |
| | `Card` | `tone` raised/brand, `pad` |
| | `CategoryDot` | `n` 1..10, `glyph`, `size` |
| | `CategoryBar` / `ProgressBar` | barras: `items [{label,cents,n,glyph}]`, `kind`; única: `value`, `max`, `label`, `color` |
| | `BalanceHero` | `now`, `forecast`, `done`, `todo`, `nowLabel`, `forecastLabel` (trilha hoje → previsto) |
| Feedback | `Banner` | `tone` info/warn/danger, `icon`, `detail`, `action` |
| | `Toast` / `ToastHost` | `msg`, `tone`, `actionLabel`, `onaction`; fila via `toast(msg, opts)` de `ui/toast.js` |
| | `EmptyState` / `ErrorState` / `Skeleton` | `icon`, `title`, `text`, `actionLabel`/`retryLabel`, `onretry`; skeleton: `kind` line/row, `count` |
| Sobreposição | `Sheet` | `title`, `onclose`, `center` (= diálogo); foco preso, Escape, `aria-modal`, devolve o foco |
| | `FormSheet` | `title`, `onclose`, `onsubmit`, `busy`, `error`, `onremove`, `removeLabel` |
| | `ConfirmHost` + `confirmDialog()` | `confirmDialog({title, message, confirmLabel, cancelLabel, danger})` devolve `Promise<boolean>`; substitui `confirm()` |
| | `Menu` | `label`, `items [{label, icon, danger, onselect}]`; setas/Home/End |
| Navegação | `TabBar` | `tabs [[id, rótulo, ícone, aviso]]`, `value`, `onselect` |
| | `MonthNav` | `label`, `onprev`, `onnext` |
| | `Header` | `title`, `hello`, ações como snippet |
| Base | `Icon` | `name`, `size`, `label` (decorativo sem `label`) |

Ícones: grade 24, traço via CSS, só os usados em `ui/icons.js`; extras da `/design` em `icons-dev.js` (fora do build de produção). Lógica pura (percentuais, estado da linha, agrupamento, navegação do menu) em `ui/logic.js`, testada em `ui/ui.test.js`.

## 7. Página `/design`
Só em dev: `npm run dev` e abra `http://localhost:5173/#/design`. Mostra tokens, todos os componentes e estados, nos dois temas. É carregada por `import()` atrás de `import.meta.env.DEV`: **não entra no bundle de produção**.

## 8. Orçamento de peso
Medido em `npm run build` (gzip). JS inicial ≤ **45 KB** (hoje 43,3), CSS ≤ **15 KB** (hoje 6,4), ≤ **2** arquivos de fonte (Fredoka + Nunito, ~67 KB woff2). Alvo de build ES2022 (`vite.config.js`: Safari 15.4+/Chrome 94+), sem polyfill de modulepreload. Não adicione dependência de runtime; ícones só os usados; sem spread de atributos (puxa `set_attributes` do Svelte).

## 9. Fluxo dos tokens
1. Edite `docs/design/tokens/tokens.css`. 2. `cd frontend && npm run sync:tokens`. 3. `node docs/design/tokens/contraste.mjs` (AA, daltonismo; sai com erro se falhar). 4. `npm test` (inclui a deriva fonte × cópia) e `npm run lint:css`.

## 10. Identidade do app
Ícone: dois discos ligados por um ponto ("hoje" cheio → "previsto" vazado), creme sobre damasco (`--apricot-600`). Fonte: `frontend/public/icon.svg` (também é o favicon). PNGs (192, 512, maskable 512, apple-touch 180) gerados por `node frontend/scripts/gen-icons.mjs` (usa o Edge/Chrome headless instalado) e commitados. Manifest com `theme_color` damasco e `background_color` creme (a abertura do Android usa ícone + essa cor); `<meta theme-color>` claro/escuro no `index.html`. O service worker pré-cacheia todos os ícones (teste em `sw.test.js`); mudou ícone ou lógica do SW: suba `CACHE` em `public/sw.js`.

## 11. Visualização de dados
- **Cor de categoria**: `--cat-1..10` (base Okabe-Ito). A categoria ganha o índice estável de `catOf(id)`; o campo `color` do modelo não é usado. Sempre cor **+ glifo** (`CategoryDot`): a cor nunca é o único canal.
- **Receita/despesa**: receita verde, despesa **ameixa** (não vermelho; vermelho é reservado a erro real). O sinal **+ / −** é obrigatório em todo valor; `Money` já o aplica. Previsto = índigo; atrasado = âmbar **com ícone de relógio e texto**.
- **Rótulos**: toda barra mostra o valor e a participação em texto ("32% do total, R$ 1.200,00"); não dependa de tooltip nem de hover.
- **Acessibilidade dos gráficos**: gráficos são `role="img"` com `aria-label` descrevendo o dado (ver `ProgressBar`, `CategoryBar`, `BalanceHero`); a lista/valores equivalentes existem na tela. Sem animação essencial (movimento zera com `prefers-reduced-motion`).
- **Daltonismo**: Mais › Aparência › "Cores para daltonismo" liga `data-cvd="on"` (categorias com ΔE2000 mín. ≥ 14 em protan/deutan/tritan; receita azul, despesa laranja). O modo reduz a dependência de matiz, não dispensa glifo/sinal/rótulo.
- **Sem alarmismo**: nada de vermelho berrante, contagem regressiva ou animação para chamar atenção a atraso.
- Antes de mexer em cor: `node docs/design/tokens/contraste.mjs`.

## 12. Checklist de PR de UI
- [ ] Só tokens (camadas 2/3); `npm run lint:css` verde; nada de hex/px de espaço solto.
- [ ] Reutiliza componente de `ui/`; nada de botão/linha/campo/diálogo reimplementado. Componente novo aparece na `/design`.
- [ ] Claro **e** escuro (e modo daltônico se mexeu em cor); `contraste.mjs` verde.
- [ ] 360 px e 390 px sem rolagem horizontal; valores grandes (R$ 1.234.567,89) não quebram o layout.
- [ ] Foco visível por teclado; alvos ≥ 44 px; rótulo/`aria-*` em todo controle; ícone sem texto tem `label`.
- [ ] Estados: vazio, erro, carregando, offline; status nunca só por cor.
- [ ] Movimento via `--dur-*`/`--ease-*` (respeita `prefers-reduced-motion`).
- [ ] Textos seguem `voz-e-microcopy.md`; sem `confirm()`/`alert()` (use `confirmDialog`/`toast`).
- [ ] `npm test`, `npm run build` (orçamento) e `go test ./...` verdes.
