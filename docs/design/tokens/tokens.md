# Tokens da direção B — mapa de migração

Arquivos: `tokens.css` (3 camadas), `contraste.mjs` (mede WCAG + daltonismo; `node contraste.mjs`, exit 1 se falhar), `fontes.md`.

## Nomes antigos (app.css, já removidos na Fase 4) → tokens

| Hoje | Novo (semântico) | Claro / escuro |
|---|---|---|
| `--paper` | `--surface-page` | cream-50 / night-900 |
| `--ink` | `--text-body` (títulos: `--text-strong`) | brown-800 / night-100 |
| `--muted` | `--text-muted` | brown-500 / night-300 |
| `--line` | `--border-subtle` | cream-200 / night-600 |
| `--in` | `--color-income` | green-600 / green-300 |
| `--out` | `--color-expense` | plum-600 / plum-300 (era vermelho-rosado) |
| `--proj` | `--color-forecast` | indigo-600 / indigo-300 |
| `--focus` | `--focus-ring` | indigo-600 / indigo-300 |
| `--radius` (10px) | `--radius-1` (12px) para controles; cartões `--radius-3` | |
| fundo de cartão (novo) | `--surface-raised` | branco / night-800 |
| `.num` | `font-variant-numeric: var(--num-features)` | |

Novos sem equivalente hoje: `--brand`, `--brand-soft`, `--brand-strong`, `--on-brand`, `--color-overdue`, `--color-pending`, `--color-settled`, `--color-transfer` (+ `-soft`), `--cat-1..10`, `--money-{lg,md,sm}-*`, espaço/raio/z/movimento.

Os aliases legados (`--paper`, `--ink`…) foram removidos de `app.css` na Fase 4: use sempre os semânticos. `@media (prefers-color-scheme: dark)` do app.css é substituído pelos blocos do tokens.css; adicionar `data-theme` em `<html>` só se houver seletor manual de tema.

## Valor monetário
`lg` Fredoka 600 34px (hero/sheet), `md` Nunito 800 20px (cartões), `sm` Nunito 800 16px (linhas). Sempre `tabular-nums`, sinal explícito (+ / −): a cor sozinha não distingue receita de despesa.

## Regras
- Componentes usam só camadas 2 e 3; hex bruto só em primitivos.
- Categoria = cor + glifo (tinta escura em amarelo/laranja/ciano/rosa claro, clara no resto; `contraste.mjs` escolhe a melhor e exige 3:1).
- Movimento: `--dur-*` zera com `prefers-reduced-motion`; usar `transition: ... var(--dur-base) var(--ease-out)`.

## Contrato de tema e modo daltônico (Mais > Aparência)

Dois atributos no `<html>`; o CSS só reage a eles (nenhum JS de cor):

| Atributo | Valores | Ausente = |
|---|---|---|
| `data-theme` | `light` \| `dark` | segue o sistema (`prefers-color-scheme`) |
| `data-cvd` | `on` | desligado |

UI "Tema": Sistema (remove o atributo) / Claro / Escuro. UI "Cores para daltonismo": liga/desliga `data-cvd="on"`. Combinam livremente (4 combos validados por `contraste.mjs`: claro/escuro × cvd off/on).

Persistência (localStorage, por dispositivo; try/catch, falha = padrão): `mf.theme` = `light|dark` (ausente = sistema) e `mf.cvd` = `on` (ausente = off).

Anti-flash: script síncrono no `<head>` do `index.html`, antes do CSS, hoje o arquivo externo `frontend/public/theme-init.js` (a CSP não aceita inline); mesma lógica:

```html
<script>try{var d=document.documentElement,t=localStorage.getItem('mf.theme'),c=localStorage.getItem('mf.cvd');
if(t==='light'||t==='dark')d.dataset.theme=t;if(c==='on')d.dataset.cvd='on'}catch(e){}</script>
```

Ao mudar na UI: setar/remover o atributo e gravar/remover a chave (mesma lógica do script). Se a CSP bloquear script inline, usar hash/nonce ou arquivo síncrono pequeno.

`data-cvd="on"` sobrescreve só: `--cat-1..10` (ΔE2000 mín. 14,4 claro e 14,9 escuro em protan/deutan/tritan; paletas distintas por tema, ≥3:1 contra page e raised) e `--color-*` (receita azul, despesa laranja em vez de verde/vermelho; ΔE ≥ 16 entre os 6 financeiros; AA mantido). Não muda superfícies, texto, marca nem espaçamento.

Regra: o modo daltônico NÃO dispensa os outros canais. Glifo por categoria, sinal +/−, ícone de relógio em atrasado e rótulo de status valem nos dois modos; o modo só reduz a dependência de matiz.

Observação: no claro+cvd a despesa (#6D1503) e o "previsto" ficam escuros (AA sobre creme exige); a separação vem de luminância/matiz, não de saturação.

## Implementação (Fase 1)
**Fonte única: `docs/design/tokens/tokens.css`** (é o que o `contraste.mjs` mede). Edite só ele e rode `npm run sync:tokens` em `frontend/` para atualizar a cópia `frontend/src/tokens.css` (importada em `main.js`, ignorada pelo stylelint); `npm test` falha se as duas divergirem. `npm run lint:css` (stylelint) barra, fora de `tokens.css`/`fonts.css`: cor literal (hex, rgb/hsl…, nomes), `font-family` literal e espaçamento literal (`padding`/`margin`/`gap` em px/rem/em — use `var(--space-N)`; `0` e `auto` passam).
