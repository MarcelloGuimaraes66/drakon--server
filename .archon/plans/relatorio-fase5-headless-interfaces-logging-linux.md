# Relatorio fase 5 - Headless interfaces portaveis e logging Linux

Data de execucao local: 2026-05-22 America/Manaus  
UTC observado na validacao: 2026-05-23
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`

## 1. Arquivos lidos

- `.archon/prompts/prompt-5-headless-interfaces-logging-linux.txt`
- `.archon/plans/relatorio-fase4-headlessservice-linux-safe.md`
- `.archon/plans/relatorio-fase3-pairing-headless-linux.md`
- `.archon/plans/relatorio-fase2-runtime-xdg-secrets-linux.md`
- `.archon/plans/anchor-riscos-multiplataforma.md`
- `Perceptrum/CMakeLists.txt`
- `Perceptrum/linux/main.cpp`
- `Perceptrum/linux/RuntimePaths.h`
- `Perceptrum/linux/RuntimePaths.cpp`
- `Perceptrum/linux/LinuxHeadlessRuntime.h`
- `Perceptrum/linux/LinuxHeadlessRuntime.cpp`
- `Perceptrum/linux/LinuxRuntimeAdapters.h`
- `Perceptrum/linux/LinuxRuntimeAdapters.cpp`
- `Perceptrum/Perceptrum/runtime/HeadlessService.h`
- `Perceptrum/Perceptrum/runtime/HeadlessService.cpp`
- `Perceptrum/Perceptrum/runtime/BrandingRuntime.h`
- `Perceptrum/Perceptrum/runtime/BrandingRuntime.cpp`
- `Perceptrum/Perceptrum/runtime/interfaces/IRuntimeLogger.h`
- `Perceptrum/Perceptrum/runtime/interfaces/ITokenStore.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IAgentRuntime.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IHeadlessRuntime.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IAgentCoreStatusProvider.h`
- `Perceptrum/Perceptrum/runtime/interfaces/AgentCoreStatusContract.h`
- `Perceptrum/Perceptrum/core/AgentCoreStatus.h`
- `Perceptrum/Perceptrum/core/AgentCoreStatus.cpp`
- `Perceptrum/Perceptrum/logging/Logging.h`
- `Perceptrum/Perceptrum/logging/Logging.cpp`
- `Perceptrum/Perceptrum/core/AgentCore.h`
- `Perceptrum/Perceptrum/core/AgentCore.cpp`
- `Perceptrum/Perceptrum/platform/platform_common.h`
- `Perceptrum/Perceptrum/platform/platform_common.cpp`
- `Perceptrum/Perceptrum/platform/platform_secure_store.h`
- `Perceptrum/Perceptrum/platform/platform_secure_store.cpp`
- `Perceptrum/Perceptrum/platform/platform_shutdown.h`
- `Perceptrum/Perceptrum/platform/platform_shutdown.cpp`

## 2. Arquivos criados

Os arquivos de contrato/adaptador da fase 5 ja existiam no inicio desta reexecucao:

- `Perceptrum/Perceptrum/runtime/interfaces/IRuntimeLogger.h`
- `Perceptrum/Perceptrum/runtime/interfaces/ITokenStore.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IAgentRuntime.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IHeadlessRuntime.h`
- `Perceptrum/Perceptrum/runtime/interfaces/IAgentCoreStatusProvider.h`
- `Perceptrum/Perceptrum/runtime/interfaces/AgentCoreStatusContract.h`
- `Perceptrum/linux/LinuxRuntimeAdapters.h`
- `Perceptrum/linux/LinuxRuntimeAdapters.cpp`

Nesta execucao, o relatorio da fase 5 foi atualizado para o estado real atual.

## 3. Arquivos alterados

- `.archon/plans/relatorio-fase5-headless-interfaces-logging-linux.md`

Nao foi necessaria alteracao de codigo nesta reexecucao: as interfaces, adaptadores, CMake e testes ja estavam presentes e passaram na validacao.

## 4. Interfaces criadas

Pasta canonica: `Perceptrum/Perceptrum/runtime/interfaces/`.

- `IRuntimeLogger`: `debug`, `info`, `warn`, `error`, sem depender de `Logger::instance()`.
- `ITokenStore`: `readToken`, `writeToken`, `hasToken`, `clearToken`.
- `IAgentRuntime`: `start`, `stop`, `status`, com `AgentRuntimeStatus`.
- `IAgentCoreFactory`: `create(baseUrl, exeToken, clientId)` retornando `IAgentRuntime`.
- `IHeadlessRuntime`: `RuntimeRoots` e `HeadlessRuntimeContext` para roots, logger, token store, factory, shutdown e callback de status.
- `IAgentCoreStatusProvider` e `AgentCoreStatusContract`: contrato leve para expor estado/capacidades sem puxar `AgentCore.cpp`.

## 5. O que mudou em Logging

- `Logger::instance()` e o fluxo legado foram preservados para Windows/uso existente.
- Em Linux, o bootstrap de logging respeita `APP_RUNTIME_LOG_ROOT` quando definido.
- O caminho Linux novo nao cria `logs/agent.log` relativo ao CWD quando o runtime root explicito existe.
- A exportacao Linux de error logs via bearer token permanece desativada no caminho stub/teste ate existir token store explicito injetado no fluxo real.
- Mensagens passam por redacao de campos sensiveis antes de escrita.

## 6. HeadlessService.cpp no build Linux

`HeadlessService.cpp` entra no `perceptrum_core` Linux e compila com `PERCEPTRUM_LINUX_BUILD`.

No Linux, ele nao inclui `AgentCore.h`, `PairingClient.h` ou `Logging.h` no caminho de build. A sobrecarga sem dependencias retorna erro funcional `78`, e a sobrecarga com `HeadlessServiceDependencies` usa `HeadlessRuntimeContext` injetado.

## 7. Se nao entrou, por que

Nao se aplica: `HeadlessService.cpp` entrou no build Linux.

O que continua fora do alvo Linux e o runtime pesado:

- `AgentCore.cpp`;
- `CameraSession.cpp`;
- `FrameDiskWriter.cpp`;
- `JobRuntime.cpp`.

Esses arquivos continuam fora porque ainda arrastam Win32/OpenCV/camera/RTSP/jobs pesados, fora do escopo desta fase.

## 8. LinuxHeadlessRuntime usando interfaces/adaptadores

`LinuxHeadlessRuntime` usa:

- `LinuxRuntimeLogger` via `IRuntimeLogger`;
- `LinuxTokenStore` via `ITokenStore`;
- `LinuxMinimalAgentRuntime` via `IAgentRuntime`;
- `LinuxMinimalAgentCoreFactory` via `IAgentCoreFactory`;
- `AgentCoreStatusContract` para reportar capacidades leves.

O health JSON reporta:

- `runtime_logger=linux_runtime_logger_adapter`;
- `token_store=linux_token_store_adapter`;
- `agent_runtime=linux_minimal_agent_runtime`;
- `agent_core_status_provider=linux_minimal_agentcore_status_provider`.

## 9. Protecao de tokens

- Escrita/leitura de token no agente Linux passa por `LinuxTokenStore`, que delega para `platform_secure_store`.
- Sem Secret Service ou fallback explicito, o comportamento continua fail-closed.
- Com `APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1`, o fallback explicito grava `config/secrets/exe_token.txt` com permissao `0600`.
- Status, health JSON e logs nao incluem o token.
- A validacao manual encontrou o token de teste somente no arquivo de fallback plaintext explicitamente autorizado.

## 10. Roteamento de logs

- Runtime Linux grava em `${APP_RUNTIME_LOG_ROOT}/perceptrum-agent.log`.
- `Logging.cpp`, quando usado no Linux com `APP_RUNTIME_LOG_ROOT`, tambem roteia bootstrap/agent log para esse root.
- O teste `agent_logger_does_not_write_cwd_logs` valida que o logger nao cria `logs/agent.log` nem `logs/perceptrum-agent.log` relativos ao CWD no caminho Linux com roots explicitos.

## 11. Testes adicionados/validados

CTest atual tem 43 testes. Os testes mais diretamente ligados a fase 5 incluem:

- `agent_provision_fails_closed_without_secret_store_when_token_needed`
- `agent_provision_with_plaintext_recovery_flag_uses_0600_file`
- `agent_status_does_not_expose_secrets`
- `agent_logger_does_not_write_cwd_logs`
- `agent_health_does_not_expose_secrets`
- `linux_runtime_reports_interface_adapters`
- `headless_service_cpp_compiles_in_linux_core`
- `apphost_project_files_not_touched_by_linux_ctest`
- `agentcore_complete_not_in_linux_target`

Os testes anteriores e os testes de desktop Linux/WebKitGTK/fronteira React tambem passaram.

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
Total Test time (real) = 29.74 sec
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
- `./out/build/linux-debug/perceptrum-agent status || true` antes do snapshot: erro funcional `missing_snapshot`, com JSON de status e roots.
- `./out/build/linux-debug/perceptrum-agent healthcheck || true` antes do snapshot: erro funcional `missing_snapshot`.
- `APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 ./out/build/linux-debug/perceptrum-agent provision --base-url http://localhost:4000 --exe-token TEST_TOKEN --client-id test-client --timezone America/Manaus || true`: sucesso de teste com fallback explicito, sem imprimir o token no output do comando.
- `timeout 10s ./out/build/linux-debug/perceptrum-agent run || true`: criou log e snapshot; encerrou com `status=stopped`.
- `./out/build/linux-debug/perceptrum-agent status || true` depois do run: JSON com `paired=true`, `provisioned=true`, `runtime_logger=linux_runtime_logger_adapter`, `token_store=linux_token_store_adapter`, `agent_runtime=linux_minimal_agent_runtime`, `agent_core_enabled=false`, `camera_capture_enabled=false`, `rtsp_capture_enabled=false` e `job_runtime_enabled=false`.
- `./out/build/linux-debug/perceptrum-agent healthcheck || true` depois do run: erro funcional esperado `stopped`.
- `find /tmp/perceptrum-runtime-test -maxdepth 5 -type f -print`: encontrou config nao sensivel, health snapshot, log e o arquivo de token apenas por causa do fallback plaintext explicito.
- `grep -R "TEST_TOKEN" /tmp/perceptrum-runtime-test/data /tmp/perceptrum-runtime-test/state /tmp/perceptrum-runtime-test/config 2>/dev/null || true`: encontrou o token somente em `/tmp/perceptrum-runtime-test/config/secrets/exe_token.txt`.
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

- O caminho injetavel de `HeadlessService` ja compila no Linux, mas ainda executa runtime minimo; `AgentCore` real segue desativado.
- `AgentCore.cpp` ainda precisa ser separado de Win32/OpenCV/camera/jobs antes de entrar no alvo Linux.
- `Logging.cpp` preserva comportamento legado; o proximo passo e aproximar o fluxo real de `IRuntimeLogger`/`ITokenStore` sem quebrar Windows.
- O fallback plaintext explicito e apenas recuperacao operacional de teste; producao deve usar Secret Service/libsecret.
- `PairingClient` e runtime real ainda precisam convergir totalmente para roots e token store injetados.

## 20. Proxima fase recomendada

Prosseguir para a implementacao Linux real minima de `IAgentRuntime` sem camera/RTSP/jobs, conectando `HeadlessService` por dependencias injetadas e mantendo `AgentCore`, cameras e jobs pesados atras de feature gates ate cada acoplamento Win32 ser removido.

## 21. Criterio de sucesso

Concluido para esta execucao:

- build Linux reprodutivel passou;
- CTest passou;
- interfaces portaveis existem;
- `LinuxHeadlessRuntime` usa logger, token store, factory e runtime por interfaces/adaptadores;
- logs respeitam `APP_RUNTIME_LOG_ROOT`;
- tokens nao aparecem em status, health ou logs;
- `HeadlessService.cpp` compila no Linux sem ativar `AgentCore` real;
- `AgentCore`, camera, RTSP e jobs pesados nao foram ativados;
- `AppHost`, `.vcxproj` e `.sln` nao foram alterados;
- nenhum commit foi feito.
