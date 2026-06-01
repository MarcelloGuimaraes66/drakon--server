# Relatorio fase 3 - pairing, provisioning e headless Linux minimo

Data: 2026-05-03
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`

## 1. Arquivos lidos

- `.archon/plans/plano-recalibrado-pos-reset-github.md`
- `.archon/plans/relatorio-fase1-base-linux-reprodutivel.md`
- `.archon/plans/relatorio-fase2-runtime-xdg-secrets-linux.md`
- `.archon/plans/anchor-riscos-multiplataforma.md`
- `.archon/plans/anchor-comandos-validacao.md`
- `Perceptrum/CMakeLists.txt`
- `Perceptrum/linux/main.cpp`
- `Perceptrum/linux/RuntimePaths.h`
- `Perceptrum/linux/RuntimePaths.cpp`
- `Perceptrum/linux-desktop/main.cpp`
- `Perceptrum/linux-desktop/XdgPaths.h`
- `Perceptrum/linux-desktop/XdgPaths.cpp`
- `Perceptrum/Perceptrum/runtime/HeadlessService.cpp`
- `Perceptrum/Perceptrum/runtime/HeadlessService.h`
- `Perceptrum/Perceptrum/runtime/BrandingRuntime.cpp`
- `Perceptrum/Perceptrum/runtime/BrandingRuntime.h`
- `Perceptrum/Perceptrum/comm/PairingClient.cpp`
- `Perceptrum/Perceptrum/comm/PairingClient.h`
- `Perceptrum/Perceptrum/comm/BackendConfig.h`
- `Perceptrum/Perceptrum/comm/SecureLocalStore.cpp`
- `Perceptrum/Perceptrum/comm/SecureLocalStore.h`
- `Perceptrum/Perceptrum/platform/platform_secure_store.cpp`
- `Perceptrum/Perceptrum/platform/platform_secure_store.h`
- `brand.config.json`

## 2. Arquivos criados

- `.archon/plans/relatorio-fase3-pairing-headless-linux.md`

Observacao: os arquivos Linux e `.archon` de fases anteriores ja estavam nao rastreados no inicio desta fase.

## 3. Arquivos alterados nesta fase

- `Perceptrum/CMakeLists.txt`
- `Perceptrum/linux/main.cpp`
- `Perceptrum/linux/RuntimePaths.h`
- `Perceptrum/linux/RuntimePaths.cpp`
- `Perceptrum/linux-desktop/main.cpp`

Arquivos ja modificados antes desta fase e preservados:

- `Perceptrum/Perceptrum/platform/platform_secure_store.cpp`
- `Perceptrum/Perceptrum/runtime/BrandingRuntime.h`

## 4. Comandos implementados ou revisados

`perceptrum-agent` agora cobre:

- `--help`
- `version`
- `validate-config [--base-url <url>]`
- `check-deps`
- `status`
- `healthcheck [--max-heartbeat-age-seconds <seconds>]`
- `run`
- `pair --pair-code <code> [--base-url <url>]`
- `provision --base-url <url> --exe-token <token> --client-id <id> [--exe-id <id>] [--timezone <iana>]`

## 5. Pair

`pair` valida `--pair-code`, resolve/valida `base_url`, gera/reusa `exe_id`, detecta timezone IANA e chama:

`POST <base_url>/api/pairing/pair`

Payload enviado:

- `pair_code`
- `exe_id`
- `timezone_iana`

O comando usa timeout de conexao de 2s e timeout total de 5s. Se o backend estiver ausente, retorna erro funcional `backend_unreachable` sem crash. Se a resposta nao tiver contrato claro com `exe_token` e `client_id`, retorna `pairing backend contract not available yet`.

Pair-code nao e persistido, nao e logado e nao aparece em health JSON.

## 6. Provision

`provision` valida:

- `--base-url` obrigatorio;
- `--exe-token` obrigatorio;
- `--client-id` obrigatorio;
- `base_url` com esquema `http://` ou `https://`;
- timezone IANA simples quando fornecido.

Em sucesso, grava config nao sensivel, grava arquivos de compatibilidade nao sensiveis e atualiza `agent_health.json`.

## 7. Persistencia de config

Config principal:

- `${APP_RUNTIME_CONFIG_ROOT}/agent_config.json`

Campos persistidos:

- `base_url`
- `client_id`
- `exe_id`
- `timezone`
- `state`
- `paired`
- `provisioned`
- `created_utc`
- `updated_utc`
- `last_backend_status`

Arquivos de compatibilidade nao sensiveis:

- `${APP_RUNTIME_CONFIG_ROOT}/perceptrum_base_url.txt`
- `${APP_RUNTIME_CONFIG_ROOT}/client_id.txt`
- `${APP_RUNTIME_CONFIG_ROOT}/exe_id.txt`
- `${APP_RUNTIME_CONFIG_ROOT}/paired_timezone.txt`

## 8. Protecao do exe-token

`exe-token` e gravado somente via:

- `perceptrum::platform::WriteProtectedLocalText(${APP_RUNTIME_CONFIG_ROOT}/secrets/exe_token.txt, token)`

No Linux, essa camada tenta Secret Service via `secret-tool`. Se nao conseguir, falha fechado, exceto quando a flag explicita de fallback plaintext esta ativa. O token nao e impresso no terminal, nao e escrito no log e nao entra em `agent_health.json`.

## 9. Secure store neste Ubuntu

`command -v secret-tool` nao retornou caminho neste ambiente. Portanto o comportamento observado foi fail-closed:

- `provision --base-url ... --exe-token ... --client-id ...` retornou `secure_store_unavailable`;
- nenhum secret foi gravado em `/tmp/perceptrum-runtime-test`;
- busca por `TEST_TOKEN`, `TEST-CODE`, `exe-token` e `pair-code` em `/tmp/perceptrum-runtime-test` nao encontrou vazamentos.

## 10. Flags explicitas de fallback

Flags preservadas da Fase 2:

- `APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1`
- `PERCEPTRUM_ALLOW_PLAINTEXT_SECRET_RECOVERY=1`

Com fallback explicito e `PATH=/nonexistent`, o teste confirmou:

- `${APP_RUNTIME_CONFIG_ROOT}/secrets/exe_token.txt` e criado;
- permissao do arquivo: `0600`.

## 11. Run/status/healthcheck

`run` continua sendo ponte Linux minima e nao inicia `AgentCore`, cameras, jobs pesados ou captura RTSP. Ele:

- cria heartbeat a cada segundo;
- carrega `agent_config.json`;
- reflete `paired` e `provisioned`;
- usa `base_url`, `client_id`, `exe_id` e `timezone` persistidos;
- grava `headless_service=linux_minimal_stub`;
- grava `agent_core_enabled=false`.

Estados refletidos:

- `missing_snapshot`: `status` quando nao ha `agent_health.json`;
- `not_paired`: runtime vivo sem config pareada;
- `alive`: config pareada/provisionada e token legivel;
- `config_invalid`: config JSON invalida;
- `secure_store_unavailable`: config pareada/provisionada existe, mas token nao pode ser lido;
- `backend_unreachable`: tentativa de pair com backend indisponivel;
- `stale_heartbeat`: `healthcheck` quando heartbeat passa de `--max-heartbeat-age-seconds`.

## 12. Testes CTest adicionados/atualizados

CTest agora executa 15 testes:

- `agent_help`
- `agent_validate_config_tmp_runtime`
- `agent_check_deps_tmp_runtime`
- `agent_version`
- `agent_status_missing_snapshot`
- `agent_run_writes_health_snapshot`
- `agent_healthcheck_not_paired`
- `agent_provision_requires_base_url`
- `agent_provision_requires_token`
- `agent_provision_requires_client_id`
- `agent_provision_fails_closed_without_secret_store_when_token_needed`
- `agent_provision_with_plaintext_recovery_flag_uses_0600_file`
- `agent_status_after_provision_reads_config`
- `pair_requires_pair_code`
- `pair_backend_unreachable_is_functional_error`

Todos usam runtime isolado sob `/tmp/perceptrum-ctest-runtime`.

## 13. Resultado do CMake

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

## 14. Resultado do build

Comando:

```bash
cmake --build out/build/linux-debug -j$(nproc)
```

Resultado: sucesso.

```text
[1/4] Building CXX object CMakeFiles/perceptrum-agent.dir/linux/RuntimePaths.cpp.o
[2/4] Building CXX object CMakeFiles/perceptrum-desktop.dir/linux/RuntimePaths.cpp.o
[3/4] Linking CXX executable perceptrum-desktop
[4/4] Linking CXX executable perceptrum-agent
```

## 15. Resultado do ctest

Comando:

```bash
ctest --test-dir out/build/linux-debug --output-on-failure
```

Resultado: sucesso.

```text
100% tests passed, 0 tests failed out of 15
Total Test time (real) = 6.39 sec
```

## 16. Resultado dos comandos manuais

Runtime isolado:

```bash
APP_RUNTIME_DATA_ROOT=/tmp/perceptrum-runtime-test/data
APP_RUNTIME_CONFIG_ROOT=/tmp/perceptrum-runtime-test/config
APP_RUNTIME_CACHE_ROOT=/tmp/perceptrum-runtime-test/cache
APP_RUNTIME_STATE_ROOT=/tmp/perceptrum-runtime-test/state
APP_RUNTIME_LOG_ROOT=/tmp/perceptrum-runtime-test/state/logs
```

Resultados:

- `--help`: sucesso, listando todos os comandos da Fase 3.
- `version`: sucesso, `1.0.0`.
- `validate-config`: sucesso, roots em `/tmp/perceptrum-runtime-test` e `baseUrl=http://127.0.0.1:4000`.
- `check-deps`: sucesso, encontrou `/usr/bin/ffmpeg`, `/usr/bin/ffprobe` e `/usr/bin/node`.
- `status` antes de `run`: retornou JSON com `status=missing_snapshot`.
- `healthcheck` antes de `run`: erro funcional `missing_snapshot`.
- `provision`: erro funcional por falta de `--base-url`.
- `provision --base-url http://localhost:4000`: erro funcional por falta de `--exe-token`.
- `provision --base-url http://localhost:4000 --exe-token TEST_TOKEN`: erro funcional por falta de `--client-id`.
- `provision --base-url http://localhost:4000 --exe-token TEST_TOKEN --client-id test-client --timezone America/Manaus`: fail-closed com `secure_store_unavailable`, pois `secret-tool` nao esta instalado.
- `pair`: erro funcional por falta de `--pair-code`.
- `pair --pair-code TEST-CODE --base-url http://localhost:4000`: erro funcional `backend_unreachable`.
- `timeout 10s perceptrum-agent run || true`: criou heartbeat e `agent_health.json`.
- `status` apos `run`: JSON com `status=not_paired`, `paired=false`, `provisioned=false`, `headless_service=linux_minimal_stub`, `agent_core_enabled=false`.
- `healthcheck` apos `run`: erro funcional `not_paired`.
- `find /tmp/perceptrum-runtime-test -maxdepth 5 -type f -print` encontrou:
  - `/tmp/perceptrum-runtime-test/state/logs/perceptrum-agent.log`
  - `/tmp/perceptrum-runtime-test/data/agent_health.json`

## 17. AppHost

Confirmado: `AppHost/` nao foi alterado.

## 18. .vcxproj e .sln

Confirmado: nenhum arquivo `.vcxproj` ou `.sln` foi alterado.

## 19. Commit

Confirmado: nenhum commit foi feito.

Tambem nenhum push foi feito.

## 20. Riscos pendentes

- `HeadlessService.cpp` real ainda nao entra no build Linux porque ainda depende de `AgentCore`, `Logging` e caminhos Windows.
- `AgentCore`, `CameraSession`, `FrameDiskWriter` e `JobRuntime` continuam fora do build Linux por acoplamentos Win32.
- Pairing real depende de contrato backend confirmado para `/api/pairing/pair`.
- Secret Service precisa ser validado em Ubuntu com `secret-tool`/keyring disponivel.
- O fallback plaintext existe apenas como recuperacao explicita; nao deve ser modo padrao de producao.
- `perceptrum-desktop` segue stub e apenas mostra estado basico de pairing/provisioning.

## 21. Proxima fase recomendada

Isolar os acoplamentos Win32 de `HeadlessService`, `Logging` e da carga minima de `AgentCore`, criando uma interface Linux segura para iniciar o runtime real sem cameras/jobs pesados primeiro. Depois disso, validar contrato backend de pairing em ambiente local e substituir o stub `headless_service=linux_minimal_stub` por uma chamada controlada ao `HeadlessService` real.
