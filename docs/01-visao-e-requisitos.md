# 01 — Visão, escopo e requisitos

## Visão
Controle financeiro pessoal **leve**, em **PWA** (web + celular), que **funciona offline em tudo**
e roda numa VM pequena (Contabo). Até ~10 usuários, cada um com seus próprios dados.

## Princípios
1. **Leveza**: 1 binário Go + SQLite; servidor < 50 MB de RAM em repouso.
2. **Offline é padrão, não exceção**: o app lê e grava no aparelho; a rede só sincroniza.
3. **Dinheiro = centavos inteiros**. Nunca float.
4. **Simples > completo**: o que não está no MVP fica em "Em breve".

## Escopo MVP
| Área | Inclui |
|---|---|
| Contas | criar, editar, arquivar (corrente, dinheiro, poupança, investimento) |
| Categorias | criar, editar, excluir; receita/despesa; 1 nível de subcategoria |
| Lançamentos | receita, despesa, transferência; **CRUD completo**; efetivar/desfazer; notas |
| Recorrências | diária/semanal/mensal/anual, intervalo, fim opcional; editar/encerrar |
| Parcelas | compra parcelada (soma = total, centavos nas primeiras) |
| Saldos | **atual** e **previsto** até qualquer data, por conta e total; navegação por mês (passado e futuro) |
| Relatório simples | gastos do mês por categoria |
| Offline | tudo acima, sem rede; sincroniza ao voltar |
| Multiusuário | login com Google (cadastro aberto), dados isolados por usuário |
| Visão do mês | alternar **Todos / Pendentes / Efetivados** (ver seção abaixo) |
| Dados | exportar CSV/JSON dos próprios dados; backup do servidor |

## Fora do MVP (Em breve)
Cartão de crédito (fatura, fechamento/vencimento — **aparece na UI como "Em breve"**), orçamento
por categoria, importação OFX/CSV, contas compartilhadas entre usuários, anexos/recibos,
notificações de vencimento, Open Finance, multi-moeda.

## Visão do mês (filtro Todos / Pendentes / Efetivados) — PROPOSTA, a refinar
Tela principal navega por mês (‹ out/2026 ›). Um seletor segmentado muda **o que é listado e somado**:

| Seletor | Lista de lançamentos | Totais do mês (receitas / despesas / resultado) | Gastos por categoria |
|---|---|---|---|
| **Todos** (padrão) | pagos + pendentes | tudo = *previsto do mês* | pagos + pendentes |
| **Pendentes** | só `pending` | *a realizar* | só pendentes |
| **Efetivados** | só `paid` | *realizado* | só pagos |

**Cartões de saldo no topo não mudam com o seletor** (sempre fixos e sem ambiguidade):
- **Saldo atual** = só efetivados até hoje.
- **Saldo previsto** até o fim do mês exibido = atual + pendentes até essa data.

Detalhes a decidir (ver perguntas):
- "Atrasados" (pendentes com data < hoje) aparecem destacados em *Pendentes* e em *Todos*, mesmo em meses passados.
- O filtro vale por sessão; guarda a última escolha no aparelho.
- Em transferência: aparece nas listas, fora dos totais de receita/despesa e dos gastos por categoria.

## Requisitos funcionais
- **RF1** Entrar com **Google** (sem senha própria). O servidor valida o ID token do Google e emite uma sessão própria de longa duração (90 dias, renovável) guardada no aparelho — o login exige rede **uma vez**; depois o app abre e funciona offline.
- **RF1b** Cadastro aberto: qualquer conta Google entra, sem aprovação. Travas de abuso: `MAX_USERS`, cota por usuário e rate limit (ver `04-api.md`).
- **RF2** Usuário só enxerga e altera os próprios dados.
- **RF3** Saldo atual = saldo inicial + tudo efetivado. Saldo previsto até D = atual + pendentes com data ≤ D (inclui atrasados).
- **RF4** Transferência não é receita nem despesa.
- **RF5** Todas as operações (inclusive criar recorrência, editar, excluir, efetivar) funcionam offline.
- **RF6** Ao voltar a rede, alterações locais são enviadas e as de outros aparelhos do mesmo usuário são recebidas, sem ação manual.
- **RF7** Indicador visível: "offline" e "N alterações pendentes de envio".
- **RF8** Editar uma recorrência pergunta: "só esta", "esta e as próximas" ou "todas pendentes".
- **RF9** Excluir é lógico (tombstone) para propagar na sincronização.

## Requisitos não funcionais
- **RNF1 Desempenho**: abrir o app e mostrar saldo < 1 s com 5 anos de dados (~10 mil lançamentos) em celular médio.
- **RNF2 Leveza**: bundle JS inicial < 150 KB gzip; servidor < 50 MB RAM; 1 vCPU basta.
- **RNF3 Segurança**: HTTPS obrigatório, sem senha armazenada (Google OIDC; ID token verificado: assinatura, `aud`, `iss`, `exp`, `email_verified`), sessão opaca revogável (guardamos só o hash), isolamento por `user_id` coberto por teste.
- **RNF4 Durabilidade**: backup diário do SQLite com cópia **fora** da VM; restauração testada.
- **RNF5 Idempotência**: reenviar a mesma operação (rede caiu no meio) nunca duplica lançamento.
- **RNF6 Acessibilidade/UX**: mobile-first, uso com uma mão, pt-BR, BRL, fuso `America/Sao_Paulo`.
- **RNF7 Compatibilidade**: Chrome/Android e Safari/iOS recentes (instalável como PWA).

## Riscos conhecidos
- **Login Google em PWA instalada (principalmente iOS)**: o fluxo por popup/redirect é o ponto
  mais frágil. Mitigação: validar no M1 num iPhone e Android reais antes de construir o resto;
  se falhar, usar o fluxo de redirect (`ux_mode: redirect`).
- **iOS/Safari pode apagar IndexedDB** de PWA pouco usada (~7 dias sem abrir, fora da tela inicial). Mitigação: pedir `navigator.storage.persist()`, sincronizar sempre que abrir, e o servidor é a cópia de segurança.
- **Perda de dados na fila offline** se o usuário limpar dados do navegador antes de sincronizar. Mitigação: contador de pendências bem visível.
