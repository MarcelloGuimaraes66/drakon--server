# Prompt 1 - Mapa de extracao de modulos para drakon-server

Data da leitura: 2026-05-21

## Criterios de classificacao

- `reutilizar diretamente`: codigo simples ou contrato pequeno que pode entrar quase igual, com namespace, testes e ajustes de build.
- `extrair/refatorar`: logica util, mas acoplada ou grande demais para copiar inteira.
- `usar apenas como referencia`: comportamento/contrato valido, mas implementacao inadequada para o servidor Linux headless.
- `manter fora do servidor`: UI, desktop, branding, billing ou funcao que nao pertence ao processamento headless.
- `pertence ao dashboard cliente`: codigo que deve continuar no Drakon visual/web.

## Bibliotecas internas recomendadas

| Biblioteca interna | Responsabilidade | Fontes de referencia |
|---|---|---|
| `drakon_runtime` | CLI, paths, shutdown, health, logs, status e service loop. | `runtime/interfaces/*`, `HeadlessService.*`, `linux/RuntimePaths.*`, `platform_shutdown.*`. |
| `drakon_config` | Config JSON versionada, validacao, camera/job/alert schemas, leitura de env/secrets. | `CameraConfig.h`, `JobTypes.h`, `RuntimePaths.*`. |
| `drakon_camera` | `Frame`, `FrameBuffer`, motion, regioes de analise, snapshots. | `Frame.h`, `FrameBuffer.*`, `MotionDetector.*`, `AnalysisRegionGeometry.*`. |
| `drakon_capture` | RTSP, webcam, reconnect, backoff, perfis 1 FPS/10 FPS/configuraveis. | `RtspCapture.*`, `CameraSession::runWebcamCapture_`. |
| `drakon_media` | Escrita de frames/clips, layouts de diretorio, thumbnails, retencao, materializacao. | `FrameDiskWriter.*`, `DrakonSite/src/worker/cameraRecordings.ts`. |
| `drakon_json_index` | JSON estruturado e indices JSONL para dashboard. | `events`, `detections`, `cameraRecordings.ts`, contratos de worker. |
| `drakon_db` | SQLite local e PostgreSQL opcional com repositorios tipados. | `DrakonSite/db/patches/*.sql`, `server/sqlite-d1.ts`, `server/pg-d1.ts`, `PgClient.h`. |
| `drakon_jobs` | Jobs, steps, pipelines, start conditions, runtime state. | `JobTypes.h`, `JobPayloadParser.*`, `JobRuntime.*`. |
| `drakon_temporal` | Evidencia temporal, plano temporal, cobertura de conteudo. | `TemporalEngine.h`, `TemporalEvidence.h`, `ContentCoverageTracker.h`. |
| `drakon_inference` | Interface LLM/vision, modelos, timeouts, token usage, stubs e provedores. | `AgentCore.*`, `LocalLlmClient.*`, `ChatModelConfig.*`. |
| `drakon_alerts` | Regras de alerta, JSON de alerta, webhooks, Telegram e retry/idempotencia. | `JobAlertRule`, `TelegramNotifier.*`, `/api/agent/events`. |
| `drakon_dashboard_contracts` | Contratos de arquivos e compatibilidade com dashboard. | `DrakonSite/src/react-app/*`, `DrakonSite/src/worker/*`. |

## Mapa por modulo fonte

### `Perceptrum/Perceptrum/camera`

| Fonte | Classificacao | Destino recomendado | Acao |
|---|---|---|---|
| `Frame.h` | reutilizar diretamente | `drakon_camera/frame.*` | Adicionar namespace `drakon`, timestamp UTC e testes. |
| `FrameBuffer.*` | reutilizar diretamente | `drakon_camera/frame_buffer.*` | Preservar semantica de overwrite; testar push/pop/stop/resize. |
| `MotionDetector.*` | reutilizar diretamente | `drakon_camera/motion_detector.*` | Preservar algoritmo OpenCV, parametrizar tuning por config. |
| `RtspCapture.*` | extrair/refatorar | `drakon_capture/rtsp_capture.*` | Manter FFmpeg isolado no `.cpp`; adicionar sanitizacao de URL, reconexao e metricas. |
| `FrameDiskWriter.*` | extrair/refatorar | `drakon_media/frame_writer.*`, `clip_writer.*` | Reimplementar escrita Linux com FFmpeg; preservar perfis e layout conceitual. |
| `CameraConfig.h` | extrair/refatorar | `drakon_config/camera_config.*` | Separar config publica, runtime config e secrets. |
| `CameraSession.*` | extrair/refatorar | varios modulos | Quebrar em `CameraWorker`, `CapturePipeline`, `InferenceScheduler`, `TelemetryPublisher`, `EventSink`. |
| `PerfMetrics.h` | usar apenas como referencia | `drakon_runtime/linux_metrics.*` | Implementar Linux nativo; nao portar Win32. |

### `Perceptrum/Perceptrum/core`

| Fonte | Classificacao | Destino recomendado | Acao |
|---|---|---|---|
| `AgentCore.*` | usar apenas como referencia/extrair contratos | `drakon_command`, `drakon_api_client`, `drakon_inference` | Nao copiar. Extrair lista de comandos, eventos, sanitizacao e fluxo. |
| `TemporalEngine.h` | extrair/refatorar | `drakon_temporal/temporal_engine.*` | Separar header grande em unidades testaveis. |
| `TemporalEvidence.h` | reutilizar diretamente | `drakon_temporal/evidence.*` | Adicionar namespace e serializacao JSON. |
| `ContentCoverageTracker.h` | reutilizar diretamente | `drakon_temporal/content_coverage.*` | Testar merges, gaps e cutoff. |
| `AnalysisRegionGeometry.*` | reutilizar/refatorar | `drakon_camera/analysis_region.*` | Manter crop e poligonos; testes com coordenadas normalizadas. |
| `VideoPolygonOverlayRenderer.*` | usar como referencia | futuro `drakon_media/overlay_renderer` | Nao incluir na primeira fase. |

### `Perceptrum/Perceptrum/jobs`

| Fonte | Classificacao | Destino recomendado | Acao |
|---|---|---|---|
| `JobTypes.h` | extrair/refatorar | `drakon_jobs/job_types.*` | Virar contrato canonico com schema JSON. |
| `JobPayloadParser.*` | extrair/refatorar | `drakon_jobs/job_payload_parser.*` | Parser robusto para `job_start`; validar erros. |
| `JobRuntime.*` | extrair/refatorar | `drakon_jobs/job_runtime.*` | Reimplementar em camadas: scheduler, step runner, camera leases, output store, alerts. |

### `Perceptrum/Perceptrum/orchestrator`

| Fonte | Classificacao | Destino recomendado | Acao |
|---|---|---|---|
| `SkillTypes.h` | extrair/refatorar | `drakon_agents/skill_contracts.*` | Usar conceitos de skill sem acoplar a chat. |
| `SkillRegistry.*` | extrair/refatorar | `drakon_agents/agent_registry.*` | Registro de handlers de comando/agente. |
| `LocalLlmClient.*` | extrair/refatorar | `drakon_inference/llm_client.*` | Cliente HTTP generico com timeouts, retries e redacao de erros. |
| `ChatModelConfig.*` | usar como referencia | `drakon_inference/model_catalog.*` | Catalogo por config, nao nomes hardcoded. |
| `HttpUtils.*`, `ConfigUtils.*` | extrair/refatorar | `drakon_net`, `drakon_config` | Utilitarios reaproveitaveis com testes. |
| `ChatV2Orchestrator.*`, `PromptBuilder.*`, `KnowledgeBase.*` | usar como referencia | futura camada de authoring | Nao entra no MVP headless. |
| `skills/ControlCameraSkill.*` | usar como referencia | `drakon_command/control_camera` | Inspirar comandos start/stop/status. |
| `skills/ControlJobSkill.*` | usar como referencia | `drakon_command/control_job` | Inspirar start/stop/status de jobs. |
| `skills/ReadStateSkill.*` | usar como referencia | `drakon_query/state_reader` | Inspirar estado para dashboard. |
| `skills/VideoSearchSkill.*` | usar como referencia | futuro `drakon_find` | Nao entra na base inicial. |
| `skills/Create/Edit*` | pertence ao dashboard/cliente | dashboard/API futura | Authoring deve ficar no cliente/API, nao no runtime core inicial. |

### `Perceptrum/Perceptrum/comm`

| Fonte | Classificacao | Destino recomendado | Acao |
|---|---|---|---|
| `TelegramNotifier.*` | extrair/refatorar | `drakon_alerts/telegram_sender.*` | Transformar em emissor de alerta com timeout, retry e segredo redigido. |
| `PairingClient.*` | usar como referencia | `drakon_api_client/pairing.*` opcional | Nao obrigar `drakon-server` a pareamento no modo local. |
| `BackendConfig.*` | usar como referencia | `drakon_config/backend_config.*` opcional | Substituir por config propria. |
| `PgClient.h` | usar como referencia | `drakon_db/postgres_connection.*` | Implementar camada DB completa com prepared statements e RAII. |
| `SecureLocalStore.*` | extrair/refatorar | `drakon_runtime/secret_store.*` | Usar `secret-tool`/arquivos 0600 com opt-in explicito para fallback. |

### `Perceptrum/Perceptrum/runtime` e `platform`

| Fonte | Classificacao | Destino recomendado | Acao |
|---|---|---|---|
| `runtime/interfaces/*` | reutilizar/refatorar | `drakon_runtime/interfaces.*` | Bons contratos para roots, logger, token store e status. |
| `HeadlessService.*` | usar como referencia | `drakon_runtime/service_loop.*` | Criar loop proprio sem dependencia do `AgentCore` atual. |
| `platform_common.*` | extrair/refatorar | `drakon_platform/common.*` | Paths, env, home dir e string utils. |
| `platform_process.*` | extrair/refatorar | `drakon_platform/process.*` | POSIX process control para ferramentas futuras. |
| `platform_shutdown.*` | extrair/refatorar | `drakon_runtime/shutdown.*` | SIGTERM/SIGINT e systemd-friendly. |
| `platform_secure_store.*` | extrair/refatorar | `drakon_runtime/secret_store.*` | Isolar Linux e remover dependencia Windows. |
| `BrandingRuntime.*` | manter fora ou minimo | nenhum no MVP | Branding nao e requisito do servidor. |

### `DrakonSite` e `AppHost`

| Fonte | Classificacao | Destino recomendado | Acao |
|---|---|---|---|
| `DrakonSite/db/patches/*.sql` | usar como referencia de schema | `drakon_db/schema/*` | Criar schema limpo, sem dados seedados nem secrets. |
| `DrakonSite/src/worker/index.ts` | usar como contrato de API | `docs/contracts/api.md` futuro | Documentar comandos/eventos e payloads. |
| `DrakonSite/src/worker/cameraRecordings.ts` | usar como contrato de arquivo | `drakon_dashboard_contracts/recordings.md` futuro | Preservar layout legivel pelo dashboard ou migrar com adaptador. |
| `DrakonSite/src/react-app/*` | pertence ao dashboard cliente | fora do servidor | Nao copiar para `drakon-server`. |
| `AppHost/Platform`, `Services`, `Persistence`, `Pages` | manter fora do servidor | fora do servidor | WinUI/WebView/desktop apenas explicam contrato legado. |

## Layout de runtime recomendado para o drakon-server

```text
data/
|-- frames/{camera_id}/YYYY/MM/DD/HH/{profile}/
|-- clips/{camera_id}/YYYY/MM/DD/
|-- inference/{camera_id}/YYYY/MM/DD/
|-- alerts/YYYY/MM/DD/
|-- events/YYYY/MM/DD/
|-- jobs/{job_id}/{run_id}/
`-- indexes/
    |-- frames.jsonl
    |-- clips.jsonl
    |-- inference.jsonl
    |-- alerts.jsonl
    |-- events.jsonl
    `-- jobs.jsonl
```

Compatibilidade observada: o site atual tambem procura recordings sob `cam_<cameraId>/YYYY/MM/DD` e gera URLs `/api/camera-recordings/{scope}/{path}`. O `drakon-server` deve escolher uma convencao canonica e, se necessario, gerar links/indices que o dashboard leia sem varrer diretorios profundos.

## Ordem de extracao recomendada

1. `drakon_runtime`: CLI, paths, logging, shutdown e status.
2. `drakon_config`: `config/cameras.example.json`, validacao e redacao de secrets.
3. `drakon_camera`: `Frame`, `FrameBuffer`, `MotionDetector`, `AnalysisRegionGeometry`.
4. `drakon_capture`: RTSP FFmpeg e webcam OpenCV.
5. `drakon_media`: salvar imagens, clips e JSONL.
6. `drakon_db`: SQLite local e gateway PostgreSQL opcional.
7. `drakon_jobs`: contratos, parser e runtime simples de steps.
8. `drakon_inference`: stub deterministico, depois OpenAI/Gemini/compat.
9. `drakon_alerts`: alerta JSON, webhook generico e Telegram.
10. `drakon_dashboard_contracts`: documentar e estabilizar consumo do dashboard.

## Arquivos que nao devem entrar no servidor

- `AppHost/Pages/*`
- `AppHost/*.xaml*`
- `AppHost/Frontend/*`
- `AppHost/Packaging/*`
- `DrakonSite/src/react-app/*`
- Assets de branding/UI.
- Dumps SQL com dados reais ou exemplos sensiveis.
- Implementacoes Windows-only de Media Foundation, WinUI, WebView2 e DPAPI.

## Primeiro alvo de implementacao apos esta analise

Criar no `drakon-server` uma base compilavel que nao dependa ainda de FFmpeg/OpenCV:

- CLI `drakon-server --help`, `version`, `validate-config`.
- `RuntimePaths`.
- `CameraConfig` e `JobTypes` minimos como contratos.
- JSON parser com `nlohmann-json`.
- `config/cameras.example.json` sem credenciais reais.
- Testes CTest para CLI e config.

So depois disso entrar com captura RTSP e gravacao de frames.
