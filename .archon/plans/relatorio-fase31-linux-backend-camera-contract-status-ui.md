# Relatorio fase 31 - Linux backend camera contract status UI

Data: 2026-05-26 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Executor: Codex/gpt-5.5
Commit/push: nao realizado

## Objetivo

Corrigir o contrato Start/Stop de camera entre UI, backend e agente Linux para que a UI nao fique presa em `reconnecting` quando o agente esta ausente ou quando o start falha com erro real de captura.

## Contrato final de Start

O sucesso de `start_camera` agora depende de ack rapido do agente com:

- `started=true`
- `first_frame_captured=true`

Nao depende mais de `recording_clip_generated=true`. Para compatibilidade com agentes em transicao, o backend ainda aceita `thumbnail_generated=true` como confirmacao equivalente quando `first_frame_captured` nao vem no payload.

O agente Linux passou a enviar:

- `first_frame_captured`
- `error_code`

para resultados WEBCAM e RTSP. Para WEBCAM, `first_frame_captured` reflete a captura do frame inicial/thumbnail antes da sessao residente ser considerada online.

## Backend

Arquivos alterados:

- `DrakonSite/src/shared/linuxCameraStartContract.ts`
  - novo avaliador comum para resultado de Start Linux;
  - remove dependencia de clip completo;
  - trata falha quando falta `started` ou `first_frame_captured`.
- `DrakonSite/src/worker/index.ts`
  - `enqueueStartCameraCommand` retorna `linux_agent_not_running` tambem quando nao ha pairing conectado;
  - mantem validacao de heartbeat fresco antes de enfileirar;
  - timeout de espera continua curto para ack de agente e retorna `camera_start_timeout`;
  - `/api/agent/commands/:commandId/result` atualiza `cameras.is_service_running=1` e `is_online=1` quando o contrato de sucesso passa;
  - falha chama `persistImmediateCameraStartFailureState`, preservando `is_service_running` quando `was_service_running_before=true` e revertendo para `0` quando a camera nao estava rodando antes;
  - eventos `camera_started` e `camera_connection_failed` passam a gravar `details_json` sanitizado com `command_id`, `camera_session_id`, `error_code`, `error`, `started`, `first_frame_captured` e payload de resultado sem segredos.
- `DrakonSite/server/index.ts` e `AppHost/Runtime/desktop-local-server.mjs`
  - `/api/runtime/agent-health` agora inclui `commands.pending`, `commands.sent`, `commands.failed`, `commands.completed`, alem de status/heartbeat/sessoes ja existentes.
- `Perceptrum/linux/LinuxJobRuntime.cpp`
  - resultados de Start incluem `first_frame_captured`;
  - erros do agente incluem `error_code` derivado do prefixo do erro real.

## UI

Arquivos alterados:

- `DrakonSite/src/shared/cameraStartDiagnostics.ts`
- `DrakonSite/src/react-app/utils/cameraService.ts`
- `DrakonSite/src/react-app/pages/Cameras.tsx`
- `DrakonSite/src/react-app/pages/AIAgents.tsx`

Quando Start falha, as telas de Cameras e AI Agents:

- mostram toast com diagnostico simples;
- limpam `is_service_running=0` e `is_online=0` localmente quando a falha ocorre ao iniciar;
- deixam de mostrar `reconnecting` infinito apos falha HTTP do backend.

Codigos finais e exibicao na UI:

- `linux_agent_not_running`: titulo `Agent Offline`; mensagem informa que o agente Linux nao esta pollando comandos.
- `webcam_permission_denied`: titulo `Webcam Permission Denied`; mensagem informa que o device da webcam nao esta legivel pelo usuario.
- `webcam_device_not_found`: titulo `Camera Source Unavailable`; mensagem informa fonte webcam indisponivel.
- `webcam_source_empty`: titulo `Camera Source Unavailable`; mensagem informa fonte webcam indisponivel.
- `webcam_frame_timeout`: titulo `Camera Capture Timed Out`; mensagem usa o erro real do backend/agente.
- `webcam_probe_timeout`: titulo `Camera Capture Timed Out`; mensagem usa o erro real do backend/agente.
- `camera_start_timeout`: titulo `Camera Capture Timed Out`; mensagem usa o erro real do backend.
- `ffmpeg_not_found`: titulo `Camera Runtime Missing`; mensagem informa ausencia de ffmpeg.
- `thumbnail_upload_failed`: titulo `Camera Start Failed`; mensagem mostra o erro real sanitizado.
- `camera_start_failed`: titulo `Camera Start Failed`; mensagem mostra o erro real sanitizado.
- `insufficient_memory`: fluxo existente mantido como `Camera Start Blocked`.

## Testes adicionados

- `DrakonSite/src/tests/linuxCameraStartContract.test.ts`
- script npm `test:linux-camera-start-contract`

Cobertura:

- agente responde Start com sucesso rapido e sem clip completo;
- agente responde Start com falha e preserva `error_code`;
- agente ausente tem diagnostico claro de UI;
- falha de permissao de webcam tem diagnostico claro de UI.

## Validacao executada

```bash
(cd DrakonSite && npm run test:linux-camera-start-contract)
(cd DrakonSite && npx tsc --noEmit --project tsconfig.worker.json)
(cd DrakonSite && npm run test:platform-boundaries)
(cd DrakonSite && npm run test:local-sqlite-bootstrap)
(cd DrakonSite && npm run build)
(cd Perceptrum && cmake --build out/build/linux-debug -j$(nproc))
(cd Perceptrum && ctest --test-dir out/build/linux-debug -R 'agent|camera|job' --output-on-failure)
```

Resultados:

- `test:linux-camera-start-contract`: passou, 4/4.
- `tsc --noEmit --project tsconfig.worker.json`: passou.
- `test:platform-boundaries`: passou.
- `test:local-sqlite-bootstrap`: passou.
- `npm run build`: passou.
- `cmake --build`: passou; manteve avisos conhecidos de bundle CJS sobre `import.meta`.
- `ctest -R 'agent|camera|job'`: passou, 33/33.

## Observacoes

- Nenhum commit foi feito.
- Nenhum push foi feito.
- Nenhum token/chave foi exposto em logs, HTTP ou neste relatorio.
- A arvore ja continha alteracoes extensas de fases anteriores; esta fase trabalhou sobre esse estado sem reverter mudancas existentes.
