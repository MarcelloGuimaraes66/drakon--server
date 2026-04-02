# Orquestracao de Jobs Complexos

Use este guia quando a pergunta nao for apenas "como criar um job", mas sim "como desenhar um workflow analitico com varios steps, varias cameras, dependencia temporal, reuso de resposta e validacao final".

Este documento nao descreve um caso unico. Ele existe para orientar outro chat a propor varias alternativas de jobs com base nos recursos reais do Perceptrum + DrakonSite.

## Capacidade do produto

O modulo de Jobs permite orquestrar analises em varios estagios, correlacionando cameras, janelas temporais e regras de negocio.

Na pratica, a plataforma consegue:

- executar workflows recorrentes;
- distribuir a analise em varios steps;
- usar uma ou varias cameras por step;
- iniciar steps por sequencia, horario, atraso relativo ou condicao derivada de outro step;
- usar o output de um step como contexto de outro por meio de pipeline;
- consolidar evidencias de pontos diferentes em um step validador;
- aplicar regras finais de negocio somente no step decisor;
- disparar alertas a partir da combinacao de resultados parciais.

Isso significa que o produto nao deve ser tratado apenas como "um agente por camera", e sim como um mecanismo de orquestracao analitica.

## Regra mestra para responder

Quando alguem pedir ajuda para montar um job sofisticado:

1. nao assumir um desenho unico logo de cara;
2. identificar o objetivo operacional real;
3. escolher a topologia do workflow;
4. separar steps de coleta dos steps de decisao;
5. definir como a resposta de um step sera reutilizada por outro;
6. definir em qual step o alerta deve nascer.

Quando houver mais de uma topologia valida, a resposta ideal e oferecer `N alternativas`, com tradeoff de simplicidade, robustez e custo.

## Componentes que formam a orquestracao

### Camera

Recurso cadastrado fora do job.

O job nao cria camera do nada. Ele consome cameras ja existentes.

Referencia de produto:

- `DrakonSite/src/react-app/pages/Cameras.tsx`
- `DrakonSite/src/worker/index.ts`

### Job

Define o workflow, a agenda e o periodo ativo.

Campos mais importantes:

- `name`
- `description`
- `schedule_mode`
- `schedule_days`
- `active_from`
- `active_until`

Referencia de produto:

- `DrakonSite/src/react-app/pages/Jobs.tsx`
- `DrakonSite/src/worker/index.ts`

### Step

Cada step e uma etapa logica do workflow.

Campos mais importantes:

- `step_order`
- `name`
- `timeout_seconds`

Observacao importante:

- o timeout minimo efetivo no scheduler e no runtime e `120` segundos.

Referencia de produto:

- `DrakonSite/src/react-app/pages/Jobs.tsx`
- `DrakonSite/src/worker/jobScheduler.ts`
- `Perceptrum/Perceptrum/jobs/JobRuntime.cpp`

### Target

Um target e a camera vinculada ao step.

Regra pratica:

- primeiro cria o step;
- depois adiciona a camera como target;
- depois configura o agent daquele target.

### Agent

O agent define a inferencia daquele target no step.

Campos importantes:

- `agent_key`
- `prompt_template`
- `alert_condition`
- `negative_condition`
- `input_type`
- `video_packaging_mode`
- `inference_model`
- `run_every`
- `only_capture_on_motion`
- `use_temporal_context`
- `analysis_regions`

Regra pratica:

- steps de coleta devem produzir respostas previsiveis;
- steps validadores devem consumir contexto e aplicar regra de negocio;
- quando houver pipeline, o prompt do step downstream deve comecar com `Use PIPELINE_INPUTS como fonte principal.`

### Start Condition

Define quando um step pode iniciar.

Modos relevantes no projeto:

- `sequential`
- `time`
- `elapsed`
- `positive`
- `negative`
- `custom`

Uso tipico:

- `sequential`: quando a ordem por si so ja resolve;
- `time`: quando varios steps devem iniciar no mesmo horario ou quando um validador precisa esperar a janela de coleta;
- `elapsed`: quando o gatilho e um atraso relativo;
- `positive` e `negative`: quando um step deve depender de uma chave padrao de resposta anterior;
- `custom`: quando a chave observada e especifica do negocio.

### Pipeline

Define como o output de steps anteriores entra no contexto do step atual.

Regras praticas:

- pipeline e configurado no step de destino;
- cada linha liga `step origem + target origem + target destino`;
- o runtime injeta preferencialmente o campo `answer` do step anterior;
- downstream nao deve depender de JSON arbitrario se o upstream nao for determinista.

### Alert

O alerta deve nascer no step que toma a decisao final, e nao necessariamente no primeiro step que observou algo.

Observacao importante:

- o runtime depende de `alert_condition=true` no output da inferencia;
- `condition_expr` hoje e efetivamente usado como `true`.

### Inference Groups

Use inference groups quando varios targets do mesmo step compartilham a mesma logica e a mesma decisao, sem precisar de pipeline entre steps.

Use multiplos steps quando o problema exigir:

- tempos diferentes;
- regras diferentes;
- dependencia entre respostas;
- validacao final separada.

Referencia de runtime:

- `Perceptrum/Perceptrum/jobs/JobPayloadParser.cpp`
- `Perceptrum/Perceptrum/jobs/JobRuntime.cpp`

## Como escolher a topologia correta

Antes de preencher formularios, responda mentalmente:

1. o objetivo e observacao continua por camera ou workflow agendado?
2. quantos pontos de evidencia existem?
3. todas as cameras observam a mesma janela ou janelas diferentes?
4. a decisao final depende de uma comparacao, de uma sequencia ou de uma condicao?
5. o output de um step precisa virar input de outro?
6. o alerta deve nascer no primeiro indico ou somente na consolidacao final?

Se o caso for monitoramento continuo de uma unica camera, preferir `AI Agents`.

Se o caso exigir coordenacao entre cameras, horarios, validacoes ou reutilizacao de resposta, preferir `Jobs / Steps`.

## Catalogo de padroes

### Padrao 1: Auditoria simples em uma camera

Use quando:

- ha apenas uma camera;
- o objetivo e rodar em horarios definidos;
- nao existe dependencia entre etapas.

Desenho:

- Job com 1 step
- 1 ou mais targets no mesmo step
- alerta no proprio step

### Padrao 2: Coleta paralela + validador final

Use quando:

- varias cameras observam a mesma janela;
- a resposta final depende da comparacao entre resultados;
- o alerta so deve acontecer depois da consolidacao.

Desenho:

- Step 1: coleta em camera A
- Step 2: coleta em camera B
- Step 3: validador final

Configuracao tipica:

- Step 1 e Step 2 com `start condition` no mesmo horario;
- Step 3 com `start condition` no fim da janela;
- pipeline de Step 1 e Step 2 para Step 3;
- alerta apenas no Step 3.

### Padrao 3: Cadeia de passagem

Use quando:

- o evento precisa percorrer varios pontos;
- importa saber se houve passagem por origem, transito e destino;
- a decisao final depende da sequencia completa.

Desenho:

- Step 1: origem
- Step 2: ponto intermediario 1
- Step 3: ponto intermediario 2
- Step N: destino
- Step final: validador do circuito

Configuracao tipica:

- steps de coleta iniciam na mesma janela ou em janelas sobrepostas;
- step final comeca ao final da janela total;
- pipeline de todos os coletores para o validador.

### Padrao 4: Investigacao condicional

Use quando:

- um step so faz sentido se o anterior encontrar certo indico;
- o custo de analisar tudo o tempo todo seria desnecessario;
- a logica pede confirmacao secundaria.

Desenho:

- Step 1: detector inicial
- Step 2: confirmacao ou detalhamento
- Step 3: decisao final

Configuracao tipica:

- Step 2 usa `start condition` do tipo `positive`, `negative` ou `custom`;
- Step 2 pode olhar outra camera ou outro target;
- Step 3 consolida o que foi observado.

### Padrao 5: Consolidacao N para 1

Use quando:

- varias cameras diferentes produzem fragmentos de evidencia;
- o que importa e uma visao consolidada final;
- o step final precisa receber varios outputs anteriores.

Desenho:

- varios steps coletores
- um unico step consolidador

Configuracao tipica:

- pipeline multiplo para um unico target do validador;
- prompts de coleta com formato fixo;
- prompt final com regra de negocio explicita.

### Padrao 6: Escalonamento ou dupla validacao

Use quando:

- existe um primeiro alerta tecnico e uma segunda camada de confirmacao;
- o negocio quer reduzir falso positivo antes da entrega final;
- e preciso revisar a mesma evidencia por outra regra.

Desenho:

- Step 1: detector bruto
- Step 2: revisor
- Step 3: entrega do alerta

### Padrao 7: Multi-target no mesmo step

Use quando:

- varias cameras podem ser tratadas pela mesma regra e no mesmo instante;
- o problema nao exige dependencia temporal entre cameras;
- a decisao pode ocorrer dentro do proprio step por inference group.

Nao usar esse padrao quando a tarefa pede:

- tempos diferentes por camera;
- reutilizacao de resposta de um step em outro;
- cadeia de validacao;
- start condition diferente por etapa.

## Como desenhar prompts para orquestracao

Quando houver pipeline, o ponto mais importante nao e o texto bonito, e sim o contrato de resposta.

### Steps de coleta

Steps de coleta devem responder de forma curta, estavel e parseavel.

Exemplo generico:

```text
STEP_RESULT step_role=<coleta|confirmacao|medicao> camera=<nome> status=<valor_padrao> value=<inteiro_ou_texto_curto> evidence=<texto_curto>
```

### Steps validadores

Steps validadores devem:

- ler `PIPELINE_INPUTS`;
- consolidar as respostas recebidas;
- aplicar a regra de negocio;
- devolver uma decisao final.

Exemplo generico:

```text
VALIDATION_RESULT status=<OK_ou_ALERTA> reason=<texto_curto> action=<texto_curto>
```

### Regra de ouro para respostas

Se outro step vai reutilizar o output, evite:

- paragrafo longo;
- variacao de estrutura entre execucoes;
- resposta narrativa sem chaves fixas.

Prefira:

- linha unica;
- chaves estaveis;
- vocabulos controlados como `OK`, `ALERTA`, `YES`, `NO`, `PRESENTE`, `AUSENTE`.

## Como usar Start Condition corretamente

### `sequential`

Use quando a ordem natural basta.

Bom para:

- fluxo linear simples;
- revisao que so comeca quando o step anterior acaba.

### `time`

Use quando:

- varios steps precisam iniciar juntos;
- o step final precisa esperar o fim da janela;
- o workflow deve refletir um horario absoluto do job.

Padrao forte:

- coletores no minuto `T`
- validador no minuto `T + janela`

### `elapsed`

Use quando a forma mais clara de expressar a espera e um atraso relativo em segundos ou minutos.

### `positive`, `negative` e `custom`

Use quando a etapa seguinte depende de uma resposta anterior.

Campos conceituais importantes:

- `from_step_id`: step observado
- `answer_key`: chave ou marcador esperado
- `target_key`: camera ou target de referencia
- `on_fail`: comportamento quando o input nao vier

## Como usar Pipeline corretamente

Pipeline nao substitui a regra de negocio. Ele apenas entrega contexto entre steps.

Regras importantes:

1. pipeline e configurado no step downstream;
2. cada linha aponta para um step anterior;
3. o runtime injeta o `answer` anterior em `PIPELINE_INPUTS`;
4. consolidacao e comparacao precisam estar descritas no prompt do step final;
5. `on_missing_input` deve ser pensado deliberadamente:
   - `skip` para seguir sem um input ausente;
   - `fail` para tratar a ausencia como erro de workflow.

## Heuristicas para montar alternativas de job

Quando outro chat receber um pedido vago, a melhor resposta normalmente e oferecer de `2` a `4` desenhos alternativos.

Cada alternativa deve informar:

- objetivo;
- cameras por step;
- ordem dos steps;
- tipo de `start condition`;
- quais steps alimentam `pipeline`;
- onde fica a decisao final;
- onde nasce o alerta.

Exemplo de comparacao util:

- alternativa A: mais simples, menos robusta;
- alternativa B: mais controlada, com validador final;
- alternativa C: mais sofisticada, com confirmacao condicional ou escalonamento.

## Restrições e comportamentos reais do projeto

- o primeiro step normalmente inicia com o job;
- o timeout minimo efetivo e `120` segundos;
- a UI de criacao de job trabalha com agenda recorrente;
- `pipeline` reutiliza principalmente o `answer` anterior;
- o alerta depende de `alert_condition=true` no output;
- `Ultra` e mais apropriado para workflows complexos ou baixa latencia;
- `Core` tem restricoes maiores e cadencia mais lenta;
- prompt de coleta e prompt de decisao nao devem ser misturados no mesmo step sem necessidade.

## Mapa de referencias do codigo

### UI e formularios

- `DrakonSite/src/react-app/pages/Jobs.tsx`
  - criacao e edicao de jobs;
  - steps;
  - targets;
  - editor de agents;
  - start condition;
  - pipeline;
  - alerts;
  - inference groups.

### Backend web

- `DrakonSite/src/worker/index.ts`
  - endpoints de jobs, steps, targets, agents e alerts.

Endpoints mais importantes:

- `POST /api/jobs`
- `PUT /api/jobs/:id`
- `POST /api/jobs/:jobId/steps`
- `PATCH /api/job-steps/:stepId`
- `POST /api/job-steps/:stepId/targets`
- `POST /api/job-steps/:stepId/agents`
- `POST /api/job-steps/:stepId/alerts`

### Scheduler

- `DrakonSite/src/worker/jobScheduler.ts`
  - normalizacao de timeout;
  - derivacao de `start_condition`;
  - derivacao de `pipelines`;
  - serializacao do payload que vai para o runtime.

### Parser de payload

- `Perceptrum/Perceptrum/jobs/JobPayloadParser.cpp`
  - parse de `start_condition`;
  - parse de `pipeline` e `pipelines`;
  - parse de `inference_groups`.

### Runtime

- `Perceptrum/Perceptrum/jobs/JobRuntime.cpp`
  - enforcement do timeout minimo;
  - inicio por horario e atraso;
  - injecao de `PIPELINE_INPUTS`;
  - consolidacao de grupos;
  - disparo de alerts.

### Skill que responde no chat

- `Perceptrum/Perceptrum/orchestrator/skills/ExplainAppSkill.cpp`
- `Perceptrum/Perceptrum/orchestrator/KnowledgeBase.cpp`

## Como outro chat deve responder

Quando a pergunta for sobre jobs complexos, o chat deve:

1. decidir se o caso pertence a `AI Agents` ou `Jobs / Steps`;
2. identificar a topologia adequada;
3. propor alternativas quando houver mais de um desenho razoavel;
4. descrever os steps como papeis logicos, nao apenas como cameras;
5. separar coleta, confirmacao, validacao e entrega;
6. explicar como `start condition` e `pipeline` conectam o fluxo;
7. orientar o preenchimento dos formularios somente depois de escolher a arquitetura.

Nunca reduzir o produto a um unico exemplo de contagem se o usuario estiver pedindo um padrao generico de orquestracao.
