# Repetições — registro de design da tela (issue #23)

Abra `index.html` no navegador (sem build, sem rede). O painel ao lado do celular troca a alternativa de posicionamento, a versão (atual / próxima), os dados (com repetições / vazio) e o tema. A URL guarda o estado, então dá para mandar o link de uma tela. `index.html#selftest` clica pelo protótipo e confere 34 passos (`#selftest&theme=dark` começa no tema escuro).

O protótipo espelha a tela já implementada na aba Mês (`frontend/src/Recurrences.svelte`, `RecurrenceSheet.svelte` e a subaba em `Month.svelte`). Onde os dois divergirem, a implementação vence.

Nome na interface: **Repetições** (título da seção: "Contas que se repetem"). "Recorrência" e "regra" ficam só no código. O app já diz "repete" na linha e "Faz parte de uma repetição" no formulário.

## Onde a tela mora

A tela **não** entra na barra inferior, que segue com Mês, Contas, Categorias e Mais.

| | Alternativa | A favor | Contra |
|---|---|---|---|
| **A (escolhida)** | **Mês › subaba "Lançamentos \| Repetições"** | É onde a pessoa lança, vê "repete" e cria a repetição (Lançar › Repetir). 1 toque a partir da tela inicial. | A aba Mês ganha um segundo seletor, além do filtro Todos/Pendentes/Efetivados. |
| B (não escolhida) | Mais › linha "Repetições" que abre a tela | Não mexe nas telas do dia a dia. | Escondido: Mais é ajuste (tema, sincronização, conta). 2 toques. |
| C (não escolhida) | Contas › subaba "Contas \| Repetições" | A aba Contas é curta, a subaba cabe sem disputa. | Mistura "Contas" (banco, carteira) com "contas a pagar". A repetição é de lançamento, não de conta bancária. |

B e C continuam alternáveis no protótipo só como histórico.

Na subaba Repetições somem o hero, o seletor de mês e o filtro, porque a lista não é "do mês". O menu ⋯ de um lançamento que repete tem **"Ver repetição"**, que abre o detalhe direto.

## O que o protótipo mostra (versão atual)

- **Lista:** resumo "Próximos 30 dias" com **A receber / A pagar / Resultado** (pendentes de hoje a hoje + 29, sem as contas arquivadas); grupos **A pagar** e **A receber**, ordenados pelo que vence antes (atrasado primeiro); cada linha com ritmo ("Todo mês, dia 5"), conta, valor com sinal, o próximo vencimento e, se houver, "Até dd/mm/aaaa". Conta arquivada aparece como "Nome (arquivada)". **Encerradas** ficam recolhidas no fim.
- **Estados:** vazio; ativa (Aluguel); ativa com atraso (Condomínio); com data final (Academia); em conta arquivada (Plano de celular); encerrada (Curso de inglês, Streaming).
- **Estado vazio:** sem botão próprio. A única ação é o **"Nova repetição"** fixo da tela, que abre o formulário de lançamento já repetindo.
- **Detalhe/edição** (um sheet): uma linha de fatos (ritmo, desde quando, efetivados, pendentes, atrasados) e os campos valor, descrição, conta e categoria. **"Mudar a partir de"** é um seletor de data, com padrão na próxima pendente: mudam os pendentes dessa data em diante; os anteriores e os já efetivados não mudam. Se sobram pendentes antes da data, a repetição se divide em duas com o mesmo nome, e a antiga vai para Encerradas quando esvazia. Ritmo, dia e data final são só leitura.
- **Encerrar:** confirmação com as consequências contadas. Saem os pendentes de hoje em diante; os atrasados ficam na aba Mês para efetivar ou excluir; os efetivados ficam no histórico e nos saldos. A regra grava a data final ("parou em"). Uma repetição encerrada que ainda tem atrasado **continua na lista principal**; só vai para Encerradas quando não há mais nada a resolver.
- **Encerrada:** só leitura, com "Fechar".

## Decisões tomadas (27/11/2026)

1. **Posicionamento:** alternativa A, subaba em Mês.
2. **Atrasados ao encerrar:** ficam na aba Mês; só os pendentes de hoje em diante saem.
3. **Editar pela repetição:** pergunta "Mudar a partir de" (padrão: a próxima pendente). Não aplica a todos os pendentes sem perguntar.
4. **Ritmo e dia:** só leitura na primeira versão; editar na própria tela fica para a próxima.
5. **"Repetir de novo"** numa encerrada: fica para a próxima versão.
6. **"Nova repetição":** abre o "Novo lançamento" com "Repetir" já marcado; não há formulário próprio.
7. **Resumo "Próximos 30 dias":** fica, com "Resultado" no lugar de "Sobra" e sem as contas arquivadas.

## Próxima versão (decidido, ainda não implementado)

No protótipo, em "Versão › Próxima versão", dentro de uma moldura tracejada com o selo "Próxima versão":

- **Mudar o ritmo e o dia na própria tela:** "Repete", "A cada quantos" e "Novo dia" no sheet de edição, valendo a partir da data de "Mudar a partir de". Os campos e o comportamento do protótipo (com efetivados para trás, a repetição antiga encerra e uma nova segue no novo ritmo) são uma proposta, a confirmar na implementação.
- **"Repetir de novo"** numa repetição encerrada: cria outra igual a partir da próxima data do mesmo ritmo; o histórico da antiga fica como está.

Fora do escopo e sem decisão: "Desfazer" depois de encerrar, editar a data final e excluir de vez uma repetição encerrada.
