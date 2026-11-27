# Repetições — protótipo da tela (issue #23, etapa 1)

Abra `index.html` no navegador (sem build, sem rede). O painel ao lado do celular troca a alternativa de posicionamento, os dados (com repetições / vazio) e o tema. A URL guarda o estado, então dá para mandar o link de uma tela. `index.html#selftest` clica pelo protótipo e confere 24 passos.

Nome na interface: **Repetições** (título da seção: "Contas que se repetem"). "Recorrência" e "regra" ficam só no código. O app já diz "repete" na linha e "Faz parte de uma repetição" no formulário.

## Onde a tela mora

A tela **não** entra na barra inferior, que segue com Mês, Contas, Categorias e Mais.

| | Alternativa | A favor | Contra |
|---|---|---|---|
| **A** | **Mês › subaba "Lançamentos \| Repetições"** | É onde a pessoa lança, vê "repete" e cria a repetição (Lançar › Repetir). 1 toque a partir da tela inicial. | A aba Mês ganha um segundo seletor, além do filtro Todos/Pendentes/Efetivados. |
| B | Mais › linha "Repetições" que abre a tela | Não mexe nas telas do dia a dia. | Escondido: Mais é ajuste (tema, sincronização, conta). 2 toques. |
| C | Contas › subaba "Contas \| Repetições" | A aba Contas é curta, a subaba cabe sem disputa. | Mistura "Contas" (banco, carteira) com "contas a pagar". A repetição é de lançamento, não de conta bancária. |

**Recomendação: A.** A repetição é um lançamento que se multiplica; o lugar dela é ao lado dos lançamentos. Para o segundo seletor não brigar com o filtro, a subaba usa aba sublinhada no topo (não a pílula do `Segmented`), e na subaba Repetições somem o hero, o seletor de mês e o filtro, porque a lista não é "do mês".

Vale em qualquer alternativa: o menu ⋯ de um lançamento que repete ganha **"Ver repetição"**, que abre o detalhe direto.

## O que o protótipo mostra

- **Lista:** resumo "Próximos 30 dias" (a receber, a pagar, sobra); grupos **A pagar** e **A receber**, ordenados pelo que vence antes (atrasado primeiro); cada linha com ritmo ("Todo mês, dia 5"), conta, valor com sinal e o próximo vencimento. **Encerradas** ficam recolhidas no fim.
- **Estados:** vazio; ativa (Aluguel); ativa com atraso (Condomínio); com data final (Academia, "Até 10/05/2027 · faltam 6"); encerrada (Curso de inglês, Streaming).
- **Detalhe/edição** (um sheet só): resumo, 3 próximos lançamentos e os campos valor, descrição, conta, categoria e "Termina em". Não pergunta escopo: editar pela repetição vale para **todos os pendentes**; os efetivados não mudam. O ritmo é só leitura.
- **Encerrar:** diálogo com as três consequências contadas: pendentes de hoje em diante saem (e o previsto é refeito), efetivados continuam no histórico e nos saldos, atrasados ficam na aba Mês para a pessoa decidir. Depois, toast com "Desfazer".
- **Encerrada:** só leitura, com "Repetir de novo" (cria outra a partir da próxima data do mesmo ritmo; o histórico da antiga fica intacto).

## Dúvidas em aberto para o dono do produto

1. **Posicionamento:** fecha na A?
2. **Atrasados ao encerrar:** ficam na aba Mês (proposto) ou saem junto com os pendentes?
3. **Editar pela repetição** vale para todos os pendentes, sem perguntar (proposto), ou oferece "a partir de quando"?
4. **Ritmo e dia** só leitura na primeira versão ("encerre e crie outra"), ou precisa editar?
5. **"Repetir de novo"** numa encerrada: entra agora ou fica para depois?
6. **"Nova repetição" pela lista:** formulário próprio (como no protótipo) ou abre o "Novo lançamento" com "Repetir" já marcado?
7. **Resumo "Próximos 30 dias":** ajuda ou é número demais?
8. **Excluir de vez** uma repetição encerrada: precisa existir? (O protótipo não tem; os lançamentos efetivados apontam para ela.)

## O que a implementação vai precisar (etapa 2, não feito aqui)

- **Navegação:** estado de subaba dentro de `Month.svelte` (ou componente `Recurrences.svelte` irmão, escolhido em `App.svelte`). `TabBar` não muda.
- **Componente:** abas sublinhadas não existem em `ui/`. Ou variante do `Segmented`, ou usar o `Segmented` como está e aceitar dois seletores parecidos. Linha da lista: `ListRow` tem ação "Efetivar" embutida; a linha de repetição é clicável inteira, sem ação, então pede variante ou composição local.
- **Lógica pura nova** (em `lib/finance.js`, com teste): estado da repetição (ativa / com data final / encerrada), texto do ritmo, próximo vencimento e contagens (efetivados, pendentes, atrasados) a partir de `app.transactions` por `recurrence_id`.
- **Ações novas em `lib/app.svelte.js`**, pela regra e não por uma ocorrência (hoje `editRecurring`/`deleteRecurring` partem de um lançamento):
  - editar campos compartilhados: mesma escrita do escopo `all` de `editRecurring`;
  - definir/alterar `end_date`: apagar pendentes depois da data; se a data for adiada ou removida, gerar de novo (`extendRecurrences`);
  - encerrar: apagar pendentes de hoje em diante e gravar `end_date` (hoje `deleteRecurring` com `all` grava só `active: false`, sem data, e apaga também os atrasados: a tela precisa da data para dizer "parou em" e a decisão 2 muda o que é apagado);
  - desfazer o encerrar (se entrar): regravar a regra e deixar o `extendRecurrences` recriar os pendentes.
- **Servidor:** conferir se a validação de `recurrence` aceita `end_date` com `active: true` no meio da vida da regra e se o `interval_n` > 1 já é exibido (hoje a criação fixa `interval_n: 1`).
- **Microcopy:** acrescentar "repetição" e "encerrar" aos termos fixos de `docs/voz-e-microcopy.md`.
