# Prompt 1 - Riscos de extracao do perceptrum para drakon-server

Data da leitura: 2026-05-21

## Resumo de risco

O maior risco e tentar portar o `perceptrum_desktop_aspp` como esta. O projeto fonte mistura servidor, agente, desktop Windows, dashboard, backend Node, chat, LLM, jobs, cameras e billing. O `drakon-server` deve extrair contratos e reimplementar modulos pequenos, testaveis e Linux-first.

## Riscos criticos

### 1. Secrets no fonte e em dumps historicos

Foram encontrados dumps/configuracoes historicas contendo campos de API keys, tokens e credenciais. O relatorio nao reproduz valores.

Risco:

- Copiar dados de `DrakonSite/db/patches/perceptrum_sql.sql` pode vazar secrets.
- Campos como `model_api_keys`, `telegram_settings`, `openai_settings`, `cameras.username`, `cameras.password`, `rtspUrl`, `api_key`, `model_api_key` e `exe_token` nao podem entrar em logs nem exemplos reais.

Mitigacao:

- Nunca copiar dados seedados do dump.
- Criar exemplos com valores ficticios.
- Usar variaveis de ambiente, arquivos 0600 ou secret store.
- Implementar redacao centralizada para logs e erros.
- Testar explicitamente que URLs RTSP e tokens sao mascarados.

### 2. Acoplamento Windows/desktop

Fontes afetados:

- `AppHost/*`
- `FrameDiskWriter.*`
- `PerfMetrics.h`
- `platform_secure_store.*`
- `platform_process.*`
- `HeadlessService.*`

Risco:

- WinUI, WebView2, Windows App SDK, Media Foundation, DPAPI, Win32 thread/process APIs e paths Windows nao pertencem ao servidor Ubuntu.
- `FrameDiskWriter` usa conceito/estrutura util, mas partes de encoder dependem de Media Foundation.

Mitigacao:

- Criar implementacoes Linux-first.
- Usar FFmpeg/libav para video e OpenCV para imagens.
- Implementar metricas Linux via `/proc`, `clock_gettime` ou outra abordagem nativa.
- Manter UI e AppHost fora do `drakon-server`.

### 3. Monolitos com muitas responsabilidades

Fontes afetados:

- `CameraSession.cpp`
- `AgentCore.cpp`
- `JobRuntime.cpp`

Risco:

- Copiar esses arquivos carrega dependencias circulares, comportamento dificil de testar, threads destacadas, chamadas HTTP, persistencia, inferencia, thumbnails e eventos no mesmo lugar.
- A manutencao futura do servidor ficaria presa a contratos de desktop/backend antigo.

Mitigacao:

- Extrair por responsabilidades: captura, fila de frames, writer, inference runner, event sink, job scheduler, alert dispatcher.
- Criar interfaces pequenas.
- Testar cada biblioteca interna isoladamente.

### 4. Contrato API antigo pode nao ser o contrato ideal

Fonte:

- `DrakonSite/src/worker/index.ts`
- `AgentCore::processCommand_`

Risco:

- O fluxo atual usa pareamento e polling de `/api/agent/commands`. O novo `drakon-server` pode precisar ser fonte local de dados e nao apenas cliente do backend.
- Portar esse contrato sem revisao pode manter dependencia desnecessaria do dashboard atual.

Mitigacao:

- Separar dois modos:
  - modo local: le config/DB e gera arquivos JSON/JSONL;
  - modo conectado: opcionalmente sincroniza com API/dashboard.
- Documentar todos os payloads antes de implementar compatibilidade.

### 5. Divergencia entre dashboard e arquivos gerados

Fonte:

- `DrakonSite/src/worker/cameraRecordings.ts`
- rotas `/api/camera-recordings/*`, `/api/dashboard`, `/api/events`, `/api/dashboard-alerts`

Risco:

- O dashboard espera nomes, paths e timestamps especificos.
- Se o servidor escrever estrutura diferente sem indice, o dashboard pode nao localizar frames/clips.

Mitigacao:

- Definir contrato de `data/indexes/*.jsonl`.
- Incluir `schema_version`, `camera_id`, timestamps ISO 8601, paths relativos e tipo de media.
- Se preservar compatibilidade com recordings atuais, manter ou mapear `cam_<id>/YYYY/MM/DD`.

### 6. LLM provider lock-in e modelos hardcoded

Fonte:

- `AgentCore.*`
- `LocalLlmClient.*`
- `ChatModelConfig.*`
- `CameraConfig.h`
- `JobTypes.h`

Risco:

- O fonte mistura OpenAI, Gemini e modelos/tier por strings.
- Keys aparecem em payloads e configs historicas.
- Erros de API podem conter dados sensiveis.

Mitigacao:

- Criar `InferenceProvider` abstrato.
- Comecar com runner stub deterministico.
- Resolver modelo e API key por config/secret store, nunca por constante.
- Sanitizar request/response logs.

### 7. Captura RTSP e FPS configuravel

Fonte:

- `RtspCapture.*`
- `CameraSession.*`
- `FrameDiskWriter.*`

Risco:

- Reconnect, timeout, TCP/UDP, baixa latencia, backpressure e multi-FPS podem gerar perda de frames ou loops de CPU.
- `FrameDiskWriter` atual trabalha com perfis 10s/60s; o objetivo do `drakon-server` tambem exige 1 FPS, 10 FPS e perfis configuraveis para imagens/frames.

Mitigacao:

- Separar ingestao de amostragem.
- Medir FPS real, fila, drops, reconexoes e latencia.
- Implementar backoff e limites por camera.
- Testar com RTSP indisponivel e webcam indisponivel.

### 8. Concurrency e ciclo de vida

Fonte:

- `CameraSession.*`
- `JobRuntime.*`
- `AgentCore.*`

Risco:

- Threads por camera/step, detach, maps compartilhados e cancelamento parcial podem causar corrida, use-after-free ou shutdown incompleto.

Mitigacao:

- Usar ownership claro (`std::jthread` quando possivel, stop tokens ou cancel flags com join).
- Definir `start/stop` idempotentes.
- Testar shutdown com camera em reconnect, job ativo e inferencia pendente.

### 9. Banco de dados e portabilidade SQLite/PostgreSQL

Fonte:

- `DrakonSite/db/patches/*.sql`
- `server/sqlite-d1.ts`
- `server/pg-d1.ts`
- `PgClient.h`

Risco:

- SQL atual nasceu para PostgreSQL e tem adaptadores para SQLite no Node.
- Tipos, `ON CONFLICT`, timestamps e JSON em texto podem divergir.

Mitigacao:

- Criar schema proprio do `drakon-server`.
- Comecar com SQLite local.
- Definir gateway de persistencia e migracoes.
- PostgreSQL so como modo opcional depois que SQLite estiver testado.

### 10. Alertas duplicados ou sem idempotencia

Fonte:

- `JobAlertRule`
- `TelegramNotifier.*`
- `events`, `notifications`, `job_run_alerts`

Risco:

- Reprocessamento de frame/job pode disparar o mesmo alerta varias vezes.
- Webhooks e Telegram podem falhar parcialmente.

Mitigacao:

- Gerar `alert_id` deterministico por camera/job/step/frame/evento quando aplicavel.
- Registrar estado de entrega.
- Implementar retry com backoff e deduplicacao.
- Salvar alerta local antes de emitir webhook.

## Riscos medios

### Codigo Linux parcial no fonte ainda e minimo

`Perceptrum/CMakeLists.txt` ja tem C++23, CMake, CURL e testes, mas indica explicitamente que `AgentCore`, captura, RTSP, jobs e frame writer estao atras de feature gates e nao sao suportados no runtime Linux minimo atual.

Mitigacao: usar essa base apenas como referencia de CLI/runtime paths, nao como prova de que a pilha completa ja compila no Linux.

### Branding e produto legado

`BrandingRuntime.*` e assets carregam identidade/paths do produto antigo.

Mitigacao: o `drakon-server` deve ter nome, paths e config proprios.

### Payloads grandes de imagem/video

O fonte usa base64, clips MP4 e uploads. Isso pode explodir memoria/logs.

Mitigacao: preferir paths locais e streams; limitar tamanho; truncar logs; persistir metadados separados da media.

### Contratos de tempo e timezone

Jobs usam timezone, janelas locais, timestamps UTC, offset e cobertura temporal.

Mitigacao: padronizar UTC nos arquivos e armazenar timezone de camera/job como metadado.

## Riscos de copiar codigo cliente para servidor

- UI React/WinUI traz dependencias, estados visuais e regras de UX que nao pertencem ao processo headless.
- AppHost mistura pareamento, WebView, tray, SQLite local e runtime Windows.
- DrakonSite mistura auth, billing, Stripe, chat, hub e dashboard com endpoints de agente.
- Copiar essas partes para C++ criaria um servidor inchado, dificil de empacotar e com superficie de seguranca maior.

Decisao recomendada:

- Dashboard fica cliente.
- Servidor gera dados, executa captura/jobs/inferencia/alertas e expoe contrato local simples.
- Integracao com API antiga fica em adaptador opcional.

## Checklist antes de qualquer implementacao

1. Confirmar que nenhum dado sensivel dos dumps sera copiado.
2. Definir schema de config sem credenciais inline.
3. Definir estrutura final de `data/` e indices JSONL.
4. Definir se o primeiro DB sera somente SQLite.
5. Definir quais endpoints do DrakonSite precisam de compatibilidade imediata.
6. Criar testes para redacao de secrets.
7. Resolver o repositorio Git aninhado no alvo antes do primeiro commit futuro.

## Decisao tecnica recomendada

Nao portar `AgentCore.cpp`, `CameraSession.cpp` ou `JobRuntime.cpp` inteiros.

Usar o fonte como mapa de dominio e implementar o `drakon-server` com estas fronteiras:

- `drakon_runtime`
- `drakon_config`
- `drakon_camera`
- `drakon_capture`
- `drakon_media`
- `drakon_db`
- `drakon_jobs`
- `drakon_temporal`
- `drakon_inference`
- `drakon_alerts`
- `drakon_dashboard_contracts`

Essa divisao reduz risco de plataforma, facilita testes e permite entregar primeiro um servidor CLI/headless compilavel antes de conectar RTSP, jobs e LLM reais.
