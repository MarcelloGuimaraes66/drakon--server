# Relatorio fase 1 - base Linux reprodutivel

Data: 2026-05-03
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`

## Arquivos criados

- `Perceptrum/CMakeLists.txt`
- `Perceptrum/linux/main.cpp`
- `Perceptrum/linux-desktop/main.cpp`
- `Perceptrum/linux-desktop/XdgPaths.h`
- `Perceptrum/linux-desktop/XdgPaths.cpp`
- `.archon/plans/relatorio-fase1-base-linux-reprodutivel.md`

## Arquivos alterados

- Nenhum arquivo existente foi alterado.
- `AppHost/` nao foi alterado.
- Arquivos `.vcxproj` nao foram alterados.
- Arquivos `.sln` nao foram alterados.

## Alvos CMake criados

- `perceptrum_core`: biblioteca estatica com fontes canonicas C++ portaveis.
- `perceptrum-agent`: executavel Linux minimo do agente.
- `perceptrum-desktop`: executavel Linux desktop inicial em modo stub.

## Fontes incluidas no `perceptrum_core`

- `Perceptrum/platform/platform_common.cpp`
- `Perceptrum/platform/platform_process.cpp`
- `Perceptrum/platform/platform_secure_store.cpp`
- `Perceptrum/platform/platform_shutdown.cpp`
- `Perceptrum/runtime/BrandingRuntime.cpp`
- `Perceptrum/orchestrator/ConfigUtils.cpp`
- `Perceptrum/orchestrator/HttpUtils.cpp`
- `Perceptrum/jobs/JobPayloadParser.cpp`

## Fontes excluidas e motivo

- `Perceptrum/Perceptrum.cpp`: entrada Win32 com `wWinMain`, janela, tray e APIs Win32.
- `Perceptrum/app/PairingDialog.cpp` e `Perceptrum/app/TrayIcon.cpp`: UI Windows-only baseada em `HWND`, `HINSTANCE` e `Shell_NotifyIcon`.
- `Perceptrum/camera/CameraSession.cpp`: ainda contem varios trechos Win32 nao isolados no caminho Linux, incluindo `CreateProcessW`, `GetModuleFileNameA`, variaveis de ambiente Win32 e enumeracao de interfaces/processos.
- `Perceptrum/camera/FrameDiskWriter.cpp`: ainda contem execucao FFmpeg e partes de encoding com APIs Win32.
- `Perceptrum/core/AgentCore.cpp`: ainda contem acoplamentos Win32 extensos e trechos FFmpeg/processo que exigem refatoracao dedicada antes de entrar no build Linux canonico.
- `Perceptrum/jobs/JobRuntime.cpp`: ainda contem trechos Win32 extensos, conversao base64 via CryptoAPI e execucao de processo Win32.
- `Perceptrum/runtime/HeadlessService.cpp`: depende de `AgentCore`, `PairingClient`, `BackendConfig`, `curl` e tratamento de excecao Win32; deve entrar apos saneamento do runtime.
- `Perceptrum/logging/Logging.cpp`: nao foi incluido nesta fase minima porque acopla exportacao HTTP, store seguro e configuracao backend; sera reavaliado quando o agente real entrar no alvo.
- `Perceptrum/*_old.cpp` e `Perceptrum/*_old.h`: excluidos por regra do prompt como codigo legado.
- `Perceptrum/*.vcxproj`, `Perceptrum/*.sln`, `AppHost/`: excluidos por regra do prompt e por serem Windows-only.

## Artefatos de `Perceptrum/out` ignorados

Usado apenas como inventario historico, sem copiar fonte ou scripts para a arvore canonica:

- `Perceptrum/out/build/linux-debug/perceptrum-agent`
- `Perceptrum/out/build/linux-debug/perceptrum-desktop`
- `Perceptrum/out/build/linux-debug/libperceptrum_core.a`
- `Perceptrum/out/build/linux-debug/CMakeCache.txt`
- `Perceptrum/out/build/linux-debug/compile_commands.json`
- `Perceptrum/out/build/linux-debug/CPackConfig.cmake`
- `Perceptrum/out/build/linux-debug/install_manifest.txt`
- `Perceptrum/out/build/ui/*`
- `Perceptrum/out/package/perceptrum-desktop_1.0.0_amd64.deb`

## Comandos executados

```bash
cd Perceptrum
cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build out/build/linux-debug -j$(nproc)
ctest --test-dir out/build/linux-debug --output-on-failure
./out/build/linux-debug/perceptrum-agent --help
./out/build/linux-debug/perceptrum-agent validate-config
./out/build/linux-debug/perceptrum-agent check-deps
./out/build/linux-debug/perceptrum-desktop
```

## Resultado do CMake

Sucesso.

Mensagem final:

```text
-- Configuring done
-- Generating done
-- Build files have been written to: /home/marcello-guimaraes/dev/perceptrum_desktop_aspp/Perceptrum/out/build/linux-debug
```

## Resultado do build

Sucesso.

Artefatos gerados:

- `Perceptrum/out/build/linux-debug/libperceptrum_core.a`
- `Perceptrum/out/build/linux-debug/perceptrum-agent`
- `Perceptrum/out/build/linux-debug/perceptrum-desktop`

Mensagem final:

```text
[12/14] Linking CXX static library libperceptrum_core.a
[13/14] Linking CXX executable perceptrum-agent
[14/14] Linking CXX executable perceptrum-desktop
```

## Resultado dos testes

`ctest` executou com sucesso, mas ainda nao existem testes cadastrados.

```text
Test project /home/marcello-guimaraes/dev/perceptrum_desktop_aspp/Perceptrum/out/build/linux-debug
No tests were found!!!
```

## Resultado dos binarios

`perceptrum-agent --help`: sucesso.

```text
perceptrum-agent - Linux entrypoint for the Perceptrum runtime

Usage:
  perceptrum-agent --help
  perceptrum-agent validate-config
  perceptrum-agent check-deps
```

`perceptrum-agent validate-config`: sucesso.

```text
brand=perceptrum
displayName=Perceptrum
dataRoot=/home/marcello-guimaraes/.local/share/PerceptrumData
executable=/home/marcello-guimaraes/dev/perceptrum_desktop_aspp/Perceptrum/out/build/linux-debug/perceptrum-agent
```

`perceptrum-agent check-deps`: sucesso.

```text
ffmpeg=/usr/bin/ffmpeg
ffprobe=/usr/bin/ffprobe
node=/usr/bin/node
```

`perceptrum-desktop`: sucesso como stub inicial.

```text
Perceptrum Linux desktop stub
dataHome=/home/marcello-guimaraes/.local/share/perceptrum
configHome=/home/marcello-guimaraes/.config/perceptrum
cacheHome=/home/marcello-guimaraes/.cache/perceptrum
runtimeDir=/run/user/1000/perceptrum
```

## Erros remanescentes

- O desktop Linux ainda e stub e nao inicializa GTK/WebKitGTK.
- O agente Linux ainda e entrada minima de diagnostico; ainda nao inicia `AgentCore`.
- As fontes grandes do runtime real ainda precisam de uma fase de saneamento Linux antes de entrarem no `perceptrum_core`, principalmente `AgentCore.cpp`, `CameraSession.cpp`, `FrameDiskWriter.cpp` e `JobRuntime.cpp`.
- Ainda nao ha testes CTest cadastrados.

## Dependencias apt necessarias

Nenhuma instalacao apt foi necessaria nesta fase. As ferramentas e bibliotecas usadas no build ja estavam disponiveis no ambiente.

## Confirmacoes

- `AppHost/` nao foi alterado.
- `.vcxproj` nao foi alterado.
- `.sln` nao foi alterado.
- Nenhum commit foi feito.
- Nenhum push foi feito.
- Ultimo commit observado apos a execucao: `1d8fa61 Improve chat identity evidence and text entry handling`.
