# RUNBOOK Linux - Perceptrum Desktop

Data: 2026-05-24

Este runbook cobre build, empacotamento, instalacao, execucao e remocao do pacote Linux local.

## Pre-requisitos

Ubuntu/Debian com:

```bash
sudo apt update
sudo apt install -y build-essential cmake ninja-build pkg-config libcurl4-openssl-dev libwebkit2gtk-4.1-dev nodejs npm ffmpeg xdg-utils libsecret-tools
```

O pacote gerado declara dependencias runtime:

```text
libcurl4, libgtk-3-0, libwebkit2gtk-4.1-0, ffmpeg, nodejs, xdg-utils, libsecret-tools
```

## Build local

Web:

```bash
cd DrakonSite
npm run build
```

C++ Debug:

```bash
cd Perceptrum
cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build out/build/linux-debug -j"$(nproc)"
ctest --test-dir out/build/linux-debug --output-on-failure
```

C++ Release e pacote:

```bash
cd Perceptrum
cmake -S . -B out/build/linux-release -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build out/build/linux-release -j"$(nproc)"
ctest --test-dir out/build/linux-release --output-on-failure
cmake --build out/build/linux-release --target package
```

Artefatos esperados:

```text
Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.tar.gz
```

## Validacao visual

```bash
cd DrakonSite
npm run visual:browser
npm run visual:linux
```

Artefatos:

```text
DrakonSite/visual-artifacts/
```

## Execucao sem instalar

Build Debug com WebKitGTK:

```bash
cd Perceptrum
APP_STATIC_ROOT="$PWD/../DrakonSite/dist" \
PERCEPTRUM_BACKEND_COMMAND="$PWD/out/build/linux-debug/linux-backend-runtime/perceptrum-local-backend.sh" \
out/build/linux-debug/perceptrum-desktop --webkit
```

Smoke sem abrir janela:

```bash
cd Perceptrum
APP_STATIC_ROOT="$PWD/../DrakonSite/dist" \
PERCEPTRUM_BACKEND_COMMAND="$PWD/out/build/linux-release/linux-backend-runtime/perceptrum-local-backend.sh" \
out/build/linux-release/perceptrum-desktop --check-backend --print-web-root --no-open
```

O smoke deve mostrar:

```text
launchUrl=http://127.0.0.1:4000/dashboard
backendStatus=started
webkitgtkCompiled=true
```

## Instalar o pacote

Inspecione antes de instalar:

```bash
cd Perceptrum
dpkg-deb --info out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
dpkg-deb --contents out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb | less
dpkg --dry-run -i out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
```

Instale:

```bash
sudo apt install ./out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
```

Se `apt` pedir dependencias, instale apenas em ambiente aprovado para alteracoes globais.

## Executar instalado

Pelo terminal:

```bash
perceptrum-desktop
```

Forcar WebKitGTK:

```bash
perceptrum-desktop --webkit
```

Forcar navegador externo:

```bash
PERCEPTRUM_LINUX_WINDOW_MODE=browser perceptrum-desktop
```

Pelo launcher desktop:

```bash
gtk-launch perceptrum
```

O launcher instalado usa:

```text
/usr/bin/perceptrum-desktop-launcher.sh
/usr/share/applications/perceptrum.desktop
/usr/share/perceptrum-desktop/web
/usr/share/perceptrum-desktop/backend/perceptrum-local-backend.sh
```

## Validar health

Depois de abrir o app, descubra a porta se necessario:

```bash
ss -ltnp | rg 'perceptrum|node|127.0.0.1'
```

Valide:

```bash
curl -fsS http://127.0.0.1:4000/__perceptrum/health
curl -fsS http://127.0.0.1:4000/api/runtime/health
curl -fsSI http://127.0.0.1:4000/dashboard
```

## Validar agente

```bash
perceptrum-agent version
perceptrum-agent status
perceptrum-agent healthcheck
```

Pareamento/provisionamento manual:

```bash
perceptrum-agent pair --base-url http://127.0.0.1:4000 --pair-code <PAIR_CODE>
perceptrum-agent provision --base-url http://127.0.0.1:4000 --exe-token <TOKEN> --client-id <CLIENT_ID>
```

Nao cole tokens em tickets, logs ou documentos.

## Validar camera discovery

```bash
curl -fsS -X POST http://127.0.0.1:4000/api/runtime/camera-discovery \
  -H 'content-type: application/json' \
  -d '{"timeoutMs":5000}'
```

Uma resposta com `devices: []` e `summary` valido significa que o discovery executou, mas nao achou cameras na rede atual.

## Validar RTSP/thumbnail

Com uma camera real:

```bash
ffprobe -hide_banner -rtsp_transport tcp -i 'rtsp://USER:PASS@CAMERA_IP:554/STREAM' -v error -show_streams
ffmpeg -hide_banner -rtsp_transport tcp -i 'rtsp://USER:PASS@CAMERA_IP:554/STREAM' -frames:v 1 /tmp/perceptrum-test-frame.jpg
file /tmp/perceptrum-test-frame.jpg
```

Para o agente Linux com gates ativados, configure `agent_config.json` ou variaveis como `APP_AGENT_RTSP_URL` conforme o ambiente de teste.

## Logs e dados locais

Raizes XDG padrao:

```text
${XDG_DATA_HOME:-$HOME/.local/share}
${XDG_CONFIG_HOME:-$HOME/.config}
${XDG_CACHE_HOME:-$HOME/.cache}
${XDG_STATE_HOME:-$HOME/.local/state}
```

Buscar artefatos:

```bash
find "${XDG_DATA_HOME:-$HOME/.local/share}" -maxdepth 4 -iname '*perceptrum*' -print 2>/dev/null
find "${XDG_CONFIG_HOME:-$HOME/.config}" -maxdepth 4 -iname '*perceptrum*' -print 2>/dev/null
find "${XDG_CACHE_HOME:-$HOME/.cache}" -maxdepth 4 -iname '*perceptrum*' -print 2>/dev/null
find "${XDG_STATE_HOME:-$HOME/.local/state}" -maxdepth 4 -iname '*perceptrum*' -print 2>/dev/null
```

## Remover

Remover binarios e arquivos do pacote, mantendo configuracao/dados de usuario:

```bash
sudo apt remove perceptrum-desktop
```

Remover pacote e configuracao gerenciada pelo pacote:

```bash
sudo apt purge perceptrum-desktop
```

Remover dependencias que ficaram sem uso:

```bash
sudo apt autoremove
```

## Limpar dados de usuario

Somente execute depois de confirmar que os dados podem ser apagados:

```bash
rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/perceptrum"
rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/perceptrum"
rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/perceptrum"
rm -rf "${XDG_STATE_HOME:-$HOME/.local/state}/perceptrum"
```

Antes de apagar, faca backup se houver dados de operacao, historico, cameras ou credenciais que devam ser preservados.

