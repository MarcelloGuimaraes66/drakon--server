# Drakon Server - Plano em Fases

## Fase 1 - Scaffold CLI/CMake

Objetivo: consolidar executavel C++23 headless.

- Verificar `CMakeLists.txt`, `src/main.cpp`, `include/`, `tests/`.
- Comandos iniciais: `--help`, `version`, `validate-config`.
- Padrao de build: `cmake -S . -B build && cmake --build build && ctest --test-dir build`.
- Nao adicionar GUI, navegador ou dependencia desktop.

## Fase 2 - Config e Runtime Dirs

- Definir `config/drakon-server.json`.
- Resolver roots: `data`, `frames`, `clips`, `inference`, `alerts`, `events`, `indexes`, `logs`, `runtime`.
- Criar validacao de paths e permissoes.
- Definir politica de secrets por env/secret store.

## Fase 3 - SQLite/PostgreSQL

- Criar interface `Database`.
- Implementar SQLite primeiro.
- Planejar Postgres via libpq/libpqxx depois.
- Migracoes iniciais: cameras, jobs, steps, agents, alerts, events, runtime_state.
- Importador opcional para schema legado Perceptrum.

## Fase 4 - Leitura de Cameras

- Ler cameras de JSON e SQLite.
- Normalizar RTSP/webcam.
- Resolver credenciais sem logar secrets.
- Validar timezone, FPS, retencao, store_frames e agentes associados.

## Fase 5 - Captura RTSP/Webcam

- Portar `RtspCapture` para Linux.
- Implementar webcam via OpenCV `VideoCapture`.
- Implementar reconnect/backoff, timeout e status.
- Expor telemetria por camera.

## Fase 6 - Escrita de Frames 1 FPS/10 FPS

- Implementar writer atomico JPG/PNG.
- Criar perfis `fps_1`, `fps_10`.
- Implementar retencao por camera.
- Adicionar motion gating opcional.

## Fase 7 - Indice JSONL de Frames

- Escrever `data/indexes/frames.jsonl`.
- Incluir camera_id, ts_utc, path, fps, width, height, motion, source.
- Garantir append thread-safe.
- Criar snapshot `runtime-status.json`.

## Fase 8 - Jobs/Steps/Agentes

- Portar `JobTypes` e parser normalizador.
- Implementar executor sequencial de steps.
- Implementar start conditions basicas: sequential, positive, negative, time.
- Implementar target cameras e agent selection.
- Guardar outputs por step/camera.

## Fase 9 - Inferencia LLM

- Criar `InferenceClient`.
- Enviar frame ou sequencia de frames.
- Suportar OpenAI-compatible local/remoto.
- Aplicar timeouts, retries e response JSON.
- Separar prompt core, alert condition e negative condition.

## Fase 10 - JSON de Inferencia

- Persistir resultado por inferencia em `data/inference/...json`.
- Append em `data/indexes/inference.jsonl`.
- Capturar usage, model, latency, alert_condition, answer, media refs.
- Registrar erro sanitizado em `events.jsonl`.

## Fase 11 - Alertas JSON/API/Webhook

- Gerar alerta quando `alert_condition` final for true.
- Escrever `data/alerts/...json` e `alerts.jsonl`.
- Implementar webhook dispatcher com retry/backoff.
- Suportar Telegram depois como canal opcional.

## Fase 12 - Integracao Dashboard

- Garantir contratos JSONL estaveis.
- Servir arquivos estaticos ou expor API local read-only.
- Entregar `runtime-status.json`, alerts, events, frames, inference.
- Manter dashboard separado.

## Fase 13 - systemd

- Criar unit `drakon-server.service`.
- Configurar usuario dedicado, WorkingDirectory, env file e restart policy.
- Logs para journald + JSONL local.
- Healthcheck local.

## Fase 14 - Pacote .deb

- Instalar binario, config example, systemd unit e docs.
- Criar diretorios em `/var/lib/drakon-server` e `/etc/drakon-server`.
- Garantir permissao de secrets e data dirs.
- Script pos-install sem credenciais hardcoded.

## Ordem Recomendada de Entrega

1. CLI + config validation.
2. Frame store local com JSONL.
3. Captura webcam.
4. Captura RTSP.
5. SQLite cameras.
6. Runtime start/stop.
7. Jobs parser.
8. Inferencia mock.
9. Inferencia real.
10. Alertas e webhooks.
