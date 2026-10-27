# Voz e microcopy (pt-BR)

Tom: **amigo organizado, não banco**. Próximo, calmo, direto. Sem culpa, sem alarme, sem gíria forçada; os números continuam sérios. Frases curtas, verbo no começo do botão, "você" quando precisa falar com a pessoa. Atraso é informação ("Atrasado"), não punição.

## Termos fixos
| Use | Significa | Evite |
|---|---|---|
| **efetivar** / "Efetivado" | lançamento que já aconteceu (pago/recebido); ações "Efetivar" (despesa) e "Recebi" (receita) | "dar baixa", "quitar" |
| **previsto** | valor esperado até o fim do mês, contando o que ainda não aconteceu | "projetado", "estimado" |
| **pendente** | ainda não efetivado e dentro do prazo | "em aberto", "a vencer" |
| **atrasado** | pendente com data anterior a hoje (sempre com ícone de relógio) | "vencido", "inadimplente" |
| **lançamento** | uma receita, despesa ou transferência | "transação", "movimentação" |
| **Hoje → Previsto** | os dois números do hero | "saldo atual/projetado" |
| **não enviado** / **recusado** | alteração ainda local / rejeitada pelo servidor | "dessincronizado", "falhou" |

Datas `dd/mm`; mês por extenso ("Outubro de 2026"); valores `R$ 1.234,56` com sinal `+`/`−` explícito.

## Rótulos e botões
Ação principal em verbo curto: "Efetivar", "Recebi", "Lançar", "Salvar", "Cancelar", "Tentar de novo", "Desfazer", "Sincronizar agora". Destrutivo diz o que faz: "Excluir", "Descartar", "Excluir para sempre". Campo: rótulo curto ("Descrição", "Valor (R$)", "Saldo inicial (R$)") e ajuda embaixo ("Como aparece na lista", "Digite só os números"). Menu secundário: "Editar", "Excluir", "Desfazer".

## Erros
Dizem **o que aconteceu e o que fazer**, sem culpar. Erro de campo é local e específico; o erro geral aparece no topo do formulário.
- Campo: "Informe uma descrição" · "Informe o nome" · "Informe o nome da conta." · "Valor deve ser maior que zero" · "Saldo inválido ou fora do limite. Exemplo: 1.250,00".
- Tela/lista: título "Não deu certo", texto "Confira a conexão e tente de novo.", botão "Tentar de novo".
- Salvar: "Não foi possível salvar" + a causa quando houver.
- Servidor recusou: "Estas alterações não foram aceitas e não entram nos saldos. Descarte para voltar ao que o servidor tem, ou edite o item e salve de novo." · "foi excluído em outro aparelho".

## Estados vazios
Título curto + uma frase de orientação + ação, quando existir. Nunca só "Nenhum dado".
- Mês: "Nada por aqui ainda" / "Quando você lançar algo neste mês, aparece aqui." (ação "Novo lançamento").
- Contas: "Nenhuma conta ainda" / "Crie a conta onde seu dinheiro está."
- Categorias: "Nenhuma categoria". Filtro: "Sem despesas neste filtro."

## Confirmações
Pergunta com o nome do item, consequência em uma frase, botão com o verbo da ação (nunca "OK"/"Sim"):
- `Excluir "Mercado"?` + nota de recorrência/parcela · botão "Excluir".
- `Excluir a conta "Carteira"?` · `Excluir "Moradia"?` / "Os lançamentos dela ficam sem categoria."
- "Descartar alterações?" / "As alterações não enviadas da outra conta serão perdidas. Continuar?" · "Descartar".
- "Sair mesmo assim?" diz quantas alterações ficam guardadas no aparelho.
- Recorrência: "Só este" / "Este e os próximos" (pergunta de escopo no diálogo).
Sem `confirm()`/`alert()` nativos: use `confirmDialog()`.

## Offline e sincronização
Calmo, afirmando o que continua funcionando: "Offline. Tudo continua funcionando; envio quando a rede voltar." · "Sincronizando…" · "Tudo sincronizado" · "1 lançamento foi recusado". Estar offline nunca usa tom de alarme.

## Toasts
Confirmam em 1 a 3 palavras e, se der, oferecem desfazer: "Lançamento salvo" (ação "Desfazer"), "Excluído".

## Saudação e identidade
"Oi, Josias" no cabeçalho (opcional), "Vamos começar" no primeiro acesso; nome do app "MyFinance". Sem emojis em mensagens de erro.
