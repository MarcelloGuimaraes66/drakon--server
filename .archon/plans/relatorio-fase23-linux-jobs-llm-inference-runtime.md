# Relatorio fase 23 - Linux jobs, comandos e LLM inference runtime

Data: 2026-05-25 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Branch local: `archon/linux-port-origin-main-sync`
Push: nao realizado

## Objetivo

Portar o caminho Linux de jobs/comandos e inferencia LLM sem ativar dependencias Windows, mantendo `PERCEPTRUM_ENABLE_JOB_RUNTIME=ON` atras de gate de build e gate runtime.

## Resultado

Foi adicionado um `LinuxJobRuntime` leve para o agente Linux:

- compila no target Linux quando `PERCEPTRUM_ENABLE_JOB_RUNTIME=ON`;
- roda como worker de polling em background dentro do `LinuxMinimalAgentRuntime`;
- consulta `/api/agent/commands?client_id=...` usando o token local, sem imprimir token;
- reporta resultados por `/api/agent/commands/:commandId/result?client_id=...`;
- publica status no `agent_health.json`: comandos processados, ultimo comando, ultimo erro, provider LLM e roots de inference temp;
- continua sem incluir `Perceptrum/core/AgentCore.cpp`, `CameraSession.cpp`, `FrameDiskWriter.cpp` ou `Perceptrum/jobs/JobRuntime.cpp` no target Linux.

## Comandos suportados

- `start_camera`: resolve payload RTSP/Webcam compativel com o adaptador Linux, gera thumbnail e clips via `RunLinuxRtspThumbnailProbe`.
- `stop_camera`: confirma parada funcional do comando no backend local.
- `job_start`: marca job local como ativo no runtime, executa `start_camera_payloads` quando presentes e grava artefato fake/local de inferencia em `jobs-inference-temp`.
- `job_stop`: cancela/remover job ativo no runtime Linux e confirma parada no backend.

## Diretorios integrados

Foram reutilizados os roots definidos na fase 22:

- thumbnails: `${APP_RUNTIME_CACHE_ROOT}/agentcore/camera-thumbnails`
- clips: `${APP_RUNTIME_DATA_ROOT}/frames`
- inference temp: `${APP_RUNTIME_CACHE_ROOT}/agentcore/inference-temp`
- jobs inference temp: `${APP_RUNTIME_CACHE_ROOT}/agentcore/jobs-inference-temp`
- eventos locais: `${APP_RUNTIME_STATE_ROOT}/events/agent_events.jsonl`
- health: `${APP_RUNTIME_DATA_ROOT}/agent_health.json`

## Provider fake/local

O runtime Linux usa provider fake/local por padrao (`PERCEPTRUM_LINUX_LLM_PROVIDER=fake` ou vazio):

- nao faz chamada externa;
- grava JSON de inferencia em `jobs-inference-temp`;
- retorna `fake_local_inference_ok` no resultado do comando;
- e coberto por CTest com servidor HTTP local falso em `Perceptrum/linux/tests/mock_command_server.js`.

`LocalLlmClient` tambem aceita provider fake/local por `CHATV2_LLM_PROVIDER=fake|local` ou URL `local://fake`.

## Teste real opcional

Chamadas reais continuam opt-in:

- `PERCEPTRUM_LINUX_LLM_PROVIDER=real` ou `openai` exige `OPENAI_API_KEY`;
- `PERCEPTRUM_LINUX_LLM_PROVIDER=zai` ou modelo `core`/`glm-*` exige `ZAI_API_KEY`;
- sem chave configurada, o runtime retorna erro funcional `missing_openai_api_key` ou `missing_zai_api_key`;
- `ChatModelConfig` agora usa `OPENAI_API_KEY`/`ZAI_API_KEY` como fallback quando o payload/settings nao carregam chave.

Nenhuma chamada real paga foi executada nesta fase.

## Tabelas afetadas

- `commands`: polling le comandos pendentes; o resultado volta para `commands.status/result/updated_at` pelo endpoint de result.
- `jobs`: origem do payload montado pelo scheduler/UI; usado para `job.id` e `job.name`.
- `job_steps`: origem dos steps no payload do scheduler, consumido pelo runtime como definicao de job.
- `openai_settings`: fonte de chave OpenAI no backend local/scheduler; fallback manual via `OPENAI_API_KEY`.
- `zai_settings`: fonte de chave Z.ai no backend local/scheduler; fallback manual via `ZAI_API_KEY`.
- `model_api_keys`: fonte de modelos/chaves/default_fps no scheduler; mantida sem impressao de segredos.

Na validacao automatizada Linux, o backend real foi substituido por servidor local falso para nao depender de D1/SQLite nem de provedor pago. A persistencia real de `commands.result` e a exibicao na UI seguem pelo endpoint existente `/api/agent/commands/:commandId/result` e pelo painel de comandos recentes.

## Validacao executada

Passou:

```bash
cd Perceptrum
cmake -S . -B out/build/linux-jobs -G Ninja -DCMAKE_BUILD_TYPE=Debug -DPERCEPTRUM_ENABLE_AGENT_CORE=ON -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON
cmake --build out/build/linux-jobs -j$(nproc)
ctest --test-dir out/build/linux-jobs --output-on-failure
cd ../DrakonSite && npm run test:local-sqlite-bootstrap && npm run build
```

Resultados:

- `linux-jobs`: 57/57 testes passaram.
- `npm run test:local-sqlite-bootstrap`: passou.
- `npm run build`: passou.

Avisos observados:

- staging do backend manteve os avisos conhecidos de `import.meta` em output CJS;
- WebKitGTK manteve aviso de API depreciada `webkit_web_view_run_javascript`.

## Pendencias

- O Linux ainda usa um `LinuxJobRuntime` portavel/leve em vez do `JobRuntime.cpp` completo do Windows, para evitar trazer as dependencias Win32/OpenCV legadas para o target Linux.
- O fake/local cobre inferencia automatizada; validacao real OpenAI/Z.ai deve ser manual e opt-in com chave configurada.
- Persistencia detalhada por step/agent em tabelas como `job_step_run_results` depende dos eventos estruturados completos do runtime legado; nesta fase o caminho validado grava o envelope de resultado em `commands.result` e artefato local em `jobs-inference-temp`.
