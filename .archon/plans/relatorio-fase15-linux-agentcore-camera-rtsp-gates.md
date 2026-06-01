# Relatorio fase 15 - Linux AgentCore camera RTSP por gates

## Gates ativados

- `PERCEPTRUM_ENABLE_CAMERA_CAPTURE`
- `PERCEPTRUM_ENABLE_RTSP_CAPTURE`
- `PERCEPTRUM_ENABLE_FRAME_WRITER`

Esses tres gates agora liberam somente o caminho Linux pequeno de camera RTSP + thumbnail. O runtime continua aceitando override por variaveis de ambiente, como os demais gates.

O caminho ativado:

- carrega `agent_config.json` pelos `RuntimePaths` existentes;
- resolve a camera RTSP por `APP_AGENT_RTSP_URL` ou por campos de config (`rtsp_url`, `rtspUrl`, `stream_url`, `streamUrl`, inclusive dentro de `cameras[]` ou `linux_rtsp_camera`);
- inicia `ffmpeg` via `platform_process` POSIX/Windows-safe para capturar um frame;
- grava thumbnail em `cache/agentcore/rtsp-thumbnails/<camera-id>-latest.jpg`;
- publica evento em `data/agent_events.jsonl`;
- expõe health em `data/agent_health.json` com `rtsp_camera_started`, `rtsp_thumbnail_generated`, `rtsp_event_published`, paths e erro funcional.

Continuam bloqueados:

- `PERCEPTRUM_ENABLE_AGENT_CORE`
- `PERCEPTRUM_ENABLE_JOB_RUNTIME`
- qualquer subset incompleto de camera/RTSP/frame writer, por exemplo `PERCEPTRUM_ENABLE_CAMERA_CAPTURE=1` sozinho.

## Fontes pesados que entraram

Nenhum dos fontes legados pesados entrou no target Linux.

Entrou somente o adaptador Linux pequeno:

- `Perceptrum/linux/LinuxRtspThumbnailProbe.cpp`
- `Perceptrum/linux/LinuxRtspThumbnailProbe.h`

Ele usa `ffmpeg` externo e `Perceptrum/platform/platform_process.cpp`, evitando acoplar OpenCV, Media Foundation, Win32 process APIs, `AgentCore.cpp`, `CameraSession.cpp`, `FrameDiskWriter.cpp` ou `JobRuntime.cpp` ao build Linux.

## Fontes que continuam fora

Continuam fora de `perceptrum-agent`/`perceptrum_core` no Linux:

- `Perceptrum/Perceptrum/core/AgentCore.cpp`
- `Perceptrum/Perceptrum/camera/CameraSession.cpp`
- `Perceptrum/Perceptrum/camera/FrameDiskWriter.cpp`
- `Perceptrum/Perceptrum/jobs/JobRuntime.cpp`

Auditoria Win32 resumida:

- `AgentCore.cpp`: inclui `Windows.h` diretamente e ainda usa `DWORD`, `GetModuleFileName*`, `GetTempPathW`, `GetTickCount64`, `GetCurrentProcessId`, `CreateProcessW`, `WaitForSingleObject`, pipes Win32 e `CryptStringToBinaryA`.
- `CameraSession.cpp`: inclui `windows.h` e usa `CoInitializeEx`, `CreateProcessW`, `WaitForSingleObject`, `GetEnvironmentVariableW`, `GetIfTable`, toolhelp snapshot, `GetCurrentDirectoryA`, `GetTickCount64` e contadores de processo Win32.
- `FrameDiskWriter.cpp`: inclui `windows.h`, usa `GetModuleFileNameW`, `CreateProcessW`, `WaitForSingleObject`, `CoInitializeEx` e encoder Media Foundation protegido por `_WIN32`.
- `JobRuntime.cpp`: inclui `windows.h`, usa `CryptStringToBinaryA`, `CryptBinaryToStringA`, `CoInitializeEx`, `GetModuleFileNameA`, `CreateProcessW` e `WaitForSingleObject`.

Por isso, esta fase nao moveu esses fontes para o target Linux. O adaptador POSIX fica isolado em `linux/`.

## Testes de regressao

Validacao obrigatoria executada:

```bash
cd Perceptrum
cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build out/build/linux-debug -j$(nproc)
ctest --test-dir out/build/linux-debug --output-on-failure
```

Resultado:

- Configure: passou.
- Build Ninja: passou.
- CTest: 52/52 testes passaram.

Testes adicionados:

- `linux_rtsp_thumbnail_adapter_compiles_without_legacy_sources`
- `linux_rtsp_thumbnail_gates_generate_health_and_event`

Os testes confirmam que o adaptador novo compila, os quatro fontes legados continuam fora do `build.ninja`, os tres gates pequenos ativam health/event/thumbnail, e o gate isolado de camera continua retornando erro funcional.

## Riscos restantes

- O teste de thumbnail usa fonte sintetica `lavfi:` explicitamente liberada por `APP_AGENT_RTSP_ALLOW_TEST_SOURCE=1`; ainda falta smoke test manual com camera RTSP real em rede.
- O caminho Linux captura somente um thumbnail inicial. Ainda nao ha sessao continua equivalente a `CameraSession`.
- O evento publicado e health sao locais (`agent_events.jsonl` e `agent_health.json`); envio HTTP para backend ainda nao foi ligado neste gate.
- O adaptador depende de `ffmpeg` no `PATH` e de suporte do build local de `ffmpeg` aos protocolos RTSP usados pela camera.
- `AgentCore.cpp`, `CameraSession.cpp`, `FrameDiskWriter.cpp` e `JobRuntime.cpp` seguem com acoplamentos Win32 que devem ser quebrados em fases separadas antes de entrar no Linux target.
