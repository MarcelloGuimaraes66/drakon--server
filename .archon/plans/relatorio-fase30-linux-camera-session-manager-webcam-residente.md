# Relatorio fase 30 - Linux camera session manager e webcam residente

Data: 2026-05-26 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Executor: Codex/gpt-5.5
Commit/push: nao realizado

## Objetivo

Implementar uma sessao residente para cameras Linux `WEBCAM -> /dev/videoN`, evitando que `start_camera` fique bloqueado esperando a gravacao de um clip completo. O comportamento agora segue o contrato: capturar frame inicial, publicar thumbnail, iniciar gravacao residente em background e retornar rapidamente.

## Contrato Start/Stop

`start_camera` no Linux:

- Para `connection_method=WEBCAM`, resolve a fonte para `v4l2:/dev/videoN`.
- `APP_AGENT_WEBCAM_DEVICE` sobrescreve o device fisico.
- `APP_AGENT_WEBCAM_TEST_SOURCE` aceita `lavfi:` ou `file:` somente quando `APP_AGENT_RTSP_ALLOW_TEST_SOURCE=1`, para testes automatizados sem webcam real.
- Valida `ffmpeg`, existencia do device e permissao antes de tentar abrir a camera.
- Captura um frame inicial com `ffmpeg` dentro de timeout curto.
- Faz upload do thumbnail para o backend antes de concluir.
- Inicia uma worker residente que mantem ffmpeg segmentando clips em background.
- Retorna `completed` quando a fonte abriu, o frame inicial foi capturado e o upload do thumbnail concluiu.
- Retorna `failed` com erro especifico para `ffmpeg_not_found`, `webcam_device_not_found`, `webcam_permission_denied`, `webcam_frame_timeout`/falha de frame e `thumbnail_upload_failed`.
- E idempotente por `camera_id`: se a sessao esta ativa, reutiliza a sessao e retorna `reused=true`.

`stop_camera` no Linux:

- Resolve `camera_id` do comando/payload.
- Encerra a sessao residente, envia SIGTERM/SIGKILL via adapter de processo quando necessario e faz join da worker.
- Retorna `stopped=true` e `was_running=true|false`.
- `shutdown` do runtime tambem encerra todas as sessoes.

## Arquivos alterados

- `Perceptrum/linux/LinuxCameraSessionManager.{h,cpp}`
  - novo mapa de sessoes por `camera_id`;
  - start idempotente;
  - stop por camera;
  - shutdown limpo;
  - status JSON com cameras ativas, erros, thumbnails, diretorios e pids ffmpeg.
- `Perceptrum/linux/LinuxJobRuntime.{h,cpp}`
  - `start_camera` WEBCAM usa o novo gerenciador residente;
  - caminho RTSP existente permanece usando `RunLinuxRtspThumbnailProbe`;
  - `stop_camera` encerra sessao residente;
  - `StartCameraResultFailed` aceita `recording_session_started` sem exigir clip sincrono.
- `Perceptrum/linux/LinuxHeadlessRuntime.cpp`
  - adiciona resumo das sessoes ao `agent_health.json`.
- `Perceptrum/Perceptrum/runtime/interfaces/IAgentRuntime.h`
  - adiciona `cameraSessionStatusJson`.
- `Perceptrum/CMakeLists.txt`
  - inclui os novos arquivos no alvo `perceptrum-agent`.
- `AppHost/Runtime/desktop-local-server.mjs` e `DrakonSite/server/index.ts`
  - repassam os campos de sessao no endpoint `/api/runtime/agent-health`.

## Paths de thumbnail e clips

Com os roots XDG do runtime:

- Thumbnail: `${APP_RUNTIME_CACHE_ROOT}/agentcore/camera-thumbnails/<camera_id>-latest.jpg`
- Clips: `${APP_RUNTIME_DATA_ROOT}/frames/cam_<camera_id>/<YYYY>/<MM>/<DD>/`
- Temp de inferencia: `${APP_RUNTIME_CACHE_ROOT}/agentcore/inference-temp`
- Temp de jobs: `${APP_RUNTIME_CACHE_ROOT}/agentcore/jobs-inference-temp`

No teste sintetico executado:

- Thumbnail: `/tmp/perceptrum-session-health-check/cache/agentcore/camera-thumbnails/20-latest.jpg`
- Clips: `/tmp/perceptrum-session-health-check/data/frames/cam_20/2026/05/26`

## Agent health

`agent_health.json` agora inclui:

- `linux_camera_sessions`
- `active_camera_sessions`
- `camera_session_last_errors`
- `camera_session_last_thumbnails`
- `camera_session_clip_directories`
- `camera_session_ffmpeg_child_pids`

Snapshot ativo observado no teste local:

```json
{
  "start_latency_ms": 76,
  "active_camera_sessions": ["20"],
  "camera_session_ffmpeg_child_pids": { "20": [507349] },
  "camera_session_clip_directories": {
    "20": "/tmp/perceptrum-session-health-check/data/frames/cam_20/2026/05/26"
  },
  "camera_session_last_thumbnails": {
    "20": "/tmp/perceptrum-session-health-check/cache/agentcore/camera-thumbnails/20-latest.jpg"
  }
}
```

## Tempo medio de resposta do Start

Medicao automatizada com fonte `lavfi:testsrc=size=96x54:rate=1`:

- amostras: 1 comando `start_camera` do mock command server
- media: 76 ms
- resultado: `completed`, `recording_session_started=true`, `thumbnail_uploaded=true`

## Como testar webcam real na UI

1. Iniciar o app Linux:

```bash
./Perceptrum/linux-desktop/run-linux-dev.sh
```

2. Confirmar agente vivo:

```bash
curl -fsS http://127.0.0.1:4000/api/runtime/agent-health
```

3. Cadastrar/iniciar uma camera com:

```text
connection_method=WEBCAM
webcam_index=0
```

4. Verificar que `start_camera` conclui rapido, thumbnail aparece na UI e `agent_health` mostra `active_camera_sessions`.

5. Confirmar clips em:

```bash
find "$HOME/.local/share/PerceptrumData/frames" -name '*.mp4' -size +0c
```

6. Clicar/parar a camera na UI e confirmar que `active_camera_sessions` fica vazio e que os pids ffmpeg somem do health.

## Validacao executada

```bash
(cd Perceptrum && cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug -DPERCEPTRUM_ENABLE_AGENT_CORE=ON -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON)
(cd Perceptrum && cmake --build out/build/linux-debug -j$(nproc))
(cd Perceptrum && ctest --test-dir out/build/linux-debug -R 'linux.*camera|webcam|job_runtime' --output-on-failure)
```

Resultados:

- `cmake`: passou.
- `cmake --build`: passou.
- `ctest -R 'linux.*camera|webcam|job_runtime'`: 3/3 passaram.

Teste manual obrigatorio porque `/dev/video0` existe:

```bash
ffmpeg -y -hide_banner -f v4l2 -framerate 15 -i /dev/video0 -frames:v 1 /tmp/perceptrum-webcam-real.jpg
ls -l /tmp/perceptrum-webcam-real.jpg
```

Resultado:

- `/tmp/perceptrum-webcam-real.jpg` gerado com 130905 bytes.
- O driver ajustou a taxa de 15 fps para 5 fps, mas a captura de 1 frame passou.

## Observacoes

- Windows nao foi alterado no caminho de captura legado.
- Linux nao depende de Media Foundation.
- Testes automatizados continuam usando `lavfi`/mock server e nao exigem webcam real.
- Nenhum commit e nenhum push foram realizados.
