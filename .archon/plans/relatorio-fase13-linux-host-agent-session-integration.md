# Relatorio fase 13 - Integracao Host Linux, sessao local e agente minimo

## Objetivo

Integrar o host Linux com o agente minimo para que a sessao local do desktop consiga provisionar e observar `perceptrum-agent` por `RuntimePaths`, mantendo secure store, logging e runtime atras de interfaces.

## Escopo executado

- O host Linux continua preparando roots XDG por `RuntimePaths`.
- O host Linux agora consulta `perceptrum-agent status` durante o bootstrap do desktop e imprime `agentStatus`/`agentRuntime` no modo diagnostico.
- A ponte WebKit da sessao local continua chamando `/api/runtime/local-session`, mas a persistencia da sessao passou a delegar o provisionamento para o binario `perceptrum-agent provision`.
- O provisionamento recebe os mesmos roots `APP_RUNTIME_*` do host Linux, preservando data/config/cache/state/logs em um unico runtime local.
- O status do agente e consultado apos provisionamento da sessao local para registrar a observabilidade no log do host.
- O UI Linux segue usando WebKitGTK por padrao quando disponivel, com fallback explicito para browser apenas quando WebKitGTK nao estiver disponivel ou quando o modo browser for pedido.
- `AgentCore` completo permanece fora do target Linux; a integracao usa `linux_minimal_agent_runtime` e contrato leve de status.

## Arquivos alterados

- `Perceptrum/linux-desktop/main.cpp`
- `Perceptrum/CMakeLists.txt`
- `.archon/plans/relatorio-fase13-linux-host-agent-session-integration.md`

## Detalhes tecnicos

### Provisionamento por agente

O host Linux ganhou resolucao de `perceptrum-agent` via:

- `PERCEPTRUM_AGENT_PATH`;
- binario irmao de `perceptrum-desktop`;
- `PATH`.

Quando a WebKit bridge recebe `resident-runtime-session`, o host chama:

```bash
perceptrum-agent provision --base-url <local-backend> --exe-token <token> --client-id <id> --exe-id <id> --timezone <iana>
```

O processo e executado com os roots:

- `APP_RUNTIME_DATA_ROOT`
- `APP_RUNTIME_CONFIG_ROOT`
- `APP_RUNTIME_CACHE_ROOT`
- `APP_RUNTIME_STATE_ROOT`
- `APP_RUNTIME_LOG_ROOT`

O output de erro redige o token se algum subprocesso o ecoar acidentalmente.

### Observabilidade

O host Linux agora tenta consultar `perceptrum-agent status` e, se isso nao for possivel, le diretamente `agent_health.json`.

No bootstrap diagnostico do desktop, aparecem:

- `agentStatus=<status>`
- `agentRuntime=<runtime>`

### Secure store e logs

O token permanece responsabilidade de `perceptrum-agent provision`, que usa `LinuxTokenStore`/secure store ou fallback plaintext explicito com `APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1`.

Nao foi adicionada escrita de token em data/state/logs.

## Testes adicionados

- `linux_desktop_queries_agent_status`
- `linux_desktop_local_session_uses_agent_provision`

## Validacao obrigatoria

Executado em `Perceptrum`:

```bash
cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build out/build/linux-debug -j$(nproc)
ctest --test-dir out/build/linux-debug --output-on-failure
```

Resultado:

- CMake configure: sucesso.
- Build Ninja: sucesso.
- CTest: `100% tests passed, 0 tests failed out of 50`.

Observacoes:

- O build emitiu warnings ja conhecidos de `import.meta` no bundle CJS do backend local.
- O build emitiu warning de API WebKitGTK depreciada em `webkit_web_view_run_javascript`.

## Validacao manual

Executado em `Perceptrum`:

```bash
APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
./out/build/linux-debug/perceptrum-agent provision --base-url http://localhost:4000 --exe-token TEST_TOKEN --client-id test-client --timezone America/Manaus
./out/build/linux-debug/perceptrum-agent status
```

Resultado:

- Provisionamento: sucesso.
- Status: sucesso, com `status=provisioned`, `client_id=test-client`, `base_url=http://localhost:4000`, `runtime_mode=linux_minimal`, `agent_runtime=linux_minimal_agent_runtime`.
- `AgentCore` completo continuou desativado, com feature gates pesados `false`.

## Verificacao de segredo

Verificacao executada:

```bash
grep -R TEST_TOKEN ~/.local/share/PerceptrumData ~/.local/state/Perceptrum 2>/dev/null || true
```

Resultado: nenhum token encontrado em data/state/logs.

O token da validacao manual ficou apenas no caminho de secrets/config permitido pelo fallback explicito:

- `~/.config/Perceptrum/secrets/exe_token.txt`

## Restricoes confirmadas

- `AppHost/` nao foi alterado.
- `.vcxproj` nao foi alterado.
- `.sln` nao foi alterado.
- Nenhum commit foi criado.
- Nenhum push foi executado.

## Estado final

A fase 13 ficou implementada para a fatia Linux minima:

- host prepara runtime roots;
- host chama `perceptrum-agent provision` ao receber sessao local;
- host consulta `perceptrum-agent status` ou snapshot;
- UI Linux pode operar em WebKitGTK sem depender de navegador externo quando WebKitGTK esta disponivel;
- runtime, secure store e logging seguem atras das interfaces Linux existentes;
- `AgentCore` completo permanece desativado.
