# Drakon Server - Primeira Implementacao

## Escopo do Primeiro Corte

Construir um MVP headless local que:

- inicia por CLI;
- valida config;
- lista cameras;
- captura webcam ou RTSP;
- salva frames em disco;
- escreve `frames.jsonl`, `events.jsonl` e `runtime-status.json`;
- nao executa GUI;
- nao depende de navegador;
- nao usa secrets hardcoded.

Inferencia real, jobs complexos e webhooks entram depois do loop de captura estar estavel.

## Estrutura Inicial

```text
include/drakon/
  cli/
  config/
  database/
  camera/
  capture/
  frame_store/
  inference/
  jobs/
  agents/
  alerts/
  events/
  indexes/
  api/
  webhook/
  runtime/
  logging/
  security/
src/
  main.cpp
  cli/
  config/
  camera/
  capture/
  frame_store/
  events/
  indexes/
  runtime/
tests/
```

## Contrato de Config MVP

`config/cameras.example.json`:

```json
{
  "runtime": {
    "data_root": "data",
    "log_level": "info"
  },
  "cameras": [
    {
      "id": "webcam0",
      "name": "Local Webcam",
      "source_type": "webcam",
      "webcam_index": 0,
      "enabled": true,
      "capture": {
        "store_frames": true,
        "fps": 1,
        "retention_days": 1,
        "motion_only": false
      }
    },
    {
      "id": "gate",
      "name": "Gate RTSP",
      "source_type": "rtsp",
      "rtsp_url_env": "DRAKON_GATE_RTSP_URL",
      "enabled": false,
      "capture": {
        "store_frames": true,
        "fps": 1,
        "retention_days": 7,
        "motion_only": true
      }
    }
  ]
}
```

## Comandos CLI MVP

```text
drakon-server --help
drakon-server version
drakon-server validate-config --config config/cameras.example.json
drakon-server list-cameras --config config/cameras.example.json
drakon-server capture --config config/cameras.example.json --camera webcam0 --duration 30
drakon-server run --config config/cameras.example.json
```

## Arquivos Gerados

Frames:

```text
data/frames/cam_<id>/YYYY/MM/DD/HH/fps_1/<id>_YYYYMMDD_HHMMSS_mmm.jpg
```

Indice:

```text
data/indexes/frames.jsonl
data/indexes/events.jsonl
data/indexes/runtime-status.json
```

Registro de frame:

```json
{
  "ts_utc": "2026-05-21T12:00:00.123Z",
  "camera_id": "webcam0",
  "camera_name": "Local Webcam",
  "source_type": "webcam",
  "fps": 1,
  "path": "data/frames/cam_webcam0/2026/05/21/12/fps_1/webcam0_20260521_120000_123.jpg",
  "width": 1280,
  "height": 720,
  "motion": null
}
```

Evento:

```json
{
  "ts_utc": "2026-05-21T12:00:00Z",
  "level": "info",
  "event_type": "camera_started",
  "camera_id": "webcam0",
  "message": "Camera capture started",
  "details": {}
}
```

## Sequencia Tecnica

1. Criar `RuntimePaths` e resolver diretarios.
2. Criar `JsonConfigLoader` com validacao de cameras.
3. Criar `JsonlWriter` com mutex e escrita append.
4. Criar `FrameStore` para paths por timestamp e escrita atomica.
5. Criar interface `ICaptureSource`.
6. Implementar `WebcamCaptureSource` com OpenCV.
7. Implementar `RtspCaptureSource` com FFmpeg/OpenCV.
8. Criar `CaptureWorker` por camera.
9. Criar `RuntimeStatus` e arquivo `runtime-status.json`.
10. Adicionar testes de config, path builder e JSONL.

## Dependencias Esperadas

Ja previstas ou provaveis:

- C++23
- CMake
- OpenCV
- FFmpeg/libavformat/libavcodec/libswscale
- nlohmann/json
- SQLite no proximo corte

Se faltar pacote apt, parar e informar o comando antes de instalar.

## Fora do Primeiro Corte

- ChatV2, UI, navegador, WebView.
- Billing, OAuth, Stripe, pareamento EXE.
- Telegram no MVP.
- Jobs multi-step complexos.
- Temporal engine.
- Postgres.
- Pacote `.deb`.

## Criterios de Aceite

- `ctest` passa.
- `validate-config` rejeita RTSP sem `rtsp_url`/`rtsp_url_env`.
- `capture --duration 10` gera frames e `frames.jsonl`.
- `runtime-status.json` mostra camera, estado, ultimo frame e contadores.
- Logs nao contem senha, token, bearer ou URL RTSP com credenciais.
