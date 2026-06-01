# Relatorio fase 22 - Linux camera capture, FrameDiskWriter e recordings

Data: 2026-05-25 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Branch local: `archon/linux-port-origin-main-sync`
Push: nao realizado

## Objetivo

Portar o caminho inicial de captura RTSP/Webcam, escrita de thumbnails/clips e listagem de recordings para Linux sem depender de Media Foundation e sem ligar camera pesada no runtime minimo por padrao.

## Resultado

Foi adicionado um adaptador Linux de captura/frame writer baseado em `ffmpeg` CLI:

- `Perceptrum/linux/LinuxFrameDiskWriter.{h,cpp}` grava clips MP4 em layout compativel com o leitor de recordings.
- `Perceptrum/linux/LinuxRtspThumbnailProbe.cpp` agora gera thumbnail, clips e evento em uma execucao sintetica/RTSP.
- `Perceptrum/linux/LinuxRuntimeAdapters.cpp` mantem camera/RTSP/frame writer atras dos gates runtime `PERCEPTRUM_ENABLE_CAMERA_CAPTURE=1`, `PERCEPTRUM_ENABLE_RTSP_CAPTURE=1` e `PERCEPTRUM_ENABLE_FRAME_WRITER=1`.
- `Perceptrum/linux/LinuxHeadlessRuntime.cpp` publica paths e estado de clips no `agent_health.json`.
- `DrakonSite/src/worker/cameraRecordings.ts` passa a reconhecer `APP_RUNTIME_DATA_ROOT/frames` e segmentos `10s`, `60s` e `300s`.
- `DrakonSite/src/worker/env.d.ts` documenta `APP_RUNTIME_DATA_ROOT` para o worker.
- `Perceptrum/linux/tests/verify_camera_recordings_endpoint.mjs` valida a listagem de segmentos via helper dos endpoints.

Windows Media Foundation nao foi alterado nem ligado no Linux. As fontes legadas `Perceptrum/camera/CameraSession.cpp` e `Perceptrum/camera/FrameDiskWriter.cpp` seguem fora do target Linux; o Linux usa o adaptador novo `LinuxFrameDiskWriter`.

## Diretorios finais

Com os roots resolvidos por XDG/AppBrand e sobrescritos por `APP_RUNTIME_*`:

- thumbnails: `${APP_RUNTIME_CACHE_ROOT}/agentcore/camera-thumbnails/<cameraId>-latest.jpg`
- clips 10s/60s/300s: `${APP_RUNTIME_DATA_ROOT}/frames/cam_<cameraId>/YYYY/MM/DD/<cameraId>_YYYYMMDD_HHMMSS_YYYYMMDD_HHMMSS_<profile>s.mp4`
- inference temp: `${APP_RUNTIME_CACHE_ROOT}/agentcore/inference-temp`
- jobs inference temp: `${APP_RUNTIME_CACHE_ROOT}/agentcore/jobs-inference-temp`
- events: `${APP_RUNTIME_STATE_ROOT}/events/agent_events.jsonl`
- health: `${APP_RUNTIME_DATA_ROOT}/agent_health.json`

O backend local lista recordings por `/api/cameras/:cameraId/recordings/summary`, `/api/cameras/:cameraId/recordings/segments` e serve bytes por `/api/camera-recordings/*`. A raiz `APP_RUNTIME_DATA_ROOT/frames` foi adicionada aos candidatos de busca.

## Testes sinteticos

Foram adicionados/estendidos testes CTest com fonte `lavfi`:

- `linux_rtsp_thumbnail_gates_generate_health_and_event`: liga os tres gates runtime, usa `lavfi:testsrc`, gera thumbnail, clips `10s/60s/300s`, health e evento.
- `linux_camera_recordings_endpoint_lists_synthetic_segments`: gera clips para camera numerica `22` e valida que o helper de recordings lista segmentos `10s/60s/300s`.

Os testes usam `APP_AGENT_RECORDING_CAPTURE_SECONDS=1` para nao exigir camera real nem esperar duracoes completas. Em runtime real, `APP_AGENT_RECORDING_PROFILES` aceita `10`, `60`, `300` ou combinacoes como `10,60,300`.

## Limitacoes para camera real

Esta fase implementa a captura Linux inicial por `ffmpeg` como adaptador portavel. Ela ainda nao porta o `CameraSession.cpp` completo, nem o pipeline completo de inferencia/jobs. A camera real depende de:

- `ffmpeg` e `ffprobe` no `PATH`;
- URL RTSP valida e acessivel;
- gates CMake compilados e gates runtime ligados;
- configuracao local de camera via `APP_AGENT_RTSP_URL` ou `agent_config.json`.

Webcam local pode ser exercitada via entrada `file:` ou por uma URL/entrada aceita pelo `ffmpeg`; uma integracao OpenCV completa fica fora desta fase.

## Comando para testar RTSP real

```bash
cd Perceptrum
APP_AGENT_RTSP_URL='rtsp://usuario:senha@host:554/stream1' \
APP_AGENT_CAMERA_ID='101' \
APP_AGENT_CAMERA_NAME='Camera RTSP Linux' \
APP_AGENT_RECORDING_PROFILES='10,60,300' \
PERCEPTRUM_ENABLE_CAMERA_CAPTURE=1 \
PERCEPTRUM_ENABLE_RTSP_CAPTURE=1 \
PERCEPTRUM_ENABLE_FRAME_WRITER=1 \
./out/build/linux-camera/perceptrum-agent run
```

Para encurtar uma validacao manual sem esperar todos os perfis, use `APP_AGENT_RECORDING_CAPTURE_SECONDS=3`.

## Validacao executada

Passou:

```bash
cd Perceptrum
cmake -S . -B out/build/linux-camera -G Ninja -DCMAKE_BUILD_TYPE=Debug -DPERCEPTRUM_ENABLE_AGENT_CORE=ON -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON
cmake --build out/build/linux-camera -j$(nproc)
ctest --test-dir out/build/linux-camera --output-on-failure
cd ../DrakonSite && npm run build
cd ..
./Perceptrum/linux-desktop/run-linux-dev.sh --check-backend --print-web-root --no-open
```

Resultados:

- `linux-camera`: 56/56 testes passaram.
- `npm run build`: passou.
- `run-linux-dev --check-backend --print-web-root --no-open`: passou, backend `discovered`, WebKitGTK compilado.

Avisos nao bloqueantes observados:

- esbuild manteve avisos conhecidos sobre `import.meta` em saida CJS durante staging do backend.
- WebKitGTK manteve aviso de API depreciada `webkit_web_view_run_javascript`.

## Estado final

- Push: nao realizado.
- Default minimal continua sem camera pesada quando os gates runtime nao sao definidos.
- Camera/RTSP/frame writer ligam somente com os gates runtime ON e, no build validado, com suporte CMake habilitado.
- Bloqueadores reais para esta fase: nenhum.
