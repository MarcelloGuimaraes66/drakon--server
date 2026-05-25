# Relatorio fase 2 - runtime XDG, secrets e testes Linux

Data: 2026-05-03
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`

## 1. Arquivos lidos

- `.archon/plans/plano-recalibrado-pos-reset-github.md`
- `.archon/plans/relatorio-fase1-base-linux-reprodutivel.md`
- `.archon/plans/anchor-riscos-multiplataforma.md`
- `.archon/plans/anchor-comandos-validacao.md`
- `Perceptrum/CMakeLists.txt`
- `Perceptrum/linux/main.cpp`
- `Perceptrum/linux-desktop/main.cpp`
- `Perceptrum/linux-desktop/XdgPaths.h`
- `Perceptrum/linux-desktop/XdgPaths.cpp`
- `Perceptrum/Perceptrum/platform/platform_common.cpp`
- `Perceptrum/Perceptrum/platform/platform_common.h`
- `Perceptrum/Perceptrum/platform/platform_process.cpp`
- `Perceptrum/Perceptrum/platform/platform_process.h`
- `Perceptrum/Perceptrum/platform/platform_secure_store.cpp`
- `Perceptrum/Perceptrum/platform/platform_secure_store.h`
- `Perceptrum/Perceptrum/runtime/BrandingRuntime.cpp`
- `Perceptrum/Perceptrum/runtime/BrandingRuntime.h`
- `Perceptrum/Perceptrum/runtime/HeadlessService.cpp`
- `Perceptrum/Perceptrum/runtime/HeadlessService.h`
- `brand.config.json`

## 2. Arquivos criados

- `Perceptrum/linux/RuntimePaths.h`
- `Perceptrum/linux/RuntimePaths.cpp`
- `.archon/plans/relatorio-fase2-runtime-xdg-secrets-linux.md`

## 3. Arquivos alterados

- `Perceptrum/CMakeLists.txt`
- `Perceptrum/linux/main.cpp`
- `Perceptrum/linux-desktop/main.cpp`
- `Perceptrum/Perceptrum/platform/platform_secure_store.cpp`
- `Perceptrum/Perceptrum/runtime/BrandingRuntime.h`

## 4. APP_RUNTIME_* implementado

Foi adicionada a camada `perceptrum::linux_runtime::ResolveRuntimePaths()`.

Ordem de resolucao:

- `APP_RUNTIME_DATA_ROOT`
- `APP_RUNTIME_CONFIG_ROOT`
- `APP_RUNTIME_CACHE_ROOT`
- `APP_RUNTIME_STATE_ROOT`
- `APP_RUNTIME_LOG_ROOT`

Quando definidos, esses paths sao usados diretamente, com expansao de `~` se existir. `validate-config`, `status`, `healthcheck`, `run` e o stub `perceptrum-desktop` usam essa mesma camada. Os diretorios sao criados automaticamente por `EnsureRuntimeDirectories()`.

`AppBrand::dataRoot()` tambem passou a respeitar `APP_RUNTIME_DATA_ROOT` no Linux, preservando Windows e macOS.

## 5. XDG implementado

Fallbacks quando `APP_RUNTIME_*` nao esta definido:

- dados: `brand.config.json` via `dataRootLinux`, hoje `~/.local/share/PerceptrumData`;
- config: `${XDG_CONFIG_HOME:-~/.config}/Perceptrum`;
- cache: `${XDG_CACHE_HOME:-~/.cache}/Perceptrum`;
- state: `${XDG_STATE_HOME:-~/.local/state}/Perceptrum`;
- logs: `state/logs`, salvo quando `APP_RUNTIME_LOG_ROOT` define outro local.

Com todos os `APP_RUNTIME_*` apontando para `/tmp`, o agente nao precisa escrever em `HOME`.

## 6. agent_health.json

`agent_health.json` e gravado em:

- `${APP_RUNTIME_DATA_ROOT}/agent_health.json`, quando override existe;
- caso contrario, no data root Linux resolvido por branding/XDG.

Campos minimos implementados:

- `version`
- `status`
- `paired`
- `base_url`
- `client_id`
- `pid`
- `heartbeat_unix_ms`
- `heartbeat_utc`
- `runtime_timezone`
- `data_root`
- `config_root`
- `log_root`

`client_id` e gravado sem token/secret. O stub atual marca `status=not_paired` quando nao ha `client_id.txt` no config root.

## 7. Logs

O log minimo do agente e gravado em:

- `${APP_RUNTIME_LOG_ROOT}/perceptrum-agent.log`, quando override existe;
- caso contrario, `${stateRoot}/logs/perceptrum-agent.log`.

O log registra lifecycle minimo e nao imprime tokens ou secrets.

## 8. Secrets Linux protegidos

`platform_secure_store.cpp` foi alterado para manter DPAPI no Windows e fechar o caminho nao Windows que antes aceitava plaintext por padrao.

No Linux, a ordem agora e:

1. tentar Secret Service via `secret-tool`;
2. se `secret-tool` nao existir ou falhar, negar leitura/escrita plaintext por padrao;
3. permitir arquivo local plaintext somente com fallback explicito.

No ambiente validado, `command -v secret-tool` nao retornou caminho, entao o comportamento efetivo e fail-closed sem fallback explicito.

## 9. Fallbacks e flags explicitas

Fallback plaintext local exige uma das flags:

- `APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1`
- `PERCEPTRUM_ALLOW_PLAINTEXT_SECRET_RECOVERY=1`

Quando esse fallback e usado:

- diretorio pai: `0700`;
- arquivo: `0600`.

No macOS, como ainda nao ha Keychain implementado nesta fase, o caminho nao Windows tambem fica isolado por fail-closed e so aceita fallback plaintext com a mesma flag explicita.

## 10. Testes CTest adicionados

Foram cadastrados 7 testes reais:

- `agent_help`
- `agent_validate_config_tmp_runtime`
- `agent_check_deps_tmp_runtime`
- `agent_version`
- `agent_status_missing_snapshot`
- `agent_run_writes_health_snapshot`
- `agent_healthcheck_not_paired`

Os testes usam runtime isolado em `/tmp/perceptrum-ctest-runtime`.

## 11. Resultado do CMake

Comando executado:

```bash
cd Perceptrum
cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
```

Resultado: sucesso.

Mensagem final:

```text
-- Configuring done (0.1s)
-- Generating done (0.0s)
-- Build files have been written to: /home/marcello-guimaraes/dev/perceptrum_desktop_aspp/Perceptrum/out/build/linux-debug
```

## 12. Resultado do build

Comando executado:

```bash
cmake --build out/build/linux-debug -j$(nproc)
```

Resultado: sucesso.

Mensagem final da execucao final:

```text
ninja: no work to do.
```

A compilacao anterior recompilou e linkou `perceptrum_core`, `perceptrum-agent` e `perceptrum-desktop` com sucesso apos o ajuste de escopo em `platform_secure_store.cpp`.

## 13. Resultado do ctest

Comando executado:

```bash
ctest --test-dir out/build/linux-debug --output-on-failure
```

Resultado: sucesso.

Resumo:

```text
100% tests passed, 0 tests failed out of 7
Total Test time (real) = 7.14 sec
```

## 14. Resultado dos comandos manuais

Runtime isolado usado:

```bash
APP_RUNTIME_DATA_ROOT=/tmp/perceptrum-runtime-test/data
APP_RUNTIME_CONFIG_ROOT=/tmp/perceptrum-runtime-test/config
APP_RUNTIME_CACHE_ROOT=/tmp/perceptrum-runtime-test/cache
APP_RUNTIME_STATE_ROOT=/tmp/perceptrum-runtime-test/state
APP_RUNTIME_LOG_ROOT=/tmp/perceptrum-runtime-test/state/logs
```

Resultados:

- `perceptrum-agent --help`: sucesso, listando `version`, `validate-config`, `check-deps`, `status`, `healthcheck` e `run`.
- `perceptrum-agent validate-config`: sucesso, todos os roots apontaram para `/tmp/perceptrum-runtime-test`.
- `perceptrum-agent check-deps`: sucesso; encontrou `/usr/bin/ffmpeg`, `/usr/bin/ffprobe` e `/usr/bin/node`.
- `perceptrum-agent version`: sucesso, `1.0.0`.
- `perceptrum-agent status` antes do `run`: erro funcional controlado, sem crash: `No health snapshot found at /tmp/perceptrum-runtime-test/data/agent_health.json`.
- `timeout 10s perceptrum-agent run || true`: criou health snapshot e log.
- `perceptrum-agent status` depois do `run`: sucesso, JSON com `status=not_paired`, `paired=false`, roots em `/tmp` e timezone `America/Manaus`.
- `perceptrum-agent healthcheck || true`: erro funcional esperado: `healthcheck not_paired: local runtime is alive but no client pairing is configured`.
- `find /tmp/perceptrum-runtime-test -maxdepth 5 -type f -print`: encontrou:
  - `/tmp/perceptrum-runtime-test/state/logs/perceptrum-agent.log`
  - `/tmp/perceptrum-runtime-test/data/agent_health.json`

Tambem foi executado `perceptrum-desktop` com os mesmos overrides. Resultado: sucesso como stub, imprimindo `dataRoot`, `configRoot`, `cacheRoot`, `stateRoot` e `logRoot` em `/tmp/perceptrum-runtime-test`.

## 15. AppHost

Confirmado: `AppHost/` nao foi alterado.

## 16. .vcxproj e .sln

Confirmado: nenhum arquivo `.vcxproj` ou `.sln` foi alterado.

## 17. Commit

Confirmado: nenhum commit foi feito.

Tambem nenhum push foi feito.

## 18. Riscos pendentes

- O agente Linux ainda e stub de runtime/health; ainda nao executa `AgentCore`.
- `HeadlessService.cpp`, `AgentCore.cpp`, `CameraSession.cpp`, `FrameDiskWriter.cpp` e `JobRuntime.cpp` continuam fora do build Linux canonico por acoplamentos Windows ja mapeados na Fase 1.
- Secret Service foi integrado via `secret-tool`, mas este ambiente nao tem `secret-tool` instalado. A validacao de escrita real no keyring deve acontecer em uma sessao Ubuntu com Secret Service disponivel.
- O healthcheck saudavel real ainda depende de fluxo de pairing e runtime completo. Nesta fase, `not_paired` e tratado como estado funcional esperado.
- `perceptrum-desktop` segue como stub e nao implementa GTK/WebKitGTK nem paridade visual com Windows.

## 19. Proxima fase recomendada

Fase 3 recomendada: integrar pairing/config real ao runtime Linux minimo e preparar a entrada segura do `HeadlessService`, mantendo `AgentCore` e captura de camera ainda fora ate os acoplamentos Win32 serem isolados.
