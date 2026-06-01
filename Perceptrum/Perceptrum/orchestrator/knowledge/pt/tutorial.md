# Tutorial

Fluxo basico:

1. Abra **Settings** e gere um codigo de pareamento.
2. Digite esse codigo no EXE desktop para conectar a maquina local a conta.
3. Adicione uma ou mais cameras.
4. Configure as API keys em **Settings** antes de habilitar a inferencia de IA.
5. Inicie os servicos das cameras e crie agentes ou jobs quando necessario.
6. Use o **Chat** para busca em video, ajuda sobre o app ou leitura do estado atual.

Atalhos uteis:

- **Chat** e o melhor lugar para perguntas em linguagem natural sobre imagens, videos e sobre como o app funciona.
- **AI Agents** serve para analise continua ou repetida em uma camera especifica.
- **Jobs** serve para fluxos agendados com varios passos e varios alvos.
- **Billing** cuida de tokens, assinaturas, cartoes e historico de pagamento.

Observacao sobre a etapa de cameras no tutorial guiado:

- A Etapa 2 usa a pagina **Cameras** como exemplo principal.
- As mesmas acoes tambem existem em **AI Agents**.
- O fluxo guiado primeiro destaca **Scan Network**, **Import Cameras** e **Register Camera**.
- Depois ele explica a aba **IP / RTSP**, muda para **Webcam**, tenta detectar uma webcam que esteja respondendo nesta maquina e preenche o nome `tutorial webcam`.
- Se nenhuma webcam responder, o tutorial pede para conectar uma webcam e tentar de novo, ou permite prosseguir mesmo assim para chegar ate a Etapa 3.
- Se o usuario optar por prosseguir sem webcam, a camera do tutorial ainda e criada, mas a inferencia nao e iniciada automaticamente no final.
- A Etapa 3 abre a pagina **Algorithms** da camera do tutorial, cria um custom AI agent chamado `thumbs up detector`, explica o **Enhance Prompt with AI** e salva o agente nessa camera.

Se um pedido precisar do estado atual da conta, o chat pode usar `read_state`. Se precisar de explicacao de produto, pode usar `explain_app`.
