# Relatorio fase 28 - Release final e matriz de paridade

Data: 2026-05-25 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Branch local: `archon/linux-port-origin-main-sync`
Push: nao realizado
Executor: Codex/gpt-5.5 no ambiente local informado

## Objetivo

Fechar a refatoracao completa com validacao Linux final, runbook atualizado, pacote `.deb` final e matriz de paridade Windows/Linux com pendencias reais expostas.

Nao ha declaracao de "100% real" nesta fase, porque camera RTSP/Webcam real, LLM real OpenAI/Z.ai e Windows WebView2 nao foram exercitados neste ambiente Ubuntu.

## Contexto lido

Foram lidos os relatorios obrigatorios das fases 17 a 27:

- `.archon/plans/relatorio-fase17-preservacao-sync-github.md`
- `.archon/plans/relatorio-fase18-integracao-origin-main.md`
- `.archon/plans/relatorio-fase19-build-pos-sync-github.md`
- `.archon/plans/relatorio-fase20-linux-backend-control-plane-agent-ingress.md`
- `.archon/plans/relatorio-fase21-linux-agentcore-portable-foundation.md`
- `.archon/plans/relatorio-fase22-linux-camera-capture-framewriter-recordings.md`
- `.archon/plans/relatorio-fase23-linux-jobs-llm-inference-runtime.md`
- `.archon/plans/relatorio-fase24-linux-shared-camera-workspace-access-parity.md`
- `.archon/plans/relatorio-fase25-fluent-ui-parity-pos-github-sync.md`
- `.archon/plans/relatorio-fase26-secure-store-logging-packaging-final.md`
- `.archon/plans/relatorio-fase27-aceite-real-camera-llm-sistema-completo.md`

## Validacao final executada

### Estado inicial/final de branch

```bash
git status --short --branch
```

Resultado:

```text
## archon/linux-port-origin-main-sync
```

O status contem alteracoes tracked e untracked das fases anteriores, alem deste relatorio e da atualizacao de `RUNBOOK-LINUX.md`. Nenhum push foi feito.

### Web

Passou:

```bash
cd DrakonSite
npm run test:platform-boundaries
npm run test:local-sqlite-bootstrap
npm run test:semantic
npm run build
npm run visual:linux
```

Resultados:

- `test:platform-boundaries`: OK, UI React comum sem WinUI/GTK/WebView2.
- `test:local-sqlite-bootstrap`: OK.
- `test:semantic`: OK, 15/15 testes.
- `npm run build`: OK, Vite gerou `dist`.
- `npm run visual:linux`: OK, 20 screenshots Linux host, 0 excecoes, summary em `DrakonSite/visual-artifacts/summary.json`.

Avisos nao bloqueantes observados:

- Chrome headless emitiu avisos VAAPI/GCM.
- Babel manteve aviso conhecido de `Jobs.tsx` acima de 500KB.

### CMake Debug

Passou:

```bash
cd Perceptrum
cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build out/build/linux-debug -j$(nproc)
ctest --test-dir out/build/linux-debug --output-on-failure
```

Resultado: 58/58 testes passaram em 54.65s.

### CMake Release

Passou:

```bash
cd Perceptrum
cmake -S . -B out/build/linux-release -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build out/build/linux-release -j$(nproc)
ctest --test-dir out/build/linux-release --output-on-failure
```

Resultado: 52/52 testes passaram em 30.10s.

### Pacote `.deb`

Passou:

```bash
cd Perceptrum
cpack --config out/build/linux-release/CPackConfig.cmake
dpkg-deb --info out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
dpkg-deb --contents out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb | grep -E 'perceptrum-(desktop|agent)|perceptrum-local-backend|index.html'
```

Artefatos:

```text
Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.tar.gz
```

Tamanho: 17M cada.

SHA256 do `.deb`:

```text
fa0ba08beb52fb2d1e3da3969fdae94d50f9353d35907966d90b1fb87f2c13b7
```

Metadados conferidos:

- `Depends`: `libcurl4, ffmpeg, nodejs, xdg-utils, libsecret-tools, dbus-user-session, libgtk-3-0, libwebkit2gtk-4.1-0`
- `Recommends`: `gnome-keyring | kwalletmanager`
- Payload contem `perceptrum-agent`, `perceptrum-desktop`, `perceptrum-desktop-launcher.sh`, backend local e `web/index.html`.

### Smoke launcher/backend

Passou:

```bash
./Perceptrum/linux-desktop/run-linux-dev.sh --check-backend --print-web-root --no-open
```

Resultado observado:

```text
webRoot=/home/marcello-guimaraes/dev/perceptrum_desktop_aspp/DrakonSite/dist
paired=true
provisioned=true
clientId=test-client
agentStatus=provisioned
agentRuntime=linux_minimal_agent_runtime
backendBaseUrl=http://127.0.0.1:4000
launchUrl=http://127.0.0.1:4000/dashboard
windowMode=webkitgtk
webkitgtkCompiled=true
backendStatus=discovered
```

Passou tambem o smoke do binario release sem instalar:

```bash
cd Perceptrum
APP_STATIC_ROOT="$PWD/../DrakonSite/dist" \
PERCEPTRUM_BACKEND_COMMAND="$PWD/out/build/linux-release/linux-backend-runtime/perceptrum-local-backend.sh" \
out/build/linux-release/perceptrum-desktop --check-backend --print-web-root --no-open
```

Resultado: backend `discovered`, `launchUrl=http://127.0.0.1:4000/dashboard`, WebKitGTK compilado.

O launcher empacotado em `usr/bin/perceptrum-desktop-launcher.sh` usa caminhos absolutos de instalacao (`/usr/bin` e `/usr/share`). Ele foi inspecionado via pacote; sua execucao real exige instalar o `.deb` ou um ambiente chroot equivalente.

### Health e camera discovery

Passou:

```bash
curl -fsS http://127.0.0.1:4000/__perceptrum/health
curl -fsS http://127.0.0.1:4000/api/runtime/health
curl -fsS -X POST http://127.0.0.1:4000/api/runtime/camera-discovery \
  -H 'content-type: application/json' \
  -d '{"timeoutMs":500}'
```

Resultados:

- `__perceptrum/health`: `ok=true`, backend `sqlite`, static ready.
- `/api/runtime/health`: `ready=true`, SQLite schema disponivel, `tableCount=93`.
- camera discovery: executou sem erro e retornou `devices=[]`, `total_device_count=0` no ambiente atual.

## Matriz de paridade Windows/Linux

| Area | Linux Ubuntu | Windows | Status real |
| --- | --- | --- | --- |
| UI visual | OK no Linux host via `visual:linux`, 20 screenshots dark/light sem excecoes. | WebView2 nao executado neste Ubuntu. | Linux OK; Windows pendente em ambiente Windows real. |
| Backend local | OK com SQLite local, health, local session, agent ingress, media local e rotas de workspace/shared. | Backend compartilhado preservado no AppHost, nao revalidado nesta fase. | Linux OK; Windows precisa smoke AppHost. |
| Secure store | CTest cobre fail-closed sem cofre e fallback dev plaintext `0600`; contrato Secret Service via `secret-tool` documentado. | DPAPI nao alterado, mas nao revalidado nesta fase. | Parcial real: cofre Linux desbloqueado e DPAPI Windows ainda precisam teste manual. |
| Logging | OK; CTest cobre redacao de health/logs para tokens, URLs sensiveis e segredos. | Codigo Windows nao alterado nesta fase. | Linux OK; Windows nao revalidado. |
| Camera discovery | OK; endpoint executou e retornou `devices=[]` sem erro no host atual. | Discovery Windows nao revalidado. | Linux OK sem cameras detectadas; Windows pendente. |
| Camera capture RTSP/Webcam | OK sintetico com `lavfi` nas fases 22/27 e testes Debug com gates; RTSP real nao executado sem URL/camera. Webcam real nao testada. | Pipeline Windows existente nao revalidado nesta fase. | Sintetico OK; real externo pendente. |
| Frame writer/recordings | OK sintetico; testes geram thumbnails, MP4 10s/60s/300s e validam helper de recordings. | Frame writer Windows nao revalidado. | Linux sintetico OK; real externo pendente. |
| Jobs | OK sintetico; `linux_job_runtime_polls_commands_and_posts_fake_inference` passou no Debug. | JobRuntime Windows completo nao executado nesta fase. | Linux sintetico OK; Windows pendente. |
| LLM OpenAI/Z.ai | Provider fake/local OK; erro sem chave OK nas fases anteriores. Nenhuma chamada real paga executada. | Fluxo Windows nao revalidado. | Real OpenAI/Z.ai pendente por chave/ambiente. |
| Shared camera | Backend/local cache e shared-find descriptors cobertos por SQLite/bootstrap e fixtures visuais. Relay real central nao exercitado. | Fluxos integrados do GitHub preservados, mas sem teste Windows. | Local/degradado OK; central real pendente. |
| Workspace/access | Account users, settings, resource catalog e leituras degradadas OK. Convites/sessoes reais dependem de central relay. | UI/host Windows nao revalidado. | Local/degradado OK; central real pendente. |
| Packaging Linux | `.deb` e `.tar.gz` gerados; payload e dependencias conferidos; smoke release OK. | AppHost/installer Windows nao buildado nem instalado neste Ubuntu. | Linux OK; Windows pendente. |

## Lista zero-surpresa de dependencias externas

Ainda dependem de ambiente externo e nao foram declarados 100% reais:

- Camera RTSP real: exige `APP_AGENT_RTSP_URL` valido, credenciais, rede acessivel e camera entregando frames.
- Webcam real: exige dispositivo local ou fonte aceita por `ffmpeg`; nao havia dispositivo validado nesta fase.
- LLM OpenAI real: exige `OPENAI_API_KEY` real e autorizacao para chamada paga.
- LLM Z.ai real: exige `ZAI_API_KEY` real e autorizacao para chamada paga.
- Windows WebView2: exige host Windows com WebView2 Runtime e app/URL local.
- Windows packaging/AppHost: exige build Windows/AppHost/installer em ambiente Windows.
- Secret Service real: exige sessao desktop Linux com cofre desbloqueado (`gnome-keyring` ou KWallet). O contrato e fallback foram testados, mas o cofre real nao foi escrito/lido manualmente nesta fase.
- Central workspace/shared relay: exige servidor central configurado (`CENTRAL_AUTH_*`, relay e contas reais).

## RUNBOOK atualizado

`RUNBOOK-LINUX.md` foi atualizado com:

- instalacao de dependencias;
- sequencia final de validacao;
- execucao dev e smoke sem instalar;
- instalacao e smoke do `.deb`;
- configuracao e diagnostico de `secret-tool`;
- configuracao de camera real RTSP;
- configuracao OpenAI/Z.ai;
- comandos de diagnostico;
- caminhos de logs, banco, thumbnails, clips, eventos, inference temp, relatorios visuais, CTest e pacote.

## Comandos finais para o usuario no desktop Ubuntu

Sem instalar:

```bash
git status --short --branch
cd DrakonSite && npm run build && npm run visual:linux
cd ../Perceptrum
cmake -S . -B out/build/linux-release -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build out/build/linux-release -j"$(nproc)"
ctest --test-dir out/build/linux-release --output-on-failure
cpack --config out/build/linux-release/CPackConfig.cmake
APP_STATIC_ROOT="$PWD/../DrakonSite/dist" \
PERCEPTRUM_BACKEND_COMMAND="$PWD/out/build/linux-release/linux-backend-runtime/perceptrum-local-backend.sh" \
out/build/linux-release/perceptrum-desktop --check-backend --print-web-root --no-open
```

Instalando o `.deb`:

```bash
cd Perceptrum
sudo apt install ./out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
perceptrum-desktop --check-backend --print-web-root --no-open
perceptrum-desktop
```

Camera real:

```bash
ffprobe -hide_banner -rtsp_transport tcp -i 'rtsp://USER:PASS@CAMERA_IP:554/STREAM' -v error -show_streams
```

LLM real:

```bash
export PERCEPTRUM_LINUX_LLM_PROVIDER=openai
export OPENAI_API_KEY='<OPENAI_API_KEY>'
# ou
export PERCEPTRUM_LINUX_LLM_PROVIDER=zai
export ZAI_API_KEY='<ZAI_API_KEY>'
```

## Estado final explicavel

- Branch: `archon/linux-port-origin-main-sync`.
- Push: nao realizado.
- Pacote gerado: `Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb`.
- SHA256: `fa0ba08beb52fb2d1e3da3969fdae94d50f9353d35907966d90b1fb87f2c13b7`.
- Web tests/build/visual Linux: passaram.
- CMake/CTest Debug: passou, 58/58.
- CMake/CTest Release: passou, 52/52.
- Smoke launcher dev: passou.
- Smoke release sem instalar: passou.
- Falhas abertas nesta fase: nenhuma.
- Pendencias reais por ambiente externo: camera real, LLM real, Windows WebView2/AppHost/installer, cofre Secret Service real desbloqueado e central relay.

## Observacoes de higiene

- Backups criados em fases anteriores nao foram apagados.
- `storage/` permanece como artefato local nao versionado e nao foi removido para evitar apagar banco/dados do usuario.
- O repositorio permanece com alteracoes locais de fases anteriores e arquivos novos ainda nao rastreados. Isso e esperado pelo fluxo atual, mas deve ser revisado antes de qualquer commit.
