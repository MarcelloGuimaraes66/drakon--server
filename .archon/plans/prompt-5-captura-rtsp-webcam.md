# Prompt 5 - Captura RTSP/webcam sem inferencia

Data: 2026-05-21

## Objetivo executado

Foi implementada a primeira versao do modulo de captura do `drakon-server`, sem
inferencia e sem alertas.

Nao foi feito commit. Nao foi feito push. Nenhuma interface grafica foi criada.
Nenhuma credencial foi hardcodada.

## Fonte Perceptrum lido

Modulos lidos no repositorio fonte:

- `Perceptrum/Perceptrum/camera/CameraSession.cpp/.h`
- `Perceptrum/Perceptrum/camera/RtspCapture.cpp/.h`
- `Perceptrum/Perceptrum/camera/FrameDiskWriter.cpp/.h`
- `Perceptrum/Perceptrum/camera/FrameBuffer.cpp/.h`
- `Perceptrum/Perceptrum/camera/MotionDetector.cpp/.h`
- `Perceptrum/Perceptrum/camera/CameraConfig.h`

## O que foi usado como referencia

- `RtspCapture`: referencia de timeouts, isolamento de FFmpeg no `.cpp`,
  conversao para BGR e cuidado com reconnect. Nesta fase o `drakon-server` usa
  OpenCV `VideoCapture` com backend FFmpeg, sem portar o codigo inteiro.
- `FrameDiskWriter`: referencia de layout, perfis de FPS e escrita em disco.
  Nesta fase foram implementados frames JPEG + metadata JSON, nao clips MP4.
- `FrameBuffer`: referencia de buffer futuro; nao foi necessario para
  `capture-test` sincrono.
- `MotionDetector`: referencia futura; nao entrou nesta fase.
- `CameraSession`: usado apenas para entender fluxo RTSP/webcam e riscos; nao
  foi copiado.
- `CameraConfig`: usado para alinhar `source_type`, RTSP/webcam e perfis.

## Dependencias verificadas

Presentes no ambiente:

- OpenCV 4.10.0;
- FFmpeg/libavformat, libavcodec, libavutil, libswscale;
- binarios `ffmpeg` e `ffprobe`.

Nao foi necessario instalar pacote apt.

## Arquivos criados

- `include/drakon/camera/capture.h`
- `include/drakon/camera/frame_writer.h`
- `src/camera/capture.cpp`
- `src/camera/frame_writer.cpp`
- `.archon/plans/prompt-5-captura-rtsp-webcam.md`

## Arquivos ajustados

- `CMakeLists.txt`
- `README.md`
- `include/drakon/config/config_loader.h`
- `src/config/config_loader.cpp`
- `src/main.cpp`

## Comando implementado

```bash
drakon-server capture-test --config <path> --camera-id <id> --seconds <n>
drakon-server capture-test --config <path> --camera-id <id> --seconds <n> --dry-run
```

Comportamento:

- carrega config;
- verifica catalogo SQLite se o banco existir;
- resolve a camera por `camera_id`;
- escolhe perfis ativos referenciados pela camera;
- para `--dry-run` ou `source_type=test`, gera frames sinteticos;
- para `source_type=rtsp`, abre via OpenCV `CAP_FFMPEG`;
- para `source_type=webcam`, abre via V4L2/OpenCV;
- para `source_type=file`, abre via OpenCV/FFmpeg;
- salva frames em `data/frames/<camera_id>/YYYY/MM/DD/HH/mm/<profile>/`;
- grava metadata JSON por frame.

## Layout gerado

Exemplo:

```text
data/frames/cam_test_01/2026/05/21/16/04/fps_1/
  20260521T200412818Z_000001.jpg
  20260521T200412818Z_000001.json
```

Metadata inclui:

- `schema_version`;
- `frame_id`;
- `camera_id`;
- `capture_session_id`;
- `timestamp_utc`;
- `timestamp_local`;
- `timezone`;
- `fps_profile`;
- `sequence`;
- `image_path`;
- `metadata_path`;
- `width`;
- `height`;
- `source_uri_masked`;
- `checksum`;
- `status`;
- `dry_run`.

## Perfis

O comando usa `capture.profiles` do config:

- `fps_1`: 1 FPS;
- `fps_10`: 10 FPS, ou outros perfis configuraveis;
- apenas perfis `enabled=true` e referenciados por `camera.fps_profiles` sao
  usados.

## Seguranca de RTSP

- `rtsp_url` com senha em claro continua rejeitado pela validacao de config.
- Para RTSP com senha, usar `credentials_ref`, por exemplo
  `env:CAM_01_RTSP_URL`.
- A URL real vinda do ambiente e usada apenas para abrir a captura.
- Logs e erros nao imprimem a URL real.
- Metadata grava apenas `source_uri_masked`.

## Testes

Foi adicionado CTest sem dependencia de camera real:

- `drakon_server_capture_dry_run`

Ele executa:

```bash
drakon-server capture-test --config config/drakon-server.example.json --camera-id cam_test_01 --seconds 1 --dry-run
```

## Validacao executada

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j$(nproc)
ctest --test-dir build --output-on-failure
```

Resultado:

```text
100% tests passed, 0 tests failed out of 9
```

## Proximos passos

1. Persistir registros de frames na tabela `frames`.
2. Adicionar indice JSONL `data/indexes/frames.jsonl`.
3. Implementar fonte `file` em teste automatizado com video curto gerado.
4. Adicionar reconnect/backoff para RTSP real.
5. Adicionar captura continua por servico, alem de `capture-test`.
6. Adicionar metricas de FPS, drops e latencia.
7. So depois iniciar inferencia.

## Confirmacoes

- Nao foi feito commit.
- Nao foi feito push.
- Nao foi implementada inferencia.
- Nao foram emitidos alertas.
- Nao foram hardcodadas credenciais.
- URLs RTSP com senha nao sao impressas em logs/erros.
