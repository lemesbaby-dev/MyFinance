# Direção A — Sóbria e editorial

**Palavras-chave:** papel · tinta · confiança.

## Referências
Caderno de contas (livro-caixa), página de finanças de jornal (Financial Times, Valor), recibos tipográficos, Things 3 pela contenção. Hierarquia por tipografia e filetes, não por caixas e sombras.

## Tom
Calmo, adulto, preciso. Texto direto em pt-BR ("A pagar", "Efetivar", "atrasado 3 dias"). O dinheiro é tratado como algo sério, sem gamificação nem festa.

## O que o app NÃO é
Não é fintech neon/gradiente, nem dashboard cheio de gráficos, nem app de "metas" com confete, nem cartões flutuantes com sombra. Não usa vermelho/verde saturado como decoração: cor só significa estado.

## Par tipográfico
- **Fraunces** 600/700 (Google Fonts, `opsz` 9..144): títulos, mês, todos os valores em R$ (numerais lining + tabulares).
- **Inter** 400/500/600: UI, rótulos, metadados, botões.
- Fallback de sistema: Georgia / system-ui. Para produção offline, auto-hospedar as duas (PWA, sem CDN).

## Paleta e racional
- Papel quente `#F5F0E4` / tinta `#1C1913` (claro); noite quente `#15130F` / osso `#EFE8D9` (escuro). Nada de cinza azulado nem preto puro.
- **Despesa = cor da tinta** (sinal "−"), não vermelho: despesa é o normal, não alarme. **Receita** verde-musgo. **Previsto** ocre (tracejado = ainda não aconteceu). **Atrasado** vermelho-tijolo, o único alarme, com filete lateral + texto "atrasado Nd" (nunca só cor).
- Estados da linha: pago = riscado e esmaecido + check; pendente = ponto vazado + rótulo; atrasado = filete vermelho. Cada um se distingue sem cor.
- Contraste medido (WCAG): texto/valores >= 5,6:1 no claro e >= 7:1 no escuro (AA com folga). Todos os pares semânticos passam.
- **10 cores de categoria**: base Okabe-Ito/Tol (seguras para daltonismo), variantes separadas para claro e escuro, todas >= 3:1 contra o fundo. São marcas não textuais e sempre vêm com o nome da categoria. Ressalva: 1/6 (azuis) e 5/9 (ocre/oliva) ficam próximas em visão protan; o nome resolve.

## Estrutura de tokens
`:root` (primitivos: paper/ink/night, família, espaço, raio, `--cat-*`) → `.theme-light/.theme-dark` (semânticos: `--color-income/expense/forecast/overdue`, `--surface-raised`, `--text-muted`, `--border-*`) → `.phone` (componente: `--btn-h`, `--row-pad`, `--tabbar-h`). Em produção o tema vai em `[data-theme]` no `<html>`. Para virar `tokens.css`, mover o bloco do topo de `index.html`.

## Telas cobertas (360 e 390 px, claro e escuro)
Mês (hero hoje → previsto com trilha sólido-até-tracejado, lista por dia, "Efetivar" único por linha, menu ⋯ aberto na linha Aluguel, banner offline), Contas, Categorias, Mais, Sheet de lançamento, diálogo de confirmação (substitui `confirm()`), estado vazio com primeiros passos, TabBar SVG, paleta.

## Riscos e trade-offs
- Serifa nos valores dá identidade, mas pesa na leitura de números muito longos (R$ 1.234.567,89) em 360 px; o hero escala com a largura e pode exigir encolher.
- Pouca cor: o app pode parecer "frio/formal" para quem quer motivação; gráficos e tendências ficam com pouco apelo.
- Despesa sem vermelho exige que o sinal "−" e a posição façam o trabalho; testar com usuários.
- Fraunces + Inter = ~2 famílias de fonte para carregar offline (peso no precache do service worker).
- Filetes finos (1px) dependem de telas boas; em sol forte, o `--border-subtle` pode sumir.
- Mockup estático: o menu aberto e o hero são ilustrativos, sem interação nem animação definida.
