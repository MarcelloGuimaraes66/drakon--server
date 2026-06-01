# Anchor - Comandos de Validacao

Data: 2026-05-03  
Objetivo: lista de comandos para validar estado atual e guiar a migracao Linux/Ubuntu.  
Observacao: comandos destrutivos nao estao incluidos. Onde houver instalacao/pacote, executar em VM/container descartavel.

## Inspecao inicial do checkout

```bash
pwd
git status --short --untracked-files=all
git rev-parse --show-toplevel
git branch --show-current
```

```bash
find . -path './DrakonSite/node_modules' -prune \
  -o -path './DrakonSite/dist' -prune \
  -o -path './Perceptrum/out' -prune \
  -o -path './.git' -prune \
  -o \( -name '*.sln' -o -name '*.vcxproj' -o -name 'package.json' -o -name 'CMakeLists.txt' -o -name 'CMakePresets.json' -o -name 'vcpkg.json' \) \
  -print | sort
```

```bash
find Perceptrum -maxdepth 3 -type d | sort
test -f Perceptrum/CMakeLists.txt && echo "CMakeLists presente" || echo "CMakeLists ausente"
test -d Perceptrum/linux && echo "linux/ presente" || echo "linux/ ausente"
```

## Validacao dos artefatos Linux existentes

```bash
find Perceptrum/out/build/linux-debug -maxdepth 2 -type f \
  \( -name 'CMakeCache.txt' -o -name 'CPackConfig.cmake' -o -name '*.desktop' -o -name '*.sh' -o -name 'compile_commands.json' -o -name 'install_manifest.txt' \) \
  -print | sort
```

```bash
rg -n "CMAKE_PROJECT_NAME|CMAKE_HOME_DIRECTORY|CPACK_DEBIAN_PACKAGE_DEPENDS|CPACK_PACKAGE_NAME|WEBKIT2GTK|GTK3|OpenCV_DIR|CURL_LIBRARY" \
  Perceptrum/out/build/linux-debug/CMakeCache.txt \
  Perceptrum/out/build/linux-debug/CPackConfig.cmake
```

```bash
sed -n '1,220p' Perceptrum/out/build/linux-debug/install_manifest.txt
sed -n '1,80p' Perceptrum/out/build/linux-debug/perceptrum.desktop
sed -n '1,80p' Perceptrum/out/build/linux-debug/perceptrum-desktop-launcher.sh
sed -n '1,80p' Perceptrum/out/build/linux-debug/perceptrum-agent-launcher.sh
```

```bash
file Perceptrum/out/build/linux-debug/perceptrum-desktop Perceptrum/out/build/linux-debug/perceptrum-agent
ldd Perceptrum/out/build/linux-debug/perceptrum-desktop
ldd Perceptrum/out/build/linux-debug/perceptrum-agent
```

```bash
dpkg-deb --info Perceptrum/out/package/perceptrum-desktop_1.0.0_amd64.deb
dpkg-deb --contents Perceptrum/out/package/perceptrum-desktop_1.0.0_amd64.deb | sed -n '1,220p'
```

## Busca de acoplamentos Windows

```bash
rg -n "#include <windows\\.h>|#include <Windows\\.h>|CreateProcessW|WinHttp|Shell_NotifyIcon|NOTIFYICON|SetCurrentProcessExplicitAppUserModelID|CryptProtectData|PowerShell|GetTcpTable|Pdh|TlHelp32|GetModuleFileNameW|WaitForSingleObject|CreateJobObject|SetEvent|OpenEventW|ShellExecuteW|WebView2|Microsoft::UI|Xaml" \
  AppHost Perceptrum/Perceptrum \
  -g '!**/out/**'
```

```bash
rg -n "__linux__|_WIN32|fork|execv|SIGTERM|SIGINT|SIGKILL|HOME|XDG_DATA_HOME|/proc/self/exe" \
  Perceptrum/Perceptrum AppHost DrakonSite \
  -g '!DrakonSite/node_modules/**' \
  -g '!DrakonSite/dist/**'
```

## Validacao TypeScript/frontend atual

```bash
cd DrakonSite
npm run lint
npm run test:semantic
npm run test:desktop-sqlite-encryption
npm run build
```

```bash
cd DrakonSite
npm run check
```

Nota: `npm run check` inclui `wrangler deploy --dry-run`; usar somente se credenciais/config Cloudflare estiverem adequadas.

## Validacao backend local desktop

Dev com TSX:

```bash
cd AppHost
PORT=4000 \
APP_BIND_HOST=127.0.0.1 \
APP_BASE_URL=http://127.0.0.1:4000 \
APP_ALLOWED_ORIGINS=http://127.0.0.1:4000 \
APP_RUNTIME_ENV=local \
ENV_PROFILE=local \
APP_STATIC_ROOT="$(pwd)/../DrakonSite/dist" \
APP_SERVICE_SESSION_DIR="$(pwd)/../.tmp/perceptrum-session" \
STORAGE_ROOT="$(pwd)/../.tmp/perceptrum-storage" \
APP_DB_BACKEND=sqlite \
APP_SQLITE_ENCRYPTION=off \
node ../DrakonSite/node_modules/tsx/dist/cli.mjs --tsconfig ../DrakonSite/tsconfig.worker.json Runtime/desktop-local-server.mjs
```

Em outro terminal:

```bash
curl -fsS http://127.0.0.1:4000/api/runtime/health | jq .
curl -fsS http://127.0.0.1:4000/ | head
```

Validacao com SQLite criptografado requer `APP_SQLITE_KEY_HEX` com 64 hex:

```bash
export APP_SQLITE_KEY_HEX="$(openssl rand -hex 32)"
cd AppHost
PORT=4001 \
APP_BIND_HOST=127.0.0.1 \
APP_BASE_URL=http://127.0.0.1:4001 \
APP_ALLOWED_ORIGINS=http://127.0.0.1:4001 \
APP_RUNTIME_ENV=local \
ENV_PROFILE=local \
APP_STATIC_ROOT="$(pwd)/../DrakonSite/dist" \
APP_SERVICE_SESSION_DIR="$(pwd)/../.tmp/perceptrum-session-encrypted" \
STORAGE_ROOT="$(pwd)/../.tmp/perceptrum-storage-encrypted" \
APP_DB_BACKEND=sqlite \
APP_SQLITE_ENCRYPTION=required \
APP_SQLITE_KEY_HEX="$APP_SQLITE_KEY_HEX" \
APP_SQLITE_KEY_VERSION=v1 \
APP_SQLITE_CIPHER=sqlcipher \
APP_SQLITE_LEGACY=4 \
node ../DrakonSite/node_modules/tsx/dist/cli.mjs --tsconfig ../DrakonSite/tsconfig.worker.json Runtime/desktop-local-server.mjs
```

## Validacao de conversao SQLite

```bash
cd DrakonSite
npm run db:sqlite:import-perceptrum -- --schema-only --out ../.tmp/perceptrum_site.seed.sqlite --report ../.tmp/perceptrum_site.seed.import-report.json --schema-out ../.tmp/perceptrum_site.seed.schema.sql
```

```bash
sqlite3 ../.tmp/perceptrum_site.seed.sqlite ".tables"
sqlite3 ../.tmp/perceptrum_site.seed.sqlite "select name from sqlite_master where type='table' order by name limit 40;"
```

## Validacao C++ Windows sem alterar codigo

Executar no Windows Developer PowerShell:

```powershell
msbuild .\Perceptrum\Perceptrum.sln /m /p:Configuration=Release /p:Platform=x64
```

```powershell
msbuild .\AppHost\AppHost.vcxproj /m /p:Configuration=Release /p:Platform=x64
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\AppHost\Packaging\build.ps1 -Brand perceptrum -Step Build -Configuration Release
```

## Validacao Linux proposta apos restaurar CMake

```bash
cmake -S Perceptrum -B Perceptrum/out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build Perceptrum/out/build/linux-debug --target perceptrum-agent perceptrum-desktop -j"$(nproc)"
```

```bash
ctest --test-dir Perceptrum/out/build/linux-debug --output-on-failure
```

```bash
cmake --build Perceptrum/out/build/linux-debug --target package
ls -lh Perceptrum/out/package/*.deb
```

## Validacao de pacote em VM Ubuntu

```bash
sudo apt update
sudo apt install -y ./Perceptrum/out/package/perceptrum-desktop_1.0.0_amd64.deb
which perceptrum-desktop
dpkg -L perceptrum-desktop | sed -n '1,220p'
```

```bash
systemctl --user status perceptrum-agent.service || true
systemctl status perceptrum-agent.service || true
journalctl --user -u perceptrum-agent.service -n 200 --no-pager || true
journalctl -u perceptrum-agent.service -n 200 --no-pager || true
```

```bash
perceptrum-desktop
```

Em outro terminal, apos descobrir a porta:

```bash
ss -ltnp | rg 'perceptrum|node|127.0.0.1'
curl -fsS http://127.0.0.1:<porta>/api/runtime/health | jq .
```

## Validacao de rede/cameras no Ubuntu

```bash
ip addr
ip route
ss -lunp | rg ':3702|perceptrum|node' || true
```

```bash
curl -fsS -X POST http://127.0.0.1:<porta>/api/runtime/camera-discovery \
  -H 'content-type: application/json' \
  -d '{"timeout_ms":5000}' | jq .
```

```bash
ffprobe -hide_banner -rtsp_transport tcp -i 'rtsp://USER:PASS@CAMERA_IP:554/STREAM' -v error -show_streams
ffmpeg -hide_banner -rtsp_transport tcp -i 'rtsp://USER:PASS@CAMERA_IP:554/STREAM' -frames:v 1 /tmp/perceptrum-test-frame.jpg
file /tmp/perceptrum-test-frame.jpg
```

## Validacao de seguranca de arquivos Linux

```bash
find "${XDG_DATA_HOME:-$HOME/.local/share}" -maxdepth 4 -iname '*perceptrum*' -print 2>/dev/null
find "${XDG_STATE_HOME:-$HOME/.local/state}" -maxdepth 4 -iname '*perceptrum*' -print 2>/dev/null
```

```bash
stat -c '%a %U:%G %n' ~/.local/share/PerceptrumData 2>/dev/null || true
find ~/.local/share/PerceptrumData -type f \( -name '*token*' -o -name '*key*' -o -name '*client*' \) -maxdepth 5 -exec stat -c '%a %U:%G %n' {} \; 2>/dev/null
```

```bash
rg -n "AQAAANCM|exe_token|APP_SQLITE_KEY_HEX|sqlite_key" ~/.local/share/PerceptrumData ~/.local/state/perceptrum 2>/dev/null || true
```

## Validacao uninstall em VM

```bash
sudo apt remove -y perceptrum-desktop
dpkg -l | rg perceptrum || true
systemctl --user status perceptrum-agent.service || true
systemctl status perceptrum-agent.service || true
```

```bash
sudo apt purge -y perceptrum-desktop
test -d /opt/perceptrum && echo "/opt/perceptrum ainda existe" || echo "/opt/perceptrum removido"
test -d /etc/perceptrum && echo "/etc/perceptrum ainda existe" || echo "/etc/perceptrum removido"
```

## Comandos de auditoria final dos relatórios

```bash
ls -la .archon/plans
for f in .archon/plans/anchor-*.md; do
  echo "== $f =="
  wc -l "$f"
  sed -n '1,24p' "$f"
done
```
