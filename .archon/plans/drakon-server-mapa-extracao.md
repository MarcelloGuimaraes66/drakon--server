# Drakon Server - Mapa de Extracao

## Classificacao por Modulo

| Fonte | Classificacao | Acao para drakon-server |
|---|---|---|
| `camera/CameraConfig` | Refatorar e extrair | Criar `config/CameraConfig` e `agents/AgentConfig` separados; manter campos essenciais e remover Telegram/secrets inline. |
| `camera/CameraSession` | Refatorar e extrair | Separar em `camera/CameraSession`, `capture/CaptureWorker`, `inference/InferenceScheduler`, `runtime/Telemetry`. |
| `camera/RtspCapture` | Reutilizar diretamente com ajustes | Migrar para Linux FFmpeg/OpenCV, manter timeouts, reconnect e force TCP. |
| `camera/FrameDiskWriter` | Refatorar e extrair | Trocar backend Windows MF por FFmpeg/libav; manter layout, retencao, atomic writes e perfis FPS. |
| `camera/FrameBuffer` | Reutilizar diretamente | Ring buffer C++ simples, portavel. |
| `camera/MotionDetector` | Reutilizar diretamente | Portavel com OpenCV; parametrizar por camera/agente. |
| `jobs/JobTypes` | Refatorar e extrair | Separar contratos em headers menores: `Job`, `Step`, `Agent`, `Alert`, `InferenceGroup`, `RuntimeOutput`. |
| `jobs/JobPayloadParser` | Reutilizar com ajustes | Manter normalizacao snake/camel e validacoes; remover dependencias antigas. |
| `jobs/JobRuntime` | Refatorar e extrair | Dividir em scheduler de steps, executor de agents, pipeline resolver, alert dispatcher, temporal state. |
| `orchestrator/ChatV2Orchestrator` | Usar apenas como referencia | Conversa/skills nao e parte do servidor headless MVP. |
| `orchestrator/PromptBuilder` | Usar apenas como referencia | Reaproveitar padroes de prompt para inferencia e agent design, nao chat UI. |
| `orchestrator/SkillRegistry`/`SkillTypes` | Usar apenas como referencia | Pode inspirar plugins internos futuros, fora do MVP. |
| `orchestrator/LocalLlmClient` | Refatorar e extrair | Criar `inference/LlmClient` com HTTP, timeout, retry, response JSON, sem dependencia de chat. |
| `orchestrator/ChatModelConfig` | Usar apenas como referencia | Novo config deve vir de env/config/DB, sem secrets em arquivo ou log. |
| `orchestrator/OperationTaskState` | Nao usar no servidor | Estado de chat/authoring pertence ao dashboard/orquestrador cliente. |
| `orchestrator/skills/*` | Manter no cliente/dashboard | Skills criam/alteram configuracoes; servidor deve consumir contratos prontos. |
| `core/AgentCore` | Usar apenas como referencia | Extrair contratos e algoritmos pontuais; nao copiar monolito. |
| `core/TemporalEngine` | Refatorar e extrair | Manter avaliador temporal como modulo puro em `agents/temporal` ou `inference/temporal`. |
| `core/TemporalEvidence` | Reutilizar diretamente | Struct pequeno e portavel. |
| `core/AnalysisRegionGeometry` | Reutilizar diretamente | Utilitario puro para crop/poligonos normalizados. |
| `core/ContentCoverageTracker` | Reutilizar diretamente | Classe portavel para cobertura de intervalos. |
| `comm/BackendConfig` | Usar apenas como referencia | Novo server nao deve depender de backend remoto; usar config propria. |
| `comm/PairingClient` | Nao usar no servidor | Pareamento EXE e fluxo desktop ficam fora. |
| `comm/TelegramNotifier` | Refatorar e extrair | Transformar em backend opcional de alerta; secrets por env/secure store. |
| `comm/PgClient` | Reutilizar com ajustes | Pode servir para Postgres simples; avaliar libpqxx ou wrapper proprio. |
| `comm/SecureLocalStore` | Refatorar e extrair | Implementar Linux com permissoes 0600/libsecret opcional. |
| `platform/*` | Refatorar e extrair | Manter utilitarios portaveis; remover APIs Windows. |
| `runtime/HeadlessService` | Refatorar e extrair | Base para `runtime/ServiceMain` Linux/systemd. |
| `runtime/interfaces/*` | Reutilizar diretamente com renome | Bons contratos para logger, runtime, token store e status. |
| `runtime/BrandingRuntime` | Nao usar no servidor | Branding pertence ao produto/cliente, nao ao core headless. |
| `DrakonSite/server` | Usar apenas como referencia | Referencia de DB local, env e API; servidor novo sera C++ headless. |
| `DrakonSite/src/worker` | Usar apenas como referencia | Fonte dos contratos REST, comandos, eventos, dashboard, scheduler. |
| `DrakonSite/src/react-app` | Manter no cliente/dashboard | UI separada. |
| `DrakonSite/package.json` | Nao usar no servidor | Nao introduzir Node como dependencia do servidor C++. |
| `AppHost/Platform/LocalBackendHost` | Nao usar no servidor | Host desktop Windows. |
| `AppHost/Platform/PerceptrumRuntimeHost` | Usar apenas como referencia | Ideia de lifecycle externo; systemd substitui. |
| `AppHost/Services/DrakonApiClient` | Usar apenas como referencia | Lista endpoints e DTOs consumidos pelo cliente. |
| `AppHost/Persistence/Database` | Refatorar e extrair | Aproveitar abstracao SQLite/Postgres, removendo defaults de senha e Windows. |
| `AppHost/Pages` | Manter no cliente/dashboard | UI WinUI. |

## Componentes que Viram Codigo no Novo Projeto

Primeira extracao recomendada:

- `include/drakon/config`: structs de camera, agent, job, alert e runtime roots.
- `include/drakon/camera`: `Frame`, `FrameBuffer`, `MotionDetector`, `RtspCapture`.
- `include/drakon/frame_store`: writer local de PNG/JPEG/MP4 e JSONL.
- `include/drakon/jobs`: parser de payload e tipos normalizados.
- `include/drakon/inference`: interface `InferenceClient`, `LlmClient`, `InferenceResult`.
- `include/drakon/events`: `EventBus`, `JsonlEventSink`.
- `include/drakon/database`: interfaces SQLite/Postgres.

## Componentes que Nao Devem Entrar

- WinUI, Pages, navegador, WebView, tray icon.
- LocalBackendHost e staging Windows.
- Billing, Stripe, OAuth, chat UI e recovery de conta.
- Pareamento EXE como requisito para runtime local.
- Qualquer default de senha, token, API key ou URL privada.

## Estrategia de Extracao

1. Definir contratos novos em headers pequenos.
2. Copiar somente codigo pequeno e portavel apos revisao: `FrameBuffer`, `MotionDetector`, `AnalysisRegionGeometry`, `ContentCoverageTracker`, `TemporalEvidence`.
3. Reescrever wrappers de plataforma: RTSP, frame writer, DB, HTTP/LLM e secure store.
4. Reimplementar `JobRuntime` em partes menores, guiado por `JobTypes` e `JobPayloadParser`.
5. Usar `AgentCore` apenas como catalogo de comportamento esperado.
