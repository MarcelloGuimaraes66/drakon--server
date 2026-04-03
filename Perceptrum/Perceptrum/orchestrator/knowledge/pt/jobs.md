# Jobs

Use **Jobs** quando quiser um workflow agendado ou repetivel, em vez de um pedido pontual no chat.

## O que e um job

Um job e o container principal do workflow. Ele define quando o fluxo deve rodar, por quanto tempo a agenda fica ativa e como o trabalho e dividido em steps.

Um job nao faz sozinho a analise detalhada das cameras. No modelo atual do produto, a execucao real acontece dentro dos steps. As cameras sao adicionadas aos steps como targets, e a logica do agente e configurada dentro do contexto de cada step.

## Para que jobs sao uteis

- Revisoes noturnas ou horarias de areas selecionadas.
- Checagens recorrentes de seguranca que devem rodar automaticamente.
- Workflows com varias cameras e varias etapas.
- Automacoes estruturadas que nao dependem de alguem digitando no chat.
- Fluxos supervisionados de recebimento, transferencia, armazenagem, producao e expedicao.
- Verificacao de que um item, veiculo ou equipe passou pelas etapas esperadas na ordem correta.
- Workflows de controle gerencial, como conformidade de rota, confirmacao de entrega, checagem de filas, validacao de destino, tempo de execucao e revisao de excecoes.
- Casos em que o resultado importante nao e apenas detectar algo, mas confirmar sequencia, destino, atraso ou falha de handoff.

## Partes principais de um job

- **Name**: identifica o workflow com clareza.
- **Description**: explica o objetivo operacional ou de negocio.
- **Schedule**: controla quando o workflow roda. No fluxo atual do produto, jobs recorrentes usam modos como `weekly`, `monthly` ou `yearly`, com janelas de horario.
- **Active range**: controla a partir de qual data a agenda recorrente vale e ate quando ela permanece ativa.
- **Steps**: definem os estagios reais do trabalho dentro do job.
- **Step targets**: definem quais cameras ou fontes serao analisadas em cada step.
- **Step agents and alerts**: definem como cada step interpreta evidencias e o que deve acontecer quando uma condicao for atendida.

## Fluxo tipico

1. Abra **Jobs**.
2. Crie um novo job.
3. Dê um nome claro e, se fizer sentido, uma descricao curta.
4. Configure o schedule mode, os dias, as janelas de horario e o intervalo ativo.
5. Crie um ou mais steps.
6. Para cada step, defina ordem e timeout.
7. Para cada step, adicione as cameras target.
8. Para cada step ou target, configure o agente ou o comportamento de prompt adequado.
9. Se necessario, adicione start conditions, pipeline inputs, logica agrupada de varias cameras ou alerts.
10. Salve e ative o job.

## Exemplos praticos

Exemplo 1: revisao noturna de perimetro.

- Nome do job: `Revisao noturna de perimetro`
- Agenda: todos os dias as 23:00, dentro das janelas recorrentes configuradas
- Steps: entrada do perimetro, varredura do estacionamento, revisao do acesso traseiro
- Objetivo: checar pessoas ou veiculos fora do horario e gerar alerta apenas quando a condicao configurada for satisfeita

Exemplo 2: checagem horaria de recepcao.

- Nome do job: `Checagem de ocupacao da recepcao`
- Agenda: a cada hora, durante janelas de supervisao comercial
- Steps: revisao de ocupacao, severidade de fila, acompanhamento de acesso bloqueado
- Objetivo: identificar filas, lotacao ou bloqueio de acesso e gerar evidencia operacional repetivel

Exemplo 3: verificacao supervisionada de rota de carga.

- Nome do job: `Verificacao de recebimento ate destino`
- Agenda: sempre que uma janela de recebimento comecar, ou em intervalos fixos de supervisao
- Steps: confirmacao de recebimento, revisao do trajeto de transferencia, confirmacao de destino, revisao de excecao
- Targets: `Doca de Recebimento`, `Corredor Interno`, `Area de Armazenagem B`
- Objetivo: confirmar que uma carga recebida foi descarregada, percorreu o caminho esperado e chegou ao destino correto

Exemplo 4: supervisao de handoff operacional.

- Nome do job: `Revisao de passagem de turno`
- Agenda: no fim de cada turno
- Steps: conclusao da equipe que sai, revisao da area de handoff, assuncao da equipe que entra, revisao de excecao
- Targets: `Entrada da Producao`, `Area de Embalagem`, `Zona de Expedicao`
- Objetivo: verificar se as etapas esperadas da passagem de turno foram concluídas em sequencia e se algum atraso, desvio de rota ou material sem acompanhamento precisa de revisao

## Quando escolher um job em vez de um camera agent

Escolha um job quando:

- voce precisa de uma agenda rigorosa
- voce quer varios steps
- voce precisa de logicas diferentes em varias cameras
- voce quer um workflow estruturado, e nao apenas um observador continuo
- voce precisa de ordem, tempo, dependencias ou validacao de destino
- voce quer supervisionar um processo operacional ou de negocio, e nao so detectar um evento isolado
- voce quer confirmar que algo comecou em um ponto e terminou no destino correto
- voce precisa de evidencia visual para conformidade, qualidade de execucao ou tratamento de excecoes em um fluxo repetivel
- voce quer que uma etapa dependa da outra, seja por sequencia, start condition ou resultado compartilhado
