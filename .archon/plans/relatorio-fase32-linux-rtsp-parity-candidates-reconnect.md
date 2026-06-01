# Relatorio fase 32 - Linux RTSP parity candidatos conexao reconexao

Data: 2026-05-26 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Executor: Codex/gpt-5.5
Commit/push: nao realizado

## Objetivo

Portar para o Linux o fluxo RTSP de candidatos, conexao inicial, primeiro frame como ack, gravacao residente em background, stop limpo, status e reconexao sem exigir camera real em testes automatizados.

## Referencias lidas

- Relatorios das fases 29, 30 e 31.
- `Perceptrum/Perceptrum/core/AgentCore.cpp`
- `Perceptrum/Perceptrum/camera/CameraSession.cpp`
- `Perceptrum/Perceptrum/camera/RtspCapture.cpp`
- `Perceptrum/Perceptrum/orchestrator/skills/CreateCameraSkill.cpp`
- `Perceptrum/linux/LinuxRtspThumbnailProbe.cpp`
- `Perceptrum/linux/LinuxFrameDiskWriter.cpp`
- `Perceptrum/linux/LinuxCameraSessionManager.*`
- `DrakonSite/src/worker/index.ts`

## Implementacao

- Adicionado `Perceptrum/linux/LinuxRtspCandidateBuilder.{h,cpp}`.
  - Prioriza `rtsp_url`/`rtspUrl`/`stream_url`/`streamUrl`.
  - Aceita multiplos candidatos diretos separados por `|`.
  - Monta candidatos a partir de `ip`/`ip_address`, `rtsp_port`/`port`, `username`, `password`, `channel`, `subtype` e `manufacturer`.
  - Percent-encoda usuario/senha na URL real e mascara credenciais para logs, health e resultados.
- `LinuxCameraSessionManager` agora atende `RTSP`, `lavfi:`, `file:` e `WEBCAM`.
  - Start tenta candidatos em ordem.
  - Primeiro frame capturado gera sucesso (`first_frame_captured=true`).
  - Gravacao usa ffmpeg segmentando clips em background.
  - Worker residente relanca ffmpeg com backoff e alterna candidatos em reconexao.
  - Stop encerra processo filho e faz join da worker.
  - Status inclui `active_rtsp_url_by_camera`, `candidate_count_by_camera`, `reconnect_attempts_by_camera`, `reconnecting_by_camera` e `next_retry_delay_seconds_by_camera`.
- `LinuxJobRuntime` usa a sessao residente tambem para RTSP.
  - Resultado de `start_camera` publica `camera_started`/`camera_connection_failed` pelo contrato existente do backend.
  - Resultado inclui `active_rtsp_url` e `attempted_rtsp_urls` somente mascarados.
- `ffmpeg` Linux passou a usar `-timeout` para RTSP e `-loglevel quiet`, evitando vazamento de URL com senha em stderr.
- UI diagnostica erros `rtsp_frame_*` como falha de conexao RTSP controlada.
- `RUNBOOK-LINUX.md` documenta teste real por URL direta e por campos.

## Formatos RTSP suportados

- URL direta: `rtsp://***:***@192.168.1.50:554/live`
- Multiplos candidatos diretos: `rtsp://***:***@192.168.1.50:554/main|rtsp://***:***@192.168.1.50:554/sub`
- Hikvision: `rtsp://***:***@192.168.1.50:554/Streaming/Channels/101`
- Dahua: `rtsp://***:***@192.168.1.50:554/cam/realmonitor?channel=1&subtype=0`
- Dahua substream: `rtsp://***:***@192.168.1.50:554/cam/realmonitor?channel=1&subtype=1`
- Intelbras ONVIF: `rtsp://***:***@192.168.1.50:554/cam/realmonitor?channel=1&subtype=0&unicast=true&proto=Onvif`
- Intelbras legado: `rtsp://192.168.1.50:554/user=****&password=****&channel=1&stream=0.sdp?`
- Axis: `rtsp://***:***@192.168.1.50:554/axis-media/media.amp`
- Axis por camera: `rtsp://***:***@192.168.1.50:554/axis-media/media.amp?camera=1`
- Generico: `rtsp://***:***@192.168.1.50:554/Streaming/Channels/101`

## Testes adicionados

- `Perceptrum/linux/tests/mock_rtsp_command_server.js`
- `linux_job_runtime_rtsp_sources_and_invalid_candidate`

Cobertura:

- `lavfi:` permitido somente com `APP_AGENT_RTSP_ALLOW_TEST_SOURCE=1`.
- `file:` como fonte local sintetica.
- RTSP invalido montado por campos gera erro controlado.
- Senha RTSP nao aparece no resultado persistido do mock.

## Validacao

```bash
(cd Perceptrum && cmake --build out/build/linux-debug -j$(nproc))
(cd Perceptrum && ctest --test-dir out/build/linux-debug -R 'rtsp|camera|recording|job' --output-on-failure)
(cd DrakonSite && npm run build)
```

Resultados:

- `cmake --build`: passou.
- `ctest -R 'rtsp|camera|recording|job'`: passou, 6/6.
- `npm run build`: passou.

## Observacoes

- Nenhum commit foi feito.
- Nenhum push foi feito.
- Nenhuma camera RTSP real foi exigida para testes automatizados.
- O fluxo WEBCAM das fases anteriores foi preservado.
- URLs RTSP com credenciais sao mascaradas em resultados, health, eventos e logs do agente Linux.
