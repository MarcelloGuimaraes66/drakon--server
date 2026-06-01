# Relatorio fase 7 - AgentCore status/config Linux

Data: 2026-05-24 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`

## 1. Objetivo

Executar o prompt 7 e validar o contrato leve de status/config do AgentCore no Linux, sem integrar o AgentCore completo, `CameraSession`, `FrameDiskWriter`, OpenCV, Win32, RTSP ou `JobRuntime` no target Linux minimo.

Nesta execucao nao foi necessario alterar codigo: a fatia leve ja estava implementada. O trabalho desta rodada foi auditoria, validacao de build/testes, validacao manual do runtime e atualizacao deste relatorio com os resultados atuais.

## 2. Arquivos lidos

- `.archon/prompts/prompt-7-agentcore-status-config-linux.txt`
- `.archon/plans/relatorio-fase7-agentcore-status-config-linux.md`
- `Perceptrum/CMakeLists.txt`
- `Perceptrum/linux/main.cpp`
- `Perceptrum/linux/RuntimePaths.h`
- `Perceptrum/linux/RuntimePaths.cpp`
- `Perceptrum/linux/LinuxHeadlessRuntime.h`
- `Perceptrum/linux/LinuxHeadlessRuntime.cpp`
- `Perceptrum/linux/LinuxRuntimeAdapters.h`
- `Perceptrum/linux/LinuxRuntimeAdapters.cpp`
- `Perceptrum/Perceptrum/runtime/interfaces/AgentCoreStatusContract.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IAgentCoreStatusProvider.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IAgentRuntime.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IHeadlessRuntime.h`
- `Perceptrum/Perceptrum/runtime/HeadlessService.cpp`
- `Perceptrum/Perceptrum/runtime/HeadlessService.h`
- `Perceptrum/Perceptrum/core/AgentCoreStatus.h`
- `Perceptrum/Perceptrum/core/AgentCoreStatus.cpp`
- `Perceptrum/Perceptrum/core/AgentCore.cpp`
- `Perceptrum/Perceptrum/core/AgentCore.h`
- `Perceptrum/Perceptrum/camera/CameraSession.cpp`
- `Perceptrum/Perceptrum/camera/CameraSession.h`
- `Perceptrum/Perceptrum/camera/FrameDiskWriter.cpp`
- `Perceptrum/Perceptrum/camera/FrameDiskWriter.h`
- `Perceptrum/Perceptrum/jobs/JobRuntime.cpp`
- `Perceptrum/Perceptrum/jobs/JobRuntime.h`
- `Perceptrum/Perceptrum/comm/PairingClient.cpp`
- `Perceptrum/Perceptrum/comm/PairingClient.h`
- `Perceptrum/Perceptrum/platform/platform_secure_store.cpp`
- `Perceptrum/Perceptrum/platform/platform_secure_store.h`
- `Perceptrum/Perceptrum/logging/Logging.cpp`
- `Perceptrum/Perceptrum/logging/Logging.h`

## 3. Arquivos criados ou alterados nesta execucao

- `.archon/plans/relatorio-fase7-agentcore-status-config-linux.md`

Arquivos de codigo ja existentes e validados nesta fase:

- `Perceptrum/Perceptrum/runtime/interfaces/AgentCoreStatusContract.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IAgentCoreStatusProvider.h`
- `Perceptrum/Perceptrum/core/AgentCoreStatus.h`
- `Perceptrum/Perceptrum/core/AgentCoreStatus.cpp`

## 4. Contrato leve de AgentCore validado

`AgentCoreStatusContract` permanece como contrato portatil, sem dependencia de Win32 ou UI. Ele reporta:

- `providerName`
- `contractVersion`
- `fullAgentCoreActive`
- `partialModeAvailable`
- `capabilities`
- `blockedReason`
- `configSource`
- `configLoaded`
- `configValid`

`IAgentCoreStatusProvider` expoe somente `agentCoreStatus()`.

`BuildLinuxMinimalAgentCoreStatus()` monta o status Linux minimo sem incluir `AgentCore.h`, `CameraSession`, `FrameDiskWriter`, OpenCV, Win32, RTSP ou `JobRuntime`.

## 5. Campos de health/status confirmados

O `agent_health.json` e o comando `status` reportaram:

- `agent_core_status_provider`
- `agent_core_contract_version`
- `agent_core_partial`
- `agent_core_blocked_reason`
- `agent_core_config_source`
- `agent_core_config_loaded`
- `agent_core_config_valid`
- `agent_core_capabilities`

Tambem foram mantidos os campos anteriores:

- `runtime_mode`
- `agent_core_enabled`
- `feature_gates`
- `camera_capture_enabled`
- `rtsp_capture_enabled`
- `frame_writer_enabled`
- `job_runtime_enabled`
- `secure_store_available`
- `token_store`
- `runtime_logger`
- `headless_service`

## 6. Estado do AgentCore completo no Linux

O AgentCore completo continua fora do build Linux minimo.

Estado observado:

- `runtime_mode=linux_minimal`
- `agent_core_enabled=false`
- `agent_core_partial=true`
- `agent_core_status_provider=linux_minimal_agentcore_status_provider`
- `agent_core_contract_version=agentcore.status.v1`

Motivo reportado:

```text
full_agentcore_excluded_from_linux_minimal_build: AgentCore.cpp depends on Win32, OpenCV, CameraSession, RTSP, FrameDiskWriter and JobRuntime
```

Capacidades disponiveis:

- `status_config_contract`
- `runtime_paths_config`

Capacidades bloqueadas por gates:

- `full_agent_core` por `PERCEPTRUM_ENABLE_AGENT_CORE`
- `camera_capture` por `PERCEPTRUM_ENABLE_CAMERA_CAPTURE`
- `rtsp_capture` por `PERCEPTRUM_ENABLE_RTSP_CAPTURE`
- `frame_writer` por `PERCEPTRUM_ENABLE_FRAME_WRITER`
- `job_runtime` por `PERCEPTRUM_ENABLE_JOB_RUNTIME`

## 7. Confirmacao do plano de build Linux

`build.ninja` contem:

- `Perceptrum/core/AgentCoreStatus.cpp`

`build.ninja` nao contem como fonte compilada do target Linux minimo:

- `Perceptrum/core/AgentCore.cpp`
- `Perceptrum/camera/CameraSession.cpp`
- `Perceptrum/camera/FrameDiskWriter.cpp`
- `Perceptrum/jobs/JobRuntime.cpp`

O teste `agentcore_complete_not_in_linux_target` cobre essa fronteira.

## 8. Auditoria de PairingClient

`PairingClient` legado nao foi alterado nesta fase.

Bloqueios ainda existentes no legado:

- usa arquivos relativos como `exe_token.txt`, `client_id.txt`, `exe_id.txt` e `paired_timezone.txt`;
- usa `Logger::instance()` diretamente;
- persiste token e client id pelo fluxo legado;
- `pairWithCode` ainda grava secrets no caminho legado.

O fluxo Linux validado nesta fase usa `RuntimePaths` + `LinuxTokenStore` por meio de `perceptrum-agent provision`, `pair`, `status` e `run`.

## 9. Protecao de tokens e logs

O contrato leve nao contem token, pair code nem bearer.

Com `APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1`, o token de teste foi escrito somente em:

```text
/tmp/perceptrum-runtime-test/config/secrets/exe_token.txt
```

Permissao confirmada:

```text
600 /tmp/perceptrum-runtime-test/config/secrets/exe_token.txt
```

Busca por `TEST_TOKEN` em `/tmp/perceptrum-runtime-test/data` e `/tmp/perceptrum-runtime-test/state` nao retornou resultado. Busca em todo `/tmp/perceptrum-runtime-test` retornou somente o arquivo fallback de segredo acima.

## 10. Resultado do CMake

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

## 11. Resultado do build

Comando:

```bash
cmake --build out/build/linux-debug -j$(nproc)
```

Resultado: sucesso.

```text
ninja: no work to do.
```

## 12. Resultado do CTest

Comando:

```bash
ctest --test-dir out/build/linux-debug --output-on-failure
```

Resultado: sucesso.

```text
100% tests passed, 0 tests failed out of 43
Total Test time (real) = 29.65 sec
```

Testes relevantes desta fase:

- `agentcore_lightweight_status_fields_reported`
- `agentcore_lightweight_status_compiles_in_linux_core`
- `agentcore_complete_not_in_linux_target`
- `linux_minimal_runtime_feature_gates_off_by_default`
- `agent_status_does_not_expose_secrets`
- `agent_health_does_not_expose_secrets`
- `apphost_project_files_not_touched_by_linux_ctest`

## 13. Resultado dos comandos manuais

Runtime isolado usado:

```bash
export APP_RUNTIME_DATA_ROOT=/tmp/perceptrum-runtime-test/data
export APP_RUNTIME_CONFIG_ROOT=/tmp/perceptrum-runtime-test/config
export APP_RUNTIME_CACHE_ROOT=/tmp/perceptrum-runtime-test/cache
export APP_RUNTIME_STATE_ROOT=/tmp/perceptrum-runtime-test/state
export APP_RUNTIME_LOG_ROOT=/tmp/perceptrum-runtime-test/state/logs
```

Resultados:

- `./out/build/linux-debug/perceptrum-agent --help`: sucesso.
- `./out/build/linux-debug/perceptrum-agent version`: sucesso, `1.0.0`.
- `./out/build/linux-debug/perceptrum-agent validate-config`: sucesso, roots apontando para `/tmp/perceptrum-runtime-test`.
- `./out/build/linux-debug/perceptrum-agent check-deps`: sucesso, encontrou `perceptrum-agent`, `/usr/bin/ffmpeg`, `/usr/bin/ffprobe` e `/usr/bin/node`.
- `APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 ./out/build/linux-debug/perceptrum-agent provision --base-url http://localhost:4000 --exe-token TEST_TOKEN --client-id test-client --timezone America/Manaus || true`: sucesso, sem imprimir token.
- `timeout 10s ./out/build/linux-debug/perceptrum-agent run || true`: encerrou por timeout e gravou snapshot final `stopped`.
- `./out/build/linux-debug/perceptrum-agent status || true`: sucesso, JSON com campos `agent_core_*` e gates desligadas.
- `./out/build/linux-debug/perceptrum-agent healthcheck || true`: erro funcional esperado apos parada, `healthcheck stopped: linux runtime adapter is not running`.
- `find /tmp/perceptrum-runtime-test -maxdepth 5 -type f -print`: encontrou log, configs, fallback secret e `agent_health.json`.
- `grep -R "TEST_TOKEN" /tmp/perceptrum-runtime-test/data /tmp/perceptrum-runtime-test/state 2>/dev/null || true`: sem resultado.

Arquivos criados no runtime isolado:

- `/tmp/perceptrum-runtime-test/state/logs/perceptrum-agent.log`
- `/tmp/perceptrum-runtime-test/config/paired_timezone.txt`
- `/tmp/perceptrum-runtime-test/config/exe_id.txt`
- `/tmp/perceptrum-runtime-test/config/client_id.txt`
- `/tmp/perceptrum-runtime-test/config/perceptrum_base_url.txt`
- `/tmp/perceptrum-runtime-test/config/agent_config.json`
- `/tmp/perceptrum-runtime-test/config/secrets/exe_token.txt`
- `/tmp/perceptrum-runtime-test/data/agent_health.json`

## 14. Confirmacao de AppHost, vcxproj e sln

`AppHost/` nao foi alterado.

Nenhum `.vcxproj` foi alterado nesta execucao.

Nenhum `.sln` foi alterado nesta execucao.

`git diff --name-only -- AppHost '*.vcxproj' '*.sln'` nao retornou arquivos.

## 15. Confirmacao de commit/push

Nenhum commit foi feito.

Nenhum push foi feito.

## 16. Riscos pendentes

- `AgentCore` completo ainda depende de `CameraSession`, `FrameDiskWriter`, OpenCV, Win32, RTSP e `JobRuntime`.
- `PairingClient` legado ainda precisa aceitar config explicita e `ITokenStore` antes de ser usado pelo Linux novo.
- O contrato leve reporta status/config, mas ainda nao executa camera, RTSP, frame writer ou jobs.
- `secure_store_available=false` no ambiente atual; o fallback plaintext so funciona com opt-in explicito.

## 17. Proxima fase recomendada

Migrar `PairingClient` para interfaces de plataforma e `RuntimePaths`, preservando o comportamento Windows. Depois disso, iniciar um AgentCore parcial Linux que consuma o contrato leve e ative capacidades por gates, uma por vez.
