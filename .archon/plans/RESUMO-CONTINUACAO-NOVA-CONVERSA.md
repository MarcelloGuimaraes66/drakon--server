RESUMO-MESTRE PARA CONTINUAR O DESENVOLVIMENTO DO PERCEPTRUM NO UBUNTU COM ARCHON + CODEX

Usuário: Marcello Guimarães.
Máquina atual: Ubuntu.
Projeto local:

/home/marcello-guimaraes/dev/perceptrum_desktop_aspp

Objetivo principal:
Transformar o Perceptrum em sistema desktop Linux/Ubuntu real, independente de navegador externo, com interface e funcionalidades equivalentes ao Perceptrum Windows, sem quebrar o código Windows/macOS existente. O sistema deve permanecer multiplataforma, compilando no Windows, macOS e Linux, usando #ifdef _WIN32, __APPLE__ e __linux__ quando necessário. Não fazer commit nem push.

Regras permanentes:
- Não fazer git commit.
- Não fazer git push.
- Não executar git reset --hard sem autorização explícita.
- Não apagar arquivos sem autorização.
- Não alterar AppHost, .vcxproj ou .sln salvo se explicitamente autorizado.
- Não quebrar Windows.
- Não quebrar macOS.
- Não transformar o Linux em site externo.
- O Linux deve rodar como desktop app independente de navegador.
- Se usar WebView no Linux, deve ser WebView embutida/local, não navegador externo.
- Usar somente Codex/gpt-5.5.
- Não usar Claude, opus, sonnet ou haiku.
- Se precisar instalar pacote apt, parar e informar exatamente o comando antes de continuar.
- Após cada fase, rodar CMake, build, ctest e gerar relatório em .archon/plans/.
- Trabalhar por fases pequenas e testáveis.
- Não copiar Perceptrum/out como fonte canônica sem revisão.

Configuração Codex:
Arquivo do Codex:

/home/marcello-guimaraes/.codex/config.toml

Ele foi ajustado/queremos manter com:

model = "gpt-5.5"
model_reasoning_effort = "high"
approval_policy = "never"
sandbox_mode = "danger-full-access"

Além disso, havia configurações existentes:
[projects."/home/marcello-guimaraes/dev/perceptrum_desktop_aspp"]
trust_level = "trusted"

[tui.model_availability_nux]
"gpt-5.5" = 4

Configuração Archon:
Existe config global:

/home/marcello-guimaraes/.archon/config.yaml

Deve apontar para Codex:

defaultAssistant: codex

assistants:
  codex:
    codexBinaryPath: /home/marcello-guimaraes/.npm-global/bin/codex
    model: gpt-5.5
    modelReasoningEffort: high
    webSearchMode: live

Codex binário:
/home/marcello-guimaraes/.npm-global/bin/codex

Usar Archon sempre assim:
cd /home/marcello-guimaraes/dev/perceptrum_desktop_aspp

archon workflow run archon-assist --cwd "$PWD" --no-worktree \
"Leia e execute exatamente o prompt salvo em .archon/prompts/NOME_DO_PROMPT.txt. Use somente Codex/gpt-5.5. Não faça commit. Não faça push."

Não usar:
archon workflow run plan
porque antes ele caiu em workflow errado.

Contexto do Git:
O usuário quis limpar a refatoração anterior do Codex e voltar ao GitHub limpo. Depois disso, Archon descobriu que no checkout limpo:
- Perceptrum/CMakeLists.txt estava ausente.
- Perceptrum/linux estava ausente.
- Perceptrum/linux-desktop estava ausente.
- Perceptrum/packaging/linux estava ausente.
- Perceptrum/out/build/linux-debug existia, mas era artefato não-canônico.
- Perceptrum/out/package/perceptrum-desktop_1.0.0_amd64.deb existia, mas era artefato não-canônico.

Conclusão importante:
Não usar Perceptrum/out/build como fonte verdadeira. Ele serve só como evidência histórica. A base Linux precisa ser reconstruída em fonte versionável/canônica.

Relatórios gerados pelo Prompt Âncora:
Archon gerou estes cinco relatórios em .archon/plans/:
- anchor-inventario-projeto.md
- anchor-matriz-paridade-windows-linux.md
- anchor-plano-migracao-desktop-linux.md
- anchor-riscos-multiplataforma.md
- anchor-comandos-validacao.md

O Archon confirmou:
- AppHost é host Windows WinUI 3 + C++/WinRT + WebView2, fortemente Windows-specific.
- AppHost não deve ser portado diretamente para Linux.
- DrakonSite é fonte canônica de UI web/backend TypeScript e deve ser preservado.
- Perceptrum/Perceptrum é fonte canônica do runtime/agente C++.
- Linux deve ter host próprio separado.
- Secrets Linux eram risco porque fallback não Windows podia cair em plaintext.

Prompt 0 — Recalibração:
Foi executado e gerou:

.archon/plans/plano-recalibrado-pos-reset-github.md

Conclusão do Prompt 0:
- Checkout limpo não tinha CMake Linux canônico.
- Prioridade: restaurar build Linux reprodutível em fonte.
- Só depois avançar para agente, runtime, secrets, desktop e paridade visual.

Prompt 1 — Base Linux reprodutível:
Arquivo usado:
.archon/prompts/prompt-1-base-linux-reprodutivel.txt

Foi executado via Archon com sucesso.

Criou:
- Perceptrum/CMakeLists.txt
- Perceptrum/linux/main.cpp
- Perceptrum/linux-desktop/main.cpp
- Perceptrum/linux-desktop/XdgPaths.h
- Perceptrum/linux-desktop/XdgPaths.cpp
- .archon/plans/relatorio-fase1-base-linux-reprodutivel.md

Validação Fase 1:
- cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug: sucesso
- cmake --build out/build/linux-debug -j$(nproc): sucesso
- ctest --test-dir out/build/linux-debug --output-on-failure: sucesso, mas sem testes cadastrados
- perceptrum-agent --help: sucesso
- perceptrum-agent validate-config: sucesso
- perceptrum-agent check-deps: sucesso
- perceptrum-desktop: sucesso como stub inicial

Não alterou:
- AppHost
- .vcxproj
- .sln

Não fez commit/push.

Prompt 2 — Runtime Linux, XDG, logs, secrets e testes:
Arquivo criado:
.archon/prompts/prompt-2-runtime-xdg-secrets-linux.txt

Foi executado via Archon com sucesso.

Relatório:
.archon/plans/relatorio-fase2-runtime-xdg-secrets-linux.md

Status Git após Fase 2:
 M Perceptrum/Perceptrum/platform/platform_secure_store.cpp
 M Perceptrum/Perceptrum/runtime/BrandingRuntime.h
?? .archon/
?? Perceptrum/CMakeLists.txt
?? Perceptrum/linux-desktop/
?? Perceptrum/linux/

Criado:
- Perceptrum/linux/RuntimePaths.h
- Perceptrum/linux/RuntimePaths.cpp
- .archon/plans/relatorio-fase2-runtime-xdg-secrets-linux.md

Alterado:
- Perceptrum/CMakeLists.txt
- Perceptrum/linux/main.cpp
- Perceptrum/linux-desktop/main.cpp
- Perceptrum/Perceptrum/platform/platform_secure_store.cpp
- Perceptrum/Perceptrum/runtime/BrandingRuntime.h

Fase 2 implementou:
- camada perceptrum::linux_runtime::ResolveRuntimePaths()
- APP_RUNTIME_DATA_ROOT
- APP_RUNTIME_CONFIG_ROOT
- APP_RUNTIME_CACHE_ROOT
- APP_RUNTIME_STATE_ROOT
- APP_RUNTIME_LOG_ROOT
- fallback XDG
- criação automática de diretórios
- agent_health.json em APP_RUNTIME_DATA_ROOT
- logs em APP_RUNTIME_LOG_ROOT
- campos mínimos do health:
  version, status, paired, base_url, client_id, pid, heartbeat_unix_ms, heartbeat_utc, runtime_timezone, data_root, config_root, log_root
- secure store Linux fail-closed por padrão
- Secret Service via secret-tool, mas secret-tool não estava instalado no ambiente
- fallback plaintext só com flags explícitas:
  APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1
  PERCEPTRUM_ALLOW_PLAINTEXT_SECRET_RECOVERY=1
- diretório 0700 e arquivo 0600 se fallback for usado
- 7 testes CTest reais:
  agent_help
  agent_validate_config_tmp_runtime
  agent_check_deps_tmp_runtime
  agent_version
  agent_status_missing_snapshot
  agent_run_writes_health_snapshot
  agent_healthcheck_not_paired

Validação Fase 2:
- CMake: sucesso
- build: sucesso
- ctest: 100% tests passed, 0 tests failed out of 7
- perceptrum-agent --help: sucesso
- validate-config com /tmp: sucesso
- check-deps: sucesso, encontrou /usr/bin/ffmpeg, /usr/bin/ffprobe e /usr/bin/node
- version: 1.0.0
- status antes do run: erro funcional controlado, sem crash
- timeout 10s perceptrum-agent run || true: criou health snapshot e log
- status depois do run: sucesso com status=not_paired, paired=false, roots em /tmp, timezone America/Manaus
- healthcheck: erro funcional esperado not_paired
- perceptrum-desktop stub com overrides: sucesso
- AppHost não alterado
- .vcxproj e .sln não alterados
- nenhum commit/push

Riscos pendentes apontados pela Fase 2:
- agente Linux ainda é stub runtime/health; ainda não executa AgentCore
- HeadlessService.cpp, AgentCore.cpp, CameraSession.cpp, FrameDiskWriter.cpp e JobRuntime.cpp continuam fora do build Linux canônico por acoplamentos Windows
- Secret Service não validado porque secret-tool não está instalado
- healthcheck saudável real depende de pairing e runtime completo
- perceptrum-desktop segue stub, sem GTK/WebKit e sem paridade visual

Próxima fase recomendada:
Fase 3: integrar pairing/config real ao runtime Linux mínimo e preparar entrada segura do HeadlessService, mantendo AgentCore/câmera/jobs fora até isolar acoplamentos Win32.

Prompt 3 a criar:
Arquivo desejado:
.archon/prompts/prompt-3-pairing-headless-linux.txt

Objetivo do Prompt 3:
Implementar pairing/provisioning/config real no agente Linux mínimo e preparar uma ponte segura para HeadlessService, sem ainda integrar AgentCore/câmeras/jobs pesados.

A Fase 3 deve:
- preservar AppHost, .vcxproj e .sln
- não quebrar Windows/macOS
- não fazer commit/push
- não integrar AgentCore completo ainda
- não integrar CameraSession, captura RTSP, FrameDiskWriter ou JobRuntime pesado ainda
- implementar/revisar comandos:
  --help
  version
  validate-config [--base-url <url>]
  check-deps
  status
  healthcheck [--max-heartbeat-age-seconds <seconds>]
  run
  pair --pair-code <code> [--base-url <url>]
  provision --base-url <url> --exe-token <token> --client-id <id> [--exe-id <id>] [--timezone <iana>]
- persistir config não sensível em APP_RUNTIME_CONFIG_ROOT:
  base_url, client_id, exe_id, timezone, estado paired/provisioned, metadados não sensíveis
- proteger exe-token via secure store
- se secure store não estiver disponível, falhar fechado, exceto com flag explícita
- não imprimir tokens em logs/terminal/health
- run deve carregar config persistida e refletir paired/provisioned
- status/healthcheck devem refletir:
  not_paired, paired/provisioned, missing_snapshot, stale_heartbeat, alive, config_invalid, secure_store_unavailable, backend_unreachable
- adicionar CTest para validações de provision/pair:
  agent_provision_requires_base_url
  agent_provision_requires_token
  agent_provision_requires_client_id
  agent_provision_fails_closed_without_secret_store_when_token_needed
  agent_provision_with_plaintext_recovery_flag_uses_0600_file, se viável
  agent_status_after_provision_reads_config, se viável
  pair_requires_pair_code
  pair_backend_unreachable_is_functional_error

Validação padrão após cada fase:
cd Perceptrum
cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build out/build/linux-debug -j$(nproc)
ctest --test-dir out/build/linux-debug --output-on-failure

Runtime isolado para testes manuais:
export APP_RUNTIME_DATA_ROOT=/tmp/perceptrum-runtime-test/data
export APP_RUNTIME_CONFIG_ROOT=/tmp/perceptrum-runtime-test/config
export APP_RUNTIME_CACHE_ROOT=/tmp/perceptrum-runtime-test/cache
export APP_RUNTIME_STATE_ROOT=/tmp/perceptrum-runtime-test/state
export APP_RUNTIME_LOG_ROOT=/tmp/perceptrum-runtime-test/state/logs

Comandos manuais desejados:
rm -rf /tmp/perceptrum-runtime-test
mkdir -p "$APP_RUNTIME_DATA_ROOT" "$APP_RUNTIME_CONFIG_ROOT" "$APP_RUNTIME_CACHE_ROOT" "$APP_RUNTIME_STATE_ROOT" "$APP_RUNTIME_LOG_ROOT"

./out/build/linux-debug/perceptrum-agent --help
./out/build/linux-debug/perceptrum-agent version
./out/build/linux-debug/perceptrum-agent validate-config
./out/build/linux-debug/perceptrum-agent check-deps
./out/build/linux-debug/perceptrum-agent status || true
./out/build/linux-debug/perceptrum-agent healthcheck || true
./out/build/linux-debug/perceptrum-agent provision || true
./out/build/linux-debug/perceptrum-agent provision --base-url http://localhost:4000 || true
./out/build/linux-debug/perceptrum-agent provision --base-url http://localhost:4000 --exe-token TEST_TOKEN || true
./out/build/linux-debug/perceptrum-agent provision --base-url http://localhost:4000 --exe-token TEST_TOKEN --client-id test-client --timezone America/Manaus || true
./out/build/linux-debug/perceptrum-agent pair || true
./out/build/linux-debug/perceptrum-agent pair --pair-code TEST-CODE --base-url http://localhost:4000 || true
timeout 10s ./out/build/linux-debug/perceptrum-agent run || true
./out/build/linux-debug/perceptrum-agent status || true
./out/build/linux-debug/perceptrum-agent healthcheck || true

