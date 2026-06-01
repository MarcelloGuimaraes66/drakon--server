# Agentes de Camera

Quando alguem perguntar como criar um agente, a resposta correta depende do fluxo desejado. Hoje existem dois lugares onde a logica do agente pode ficar.

## Os dois lugares onde um agente pode ser criado

1. **AI Agents**: o agente roda direto em uma camera. Esse e o lugar certo para monitoramento continuo por camera, sem schedule e sem integracao de output entre cameras.
2. **Jobs / Steps**: o agente roda dentro de um step, depois que uma camera e adicionada como target. Esse e o lugar certo quando o agente precisa fazer parte de um schedule, de um workflow com varias etapas ou de uma integracao entre cameras.

## Quando escolher cada um

- Use **AI Agents** quando uma camera deve ficar observando continuamente.
- Use **Jobs / Steps** quando voce precisa de schedule, dependencias, varias cameras ou coordenacao de output entre etapas.
- Os dois lugares usam a mesma ideia base: definir o que o agente deve reconhecer, quando ele deve alertar e o que ele precisa ignorar.

## Campos minimos obrigatorios

- **Name**: um nome claro para o agente.
- **Prompt core**: explique o que o agente deve reconhecer e em quais circunstancias.
- **Alert condition**: defina a condicao exata na qual o agente deve disparar alerta.

## Guias e filtros opcionais

- **Targets**: voce pode definir targets especificos para a analise.
- **Face targets**: voce pode adicionar fotos do rosto quando o cenario depende de reconhecer uma pessoa especifica.
- **Negative condition**: descreve o que nao deve gerar alerta.
- **Negative reference images**: adiciona imagens negativas quando o modelo precisa entender com mais clareza o que deve ignorar.

## Enhance Prompt with AI

- No editor do agente de camera existe um botao chamado **Enhance Prompt with AI**.
- Esse botao analisa o prompt atual do usuario junto com a preview mais recente ou snapshot streamado daquela camera.
- O objetivo e montar uma sugestao de prompt mais completa e detalhada, reforcando a intencao do usuario e reduzindo falsos positivos.
- O botao melhora a sugestao de texto, mas o usuario ainda deve revisar o resultado antes de aplicar.

## Modelo e cadencia de alerta

- **Ultra**: menor latencia e possibilidade de emitir alertas a cada 10 segundos.
- **Core**: camada gratuita, maior latencia e alertas fixos a cada 60 segundos.
- Escolha **Ultra** quando o caso exige reacao mais rapida.
- Escolha **Core** quando 60 segundos sao aceitaveis e o custo menor e mais importante.

## Video packaging

- **High resolution**: envia frames no tamanho original.
- **Standard resolution**: envia a imagem cerca de 4x menor.
- **Compact resolution**: envia a imagem cerca de 6x menor.
- Modos menores reduzem o consumo de input tokens, mas tambem podem reduzir a qualidade da analise.
- Objetos pequenos analisados em **Compact resolution** podem gerar mais falsos positivos ou falsos negativos.

## Input type

- **Video**: envia uma sequencia de frames. Use quando o modelo precisa entender acoes rapidas, movimentos curtos ou contexto temporal breve.
- **Image**: envia snapshots. Com cadencia de 10 segundos, manda um snapshot a cada 10 segundos; com 60 segundos, manda um snapshot a cada 60 segundos.
- **Image + 10s** costuma ser uma combinacao forte quando analise temporal curta nao e necessaria, porque geralmente consome menos tokens do que video e ainda mantem boa cobertura.
- Regra pratica: use **Video** para movimento curto e acao rapida; use **Image** quando snapshots periodicos forem suficientes.

## Poligonos e regioes com gatilho por movimento

- No canto superior esquerdo do editor, o usuario pode criar poligonos nomeados.
- O programa so envia inferencia quando ha movimento dentro de um desses poligonos.
- Isso permite analisar apenas quadrantes ou regioes especificas da cena em vez do frame inteiro o tempo todo.

## Fluxo tipico em AI Agents

1. Abra **AI Agents**.
2. Escolha a camera.
3. Abra a tela **Configure AI Agents / Algorithms** dessa camera.
4. Clique em **Create Custom AI Agent**.
5. Preencha **Name**, **Prompt core** e **Alert condition**.
6. Se necessario, adicione targets, fotos de rosto, condicoes negativas e imagens negativas.
7. Escolha modelo, cadencia, input type e modo de **Video packaging**.
8. Crie poligonos se a analise deve observar apenas regioes especificas.
9. Salve e habilite o agente.

## Fluxo tipico em Jobs / Steps

1. Abra **Jobs**.
2. Crie ou edite o job.
3. Crie um **step**.
4. Adicione a camera como target dentro desse step.
5. Abra o editor do agente da etapa.
6. Configure **Name**, **Prompt core**, **Alert condition** e as mesmas opcoes visuais e de execucao usadas nos agentes de camera.
7. Use esse caminho quando o agente fizer parte de um schedule ou de um workflow que coordena varias cameras ou etapas.

## Observacao sobre a Etapa 3 do tutorial

- O tutorial guiado usa o caminho continuo por camera em **AI Agents**.
- A Etapa 2 cria a camera do tutorial pela pagina **Cameras**, mas os mesmos pontos de cadastro tambem existem em **AI Agents**.
- Depois que a camera do tutorial existe, a Etapa 3 abre a pagina **Algorithms** dessa camera e cria um custom AI agent ali.
- O agente de exemplo se chama **thumbs up detector**. Na copy em portugues do tutorial, o mesmo exemplo aparece como **detector de afirmativo**.
- O preset do tutorial usa:
  - **Prompt core**: reconhecer qualquer pessoa fazendo o sinal de afirmativo ou thumbs up com a mao.
  - **Alert condition**: alertar se qualquer pessoa estiver fazendo o sinal de afirmativo ou thumbs up com a mao.
- Se **OpenAI** estiver disponivel, o tutorial prefere **Ultra**, **Video**, **High resolution**, **cadencia de 10 segundos** e **FPS 1**.
- Se apenas **Z.ai** estiver configurado, o tutorial usa **Core**. **High resolution** continua selecionado, mas o app mantem a **cadencia fixa de 60 segundos** do Core.
- O tutorial explica primeiro o seletor de **modelo** e, logo depois, o seletor de **input type** como dois passos destacados separados.
- Depois de salvar o agente, o tutorial volta para a pagina **Algorithms** da camera para explicar o toggle que liga ou pausa esse agente naquela camera.
- A ultima acao guiada volta para **AI Agents** e inicia o servico da camera do tutorial, para que o usuario possa testar imediatamente o detector de afirmativo.

## Regra pratica

- Escolha **AI Agents** para um agente continuo e direto em uma camera.
- Escolha **Jobs / Steps** quando o agente precisa ser agendado ou integrado com outras cameras, etapas ou outputs.
