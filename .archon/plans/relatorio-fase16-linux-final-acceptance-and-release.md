# Relatorio fase 16 - Linux final acceptance and local release

Data: 2026-05-24

## Resultado geral

Aceite local Linux aprovado com ressalvas documentadas:

- Build web passou.
- Build C++ Debug passou.
- Build C++ Release passou.
- CTest completo passou em Debug e Release: 52/52.
- Bateria visual claro/escuro passou em browser e linux-host.
- Pacote `.deb` Release foi gerado e inspecionado.
- Backend local respondeu `/__perceptrum/health` e `/api/runtime/health`.
- Camera discovery respondeu com JSON valido em ambiente local, sem cameras detectadas.
- Install/remove real no sistema nao foi executado por seguranca, pois exigiria alteracao global via `sudo`; o pacote foi validado por `dpkg-deb` e `dpkg --dry-run`.
- Nenhum commit ou push foi feito.

## Mudanca feita durante o aceite

Foi encontrada uma lacuna contra o checklist: o backend packaged respondia HTML para `/__perceptrum/health`, pois apenas `/api/runtime/health` existia no runtime desktop packaged.

Correcao aplicada:

- `AppHost/Runtime/desktop-local-server.mjs`: adicionada rota `GET /__perceptrum/health` com JSON `{ ok, brand, backend, staticRoot, staticReady }`.

Observacao de fronteira:

- `.sln` e `.vcxproj` continuam sem diff.
- O diretorio `AppHost` passou a ter diff somente nesta rota de runtime local compartilhado. Isso foi necessario para cumprir o item de aceite do backend local.

## Comandos executados

Build web:

```bash
cd DrakonSite
npm run build
```

Resultado:

- `tsc -b && vite build` passou.
- `dist/index.html`, CSS e JS foram gerados.

Build C++ Debug:

```bash
cd Perceptrum
cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build out/build/linux-debug -j"$(nproc)"
```

Resultado:

- Configure passou.
- Build Debug passou.

Build C++ Release:

```bash
cd Perceptrum
cmake -S . -B out/build/linux-release -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build out/build/linux-release -j"$(nproc)"
```

Resultado:

- Configure passou.
- Build Release passou.
- Aviso conhecido: `webkit_web_view_run_javascript` depreciado no WebKitGTK 4.1.

CTest:

```bash
ctest --test-dir out/build/linux-debug --output-on-failure
ctest --test-dir out/build/linux-release --output-on-failure
```

Resultado:

- Debug: 52/52 passaram.
- Release: 52/52 passaram.

Cobertura relevante do CTest:

- Pareamento/provisionamento por mock server.
- Status/health do agente.
- Segredos nao expostos em status/health.
- Runtime roots Linux.
- WebKitGTK linkado.
- URL de launch HTTP em `/dashboard`.
- Backend local iniciado por host Linux.
- RTSP thumbnail por gate com fonte sintetica `lavfi`.
- Fontes Win32 pesados continuam fora do target Linux.

Visual battery:

```bash
cd DrakonSite
npm run visual:browser
npm run visual:linux
```

Resultado:

- `visual:browser`: passou na repeticao completa e escreveu 16 screenshots.
- `visual:linux`: passou e escreveu 16 screenshots.
- Artefatos: `DrakonSite/visual-artifacts/`.
- Rotas cobertas: `/dashboard`, `/cameras`, `/ai-agents`, `/jobs`, `/chat`, `/settings`, `/events`, `/billing`.
- Temas cobertos: `dark`, `light`.

Nota:

- Houve uma primeira falha flake no capturador headless para `browser/dark/dashboard` com screenshot monocromatico. A repeticao isolada e a repeticao completa passaram sem alteracao de codigo.

Pacote:

```bash
cd Perceptrum
cmake --build out/build/linux-release --target package
dpkg-deb --info out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
dpkg-deb --contents out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
dpkg --dry-run -i out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
```

Resultado:

- `.deb`: `Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb`
- Tamanho: 17M.
- Arquitetura Debian: `amd64`.
- Depends: `libcurl4, libgtk-3-0, libwebkit2gtk-4.1-0, ffmpeg, nodejs, xdg-utils, libsecret-tools`.
- Conteudo principal validado:
  - `/usr/bin/perceptrum-agent`
  - `/usr/bin/perceptrum-desktop`
  - `/usr/bin/perceptrum-desktop-launcher.sh`
  - `/usr/share/applications/perceptrum.desktop`
  - `/usr/share/perceptrum-desktop/backend/perceptrum-local-backend.sh`
  - `/usr/share/perceptrum-desktop/backend/desktop-local-server.cjs`
  - `/usr/share/perceptrum-desktop/backend/bootstrap/perceptrum_site.seed.sqlite`
  - `/usr/share/perceptrum-desktop/web/index.html`
- `dpkg --dry-run -i` chegou a `Preparing to unpack` sem instalar o pacote.

Backend local e `/dashboard`:

```bash
APP_STATIC_ROOT="$PWD/../DrakonSite/dist" \
PERCEPTRUM_BACKEND_COMMAND="$PWD/out/build/linux-release/linux-backend-runtime/perceptrum-local-backend.sh" \
APP_RUNTIME_DATA_ROOT="$PWD/../.tmp/fase16-smoke/data" \
APP_RUNTIME_CONFIG_ROOT="$PWD/../.tmp/fase16-smoke/config" \
APP_RUNTIME_CACHE_ROOT="$PWD/../.tmp/fase16-smoke/cache" \
APP_RUNTIME_STATE_ROOT="$PWD/../.tmp/fase16-smoke/state" \
APP_RUNTIME_LOG_ROOT="$PWD/../.tmp/fase16-smoke/state/logs" \
out/build/linux-release/perceptrum-desktop --check-backend --print-web-root --no-open
```

Resultado:

- `backendStatus=started`.
- `launchUrl=http://127.0.0.1:4000/dashboard`.
- `webkitgtkCompiled=true`.

Health direto:

```bash
curl -fsS http://127.0.0.1:4100/__perceptrum/health
curl -fsS http://127.0.0.1:4100/api/runtime/health
curl -fsSI http://127.0.0.1:4100/dashboard
```

Resultado:

- `/__perceptrum/health`: `{"ok":true,...,"staticReady":true}`.
- `/api/runtime/health`: `{"ready":true,"fatal":false,...}`.
- `/dashboard`: HTTP 200 com HTML do app.

Camera discovery:

```bash
curl -fsS -X POST http://127.0.0.1:4101/api/runtime/camera-discovery \
  -H 'content-type: application/json' \
  -d '{"timeoutMs":1000}'
```

Resultado:

- Resposta JSON valida.
- `devices: []` neste ambiente.
- Sem camera fisica validada nesta execucao.

Auditoria de tokens:

```bash
find .tmp /tmp/perceptrum-ctest-runtime -type f \
  \( -path '*/data/*' -o -path '*/state/*' -o -path '*/logs/*' \) \
  2>/dev/null | xargs -r rg -n \
  'TEST_TOKEN|sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]+|xox[baprs]-|AKIA[0-9A-Z]{16}' || true
```

Resultado:

- Sem achados em arquivos texto de logs/data/state.
- `strings` em SQLite/WAL usados no smoke tambem nao encontrou tokens de teste ou padroes comuns de segredo.

## Checklist de aceite

1. App abre pelo launcher: parcialmente validado por `.desktop`, launcher packaged e smoke do binario. Execucao real do launcher instalado nao foi feita para evitar `sudo`/instalacao global.
2. Janela WebKitGTK carrega `/dashboard`: validado por build com WebKitGTK, CTest de URL `/dashboard`, `ldd` com WebKitGTK/GTK e bateria visual linux-host. Janela interativa real nao foi aberta neste ambiente.
3. Backend local responde `/__perceptrum/health`: validado apos correcao.
4. UI renderiza em dark/light sem layout quebrado: validado por bateria visual browser e linux-host.
5. Pareamento/provisionamento funciona: validado por CTest com mock server.
6. Agente status/health funciona: validado por CTest e smoke `perceptrum-agent status`.
7. Camera discovery funciona: validado por endpoint local com resposta JSON.
8. RTSP/thumbnail: validado por CTest sintetico `linux_rtsp_thumbnail_gates_generate_health_and_event`; camera RTSP real nao foi usada.
9. Jobs/chat: validado visualmente por fixtures nas rotas `/jobs` e `/chat`; gates runtime completos continuam conforme fases anteriores.
10. Remove/purge documentados: documentado em `RUNBOOK-LINUX.md`.

## Limites nao executados

- Nao executei `sudo apt install`, `sudo apt remove`, `sudo apt purge` ou instalacao real do `.deb`.
- Nao apaguei dados de usuario.
- Nao fiz commit.
- Nao fiz push.

