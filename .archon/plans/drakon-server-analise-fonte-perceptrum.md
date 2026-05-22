# Drakon Server - Analise do Fonte Perceptrum

Data: 2026-05-21

Fonte lido: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Projeto alvo: `/home/marcello-guimaraes/dev/drakon-server`

## Confirmacao

O diretorio fonte existe e foi lido sem alteracao. Nenhum commit ou push foi executado.

## Visao Geral

O `perceptrum_desktop_aspp` mistura quatro responsabilidades que devem ser separadas no `drakon-server`:

- runtime headless e agente local;
- captura de cameras, escrita de frames/clipes e telemetria;
- jobs, steps, agentes, inferencia, alertas e eventos;
- dashboard/site, app desktop WinUI, pareamento, billing e UI.

O `drakon-server` deve nascer como servidor Linux/headless. A base tecnica reutilizavel esta principalmente em `Perceptrum/Perceptrum/camera`, `jobs`, `core`, `platform` e `runtime`, mas ha dependencias Windows, desktop, navegador, pareamento e branding que precisam ser removidas ou abstraidas.

## Modulos Lidos

### Perceptrum/Perceptrum/camera

- `CameraConfig`: contrato central de camera e algoritmo. Inclui `id`, `name`, `rtspUrl`, `webcam_index`, `storeFrames`, `retentionDays`, `frameCaptureIntervalSeconds`, `analysisSpeed`, `modelTier`, Telegram, chaves de modelo, captura por movimento, regioes normalizadas, FaceID e imagens negativas.
- `CameraSession`: orquestra captura, buffer, motion, escrita em disco, thumbnails, inferencia direta, webcam e telemetria por camera.
- `RtspCapture`: encapsula FFmpeg para RTSP com timeout, reconnect, TCP, decode BGR via OpenCV.
- `FrameDiskWriter`: grava segmentos MP4 por camera, perfis 10s/60s/300s, imagens PNG para inferencia, copia para jobs e aplica retencao.
- `FrameBuffer`: ring buffer thread-safe com overwrite controlado.
- `MotionDetector`: deteccao simples por diferenca/background para reduzir captura/inferencia.

### Perceptrum/Perceptrum/jobs

- `JobTypes`: define payload de job, step, target, agent, alert rule, inference group, start condition, pipeline e saidas.
- `JobPayloadParser`: normaliza JSON de job_start; aceita snake/camel case; normaliza `input_type`, `video_packaging_mode`, `inference_model`, `model_fps`, `run_every`, `running_resolution`, regioes e FaceID.
- `JobRuntime`: executa job_start/job_stop, controla steps, condicoes de inicio, pipelines, captura por camera, inferencia, alertas e eventos.

### Perceptrum/Perceptrum/orchestrator

- `ChatV2Orchestrator`: roteia chat para skills e comandos.
- `PromptBuilder`: monta prompts de roteamento, linguagem, resposta e compactacao.
- `SkillRegistry`/`SkillTypes`: registro e contrato de skills.
- `LocalLlmClient`/`ChatModelConfig`: cliente local/remoto para Chat Completions.
- `OperationTaskState`: estado de tarefas multi-turn.
- `skills/`: cria/edita cameras, jobs e agentes; controla cameras/jobs; gera relatorios; le estado.

Para `drakon-server`, o valor principal esta nos contratos de comando e geracao de payloads. A camada conversacional deve ficar fora do MVP do servidor.

### Perceptrum/Perceptrum/core

- `AgentCore`: nucleo monolitico. Polling de comandos, start/stop camera/job, chamadas LLM/OpenAI, roteamento, eventos, thumbnails, uploads de midia, alertas, Drakon Find e logs.
- `TemporalEngine`: avaliador/normalizador de planos temporais e estado temporal.
- `TemporalEvidence`: contrato pequeno de evidencia temporal.
- `AnalysisRegionGeometry`: geometria de regioes normalizadas e crop.
- `ContentCoverageTracker`: rastreamento de cobertura de captura/analise por intervalos.

`AgentCore.cpp` e grande demais para copiar. Deve ser fonte de referencia para extrair contratos e algoritmos pontuais, nao base direta.

### Perceptrum/Perceptrum/comm

- `BackendConfig`: resolve URL base por env/file/default localhost.
- `PairingClient`: fluxo de pareamento desktop com backend.
- `TelegramNotifier`: envio de mensagens/documentos/videos.
- `PgClient`: wrapper libpq simples.
- `SecureLocalStore`: leitura/escrita protegida local.

No Linux headless, `PgClient` e padroes de notifier podem ser aproveitados, mas pareamento desktop nao deve ser requisito do servidor.

### Perceptrum/Perceptrum/platform

- `platform_common`, `platform_process`, `platform_secure_store`, `platform_shutdown`: utilitarios de processo, secure store e shutdown. Precisam de revisao por plataforma.

### Perceptrum/Perceptrum/runtime

- `HeadlessService`: ja introduz contrato de runtime headless.
- `interfaces/IHeadlessRuntime`, `IAgentRuntime`, `IRuntimeLogger`, `ITokenStore`: bons pontos de partida para um runtime limpo.
- `BrandingRuntime`: acoplamento de branding; usar apenas como referencia.

### DrakonSite

- `server/`: servidor local Node/Hono e camada SQLite/Postgres.
- `src/worker/index.ts`: API principal, endpoints `/api/*`, scheduler, comandos, eventos, agente, dashboard, jobs, cameras, billing e chat.
- `src/worker/jobScheduler.ts`: cria `job_start`, `job_stop`, eventos e runtime state.
- `src/react-app/`: dashboard/cliente visual; deve ficar fora do servidor.
- `package.json`: referencia de stack web atual, nao dependencia do C++ server.

### AppHost

- `Platform/LocalBackendHost`: sobe backend local desktop.
- `Platform/PerceptrumRuntimeHost`: sobe runtime Perceptrum como processo desktop.
- `Services/DrakonApiClient`: mapeia endpoints usados pelo app.
- `Persistence/Database`: abstracao dual SQLite/Postgres, mas contem defaults inseguros de dev.
- `Pages/`: UI WinUI; nao entra no servidor.

## Riscos de Extracao

- Dependencia Windows em `FrameDiskWriter` via Media Foundation; para Ubuntu, trocar por FFmpeg/libav ou OpenCV VideoWriter.
- `AgentCore.cpp` concentra muitas responsabilidades e segredos/payloads; extrair por contrato, nao por copia.
- Contratos usam mistura de `snake_case`, `camelCase` e campos legados. O novo servidor deve aceitar legados na entrada e gravar canonical snake_case.
- O fonte atual salva/manda midia para R2/API; o `drakon-server` deve priorizar arquivos locais e JSONL para dashboard.
- Alguns defaults atuais citam modelos e credenciais; o novo projeto nao deve hardcodar secrets.
