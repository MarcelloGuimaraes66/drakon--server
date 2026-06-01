# Capacidades do Chat

O chat e o lugar mais rapido para entender o produto, consultar o estado atual da conta, procurar em video e iniciar acoes guiadas sem precisar ficar pulando entre telas.

## Para que o chat serve

- Explicar como o produto funciona, em que pagina um recurso fica e qual fluxo usar.
- Continuar trabalhos em varias mensagens sem obrigar o usuario a recomecar do zero.
- Unir ajuda do produto, leitura de estado ao vivo e acoes guiadas em um mesmo lugar.

## Caminhos especializados de capacidade

Por tras do comportamento conversacional, o chat roteia o pedido para capacidades especializadas. O usuario nao precisa decorar nomes internos, mas o comportamento realmente muda conforme o tipo de pedido.

- Ajuda e onboarding do produto: explicar pairing, API keys, billing, cadastro de camera, AI Agents, Jobs, Steps, orchestration, visao geral do app e o proprio chat.
- Leitura de estado atual: listar cameras, jobs, agentes, saldos, configuracoes, execucoes recentes, historico operacional e id cards persistidos quando esses dados existem.
- Inspecao de video e imagem: pesquisar uma ou mais cameras, analisar imagem ou video enviado e responder sobre gravacoes, eventos ou deteccoes pela pipeline existente de busca em video.
- Descoberta na rede local: executar Scan Network pelo chat para encontrar cameras, DVRs e NVRs e resumir o resultado.
- Operacoes com cameras: cadastrar uma camera, preparar cadastro em lote, editar uma camera, aplicar a mesma edicao em varias cameras e iniciar ou parar o runtime de uma camera existente.
- Operacoes com jobs: criar jobs agendados e workflows com varios steps, editar um job existente e iniciar, parar, pausar ou retomar o runtime de um job.
- Operacoes com agentes: criar ou editar agentes em camera ou em step de job, incluindo destino, cadencia, alteracao de prompt, enable ou disable, negative conditions e fluxos com regiao visual quando necessario.
- Relatorios: gerar documentos baixaveis sobre estado atual, historico, deteccoes, alertas, jobs, agentes, logs, comparacoes e contexto relevante do chat.
- Resposta direta: quando nao existe uma capacidade especializada melhor, o chat ainda pode responder normalmente.

## Como o chat conduz tarefas em varias mensagens

- Mantem uma tarefa ativa entre varias mensagens em vez de tratar tudo como pedido novo.
- Pede campos faltantes quando o pedido e acionavel mas ainda esta incompleto.
- Prefere confirmar em vez de adivinhar quando existe ambiguidade no alvo.
- Entende continuacoes como `usa o mesmo nas 5`, `essa camera`, `o mesmo endereco` ou `agora faz a versao no step`.
- Em lotes de camera, consegue continuar coletando linhas, defaults compartilhados e regras de edicao ao longo da conversa.

## Memoria e coerencia

- O chat usa dois tipos principais de memoria de conversa:
  1. turns recentes para continuidade imediata.
  2. um contexto compacto para informacao mais antiga e duravel.
- O contexto compacto guarda fatos duraveis como resumo, objetivos do usuario, restricoes, preferencias, entidades selecionadas, decisoes e pendencias abertas.
- Alem disso, ele guarda memoria de tarefa para a operacao atual, incluindo tarefa ativa, fase, objetivo, campos coletados, campos faltantes e tarefas recentes concluidas.
- Ele tambem preserva entidades de sessao importantes, como ultimo nome ou id relevante, para ajudar em follow-ups curtos.
- Quando a conversa cresce demais, mensagens antigas sao compactadas e apenas os turns mais recentes ficam literais.
- Se a mensagem atual claramente muda de assunto, a mensagem atual prevalece sobre o contexto antigo.
- A memoria compacta nao deve guardar segredos como senhas, API keys, tokens, RTSP URLs ou outras credenciais privadas.

## Comportamento de idioma

- O chat foi estruturado para os idiomas de UI suportados: English, Portuguese, Spanish, French, Chinese e Arabic.
- Ele tenta responder no idioma do usuario.
- Se o idioma do usuario nao for suportado, faz fallback para English em vez de chutar um idioma parecido.
- O knowledge pode cair para English internamente, mas a resposta final ainda pode ser reescrita no idioma de resposta do usuario.

## Guardrails e limites importantes

- O chat nao deve inventar estado ao vivo. Se a resposta depende de inspecao, ele deve consultar o estado real primeiro.
- O chat nao deve inventar credenciais, IP, porta, usuario, senha ou endereco de camera que o usuario nao forneceu.
- Algumas acoes dependem do runtime local conectado, de uma sessao de chat valida, de dados existentes na conta e das permissoes ativas do produto.
- Explicacoes do produto devem se apoiar nos documentos locais de knowledge quando esse for o caminho mais seguro.
- As respostas finais sao polidas para continuar objetivas, focadas no produto e sem detalhes de implementacao.

## Bons exemplos de pergunta

- `o que o chat pode fazer?`
- `do que voce e capaz aqui?`
- `lista os tipos de coisa em que o chat me ajuda`
- `voce consegue inspecionar minhas cameras e jobs daqui?`
- `voce consegue criar ou editar cameras, agentes e jobs?`
- `como voce mantem contexto entre mensagens?`
- `quais sao seus limites?`

## Regra pratica

- Use o chat quando o usuario quiser uma destas tres coisas:
  1. uma explicacao confiavel sobre o produto.
  2. uma leitura ou busca sobre estado atual, historico ou video.
  3. uma acao guiada que pode continuar em varias mensagens ate ser confirmada ou concluida.
