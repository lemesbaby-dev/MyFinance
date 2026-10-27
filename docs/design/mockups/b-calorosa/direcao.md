# Direção B — Calorosa e amigável

**Palavras-chave:** acolhedor · leve · claro-de-relance

## Tom e referências
Fala como um amigo organizado, não como banco. Microcopy próxima ("Oi, Josias", "Mês novinho em folha", "Combinado para hoje"), sem culpa e sem alarme: atraso é informação ("Atrasado há 6 dias"), não punição.
Referências de clima: Nubank (cor de marca ousada, voz humana), Monzo (cartões macios, emojis/ícones simpáticos), Duolingo (cantos redondos, microcopy), Things 3 (calma, hierarquia). Nada copiado, só o espírito.

## O que o app NÃO é
Não é painel de trader (sem gráficos nervosos, sem vermelho/verde berrando). Não é planilha disfarçada. Não é gamificado (sem streaks, confete ou culpa). Não é infantil: o arredondado é gentil, os números continuam sérios.

## Tipografia
- **Fredoka 600**: títulos, hero e valores grandes (geométrica arredondada, dá a personalidade).
- **Nunito 500/700/800**: texto, rótulos, valores de lista (legível em corpo pequeno, algarismos tabulares com `font-variant-numeric: tabular-nums`).
- Total: 2 famílias, 4 pesos. Para o PWA offline, self-host de woff2 (subset latin) em vez do `<link>` do Google Fonts; o fallback é `ui-rounded`/system-ui.
- Escala: 12 · 14 · 16 · 20 · 26 · 34 px.

## Paleta (racional)
- **Marca damasco** (`--apricot-600` #BF4E14 no claro, `-400` #F5893F no escuro): quente, acolhedora, e que não é cor de dinheiro nem de alerta (não colide com verde/vermelho). Botão com texto branco: 4,9:1 (AA).
- **Fundo creme** quente em vez de cinza-azulado: tira a "cara de dashboard".
- **Receita verde** `#1B7A4B` (5,9:1 no branco). **Despesa ameixa** `#9A3A66` (6,6:1): sinal "−" sempre presente, então a despesa não precisa de vermelho. **Previsto índigo**, **atrasado âmbar** (`#A44A06`, 5,6:1) sempre com ícone de relógio e texto. Status nunca depende só da cor.
- **Escuro** quente (marrom-café, não preto frio); cores de valor clareadas (≥ 7:1 sobre o fundo).
- **Categorias:** 10 cores baseadas em Okabe-Ito (seguras para daltonismo) + **glifo único por categoria**, então a cor nunca é o único canal. Amarelo/ciano/laranja usam glifo escuro. Valores AA verificados por cálculo de luminância, a validar com ferramenta na implementação.

## Formas e movimento
Raios 12/18/24/32 px e pílula; tab bar flutuante em pílula; alvos ≥ 44 px; sombras suaves e quentes. Movimento curto (150–200 ms), respeitando `prefers-reduced-motion` (a decidir na implementação).

## Decisões de tela
- **Hero "trilha":** ponto "hoje" (sol, cheio) → ponto "fim do mês" (tracejado, índigo); entre eles, paradas coloridas = contas a pagar/receber/atrasadas. O desenho responde "o que falta acontecer até lá".
- **Linha da lista:** 1 ação principal em pílula (Efetivar/Recebi), o resto no menu ⋯. Pago = chip "Pago" e linha mais calma; pendente = chip neutro com a data; atrasado = fundo âmbar + relógio.
- **Confirmações** em diálogo próprio com a pergunta de escopo (só este / este e os próximos).

## Riscos e trade-offs
- **Pode parecer "app de criança"** ou pouco sério para quem quer controle. Mitigação: números em Nunito 800 tabular, paleta madura, microcopy contida.
- **Fredoka é marcante**: cansa em excesso. Fica só em títulos e valores do hero/sheet.
- **Raios grandes e sombras** gastam espaço vertical (linhas mais altas, menos itens por tela).
- **Sem vermelho para despesa** vai contra a convenção; um usuário apressado pode demorar a associar ameixa a "gasto". Mitigação: sinal "−" e rótulos.
- **Fonte externa** quebra a promessa offline-first se não for self-hosted.
- **Contraste da marca no escuro** exige texto escuro no botão (já previsto: `--on-brand`).
