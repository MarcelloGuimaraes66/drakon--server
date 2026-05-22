# Prompt 1 - Analise do fonte perceptrum_desktop_aspp

Data da leitura: 2026-05-21

## Escopo

Fonte lido:

```text
/home/marcello-guimaraes/dev/perceptrum_desktop_aspp
```

Alvo dos relatorios:

```text
/home/marcello-guimaraes/dev/drakon-server
```

Esta fase foi somente leitura e documentacao. Nenhum codigo do repositorio-fonte foi alterado, copiado, apagado, commitado ou enviado por push.

## Estado geral observado

O `perceptrum_desktop_aspp` combina quatro superfices diferentes:

- Runtime C++ de captura, inferencia, jobs e agente.
- Host desktop Windows/WinUI em `AppHost/`.
- Backend/site Node/TypeScript em `DrakonSite/`.
- Uma base Linux parcial em `Perceptrum/CMakeLists.txt`, com C++23, CMake, CURL e feature gates para `AgentCore`, captura, RTSP, jobs e frame writer.

O ponto mais importante para o `drakon-server`: existe bastante dominio aproveitavel, mas o codigo atual nao deve ser portado inteiro. `CameraSession.cpp` e `AgentCore.cpp` concentram captura, inferencia, chamadas HTTP, eventos, chat, Drakon Find, jobs, thumbnails, telemetry e detalhes de plataforma. Para servidor headless, a abordagem correta e extrair contratos e refatorar modulos menores.

## Onde ficam os dominios principais

| Dominio | Fonte principal | Observacao |
|---|---|---|
| Cameras | `Perceptrum/Perceptrum/camera/CameraConfig.h`, `CameraSession.*` | Config, sessoes, controle de start/stop, thumbnails e acoplamento com `AgentCore`. |
| RTSP | `camera/RtspCapture.*` | Usa FFmpeg/libav e retorna `cv::Mat` BGR. Bom candidato para extracao/refatoracao. |
| Webcam | `CameraConfig.webcam_index`, `CameraSession::runWebcamCapture_`, `/api/webcams/probe` | Logica existe acoplada a `CameraSession` e comandos do agente. |
| Frames/buffer | `Frame.h`, `FrameBuffer.*` | Primitivos simples e reaproveitaveis com ajustes de namespace/testes. |
| Escrita em disco | `FrameDiskWriter.*`, `DrakonSite/src/worker/cameraRecordings.ts` | Layout e contratos sao uteis; implementacao atual usa Media Foundation no Windows para video. Reimplementar em Linux com FFmpeg/OpenCV. |
| Movimento | `MotionDetector.*` | Logica OpenCV simples, boa candidata a reutilizacao/refatoracao. |
| Jobs/steps | `jobs/JobTypes.h`, `JobPayloadParser.*`, `JobRuntime.*` | Contratos ricos para jobs, steps, grupos de inferencia, pipelines, start conditions e alertas. |
| Agentes | `CameraConfig.AlgorithmConfig`, `JobAgentDef`, `orchestrator/skills/*` | Agentes aparecem como algoritmos de camera e como agentes de step. |
| Inferencia LLM | `AgentCore.*`, `LocalLlmClient.*`, `ChatModelConfig.*`, `TemporalEngine.h` | Mistura OpenAI, Gemini, modelos locais/compativeis e prompt engineering. Extrair interfaces, nao o monolito. |
| Alertas | `JobAlertRule`, `TelegramNotifier.*`, `/api/agent/events`, tabelas `events`, `notifications`, `job_run_alerts` | Alertas devem virar modulo proprio com JSON/JSONL e emissores. |
| Banco | `DrakonSite/db/patches/*.sql`, `server/sqlite-d1.ts`, `server/pg-d1.ts`, `comm/PgClient.h` | Schema fonte tem PostgreSQL e adaptadores SQLite no site. O servidor deve ter camada DB propria. |
| API/comandos | `DrakonSite/src/worker/index.ts`, `AgentCore::processCommand_` | Contrato atual e por polling em `/api/agent/commands` e POST de resultados/eventos. |
| Dashboard | `DrakonSite/src/react-app/`, paginas e hooks | Pertence ao cliente visual. Nao deve entrar no servidor. |

## Modulos obrigatorios lidos e classificacao

### Camera e captura

| Arquivo/modulo | Classificacao | Motivo |
|---|---|---|
| `CameraConfig.h` | extrair/refatorar | Define `CameraConfig`, `AlgorithmConfig`, armazenamento, RTSP, webcam, captura, agentes, alertas e modelos. Deve virar contrato limpo, sem campos de secret em memoria/logs quando evitavel. |
| `Frame.h` | reutilizar diretamente com namespace | Tipo simples: imagem OpenCV, timestamp e camera id. Ajustar para timestamp de sistema/UTC alem de `steady_clock`. |
| `FrameBuffer.*` | reutilizar diretamente com testes | Ring buffer thread-safe e contador de overwrite. Precisa namespace, testes e politicas de shutdown. |
| `RtspCapture.*` | extrair/refatorar | Bom isolamento dos headers FFmpeg no `.cpp`; usa `AVFormatContext`, `AVCodecContext`, `sws_scale` e `cv::Mat`. Precisa sanitizar URL e parametrizar reconnect/backoff. |
| `MotionDetector.*` | reutilizar diretamente com ajustes | Usa OpenCV para diff de frame anterior e background. Boa base para captura sob movimento. |
| `FrameDiskWriter.*` | usar como referencia/refatorar | Layout e perfis 10s/60s sao uteis, mas a implementacao de video esta acoplada a Media Foundation no Windows. No Linux deve usar FFmpeg/libav ou OpenCV VideoWriter conforme qualidade exigida. |
| `PerfMetrics.h` | usar apenas como referencia | Mede CPU por thread com Win32; retorna 0 fora de Windows. Precisa implementacao Linux propria via `/proc`, `clock_gettime` ou bibliotecas. |
| `CameraSession.*` | extrair/refatorar, nao copiar inteiro | Concentra captura, inferencia, thumbnails, eventos, jobs, Drakon Find, temporal, telemetry e chamadas ao backend. Deve ser quebrada em `CameraWorker`, `CaptureEngine`, `FramePipeline`, `InferenceScheduler` e `EventSink`. |

### Core

| Arquivo/modulo | Classificacao | Motivo |
|---|---|---|
| `AgentCore.*` | usar como referencia; extrair contratos | Monolito de polling, command dispatch, camera sessions, jobs, chat, LLM, Drakon Find, uploads, eventos e telemetry. Nao deve virar biblioteca direta do servidor. |
| `TemporalEngine.h` | extrair/refatorar | Header-only com normalizacao de eventos, zonas, plano temporal e construcao/evolucao de estado. Candidato a biblioteca interna `drakon_temporal`. |
| `TemporalEvidence.h` | reutilizar diretamente com namespace | Contrato simples para evidencia temporal. |
| `AnalysisRegionGeometry.*` | reutilizar/refatorar | Geometria normalizada, crop de frame window e poligonos. Boa biblioteca interna para regioes de analise. |
| `ContentCoverageTracker.h` | reutilizar diretamente com namespace | Rastreamento de cobertura temporal por intervalos; bom para jobs e drenagem ate alvo. |
| `VideoPolygonOverlayRenderer.*` | manter fora do servidor inicialmente | Renderiza overlays em video/imagem; util para debug/evidencia, mas nao deve ser dependencia inicial do headless. |

### Jobs

| Arquivo/modulo | Classificacao | Motivo |
|---|---|---|
| `JobTypes.h` | extrair/refatorar como contrato | Define jobs, steps, agents, targets, alert rules, inference groups, pipelines e start conditions. E um dos contratos centrais do `drakon-server`. |
| `JobPayloadParser.*` | extrair/refatorar | Parser do payload `job_start`. Deve virar validador de JSON estruturado com erros claros e testes. |
| `JobRuntime.*` | usar como referencia e refatorar por partes | Runtime possui maquina de estados, execucao por step, hooks temporais, cobertura e inferencia. Deve ser decomposto antes de portar. |

### Orquestrador e agentes

| Arquivo/modulo | Classificacao | Motivo |
|---|---|---|
| `SkillTypes.h`, `SkillRegistry.*` | extrair/refatorar para contratos | Interfaces de skills podem inspirar uma camada de comandos/agentes, mas sem depender do chat/UI. |
| `LocalLlmClient.*`, `ChatModelConfig.*`, `HttpUtils.*`, `ConfigUtils.*` | extrair/refatorar | Uteis para cliente HTTP/LLM e configuracao, mas devem esconder provider e secrets atras de interfaces. |
| `ChatV2Orchestrator.*`, `PromptBuilder.*`, `KnowledgeBase.*`, `OperationTaskState.*` | usar como referencia | Fortemente voltados a conversa, authoring e dashboard. Nao sao base da primeira versao headless. |
| `orchestrator/skills/*` | dividir | `control_camera`, `control_job`, `read_state`, `video_search` sao referencia para comandos. `create/edit camera`, `create/edit job`, authoring e reports pertencem mais ao dashboard/cliente ou a uma API futura. |

### Comunicacao e alertas

| Arquivo/modulo | Classificacao | Motivo |
|---|---|---|
| `BackendConfig.*` | usar como referencia | Resolve base URL do backend atual. O `drakon-server` deve ter config propria. |
| `PairingClient.*` | usar como referencia | Modelo atual de pareamento EXE/backend. Pode inspirar um modo cliente do dashboard, mas nao deve ser obrigatorio no servidor local. |
| `TelegramNotifier.*` | extrair/refatorar | Canal de alerta util, baseado em libcurl. Precisa sanitizacao de token, retry, timeout e interface comum de notificadores. |
| `PgClient.h` | usar como referencia | Wrapper libpq minimo. Para o `drakon-server`, preferir uma camada DB mais completa e testavel. |
| `SecureLocalStore.*`, `platform_secure_store.*` | extrair/refatorar com cuidado | Guardar tokens/secrets e essencial. No Linux usa `secret-tool` quando disponivel e fallback controlado. |

### Runtime e plataforma

| Arquivo/modulo | Classificacao | Motivo |
|---|---|---|
| `runtime/interfaces/*` | reutilizar/refatorar | `RuntimeRoots`, logger, token store, status e factory sao bons contratos para headless. |
| `HeadlessService.*` | usar como referencia | Ja tem loop headless injetavel, mas o modo Linux atual e minimo e bloqueia o AgentCore completo. |
| `BrandingRuntime.*` | manter fora ou refatorar minimo | Branding e legado de produto; servidor deve ter identidade/config propria. |
| `platform_common.*`, `platform_process.*`, `platform_shutdown.*` | extrair/refatorar | Util para paths, processos e shutdown Linux. Remover restos Win32 onde nao forem necessarios. |

### Site/backend/dashboard

| Area | Classificacao | Motivo |
|---|---|---|
| `DrakonSite/server/*` | usar como referencia de DB/API local | Mostra adaptadores SQLite/PostgreSQL e servidor local Node, mas nao pertence ao binario C++. |
| `DrakonSite/src/worker/index.ts` | usar como contrato | Contem rotas de cameras, comandos, eventos, jobs, Drakon Find, pareamento, Telegram, settings, billing e dashboard. |
| `DrakonSite/src/worker/cameraRecordings.ts` | usar como contrato de arquivos | Le layout `cam_<id>/YYYY/MM/DD` e arquivos de clips por timestamp/cadencia. |
| `DrakonSite/src/react-app/*` | pertence ao dashboard cliente | Nao deve entrar no servidor. Apenas define necessidades de leitura: dashboard, eventos, alertas, recordings, jobs e cameras. |
| `AppHost/*` | manter fora do servidor | WinUI, WebView2, WinAppSDK, tray, paginas e persistencia desktop. Usar so para entender contrato historico. |

## Dependencias externas identificadas

### C++/native

- C++23 e CMake.
- `nlohmann-json`.
- `libcurl`.
- FFmpeg/libav: `libavformat`, `libavcodec`, `libavutil`, `libswscale`.
- OpenCV: `cv::Mat`, image processing, encode/decode, capture auxiliary.
- PostgreSQL/libpq: `PgClient.h` e `libpq` no projeto Windows.
- SQLite: usado no host/site; o C++ Windows tambem linka `winsqlite3`.
- Windows especifico no fonte atual: WinUI/WinRT, Windows App SDK, WebView2, Media Foundation, DPAPI/CryptProtectData, Win32 process/thread APIs.
- Linux especifico ja iniciado: POSIX process/shutdown, `secret-tool`, XDG paths.

### Node/DrakonSite

- Node/TypeScript, Vite, React, Hono, zod.
- `pg` para PostgreSQL.
- `better-sqlite3-multiple-ciphers` e `node:sqlite`.
- `ws` para WebSocket.
- Stripe, bcryptjs, jose, i18n, xlsx.

### LLM/provedores

- OpenAI/OpenAI-compatible chat completions e responses.
- Gemini/Google vision/video em trechos de `AgentCore`.
- Modelo local/compativel via `LocalLlmClient` com base URL, API key e modelo configuraveis.

## Contratos API relevantes para o servidor

O contrato atual entre backend/dashboard e agente C++ e baseado em pareamento, polling de comandos e POST de resultados:

- `POST /api/pairing/generate`
- `POST /api/pairing/pair`
- `GET /api/pairing/status`
- `POST /api/pairing/disconnect`
- `GET /api/agent/commands?client_id=...`
- `POST /api/agent/commands/:commandId/result?client_id=...`
- `POST /api/agent/events?client_id=...`
- `POST /api/agent/capture-thread-metrics?client_id=...`
- `POST /api/agent/open-monitor-snapshot?client_id=...`
- `GET /api/agent/cameras?client_id=...`
- `GET /api/agent/cameras/:id?client_id=...`
- `GET /api/agent/jobs?client_id=...`
- `GET /api/agent/jobs/:jobId/snapshot?client_id=...`
- `POST /api/agent/cameras/:cameraId/start?client_id=...`
- `POST /api/agent/cameras/:cameraId/stop?client_id=...`
- `POST /api/agent/jobs/:id/start?client_id=...`
- `POST /api/agent/jobs/:id/stop?client_id=...`

Comandos consumidos por `AgentCore::processCommand_`:

- `start_camera`
- `stop_camera`
- `probe_webcams`
- `job_start`
- `job_stop`
- `prompt_enhance`
- `temporal_recompile`
- `agent_design`
- `refresh_thumbnail`
- `camera_import_preview`
- `drakon_find_start`
- `drakon_find_cancel`
- `chat_cancel`
- `chat_identity_upsert`
- `update_algorithms`
- `orchestrator_query`
- `chat_query` legado/depreciado

Para o `drakon-server`, esses comandos devem virar uma API local/contrato JSON interno ou adaptador opcional para o dashboard, nao necessariamente o mesmo polling.

## Tabelas e dados relevantes

Tabelas fonte mais importantes:

- `cameras`
- `camera_algorithms`
- `commands`
- `events`
- `detections`
- `notifications`
- `exe_pairings`
- `job_runtime_states`
- `jobs`
- `job_steps`
- `job_step_targets`
- `job_step_agents`
- `job_step_alert_rules`
- `job_step_runs`
- `job_step_run_results`
- `job_step_run_logs`
- `job_run_alerts`
- `model_api_keys`
- `telegram_settings`
- `openai_settings`
- `capture_thread_metrics_latest`
- `drakon_find_targets`
- `drakon_find_target_images`
- `drakon_find_searches`
- `drakon_find_search_cameras`
- `drakon_find_hits`
- `drakon_find_audit_logs`

Nota de seguranca: dumps historicos no fonte contem valores sensiveis. O `drakon-server` nao deve copiar dados seedados, chaves, tokens ou exemplos reais; deve usar exemplos ficticios e variaveis de ambiente/secrets.

## Conclusao arquitetural

O `drakon-server` deve nascer como um servidor C++23 headless com bibliotecas internas pequenas. A extracao recomendada e por contratos e comportamento, nao por copia direta:

1. Contratos JSON/config/jobs/cameras.
2. Runtime roots, logging, shutdown e health.
3. Captura RTSP/webcam e buffer.
4. Escrita de frames/clips/JSON/JSONL.
5. DB local SQLite e opcional PostgreSQL.
6. Jobs/steps/agentes em pipeline.
7. Inferencia LLM por interface.
8. Alertas e emissores webhook/Telegram.
9. Indices JSONL e contratos de leitura para o dashboard Drakon.
