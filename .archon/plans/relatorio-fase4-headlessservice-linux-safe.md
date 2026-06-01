# Relatorio fase 4 - HeadlessService Linux safe

Data de execucao local: 2026-05-22 America/Manaus  
UTC observado na validacao: 2026-05-23
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`

## 1. Arquivos lidos

- `.archon/prompts/prompt-4-headlessservice-linux-safe.txt`
- `.archon/plans/relatorio-fase3-pairing-headless-linux.md`
- `.archon/plans/relatorio-fase2-runtime-xdg-secrets-linux.md`
- `.archon/plans/relatorio-fase1-base-linux-reprodutivel.md`
- `.archon/plans/anchor-riscos-multiplataforma.md`
- `.archon/plans/anchor-comandos-validacao.md`
- `Perceptrum/CMakeLists.txt`
- `Perceptrum/linux/main.cpp`
- `Perceptrum/linux/RuntimePaths.h`
- `Perceptrum/linux/RuntimePaths.cpp`
- `Perceptrum/linux/LinuxHeadlessRuntime.h`
- `Perceptrum/linux/LinuxHeadlessRuntime.cpp`
- `Perceptrum/linux/LinuxRuntimeAdapters.h`
- `Perceptrum/linux/LinuxRuntimeAdapters.cpp`
- `Perceptrum/linux-desktop/main.cpp`
- `Perceptrum/Perceptrum/runtime/HeadlessService.h`
- `Perceptrum/Perceptrum/runtime/HeadlessService.cpp`
- `Perceptrum/Perceptrum/runtime/BrandingRuntime.h`
- `Perceptrum/Perceptrum/runtime/BrandingRuntime.cpp`
- `Perceptrum/Perceptrum/runtime/interfaces/IHeadlessRuntime.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IAgentRuntime.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IRuntimeLogger.h`
- `Perceptrum/Perceptrum/runtime/interfaces/ITokenStore.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IAgentCoreStatusProvider.h`
- `Perceptrum/Perceptrum/runtime/interfaces/AgentCoreStatusContract.h`
- `Perceptrum/Perceptrum/core/AgentCoreStatus.h`
- `Perceptrum/Perceptrum/core/AgentCoreStatus.cpp`
- `Perceptrum/Perceptrum/logging/Logging.h`
- `Perceptrum/Perceptrum/logging/Logging.cpp`
- `Perceptrum/Perceptrum/core/AgentCore.h`
- `Perceptrum/Perceptrum/core/AgentCore.cpp`
- `Perceptrum/Perceptrum/camera/CameraSession.h`
- `Perceptrum/Perceptrum/camera/CameraSession.cpp`
- `Perceptrum/Perceptrum/camera/FrameDiskWriter.h`
- `Perceptrum/Perceptrum/camera/FrameDiskWriter.cpp`
- `Perceptrum/Perceptrum/jobs/JobRuntime.h`
- `Perceptrum/Perceptrum/jobs/JobRuntime.cpp`
- `Perceptrum/Perceptrum/platform/platform_common.h`
- `Perceptrum/Perceptrum/platform/platform_common.cpp`
- `Perceptrum/Perceptrum/platform/platform_process.h`
- `Perceptrum/Perceptrum/platform/platform_process.cpp`
- `Perceptrum/Perceptrum/platform/platform_shutdown.h`
- `Perceptrum/Perceptrum/platform/platform_shutdown.cpp`
- `Perceptrum/Perceptrum/platform/platform_secure_store.h`
- `Perceptrum/Perceptrum/platform/platform_secure_store.cpp`

## 2. Arquivos criados

Os artefatos de fase 4 ja estavam presentes antes desta reexecucao:

- `Perceptrum/linux/LinuxHeadlessRuntime.h`
- `Perceptrum/linux/LinuxHeadlessRuntime.cpp`
- `Perceptrum/linux/LinuxRuntimeAdapters.h`
- `Perceptrum/linux/LinuxRuntimeAdapters.cpp`
- `Perceptrum/Perceptrum/runtime/interfaces/IHeadlessRuntime.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IAgentRuntime.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IRuntimeLogger.h`
- `Perceptrum/Perceptrum/runtime/interfaces/ITokenStore.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IAgentCoreStatusProvider.h`
- `Perceptrum/Perceptrum/runtime/interfaces/AgentCoreStatusContract.h`
- `Perceptrum/Perceptrum/core/AgentCoreStatus.h`
- `Perceptrum/Perceptrum/core/AgentCoreStatus.cpp`

Nesta execucao, o relatorio foi atualizado para refletir o estado real validado.

## 3. Arquivos alterados

- `.archon/plans/relatorio-fase4-headlessservice-linux-safe.md`

Nao foi necessaria alteracao de codigo nesta reexecucao porque a camada Linux segura ja estava implementada e os testes passaram.

## 4. Bloqueios reais encontrados no HeadlessService

- `Logging`: o caminho historico de `Logging.cpp` ainda usa contratos antigos de log/config/token em partes do runtime real. A ponte Linux usa `LinuxRuntimeLogger` para manter logs em `APP_RUNTIME_LOG_ROOT`.
- `AgentCore`: `AgentCore.cpp` continua fora do alvo Linux completo porque ainda carrega Win32, OpenCV, CameraSession, captura, jobs, FrameDiskWriter e dependencias pesadas. A fase 4 adiciona apenas status leve via `AgentCoreStatus`.
- `CameraSession`: ainda depende de APIs Win32, metricas/captura e RTSP/OpenCV. Permanece atras de feature gate.
- `FrameDiskWriter`: ainda deve separar Media Foundation/Windows de encoding Linux antes de entrar no runtime real.
- `JobRuntime`: ainda arrasta `AgentCore`, `CameraSession`, processamento pesado e caminhos Windows. Permanece atras de feature gate.
- `Win32 APIs`: continuam presentes nos componentes pesados, mas nao entram no alvo Linux minimo.
- `Paths`: o runtime Linux usa `RuntimePaths` e `APP_RUNTIME_*`; os componentes pesados ainda precisam receber roots explicitamente antes de serem ativados.
- `Secure store`: o Linux ja usa `LinuxTokenStore` sobre `platform_secure_store`, fail-closed por padrao e fallback plaintext apenas com flag explicita.
- `Shutdown`: o adaptador Linux responde a SIGINT/SIGTERM e grava snapshot final `stopped`.

## 5. HeadlessService real no build Linux

`HeadlessService.h` e `HeadlessService.cpp` entram no `perceptrum_core` Linux.

O arquivo `HeadlessService.cpp` foi preparado para compilar no Linux com dependencias portaveis injetadas:

- `HeadlessServiceDependencies`;
- `HeadlessRuntimeContext`;
- `IRuntimeLogger`;
- `ITokenStore`;
- `IAgentCoreFactory`;
- `IAgentRuntime`.

No Linux, a sobrecarga sem dependencias ainda retorna erro funcional `78`, porque o `AgentCore` real/cameras/jobs nao devem ser iniciados nesta fase. A integracao segura ocorre pela sobrecarga com dependencias injetadas.

## 6. Adaptador Linux criado ou ajustado

O adaptador validado e:

- `perceptrum::linux_runtime::RunLinuxHeadlessRuntime()`;
- `LinuxRuntimeLogger`;
- `LinuxTokenStore`;
- `LinuxMinimalAgentRuntime`;
- `LinuxMinimalAgentCoreFactory`;
- `BuildLinuxMinimalAgentCoreStatus()`.

Responsabilidades confirmadas:

- carregar `agent_config.json`;
- resolver `APP_RUNTIME_DATA_ROOT`, `APP_RUNTIME_CONFIG_ROOT`, `APP_RUNTIME_CACHE_ROOT`, `APP_RUNTIME_STATE_ROOT` e `APP_RUNTIME_LOG_ROOT`;
- criar diretorios;
- escrever `perceptrum-agent.log` em `APP_RUNTIME_LOG_ROOT`;
- escrever `agent_health.json` em `APP_RUNTIME_DATA_ROOT`;
- refletir `paired` e `provisioned`;
- executar loop controlado com heartbeat;
- tratar SIGINT/SIGTERM;
- gravar `status=stopped` no encerramento controlado;
- reportar adaptadores de logger/token/runtime;
- manter `AgentCore`, camera, RTSP, FrameDiskWriter e JobRuntime desativados por feature gates.

## 7. Como run/status/healthcheck mudaram

- `run` delega para `RunLinuxHeadlessRuntime()`.
- `status` le o snapshot do mesmo runtime root e inclui roots, runtime mode, status do HeadlessService, status leve do AgentCore e feature gates.
- `healthcheck` diferencia `missing_snapshot`, `not_paired`, `config_invalid`, `secure_store_unavailable`, `backend_unreachable`, `stopped`, `feature_gate_unsupported`, `runtime_error`, `linux_minimal_runtime` e `headless_ready`.
- Quando provisionado e rodando no adaptador minimo, o healthcheck retorna sucesso textual `linux_minimal_runtime`.
- Depois de `timeout`/SIGTERM controlado, o status final e `stopped`, e o healthcheck retorna erro funcional esperado.

## 8. Logs e health snapshot

- Log: `${APP_RUNTIME_LOG_ROOT}/perceptrum-agent.log`.
- Health: `${APP_RUNTIME_DATA_ROOT}/agent_health.json`.
- O snapshot inclui roots, base URL, client id, exe id, status do runtime, status leve do AgentCore e feature gates.
- O snapshot nao inclui exe-token nem pair-code.
- O teste `agent_status_does_not_expose_secrets` valida que `status` nao imprime o token.
- O teste `agent_health_does_not_expose_secrets` valida que `agent_health.json` nao contem o token.

## 9. Shutdown/SIGTERM

O runtime Linux instala handlers para SIGINT/SIGTERM. O loop encerra de forma controlada, chama `stop()` no runtime minimo e escreve snapshot final com:

- `status=stopped`;
- `agent_runtime_running=false`;
- `headless_integration_status=linux_minimal_runtime_stopped`.

O teste `agent_run_marks_stopped_on_sigterm` cobre esse comportamento.

## 10. Testes CTest adicionados/validados

CTest atual tem 43 testes. Os testes relevantes para a fase 4 incluem:

- `agent_run_writes_health_snapshot`
- `agent_healthcheck_not_paired`
- `agent_run_marks_stopped_on_sigterm`
- `agent_run_reflects_provisioned_config`
- `agent_healthcheck_linux_minimal_when_provisioned_running`
- `agent_status_shows_runtime_roots`
- `agent_status_does_not_expose_secrets`
- `agent_logs_created_in_log_root`
- `headless_bridge_reports_linux_minimal_runtime`
- `agent_logger_does_not_write_cwd_logs`
- `agent_health_does_not_expose_secrets`
- `linux_runtime_reports_interface_adapters`
- `headless_service_cpp_compiles_in_linux_core`
- `linux_minimal_runtime_feature_gates_off_by_default`
- `agentcore_lightweight_status_fields_reported`
- `agentcore_lightweight_status_compiles_in_linux_core`
- `linux_unsupported_feature_gate_returns_functional_error`
- `agentcore_complete_not_in_linux_target`
- `apphost_project_files_not_touched_by_linux_ctest`

Os testes de desktop Linux/WebKitGTK e fronteira React tambem passaram nesta bateria.

## 11. Resultado do CMake

Comando:

```bash
cd Perceptrum
cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
```

Resultado: sucesso.

```text
-- Configuring done (0.1s)
-- Generating done (0.0s)
-- Build files have been written to: /home/marcello-guimaraes/dev/perceptrum_desktop_aspp/Perceptrum/out/build/linux-debug
```

## 12. Resultado do build

Comando:

```bash
cmake --build out/build/linux-debug -j$(nproc)
```

Resultado: sucesso.

```text
ninja: no work to do.
```

## 13. Resultado do ctest

Comando:

```bash
ctest --test-dir out/build/linux-debug --output-on-failure
```

Resultado: sucesso.

```text
100% tests passed, 0 tests failed out of 43
Total Test time (real) = 29.70 sec
```

## 14. Resultado dos comandos manuais

Runtime isolado:

```bash
APP_RUNTIME_DATA_ROOT=/tmp/perceptrum-runtime-test/data
APP_RUNTIME_CONFIG_ROOT=/tmp/perceptrum-runtime-test/config
APP_RUNTIME_CACHE_ROOT=/tmp/perceptrum-runtime-test/cache
APP_RUNTIME_STATE_ROOT=/tmp/perceptrum-runtime-test/state
APP_RUNTIME_LOG_ROOT=/tmp/perceptrum-runtime-test/state/logs
```

Resultados:

- `./out/build/linux-debug/perceptrum-agent --help`: sucesso.
- `./out/build/linux-debug/perceptrum-agent version`: sucesso, `1.0.0`.
- `./out/build/linux-debug/perceptrum-agent validate-config`: sucesso, roots em `/tmp/perceptrum-runtime-test`.
- `./out/build/linux-debug/perceptrum-agent check-deps`: sucesso, encontrou `/usr/bin/ffmpeg`, `/usr/bin/ffprobe` e `/usr/bin/node`.
- `./out/build/linux-debug/perceptrum-agent status || true` antes do snapshot: erro funcional `missing_snapshot` com JSON de status e roots.
- `./out/build/linux-debug/perceptrum-agent healthcheck || true` antes do snapshot: erro funcional `missing_snapshot`.
- `APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 ./out/build/linux-debug/perceptrum-agent provision --base-url http://localhost:4000 --exe-token TEST_TOKEN --client-id test-client --timezone America/Manaus || true`: sucesso de teste com fallback explicito.
- `timeout 10s ./out/build/linux-debug/perceptrum-agent run || true`: criou log e snapshot; encerrou com `stopped`.
- `./out/build/linux-debug/perceptrum-agent status || true` depois do run: JSON com `paired=true`, `provisioned=true`, `runtime_mode=linux_minimal`, `headless_service=linux_headless_runtime_adapter`, `headless_integration_status=linux_minimal_runtime_stopped`, `agent_core_enabled=false`, `camera_capture_enabled=false`, `rtsp_capture_enabled=false`, `job_runtime_enabled=false`.
- `./out/build/linux-debug/perceptrum-agent healthcheck || true` depois do run: erro funcional esperado `stopped`.
- `find /tmp/perceptrum-runtime-test -maxdepth 5 -type f -print`: encontrou config nao sensivel, health snapshot, log e o arquivo de token apenas porque a execucao manual usou fallback plaintext explicito.

Arquivos encontrados:

```text
/tmp/perceptrum-runtime-test/config/agent_config.json
/tmp/perceptrum-runtime-test/config/client_id.txt
/tmp/perceptrum-runtime-test/config/exe_id.txt
/tmp/perceptrum-runtime-test/config/paired_timezone.txt
/tmp/perceptrum-runtime-test/config/perceptrum_base_url.txt
/tmp/perceptrum-runtime-test/config/secrets/exe_token.txt
/tmp/perceptrum-runtime-test/data/agent_health.json
/tmp/perceptrum-runtime-test/state/logs/perceptrum-agent.log
```

## 15. Confirmacao AppHost

`git diff --name-only -- AppHost '*.vcxproj' '*.sln'` nao retornou arquivos.

Confirmado: `AppHost/` nao foi alterado nesta execucao.

## 16. Confirmacao .vcxproj e .sln

Confirmado: nenhum arquivo `.vcxproj` ou `.sln` foi alterado nesta execucao.

## 17. Confirmacao de commit/push

Nenhum commit foi feito. Nenhum push foi feito.

Ultimo commit observado:

```text
1d8fa61 Improve chat identity evidence and text entry handling
```

## 18. Riscos pendentes

- `AgentCore.cpp` completo ainda precisa de isolamento forte de Win32, OpenCV, CameraSession, captura e jobs antes de ser ativado no Linux.
- `Logging.cpp` historico ainda precisa migrar completamente para roots explicitos antes de ser usado pelo runtime pesado.
- `CameraSession.cpp` precisa de implementacao Linux propria para captura/metricas/discovery.
- `FrameDiskWriter.cpp` precisa separar Media Foundation Windows de uma implementacao Linux.
- `JobRuntime.cpp` precisa remover dependencia de CryptoAPI/Win32 e ficar atras de contratos portaveis.
- O contrato de pairing real com backend ainda deve ser validado em ambiente local.
- Secret Service deve ser validado em um Ubuntu com keyring/libsecret disponivel; neste ambiente o fallback plaintext so foi usado de forma explicita para teste.

## 19. Proxima fase recomendada

Prosseguir para a fase de interfaces portaveis finais do runtime pesado:

- migrar `Logging` para roots/secret store explicitos;
- criar fabrica portavel para `AgentCore` sem cameras/jobs;
- manter `CameraSession`, `FrameDiskWriter` e `JobRuntime` atras de feature gates;
- validar `HeadlessService` com dependencias injetadas e contrato real de pairing/backend.

## 20. Criterio de sucesso

Concluido para esta execucao:

- build Linux reprodutivel passou;
- CTest passou;
- `run`, `status` e `healthcheck` estao mais proximos do runtime real via adaptadores;
- logs e health funcionam com `APP_RUNTIME_*` em `/tmp`;
- `HeadlessService.cpp` compila no Linux com dependencias injetadas;
- `AgentCore`, cameras, RTSP, `FrameDiskWriter` e `JobRuntime` completos nao foram integrados indevidamente;
- `AppHost`, `.vcxproj` e `.sln` nao foram alterados;
- nenhum commit foi feito.
