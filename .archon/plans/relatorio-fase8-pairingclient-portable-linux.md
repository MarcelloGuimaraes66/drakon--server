# Relatorio fase 8 - PairingClient portatil Linux

Data: 2026-05-24 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`

## 1. Objetivo

Executar o prompt 8: mover o pareamento Linux para o mesmo `PairingClient` usado pelo runtime comum, mas atras de interfaces multiplataforma e `RuntimePaths`, sem gravar estado de sessao em arquivos relativos ao CWD.

## 2. Arquivos criados

- `.archon/prompts/prompt-8-pairingclient-portable-linux.txt`
- `.archon/plans/relatorio-fase8-pairingclient-portable-linux.md`
- `Perceptrum/Perceptrum/runtime/interfaces/IPairingConfigStore.h`
- `Perceptrum/linux/tests/mock_pairing_server.js`

## 3. Arquivos alterados

- `Perceptrum/Perceptrum/comm/PairingClient.h`
- `Perceptrum/Perceptrum/comm/PairingClient.cpp`
- `Perceptrum/linux/LinuxRuntimeAdapters.h`
- `Perceptrum/linux/LinuxRuntimeAdapters.cpp`
- `Perceptrum/linux/main.cpp`
- `Perceptrum/CMakeLists.txt`

## 4. Contrato portatil adicionado

Foi criado `IPairingConfigStore` em `Perceptrum/Perceptrum/runtime/interfaces/IPairingConfigStore.h`.

O contrato guarda somente config nao sensivel:

- `baseUrl`
- `clientId`
- `exeId`
- `timezone`
- `state`
- `createdUtc`
- `updatedUtc`
- `lastBackendStatus`
- `paired`
- `provisioned`

O token continua fora desse contrato e segue por `ITokenStore`.

## 5. PairingClient refatorado

`PairingClient` agora aceita `PairingClientOptions` opcionais:

- `ITokenStore* tokenStore`
- `IPairingConfigStore* configStore`
- `IRuntimeLogger* logger`
- providers opcionais para timezone, timestamp UTC e exe id

O construtor legado foi preservado:

```cpp
explicit PairingClient(const std::string& baseUrl);
```

O novo construtor e usado pelo Linux:

```cpp
PairingClient(const std::string& baseUrl, PairingClientOptions options);
```

Quando as stores portateis existem, `loadSavedToken()` e `pairWithCode()` usam `ITokenStore` + `IPairingConfigStore`. Quando nao existem e o build nao e Linux, o caminho legado Windows continua usando `SecureLocalStore`, `Logger::instance()` e os arquivos historicos.

No build Linux, o caminho legado direto fica fora por `PERCEPTRUM_LINUX_BUILD`; Linux exige stores portateis.

## 6. Adaptador Linux adicionado

Foi adicionado `LinuxPairingConfigStore` em `Perceptrum/linux/LinuxRuntimeAdapters.*`.

Ele converte entre:

- `perceptrum::runtime::PairingConfig`
- `perceptrum::linux_runtime::AgentConfig`

Persistencia Linux:

- config canonica em `APP_RUNTIME_CONFIG_ROOT/agent_config.json`
- compatibilidade nao sensivel em `client_id.txt`, `exe_id.txt`, `paired_timezone.txt` e `perceptrum_base_url.txt`
- token sensivel em `LinuxTokenStore`, ou seja, `APP_RUNTIME_CONFIG_ROOT/secrets/exe_token.txt` somente quando Secret Service ou fallback explicito estiverem disponiveis

## 7. Comando Linux pair

`perceptrum-agent pair` agora usa `PairingClient` com:

- `LinuxTokenStore`
- `LinuxPairingConfigStore`
- `LinuxRuntimeLogger`
- `RuntimeTimezone()`
- `UtcTimestampNow()`

Foi removida do comando Linux a persistencia manual duplicada de token/config para o fluxo de pair.

Tambem foi corrigido o mapeamento de erro `backend_unreachable`: a mensagem agora e preservada depois de gravar o health snapshot.

## 8. Testes adicionados

CTest subiu de 43 para 46 testes.

Novos testes:

- `pairingclient_portable_backend_unreachable_uses_runtime_paths`
- `pairingclient_portable_pair_writes_runtime_paths`
- `pairingclient_portable_compiles_in_linux_core`

O teste de sucesso usa `Perceptrum/linux/tests/mock_pairing_server.js` para responder `/api/pairing/pair` com `exe_token` e `client_id`, validando que:

- `PairingClient.cpp` compila no `perceptrum_core`;
- `perceptrum-agent pair` grava `agent_config.json`;
- `LinuxTokenStore` grava o token em `config/secrets/exe_token.txt`;
- o fallback de segredo fica com permissao `600`;
- nenhum `exe_token.txt`, `client_id.txt`, `exe_id.txt` ou `paired_timezone.txt` e criado no CWD;
- `TEST_TOKEN` nao aparece em `data` ou `state`.

## 9. Resultado do CMake

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

## 10. Resultado do build

Comando:

```bash
cmake --build out/build/linux-debug -j$(nproc)
```

Resultado: sucesso.

Evidencia:

```text
[3/7] Building CXX object CMakeFiles/perceptrum_core.dir/Perceptrum/comm/PairingClient.cpp.o
[4/7] Linking CXX static library libperceptrum_core.a
[7/7] Linking CXX executable perceptrum-agent
```

Apos o ajuste de mensagem, o rebuild incremental tambem passou:

```text
[1/2] Building CXX object CMakeFiles/perceptrum-agent.dir/linux/main.cpp.o
[2/2] Linking CXX executable perceptrum-agent
```

## 11. Resultado do CTest

Comando:

```bash
ctest --test-dir out/build/linux-debug --output-on-failure
```

Resultado final: sucesso.

```text
100% tests passed, 0 tests failed out of 46
Total Test time (real) = 29.81 sec
```

Observacao: a primeira execucao apontou falha nos dois testes de `backend_unreachable` porque a string de erro era limpa ao gravar o health snapshot. O codigo foi corrigido e os testes especificos passaram antes do CTest completo final.

## 12. Validacao manual

Runtime isolado:

```bash
export APP_RUNTIME_DATA_ROOT=/tmp/perceptrum-runtime-test/data
export APP_RUNTIME_CONFIG_ROOT=/tmp/perceptrum-runtime-test/config
export APP_RUNTIME_CACHE_ROOT=/tmp/perceptrum-runtime-test/cache
export APP_RUNTIME_STATE_ROOT=/tmp/perceptrum-runtime-test/state
export APP_RUNTIME_LOG_ROOT=/tmp/perceptrum-runtime-test/state/logs
```

Comandos:

```bash
./out/build/linux-debug/perceptrum-agent pair --base-url http://127.0.0.1:9 --pair-code TEST-CODE || true
APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 ./out/build/linux-debug/perceptrum-agent provision --base-url http://localhost:4000 --exe-token TEST_TOKEN --client-id test-client --timezone America/Manaus
./out/build/linux-debug/perceptrum-agent status || true
find /tmp/perceptrum-runtime-test -maxdepth 5 -type f -print
grep -R "TEST_TOKEN" /tmp/perceptrum-runtime-test/data /tmp/perceptrum-runtime-test/state 2>/dev/null || true
```

Resultados:

- `pair` offline retornou `backend_unreachable: Could not connect to server`.
- `provision` gravou `client_id=test-client`, `base_url=http://localhost:4000`, `timezone=America/Manaus`.
- `status` reportou `paired=true`, `provisioned=true`, `token_store=linux_token_store_adapter` e `runtime_mode=linux_minimal`.
- `agent_config.json` foi criado em `/tmp/perceptrum-runtime-test/config/agent_config.json`.
- o secret foi criado em `/tmp/perceptrum-runtime-test/config/secrets/exe_token.txt`.
- permissao confirmada: `600 /tmp/perceptrum-runtime-test/config/secrets/exe_token.txt`.
- `TEST_TOKEN` apareceu somente no fallback secret.
- `TEST_TOKEN` nao apareceu em `/tmp/perceptrum-runtime-test/data` nem em `/tmp/perceptrum-runtime-test/state`.

## 13. Build Linux e AgentCore completo

`build.ninja` contem:

- `Perceptrum/comm/PairingClient.cpp`

`build.ninja` continua sem os fontes pesados no target Linux minimo:

- `Perceptrum/core/AgentCore.cpp`
- `Perceptrum/camera/CameraSession.cpp`
- `Perceptrum/camera/FrameDiskWriter.cpp`
- `Perceptrum/jobs/JobRuntime.cpp`

## 14. AppHost, vcxproj e sln

`git diff --name-only -- AppHost '*.vcxproj' '*.sln'` nao retornou arquivos.

Nao houve alteracao em:

- `AppHost/`
- `.vcxproj`
- `.sln`

## 15. Commit e push

Nenhum commit foi feito.

Nenhum push foi feito.

## 16. Riscos pendentes

- O Windows nao foi buildado neste Ubuntu; a compatibilidade foi preservada por API/construtor legado e guards de compilacao.
- `secure_store_available` no Linux ainda depende de Secret Service/libsecret ou fallback plaintext explicitamente habilitado.
- O `PairingClient` agora esta portatil, mas o AgentCore completo ainda nao esta desacoplado para Linux.

## 17. Proxima fase recomendada

Implementar a primeira versao real do LinuxHost desktop WebKitGTK com bridge/local session usando o mesmo backend web local, agora que o pareamento e o storage de sessao estao atras de interfaces portateis.
