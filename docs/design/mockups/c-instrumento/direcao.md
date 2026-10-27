# Direção C — Instrumento de precisão

**Palavras-chave:** preciso · denso · noturno.

**Referências:** painel de instrumento (cockpit, osciloscópio), terminal Bloomberg/htop sem o ruído, planilha bem diagramada, cadernetas de contabilidade (régua, coluna de valores alinhada), Linear/Raycast na disciplina de grid.

**Tom:** técnico, calmo, confiável. Fala pouco, em maiúsculas curtas para rótulos (`SALDO HOJE`, `PREVISTO`), nunca exclamações. Números são o conteúdo; o resto é moldura.

**O que o app NÃO é:** não é "fintech simpática" (sem gradientes, sem cards flutuantes arredondados, sem ilustrações, sem emojis); não é gamificado; não é dashboard de gráficos decorativos; não é alarmista (atrasado é âmbar com texto, não vermelho gritante).

## Tipografia
Par: **JetBrains Mono** (500, 700) para valores, rótulos, datas, botões; **IBM Plex Sans** (400, 600) para descrições e texto corrido. Dois arquivos de família, 4 pesos no total. Fallback de sistema: `ui-monospace/Consolas` e `system-ui`. `font-variant-numeric: tabular-nums slashed-zero` em todo valor: colunas alinham e o zero não se confunde com "O". Escala: 11 (rótulo) · 13 · 15 · 20 · 32/24 (hero).

## Grid e forma
Múltiplos de 4px em todo espaçamento (`--space-1..8`). Raios mínimos (2/4px; 8px só na Sheet). Bordas de 1px no lugar de sombras; sombra só em camadas flutuantes (menu, FAB). Alvos de toque 44px; botão de linha 32px com área de toque estendida (a validar na implementação). Divisores de dia em faixa rebaixada, como cabeçalho de coluna.

## Paleta (racional)
- **Escuro de 1ª classe:** neutros azulados quase pretos (`ink-0..300`), superfícies separadas por luminância + hairline.
- **Um acento forte:** ciano (`--color-accent`, 400 no escuro / 700 no claro). Serve a ação principal ("Efetivar", "Lançar") **e** ao "previsto", que é a mesma ideia: o que está por vir.
- **Semântica financeira:** receita verde, despesa coral, transferência violeta, atrasado âmbar, pendente cinza-neutro. Estado nunca só por cor: pago = quadrado cheio com ✓; pendente = quadrado vazio; atrasado = `!` + selo "ATRASADO nd".
- **Contraste AA:** textos/valores calculados para ≥ 4,5:1 sobre `--surface` e `--bg` nos dois temas (muted escuro `#8B96A3` ≈ 6:1; claro `#4F5B68` ≈ 7:1; income/expense/overdue claros ≥ 5:1). Verificar com ferramenta antes de congelar tokens.
- **Categorias (10):** base Okabe-Ito estendida (laranja, azul-céu, verde-azulado, amarelo, azul, vermilhão, rosa, violeta, verde-limão, cinza). Cada uma leva **letra** dentro do chip, então a identificação não depende só de matiz. São preenchimentos (não texto): meta 3:1 contra o fundo.

## Visualização própria: a trilha
No hero, "hoje → previsto" vira uma régua graduada: marcador cheio (hoje), losango vazio (previsto), segmento entre eles, Δ explícito abaixo. Lê-se o sentido e a magnitude da variação de relance.

## Linhas do mês
Uma ação primária por linha (`EFETIVAR`, contorno ciano); editar, pular e excluir num menu `⋯`. Pago perde peso (muted, sem botão); atrasado ganha selo e vai para um grupo próprio no topo.

## Riscos / trade-offs
- **Frieza:** pode parecer austero para uso familiar/casual. Mitiga com copy humana e estados vazios acolhedores.
- **Densidade vs. toque:** linhas compactas competem com alvos de 44px; "Efetivar" e `⋯` precisam de área de toque ampliada.
- **Mono em tudo cansa:** por isso só números/rótulos em mono; texto corrido em Plex Sans.
- **Daltonismo:** coral/verde de receita-despesa depende também de sinal (+/−) e posição; já impresso nos valores.
- **Fontes web:** 2 famílias via Google Fonts = custo offline; no app, servir WOFF2 locais pelo service worker.
- **Ciano único:** previsto e ação compartilham a cor; se confundir, separar acento de previsto.
