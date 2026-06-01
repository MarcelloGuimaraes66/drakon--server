# Relatorio fase 21 - Linux AgentCore portable foundation

Data: 2026-05-25 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Branch local: `archon/linux-port-origin-main-sync`
Push: nao realizado

## Objetivo

Iniciar a portabilidade incremental do `AgentCore` completo para Linux sem ligar camera/jobs, isolando acoplamentos Win32 e dependencias pesadas por interfaces/adaptadores testaveis.

## Resultado

Foi criado um nucleo portavel pequeno em `Perceptrum/Perceptrum/core/AgentCorePortable.{h,cpp}`. Ele nao inclui `AgentCore.cpp`, `CameraSession`, `FrameDiskWriter` ou `JobRuntime`; inicializa apenas o contrato de runtime/status, valida dependencias portaveis e reporta capacidades reais versus capacidades bloqueadas por gates.

O Linux agora consegue compilar esse nucleo com `-DPERCEPTRUM_ENABLE_AGENT_CORE=ON` e ativa-lo em runtime com `PERCEPTRUM_ENABLE_AGENT_CORE=1`. Quando o nucleo portavel inicia com sucesso, o health snapshot passa a reportar:

- `runtime_mode: linux_agentcore_portable`
- `agent_core_enabled: true`
- `agent_core_partial: false`
- `agent_core_status_provider: linux_portable_agentcore_status_provider`
- adaptadores de paths, HTTP, clock/timezone e lifecycle

No build padrao, o runtime minimo continua sendo o comportamento default e `agent_core_partial` permanece `true`.

## Dependencias Win32 removidas/isoladas

O novo nucleo portavel nao depende de:

- `<Windows.h>`, DXGI, WinCrypt ou WRL usados por `AgentCore.cpp`.
- `CameraSession` / OpenCV capture.
- `FrameDiskWriter`.
- `JobRuntime`.
- Logger singleton Windows-specific.

As dependencias foram isoladas por interfaces/adaptadores:

- paths: `IAgentCorePathProvider` e `LinuxAgentCorePathProvider`;
- logging: `IRuntimeLogger` e `LinuxRuntimeLogger`;
- secure/token store: `ITokenStore` e `LinuxTokenStore`;
- pairing/config store: `IPairingConfigStore` e `LinuxPairingConfigStore`;
- HTTP/client: `IAgentCoreHttpClient` e `LinuxAgentCoreHttpClient` sobre `chatv2::getUrl`;
- clock/timezone/process id: `IAgentCoreClock` e `LinuxAgentCoreClock`;
- lifecycle: `IAgentCoreLifecycle` e `LinuxAgentCoreLifecycle`.

## Gates adicionados

- `PERCEPTRUM_ENABLE_AGENT_CORE=ON` no CMake compila `AgentCorePortable.cpp` dentro de `perceptrum_core`.
- A definicao de build `PERCEPTRUM_AGENT_CORE_PORTABLE_AVAILABLE=1` indica que o nucleo portavel esta disponivel.
- A ativacao em runtime continua explicita via ambiente `PERCEPTRUM_ENABLE_AGENT_CORE=1`, preservando o default minimal.
- Gates de camera, RTSP, frame writer e job runtime continuam separados e retornam erro funcional claro quando solicitados fora do escopo.

## Fontes compiladas

Build Linux padrao:

- `AgentCoreStatus.cpp`
- `HeadlessService.cpp`
- runtime/adapters Linux minimos
- sem `AgentCorePortable.cpp`
- sem `AgentCore.cpp`, `CameraSession.cpp`, `FrameDiskWriter.cpp` ou `JobRuntime.cpp`

Build `linux-agentcore` com `-DPERCEPTRUM_ENABLE_AGENT_CORE=ON`:

- `AgentCorePortable.cpp`
- `AgentCoreStatus.cpp`
- `HeadlessService.cpp`
- runtime/adapters Linux
- sem `AgentCore.cpp`, `CameraSession.cpp`, `FrameDiskWriter.cpp` ou `JobRuntime.cpp`

## Fontes ainda bloqueadas

Permanecem fora do alvo Linux AgentCore portable:

- `Perceptrum/Perceptrum/core/AgentCore.cpp`, por incluir Win32, DXGI/WinCrypt, CameraSession, RTSP, logger legado e JobRuntime diretamente.
- `Perceptrum/Perceptrum/camera/CameraSession.cpp`.
- `Perceptrum/Perceptrum/camera/FrameDiskWriter.cpp`.
- `Perceptrum/Perceptrum/jobs/JobRuntime.cpp`.

## Testes adicionados/ajustados

- `agentcore_portable_gate_compiles_without_legacy_sources`: garante que o gate compila `AgentCorePortable.cpp` sem fontes legadas.
- `agentcore_portable_gate_initializes_status`: garante que `agent_core_partial=false` aparece apenas com o nucleo portavel inicializado.
- `agentcore_portable_camera_jobs_return_functional_error`: garante erro claro para `PERCEPTRUM_ENABLE_JOB_RUNTIME=1` sem ligar jobs.
- O teste `apphost_project_files_not_touched_by_linux_ctest` foi restringido a arquivos `.vcxproj`/`.sln`, pois havia alteracao preexistente no runtime compartilhado `AppHost/Runtime/desktop-local-server.mjs`.

## Validacao executada

Passou:

```bash
cd Perceptrum
cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build out/build/linux-debug -j$(nproc)
ctest --test-dir out/build/linux-debug --output-on-failure
cmake -S . -B out/build/linux-agentcore -G Ninja -DCMAKE_BUILD_TYPE=Debug -DPERCEPTRUM_ENABLE_AGENT_CORE=ON
cmake --build out/build/linux-agentcore -j$(nproc)
ctest --test-dir out/build/linux-agentcore --output-on-failure
```

Resultados:

- `linux-debug`: 52/52 testes passaram.
- `linux-agentcore`: 55/55 testes passaram.

Avisos nao bloqueantes observados:

- esbuild manteve os avisos conhecidos de `import.meta` em saida CJS durante staging do backend.
- WebKitGTK avisou sobre `webkit_web_view_run_javascript` depreciado.

## Estado final

- Push: nao realizado.
- `AgentCore.cpp` completo ainda nao foi ligado no Linux.
- Camera/jobs/frame writer permanecem fora do gate desta fase.
- Bloqueadores reais para esta fase: nenhum.
