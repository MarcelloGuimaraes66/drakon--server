# Relatorio fase 10 - Bridge WebKitGTK e sessao local Linux

Data: 2026-05-24 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`

## 1. Objetivo

Implementar o minimo equivalente ao bridge desktop do AppHost/WebView2 no host Linux WebKitGTK, mantendo a UI React comum sem dependencia WinUI/GTK e permitindo que a sessao local seja provisionada pelo backend Node local.

## 2. Observacao sobre Archon

O comando Archon foi iniciado com `archon-assist` e resolveu o executor principal para `Codex/gpt-5.5`. O processo principal ficou sem saida e sem uso relevante de CPU, entao foi encerrado com `SIGTERM` e o prompt 10 foi executado diretamente neste workspace.

Nenhum commit foi feito.
Nenhum push foi feito.

## 3. Arquivos alterados nesta fase

- `Perceptrum/linux-desktop/main.cpp`
- `DrakonSite/server/index.ts`
- `Perceptrum/CMakeLists.txt`

Nao houve alteracao em:

- `AppHost/`
- `.vcxproj`
- `.sln`

Comando de verificacao:

```bash
git diff --name-only -- AppHost '*.vcxproj' '*.sln'
```

Resultado: sem saida.

## 4. Bridge WebKitGTK implementado

O host Linux injeta um script no WebKitGTK no inicio do documento. O script cria a compatibilidade esperada pela UI web:

- `window.chrome.webview.postMessage(...)`
- `window.__drakonDesktopShell = true`
- `window.__perceptrumLinuxHost = true`
- `window.__perceptrumLinuxWebKitBridgeInstalled = true`

O bridge envia mensagens para o processo nativo por `window.webkit.messageHandlers.perceptrumBridge.postMessage(...)`.

Mensagens tratadas no host Linux:

- `resident-runtime-session`
- `theme-changed`
- `account-delete-cleanup`

Tambem foram expostos helpers compat:

- `window.__drakonDesktopTryResidentRuntime`
- `window.__drakonDesktopTryPairRuntime`
- `window.__drakonDesktopReportTheme`

## 5. Sessao local

Foi criado o endpoint local:

```text
POST /api/runtime/local-session
```

O endpoint fica em `DrakonSite/server/index.ts` e usa o mesmo backend Node local do Ubuntu. Ele chama o fluxo existente do worker:

- `POST /api/pairing/generate`
- `POST /api/pairing/pair`

Quando o payload contem `client_id`, `exe_id` e `exe_token`, o host WebKitGTK persiste a sessao usando os adaptadores de runtime ja existentes:

- token: `ExeTokenSecretPath(paths)`, por `perceptrum::platform::WriteProtectedLocalText(...)`
- config: `WriteAgentConfig(...)`
- arquivos de compatibilidade nao sensiveis: `PersistNonSensitiveCompatibilityFiles(...)`

## 6. Limpeza de conta

`account-delete-cleanup` agora remove os arquivos de sessao conhecidos do runtime Linux:

- token local
- `agent_config.json`
- arquivos de compatibilidade nao sensiveis

A limpeza completa de toda a arvore de storage do usuario continua propositalmente limitada nesta fase. O host registra no log quando `clearStorageRoot` e solicitado, mas nao apaga toda a pasta do usuario automaticamente.

## 7. OAuth callback

O host WebKitGTK passou a interceptar navegacoes e reescrever callbacks que contenham `/auth/callback` para a origem local do backend ativo. Isso evita que um callback externo tire a sessao do app local.

Exemplo de destino esperado:

```text
http://127.0.0.1:4000/auth/callback...
```

## 8. Logging

Eventos relevantes do bridge sao registrados em:

```text
~/.local/state/Perceptrum/logs/perceptrum-desktop.log
```

Eventos cobertos:

- sessao residente persistida;
- falha de persistencia;
- tema recebido;
- limpeza de conta;
- callback OAuth reescrito.

## 9. Testes adicionados

Foram adicionados testes CMake de presenca para garantir que os pontos criticos nao sumam sem quebrar a bateria:

- `linux_desktop_webkit_bridge_script_present`
- `local_server_runtime_local_session_endpoint_present`

Eles validam referencias ao bridge WebKitGTK e ao endpoint local de sessao.

## 10. Validacao executada

### CMake configure

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

### Build Linux

```bash
cmake --build out/build/linux-debug -j$(nproc)
```

Resultado: sucesso.

Observacao: o build emite aviso de depreciacao para `webkit_web_view_run_javascript`. A chamada atual funciona, mas deve ser migrada depois para `webkit_web_view_evaluate_javascript`.

### Build web

```bash
cd DrakonSite
npm run build
```

Resultado: sucesso.

```text
vite v7.3.1 building client environment for production...
2046 modules transformed.
dist/index.html
dist/assets/index-eE6n0e6F.css
dist/assets/index-5IV6gQvy.js
built in 3.73s
```

### Testes Node

```bash
npm run test:platform-boundaries
npm run test:local-sqlite-bootstrap
```

Resultado: sucesso.

```text
React common UI platform boundary OK.
Local SQLite bootstrap OK.
```

### CTest

```bash
cd Perceptrum
ctest --test-dir out/build/linux-debug --output-on-failure
```

Resultado: sucesso.

```text
100% tests passed, 0 tests failed out of 48
Total Test time (real) = 29.82 sec
```

### Script local validado

```bash
./Perceptrum/linux-desktop/run-linux-dev.sh --check-backend --print-web-root
```

Resultado: sucesso.

Trechos relevantes:

```text
backendBaseUrl=http://127.0.0.1:4000
launchUrl=http://127.0.0.1:4000/dashboard
windowMode=webkitgtk
webkitgtkCompiled=true
backendStatus=started
```

## 11. Como rodar agora

Comando recomendado:

```bash
cd /home/marcello-guimaraes/dev/perceptrum_desktop_aspp
./Perceptrum/linux-desktop/run-linux-dev.sh
```

O script compila o host Linux se necessario, garante o build web quando faltar e abre a UI no WebKitGTK.

## 12. Riscos restantes

- A paridade visual completa das paginas internas ainda depende da fase Fluent visual.
- O bridge WebKitGTK cobre o caminho local minimo; nao e uma copia completa de todas as capacidades do WebView2.
- A limpeza completa de storage por exclusao de conta ainda deve ser especificada com uma politica segura antes de apagar diretorios inteiros.
- A chamada WebKit depreciada deve ser migrada em fase posterior para remover aviso de build.

## 13. Proxima fase recomendada

Executar o prompt 11:

```bash
archon workflow run archon-assist --cwd "$PWD" --no-worktree \
  "Leia e execute exatamente o prompt salvo em .archon/prompts/prompt-11-fluent-visual-parity-internal-pages.txt. Use somente Codex/gpt-5.5. Nao faca commit. Nao faca push."
```

