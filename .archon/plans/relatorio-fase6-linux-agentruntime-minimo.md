# Relatorio fase 6 - Linux IAgentRuntime minimo real

Data de execucao local: 2026-05-22 America/Manaus  
UTC observado na validacao: 2026-05-23
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`

## 1. Arquivos lidos

- `.archon/prompts/prompt-6-linux-agentruntime-minimo.txt`
- `.archon/plans/relatorio-fase5-headless-interfaces-logging-linux.md`
- `.archon/plans/relatorio-fase4-headlessservice-linux-safe.md`
- `.archon/plans/relatorio-fase3-pairing-headless-linux.md`
- `.archon/plans/anchor-riscos-multiplataforma.md`
- `Perceptrum/CMakeLists.txt`
- `Perceptrum/linux/main.cpp`
- `Perceptrum/linux/RuntimePaths.h`
- `Perceptrum/linux/RuntimePaths.cpp`
- `Perceptrum/linux/LinuxHeadlessRuntime.h`
- `Perceptrum/linux/LinuxHeadlessRuntime.cpp`
- `Perceptrum/linux/LinuxRuntimeAdapters.h`
- `Perceptrum/linux/LinuxRuntimeAdapters.cpp`
- `Perceptrum/Perceptrum/runtime/interfaces/IRuntimeLogger.h`
- `Perceptrum/Perceptrum/runtime/interfaces/ITokenStore.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IAgentRuntime.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IHeadlessRuntime.h`
- `Perceptrum/Perceptrum/runtime/HeadlessService.h`
- `Perceptrum/Perceptrum/runtime/HeadlessService.cpp`
- `Perceptrum/Perceptrum/runtime/BrandingRuntime.h`
- `Perceptrum/Perceptrum/runtime/BrandingRuntime.cpp`
- `Perceptrum/Perceptrum/logging/Logging.h`
- `Perceptrum/Perceptrum/logging/Logging.cpp`
- `Perceptrum/Perceptrum/core/AgentCore.h`
- `Perceptrum/Perceptrum/core/AgentCore.cpp`
- `Perceptrum/Perceptrum/core/AgentCoreStatus.h`
- `Perceptrum/Perceptrum/core/AgentCoreStatus.cpp`
- `Perceptrum/Perceptrum/orchestrator/ChatModelConfig.h`
- `Perceptrum/Perceptrum/orchestrator/ChatModelConfig.cpp`
- `Perceptrum/Perceptrum/orchestrator/ConfigUtils.h`
- `Perceptrum/Perceptrum/orchestrator/ConfigUtils.cpp`
- `Perceptrum/Perceptrum/orchestrator/SkillRegistry.h`
- `Perceptrum/Perceptrum/orchestrator/SkillRegistry.cpp`
- `Perceptrum/Perceptrum/orchestrator/SkillTypes.h`
- `Perceptrum/Perceptrum/platform/platform_common.h`
- `Perceptrum/Perceptrum/platform/platform_common.cpp`
- `Perceptrum/Perceptrum/platform/platform_process.h`
- `Perceptrum/Perceptrum/platform/platform_process.cpp`
- `Perceptrum/Perceptrum/platform/platform_secure_store.h`
- `Perceptrum/Perceptrum/platform/platform_secure_store.cpp`
- `Perceptrum/Perceptrum/comm/PairingClient.h`
- `Perceptrum/Perceptrum/comm/PairingClient.cpp`
- `brand.config.json`

## 2. Arquivos criados

Nenhum arquivo de codigo foi criado nesta reexecucao. A implementacao da fase 6 ja estava presente.

O arquivo atualizado nesta execucao foi:

- `.archon/plans/relatorio-fase6-linux-agentruntime-minimo.md`

## 3. Arquivos alterados

- `.archon/plans/relatorio-fase6-linux-agentruntime-minimo.md`

Nao foi necessaria alteracao de codigo: o runtime minimo, feature gates, CMake e testes ja estavam implementados e passaram.

## 4. Implementacao concreta de IAgentRuntime

A implementacao concreta atual e `LinuxMinimalAgentRuntime`, em `Perceptrum/linux/LinuxRuntimeAdapters.h/.cpp`.

Responsabilidades confirmadas:

- `start()`;
- `stop()`;
- `status()`;
- validacao dos runtime roots por `EnsureRuntimeDirectories`;
- validacao basica de branding (`AppBrand::kBrandId` e `AppBrand::kDisplayName`);
- leitura de config nao sensivel por `ReadAgentConfig`;
- validacao de dependencias leves (`ffmpeg`, `ffprobe`, `node`);
- uso de `IRuntimeLogger` via `LinuxRuntimeLogger`;
- publicacao de `AgentRuntimeStatus` no health JSON;
- declaracao explicita de `agent_core_enabled=false`;
- declaracao explicita de `agent_core_partial=true`;
- declaracao explicita de `camera_capture_enabled=false`;
- declaracao explicita de `rtsp_capture_enabled=false`;
- declaracao explicita de `job_runtime_enabled=false`;
- declaracao explicita de `frame_writer_enabled=false`.

## 5. Feature gates adicionados

Feature gates CMake/env validados, todos OFF por padrao:

- `PERCEPTRUM_ENABLE_AGENT_CORE`
- `PERCEPTRUM_ENABLE_CAMERA_CAPTURE`
- `PERCEPTRUM_ENABLE_RTSP_CAPTURE`
- `PERCEPTRUM_ENABLE_JOB_RUNTIME`
- `PERCEPTRUM_ENABLE_FRAME_WRITER`

O health JSON inclui o objeto `feature_gates`.

Quando um recurso pesado ainda nao suportado e ativado, o runtime retorna erro funcional:

- status: `feature_gate_unsupported`;
- exit code: `78`;
- mensagem: `unsupported_feature_gate: <gate> is not supported by linux_minimal_agent_runtime`.

## 6. Estado de AgentCore

`AgentCore.cpp` completo continua fora do alvo Linux.

Auditoria observada:

- `AgentCore.h` inclui `../camera/CameraSession.h`;
- `AgentCore.h` expoe tipos de `CameraSession`, `FrameDiskWriter` e `JobRuntime`;
- `AgentCore.cpp` inclui `Windows.h`, `wincrypt.h`, OpenCV, `CameraSession` e `JobRuntime`;
- `AgentCore.cpp` ainda contem chamadas `CreateProcessW` e `WaitForSingleObject`;
- o fluxo completo arrasta camera, RTSP, frame writer e jobs pesados.

A fatia leve atual fica em `AgentCoreStatus.h/.cpp`, que compila no `perceptrum_core` e fornece `AgentCoreStatusContract` sem ativar `AgentCore` real.

## 7. AgentCore no build Linux

`AgentCore.cpp` nao entrou no build Linux.

Confirmado por `build.ninja`: apenas `Perceptrum/core/AgentCoreStatus.cpp` aparece no `perceptrum_core`; `Perceptrum/core/AgentCore.cpp`, `Perceptrum/camera/CameraSession.cpp`, `Perceptrum/camera/FrameDiskWriter.cpp` e `Perceptrum/jobs/JobRuntime.cpp` nao aparecem.

O teste `agentcore_complete_not_in_linux_target` cobre essa ausencia.

## 8. Motivo para AgentCore nao entrar

Incluir `AgentCore.cpp` agora violaria o escopo do prompt 6 porque puxaria:

- Win32;
- OpenCV;
- camera;
- RTSP;
- FrameDiskWriter;
- JobRuntime;
- fluxos pesados de processamento.

Por isso, o Linux usa `AgentCoreStatus` leve e mantem o runtime pesado atras de feature gates.

## 9. Como HeadlessService usa IAgentRuntime

`HeadlessService.cpp` compila no Linux e usa o caminho portavel com `HeadlessServiceDependencies`.

No caminho injetado:

- `HeadlessRuntimeContext` fornece `IRuntimeLogger`, `ITokenStore`, `IAgentCoreFactory`, providers de base URL/client id e callback de status;
- `RunInjectedHeadlessService` chama `agentFactory->create(...)`;
- o factory Linux (`LinuxMinimalAgentCoreFactory`) cria `LinuxMinimalAgentRuntime`;
- o runtime chama `start()`, publica `status()` e chama `stop()` no encerramento.

No Linux, a sobrecarga sem dependencias ainda retorna erro funcional `78`, evitando ativacao acidental do `AgentCore` real.

## 10. Logs e tokens protegidos

- `LinuxMinimalAgentRuntime` usa `IRuntimeLogger`.
- `LinuxRuntimeLogger` grava em `${APP_RUNTIME_LOG_ROOT}/perceptrum-agent.log`.
- O caminho Linux minimo nao escreve logs relativos ao CWD.
- `LinuxTokenStore` usa `platform_secure_store`.
- Sem Secret Service/fallback explicito, token storage fica fail-closed.
- Com `APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1`, o fallback grava apenas `config/secrets/exe_token.txt` com permissao `0600`.
- `status`, `agent_health.json` e logs nao expuseram `TEST_TOKEN`.
- A busca manual em `/tmp/perceptrum-runtime-test/data` e `/tmp/perceptrum-runtime-test/state` nao retornou `TEST_TOKEN`.

## 11. Testes adicionados/validados

CTest atual tem 43 testes. Os testes mais diretamente ligados a fase 6 incluem:

- `agent_healthcheck_linux_minimal_when_provisioned_running`
- `headless_bridge_reports_linux_minimal_runtime`
- `linux_runtime_reports_interface_adapters`
- `linux_minimal_runtime_feature_gates_off_by_default`
- `agentcore_lightweight_status_fields_reported`
- `agentcore_lightweight_status_compiles_in_linux_core`
- `linux_unsupported_feature_gate_returns_functional_error`
- `agentcore_complete_not_in_linux_target`

Os testes anteriores de pairing/provisioning, logging, secret store, fronteira AppHost e desktop Linux tambem passaram.

## 12. Resultado do CMake

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

## 13. Resultado do build

Comando:

```bash
cmake --build out/build/linux-debug -j$(nproc)
```

Resultado: sucesso.

```text
ninja: no work to do.
```

## 14. Resultado do ctest

Comando:

```bash
ctest --test-dir out/build/linux-debug --output-on-failure
```

Resultado: sucesso.

```text
100% tests passed, 0 tests failed out of 43
Total Test time (real) = 29.70 sec
```

## 15. Resultado dos comandos manuais

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
- `APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 ./out/build/linux-debug/perceptrum-agent provision --base-url http://localhost:4000 --exe-token TEST_TOKEN --client-id test-client --timezone America/Manaus || true`: sucesso de teste com fallback explicito.
- `timeout 10s ./out/build/linux-debug/perceptrum-agent run || true`: criou log e snapshot; encerrou com `status=stopped`.
- `./out/build/linux-debug/perceptrum-agent status || true`: JSON com `agent_runtime=linux_minimal_agent_runtime`, `runtime_mode=linux_minimal`, gates pesados `false`, `agent_core_enabled=false`, `camera_capture_enabled=false`, `rtsp_capture_enabled=false`, `job_runtime_enabled=false` e `frame_writer_enabled=false`.
- `./out/build/linux-debug/perceptrum-agent healthcheck || true`: erro funcional esperado apos parada, `stopped`.
- `find /tmp/perceptrum-runtime-test -maxdepth 5 -type f -print`: encontrou log, config nao sensivel, fallback secret e `agent_health.json`.
- `grep -R "TEST_TOKEN" /tmp/perceptrum-runtime-test/data /tmp/perceptrum-runtime-test/state 2>/dev/null || true`: sem resultado.
- `stat -c '%a %n' /tmp/perceptrum-runtime-test/config/secrets/exe_token.txt`: confirmou `600`.

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

Checagem extra de gate pesado:

```bash
PERCEPTRUM_ENABLE_CAMERA_CAPTURE=1 ./out/build/linux-debug/perceptrum-agent run
```

Resultado:

```text
gate_exit_code=78
unsupported_feature_gate: PERCEPTRUM_ENABLE_CAMERA_CAPTURE is not supported by linux_minimal_agent_runtime
```

## 16. Confirmacao de AppHost

`AppHost/` nao foi alterado nesta execucao.

## 17. Confirmacao de .vcxproj e .sln

Nenhum `.vcxproj` foi alterado nesta execucao.

Nenhum `.sln` foi alterado nesta execucao.

## 18. Confirmacao de commit/push

Nenhum commit foi feito. Nenhum push foi feito.

Ultimo commit observado antes desta execucao:

```text
1d8fa61 Improve chat identity evidence and text entry handling
```

## 19. Riscos pendentes

- `AgentCore` completo ainda precisa ser fatiado antes de entrar no Linux.
- `PairingClient` legado ainda usa arquivos relativos e `Logger` legado; o agente Linux minimo segue usando `RuntimePaths`/`LinuxTokenStore`.
- `secure_store_available` depende de Secret Service/libsecret; sem keyring, apenas fallback plaintext explicito permite recuperar token local.
- O caminho injetavel do `HeadlessService` existe, mas o loop Linux ainda usa runtime minimo sem camera/jobs.
- Ainda nao existem implementacoes Linux para camera, RTSP, frame writer ou jobs.

## 20. Proxima fase recomendada

Prosseguir com o contrato leve de status/config de `AgentCore` e preparar a aproximacao de `PairingClient`/runtime legado a `RuntimePaths`/`ITokenStore`, mantendo cameras, RTSP, frame writer e jobs atras dos feature gates.

## 21. Criterio de sucesso

Concluido para esta execucao:

- build Linux reprodutivel passou;
- CTest passou;
- existe `LinuxMinimalAgentRuntime` concreto;
- feature gates pesados ficam OFF por padrao;
- gate pesado ativado retorna erro funcional claro;
- status/health refletem o runtime minimo;
- `AgentCore`, camera, RTSP, frame writer e jobs pesados nao foram ativados;
- `AppHost`, `.vcxproj` e `.sln` nao foram alterados;
- nenhum commit foi feito.
