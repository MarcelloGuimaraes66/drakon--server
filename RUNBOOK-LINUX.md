# RUNBOOK Linux - Perceptrum Desktop

Data: 2026-05-30

Este runbook cobre build, empacotamento, instalacao, execucao e remocao do pacote Linux local.

## Escopo por plataforma

- Linux: usa `Perceptrum/CMakeLists.txt`, `perceptrum-desktop`, `perceptrum-agent`, WebKitGTK/`xdg-open` e raizes XDG. Nao depende de WinUI, WebView2, Inno Setup, SignTool ou scripts PowerShell de packaging Windows.
- Windows: usa `AppHost` com WinUI 3, WebView2, Windows App Runtime, MSBuild e Inno Setup. O packaging Windows grava somente em `AppHost/artifacts`, `AppHost/stage` e `AppHost/dist` dentro do checkout; nao substitui assets Linux nem caminhos XDG.
- macOS: nao ha host nativo/packaging macOS neste repositorio. A validacao macOS fica limitada ao build web compartilhado ate existir um host proprio.

## Windows AppHost e packaging

Execute estes comandos em uma maquina Windows com Visual Studio Build Tools, Windows SDK Signing Tools, Node/npm, Inno Setup 6, prereq do Windows App Runtime e dependencias nativas configuradas:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\AppHost\Packaging\build.ps1 -Brand perceptrum -Configuration Release -Step Build
```

O AppHost compila o shell WinUI/WebView2 e estagia o runtime em `AppHost/artifacts/<brand>/<configuration>/stage`. O WebView2 e resolvido pelo projeto `AppHost/AppHost.vcxproj` via pacote Microsoft.Web.WebView2; a validacao visual Windows usa:

```powershell
cd .\DrakonSite
$env:VISUAL_WINDOWS_WEBVIEW2_URL = "http://127.0.0.1:4000"
npm run visual:windows
```

Para gerar o installer Inno depois de assinar o payload, rode:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\AppHost\Packaging\build.ps1 -Brand perceptrum -Configuration Release -Step Package -WindowsAppRuntimeInstallerPath C:\path\WindowsAppRuntimeInstall-x64.exe
```

Assinatura Windows depende de credenciais externas e nao deve ser comitada no repositorio. Use um certificado instalado no store, ou um PFX fora do checkout com senha em variavel de ambiente:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\AppHost\Packaging\sign-windows-artifacts.ps1 -Brand perceptrum -Configuration Release -Target Payload -CertificateThumbprint <thumbprint> -TimestampUrl <rfc3161-url>
powershell -NoProfile -ExecutionPolicy Bypass -File .\AppHost\Packaging\sign-windows-artifacts.ps1 -Brand perceptrum -Configuration Release -Target Installer -CertificateThumbprint <thumbprint> -TimestampUrl <rfc3161-url>
```

Alternativa com PFX:

```powershell
$env:PERCEPTRUM_SIGNING_PFX_PASSWORD = "<password>"
powershell -NoProfile -ExecutionPolicy Bypass -File .\AppHost\Packaging\sign-windows-artifacts.ps1 -Brand perceptrum -Configuration Release -Target All -PfxPath C:\secure\codesign.pfx -PfxPasswordEnvVar PERCEPTRUM_SIGNING_PFX_PASSWORD -TimestampUrl <rfc3161-url>
Remove-Item Env:\PERCEPTRUM_SIGNING_PFX_PASSWORD
```

## Pre-requisitos

Ubuntu/Debian com:

```bash
sudo apt update
sudo apt install -y build-essential cmake ninja-build pkg-config libcurl4-openssl-dev libwebkit2gtk-4.1-dev nodejs npm ffmpeg xdg-utils libsecret-tools dbus-user-session
```

O pacote gerado declara dependencias runtime:

```text
libcurl4, ffmpeg, nodejs, xdg-utils, libsecret-tools, dbus-user-session
```

Quando o binario foi compilado com WebKitGTK, o `.deb` tambem declara:

```text
libgtk-3-0, libwebkit2gtk-4.1-0
```

O pacote recomenda um provedor Secret Service como `gnome-keyring` ou `kwalletmanager`. Em ambiente desktop comum isso ja costuma estar ativo; em headless/CI pode nao haver cofre de usuario desbloqueado.

## Build local

Web:

```bash
cd DrakonSite
npm run build
```

C++ Debug:

```bash
cd Perceptrum
cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug \
  -DPERCEPTRUM_ENABLE_AGENT_CORE=ON \
  -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON \
  -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON \
  -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON \
  -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON
cmake --build out/build/linux-debug -j"$(nproc)"
ctest --test-dir out/build/linux-debug --output-on-failure
```

C++ Release e pacote:

```bash
cd Perceptrum
cmake -S . -B out/build/linux-release -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DPERCEPTRUM_ENABLE_AGENT_CORE=ON \
  -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON \
  -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON \
  -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON \
  -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON
cmake --build out/build/linux-release -j"$(nproc)"
ctest --test-dir out/build/linux-release --output-on-failure
cpack --config out/build/linux-release/CPackConfig.cmake
```

Artefatos esperados:

```text
Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.tar.gz
```

## Release final validado em 2026-05-30

Artefatos gerados nesta validacao local:

```text
Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
sha256: 251b9c0d68cfe12f4a0fd4fd4f604007f9bcc79e6a27722e53de1be36c4adbbb

Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.tar.gz
sha256: b76de42a54cdeac7372d44c13e7112887595658eead0bcd34bce868ba65c45f3
```

Conteudo validado no pacote:

```text
/usr/bin/perceptrum-desktop
/usr/bin/perceptrum-agent
/usr/bin/perceptrum-desktop-launcher.sh
/usr/share/perceptrum-desktop/backend/perceptrum-local-backend.sh
/usr/share/perceptrum-desktop/backend/desktop-local-server.cjs
/usr/share/perceptrum-desktop/backend/bootstrap/perceptrum_site.seed.sqlite
/usr/share/perceptrum-desktop/web/index.html
/usr/share/perceptrum-desktop/web/assets/
/usr/share/applications/perceptrum.desktop
```

Evidencias reais desta validacao Ubuntu:

```text
web build: npm run build passou
Debug CTest: 61/61 testes passaram; linux_job_runtime_real_provider_openai_manual ficou Disabled
Release CTest: 61/61 testes passaram; linux_job_runtime_real_provider_openai_manual ficou Disabled
webcam direta: /tmp/perceptrum-final-webcam.jpg, JPEG 1920x1080, 131808 bytes
agente residente via launcher: run-linux-dev.sh reportou backendStatus=started e agentStatus=started
webcam via agente: thumbnail 42-latest.jpg gerado e clips 10s/60s/300s gravados em cam_42
RTSP real: depende de URL RTSP real configurada; nao havia APP_AGENT_RTSP_URL/RTSP_URL/PERCEPTRUM_RTSP_URL
LLM real: depende de credencial; OPENAI_API_KEY/ZAI_API_KEY ausentes e secret-tool nao instalado neste ambiente
```

Comando final para rodar em dev:

```bash
APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 ./Perceptrum/linux-desktop/run-linux-dev.sh
```

Comando final para testar sem abrir janela:

```bash
./Perceptrum/linux-desktop/run-linux-dev.sh --check-backend --print-web-root --no-open
```

Comando final para instalar e rodar o pacote:

```bash
cd Perceptrum
sudo apt install ./out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
perceptrum-desktop --check-backend --print-web-root --no-open
perceptrum-desktop
```

Comando final para diagnostico rapido de camera depois de abrir o app:

```bash
curl -fsS http://127.0.0.1:4000/api/runtime/agent-health
find "${XDG_CACHE_HOME:-$HOME/.cache}/Perceptrum/agentcore/camera-thumbnails" -type f -name '*-latest.jpg' -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' 2>/dev/null | sort | tail -20
find "${XDG_DATA_HOME:-$HOME/.local/share}/PerceptrumData/frames" -type f -name '*.mp4' -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' 2>/dev/null | sort | tail -20
tail -160 "${XDG_STATE_HOME:-$HOME/.local/state}/Perceptrum/logs/perceptrum-agent.log"
```

## Validacao final local

Use esta sequencia antes de entregar um pacote para teste no desktop Ubuntu:

```bash
git status --short --branch
cd DrakonSite
npm run test:platform-boundaries
npm run test:local-sqlite-bootstrap
npm run test:linux-camera-start-contract
npm run test:desktop-sqlite-encryption
npm run test:semantic
npm run build
npm run visual:linux
cd ../Perceptrum
cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug \
  -DPERCEPTRUM_ENABLE_AGENT_CORE=ON \
  -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON \
  -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON \
  -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON \
  -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON
cmake --build out/build/linux-debug -j"$(nproc)"
ctest --test-dir out/build/linux-debug --output-on-failure
cmake -S . -B out/build/linux-release -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DPERCEPTRUM_ENABLE_AGENT_CORE=ON \
  -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON \
  -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON \
  -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON \
  -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON
cmake --build out/build/linux-release -j"$(nproc)"
ctest --test-dir out/build/linux-release --output-on-failure
cpack --config out/build/linux-release/CPackConfig.cmake
./../Perceptrum/linux-desktop/run-linux-dev.sh --check-backend --print-web-root --no-open
```

Para validar o binario release sem instalar:

```bash
cd Perceptrum
APP_STATIC_ROOT="$PWD/../DrakonSite/dist" \
PERCEPTRUM_BACKEND_COMMAND="$PWD/out/build/linux-release/linux-backend-runtime/perceptrum-local-backend.sh" \
out/build/linux-release/perceptrum-desktop --check-backend --print-web-root --no-open
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

Dev launcher, sem abrir janela:

```bash
./Perceptrum/linux-desktop/run-linux-dev.sh --check-backend --print-web-root --no-open
```

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
dpkg-deb --contents out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb | grep -E 'perceptrum-(desktop|agent)|perceptrum-local-backend|index.html'
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
perceptrum-agent check-deps
perceptrum-agent status
perceptrum-agent healthcheck
```

Pareamento/provisionamento manual:

```bash
perceptrum-agent pair --base-url http://127.0.0.1:4000 --pair-code <PAIR_CODE>
perceptrum-agent provision --base-url http://127.0.0.1:4000 --exe-token <TOKEN> --client-id <CLIENT_ID>
```

Nao cole tokens em tickets, logs ou documentos.

## Secure store

Em Linux, tokens do agente sao gravados via Secret Service usando `secret-tool` quando disponivel. O caminho de recuperacao em arquivo plaintext fica desabilitado por padrao e nao deve ser usado em producao.

Confirme que o Secret Service esta disponivel:

```bash
command -v secret-tool
dbus-run-session -- sh -lc 'secret-tool --help >/dev/null'
```

Depois de provisionar ou parear o agente, uma busca sem imprimir segredo pode ser feita pelo atributo usado pelo runtime. Ajuste o path se `APP_RUNTIME_CONFIG_ROOT` estiver definido:

```bash
secret-tool search application perceptrum path "$HOME/.config/Perceptrum/secrets/exe_token.txt"
```

Para remover o token do cofre do usuario atual:

```bash
secret-tool clear application perceptrum path "$HOME/.config/Perceptrum/secrets/exe_token.txt"
```

Fallback permitido apenas para dev/CI isolado:

```bash
APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 perceptrum-agent provision --base-url http://127.0.0.1:4000 --exe-token <TOKEN> --client-id <CLIENT_ID>
```

Nesse modo, o token fica em `${XDG_CONFIG_HOME:-$HOME/.config}/perceptrum/secrets/exe_token.txt` com permissao `0600`. Remova o arquivo depois do teste:

```bash
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/perceptrum/secrets/exe_token.txt"
```

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

O Linux tenta candidatos RTSP nesta ordem:

- `rtsp_url`, `rtspUrl`, `stream_url` ou `streamUrl` direto, aceitando multiplos candidatos separados por `|`.
- Hikvision: `rtsp://USER:PASS@HOST:PORT/Streaming/Channels/101`, com `channel` substituindo o numero final quando informado.
- Dahua: `rtsp://USER:PASS@HOST:PORT/cam/realmonitor?channel=1&subtype=0` e depois `subtype=1`.
- Intelbras: os formatos Dahua, variante `unicast=true&proto=Onvif` e legado `rtsp://HOST:PORT/user=USER&password=PASS&channel=1&stream=0.sdp?`.
- Axis: `rtsp://USER:PASS@HOST:PORT/axis-media/media.amp` e `?camera=1`.
- Generico: `rtsp://USER:PASS@HOST:PORT/Streaming/Channels/101` ou sem credenciais quando usuario/senha nao foram informados.

Logs, health e eventos devem mostrar somente URLs mascaradas, por exemplo `rtsp://***:***@192.168.1.50:554/Streaming/Channels/101`.

Build com gates de camera, frame writer e jobs:

```bash
cd Perceptrum
cmake -S . -B out/build/linux-acceptance -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DPERCEPTRUM_ENABLE_AGENT_CORE=ON \
  -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON \
  -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON \
  -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON \
  -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON
cmake --build out/build/linux-acceptance -j"$(nproc)"
```

Teste manual com RTSP real:

```bash
cd Perceptrum
APP_AGENT_RTSP_URL='rtsp://USER:PASS@CAMERA_IP:554/STREAM' \
APP_AGENT_CAMERA_ID='101' \
APP_AGENT_CAMERA_NAME='Camera RTSP Linux' \
APP_AGENT_RECORDING_PROFILES='10,60,300' \
APP_AGENT_RECORDING_CAPTURE_SECONDS=3 \
PERCEPTRUM_ENABLE_CAMERA_CAPTURE=1 \
PERCEPTRUM_ENABLE_RTSP_CAPTURE=1 \
PERCEPTRUM_ENABLE_FRAME_WRITER=1 \
out/build/linux-acceptance/perceptrum-agent run
```

Teste manual montando candidatos a partir dos campos da camera:

```bash
cd Perceptrum
mkdir -p /tmp/perceptrum-rtsp-config
cat > /tmp/perceptrum-rtsp-config/agent_config.json <<'JSON'
{
  "linux_rtsp_camera": {
    "camera_id": "101",
    "name": "Camera RTSP Linux",
    "connection_method": "RTSP",
    "ip": "CAMERA_IP",
    "rtsp_port": "554",
    "manufacturer": "Hikvision",
    "username": "USER",
    "password": "PASS",
    "channel": "101"
  }
}
JSON
APP_RUNTIME_CONFIG_ROOT=/tmp/perceptrum-rtsp-config \
APP_AGENT_RECORDING_PROFILES='10,60,300' \
APP_AGENT_RECORDING_CAPTURE_SECONDS=3 \
PERCEPTRUM_ENABLE_CAMERA_CAPTURE=1 \
PERCEPTRUM_ENABLE_RTSP_CAPTURE=1 \
PERCEPTRUM_ENABLE_FRAME_WRITER=1 \
out/build/linux-acceptance/perceptrum-agent run
```

Sem `APP_AGENT_RECORDING_CAPTURE_SECONDS`, o teste real usa as duracoes configuradas nos perfis. Nao declare camera real validada se este teste nao foi executado contra uma camera acessivel.

Se a camera RTSP nao estiver disponivel ou nao houver URL configurada, registre explicitamente:

```text
Dependencia ausente: URL RTSP real acessivel.
```

Para diagnosticar `reconnecting`, veja `reconnecting_by_camera`, `next_retry_delay_seconds_by_camera` e `reconnect_attempts_by_camera` em:

```bash
curl -fsS http://127.0.0.1:4000/api/runtime/agent-health
cat "${XDG_DATA_HOME:-$HOME/.local/share}/PerceptrumData/agent_health.json"
tail -160 "${XDG_STATE_HOME:-$HOME/.local/state}/Perceptrum/logs/perceptrum-agent.log"
```

## Validar webcam local no Ubuntu

O usuario que executa o desktop precisa conseguir ler `/dev/videoN`. Se `id` nao mostrar o grupo `video`, adicione o usuario e entre novamente na sessao grafica:

```bash
sudo usermod -aG video "$USER"
id
```

Teste a webcam fora do Perceptrum:

```bash
ls -l /dev/video*
ffmpeg -hide_banner -f v4l2 -list_formats all -i /dev/video0
ffmpeg -y -hide_banner -f v4l2 -framerate 15 -i /dev/video0 -frames:v 1 /tmp/perceptrum-webcam-test.jpg
file /tmp/perceptrum-webcam-test.jpg
```

O app Linux traduz cameras `WEBCAM` com `webcam_index=0` para `/dev/video0`. O host desktop inicia o `perceptrum-agent run` residente com camera, frame writer e job runtime habilitados. Ao clicar Start na UI, devem aparecer arquivos em:

```bash
find "${XDG_CACHE_HOME:-$HOME/.cache}/Perceptrum/agentcore/camera-thumbnails" -type f -print 2>/dev/null
find "${XDG_DATA_HOME:-$HOME/.local/share}/PerceptrumData/frames" -type f -print 2>/dev/null
tail -80 "${XDG_STATE_HOME:-$HOME/.local/state}/Perceptrum/logs/perceptrum-agent.log"
```

Para teste manual direto do agente com webcam:

```bash
cd Perceptrum
APP_AGENT_WEBCAM_INDEX=0 \
APP_AGENT_CAMERA_ID='20' \
APP_AGENT_CAMERA_NAME='Webcam Ubuntu' \
APP_AGENT_RECORDING_PROFILES='10,60,300' \
APP_AGENT_RECORDING_CAPTURE_SECONDS=3 \
PERCEPTRUM_ENABLE_AGENT_CORE=1 \
PERCEPTRUM_ENABLE_CAMERA_CAPTURE=1 \
PERCEPTRUM_ENABLE_RTSP_CAPTURE=1 \
PERCEPTRUM_ENABLE_FRAME_WRITER=1 \
PERCEPTRUM_ENABLE_JOB_RUNTIME=1 \
out/build/linux-release/perceptrum-agent run
```

Para uma validacao curta sem UI, com timeout externo:

```bash
cd Perceptrum
timeout 30s env \
  APP_AGENT_WEBCAM_INDEX=0 \
  APP_AGENT_CAMERA_ID='42' \
  APP_AGENT_CAMERA_NAME='Webcam Ubuntu' \
  APP_AGENT_RECORDING_PROFILES='10,60,300' \
  APP_AGENT_RECORDING_CAPTURE_SECONDS=3 \
  PERCEPTRUM_ENABLE_AGENT_CORE=1 \
  PERCEPTRUM_ENABLE_CAMERA_CAPTURE=1 \
  PERCEPTRUM_ENABLE_RTSP_CAPTURE=1 \
  PERCEPTRUM_ENABLE_FRAME_WRITER=1 \
  PERCEPTRUM_ENABLE_JOB_RUNTIME=1 \
  out/build/linux-release/perceptrum-agent run
```

## Configurar OpenAI/Z.ai

O runtime Linux de jobs usa OpenAI quando `OPENAI_API_KEY` esta no ambiente ou quando a chave veio do payload/settings do usuario. Para OpenAI real:

```bash
export PERCEPTRUM_LINUX_LLM_PROVIDER=openai
export OPENAI_API_KEY='<OPENAI_API_KEY>'
```

Para Z.ai real:

```bash
export PERCEPTRUM_LINUX_LLM_PROVIDER=zai
export ZAI_API_KEY='<ZAI_API_KEY>'
```

Tambem e possivel configurar chaves pela UI quando o backend local ja estiver rodando; a chave segue no payload do `job_start` e o agente nao deve registra-la em log. Use `PERCEPTRUM_LINUX_LLM_PROVIDER=fake` somente para testes locais/CI sem credito de LLM. Quando `PERCEPTRUM_LINUX_LLM_PROVIDER=openai` esta definido sem chave, o resultado esperado e falha controlada `missing_openai_api_key`.

Nao cole chaves em comandos compartilhados, tickets ou relatorios. Nao declare LLM real validado se o teste foi executado apenas com provider fake/local ou sem chave real.

Quando nao houver chave configurada, registre explicitamente:

```text
Dependencia ausente: OPENAI_API_KEY ou ZAI_API_KEY real, ou chave equivalente enviada pelo payload/settings.
```

No Linux, confirme a presenca sem imprimir o valor:

```bash
node -e "console.log({ OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY), ZAI_API_KEY: Boolean(process.env.ZAI_API_KEY) })"
command -v secret-tool >/dev/null && echo "secret-tool presente" || echo "secret-tool ausente"
find "${XDG_CONFIG_HOME:-$HOME/.config}/Perceptrum" -maxdepth 3 -type f -printf '%p\n' 2>/dev/null
```

## Perguntar para a camera

Fluxo esperado no desktop Linux:

1. Inicie o app pelo launcher Linux e confirme que o agente esta pollando:

```bash
./Perceptrum/linux-desktop/run-linux-dev.sh
curl -fsS http://127.0.0.1:4000/api/runtime/agent-health
```

2. Inicie uma camera `WEBCAM` ou `RTSP` pela UI. O agente captura um thumbnail real e mantem uma sessao residente gravando segmentos.

3. Configure OpenAI ou Z.ai como acima, ou configure a chave pela UI.

4. Dispare a pergunta/job pela UI. O `job_start` no Linux localiza o ultimo thumbnail real e os ultimos clips `10s`, `60s` e `300s` disponiveis em disco. A chamada LLM real usa o thumbnail recente como imagem de entrada e inclui os caminhos/metadados dos clips no contexto. O provider fake retorna somente resultado local e nao chama rede.

5. Veja o resultado persistido pelo backend em eventos/resultados operacionais:

```bash
sqlite3 "$HOME/.local/share/PerceptrumData/storage/sqlite/local-site/perceptrum_site.sqlite" \
  "SELECT event_type, created_at, substr(details_json,1,300) FROM events WHERE event_type IN ('job_agent_completed','job_alert_triggered','camera_agent_result') ORDER BY id DESC LIMIT 5;"
```

Nao imprima API keys nem payloads com `frame_jpeg_base64`/`video_mp4_base64` em logs compartilhados.

## Diagnostico rapido

Backend e portas:

```bash
ss -ltnp | rg 'perceptrum|node|127.0.0.1'
curl -fsS http://127.0.0.1:4000/__perceptrum/health
curl -fsS http://127.0.0.1:4000/api/runtime/health
curl -fsS http://127.0.0.1:4000/api/runtime/agent-health
curl -fsSI http://127.0.0.1:4000/dashboard
```

Ambiente efetivo do backend em `:4000`:

```bash
pid="$(lsof -tiTCP:4000 -sTCP:LISTEN | head -1)"
tr '\0' '\n' < "/proc/$pid/environ" | rg '^(SQLITE_DB_PATH|STORAGE_ROOT|APP_RUNTIME_DATA_ROOT|APP_RUNTIME_CONFIG_ROOT|APP_RUNTIME_CACHE_ROOT|APP_RUNTIME_STATE_ROOT|APP_RUNTIME_LOG_ROOT|APP_BASE_URL|PORT)='
readlink -f "/proc/$pid/cwd"
ls -l "/proc/$pid/fd" | rg 'perceptrum_site.sqlite|PerceptrumData'
```

Agente:

```bash
perceptrum-agent check-deps
perceptrum-agent status
perceptrum-agent healthcheck
curl -fsS http://127.0.0.1:4000/api/runtime/agent-health
journalctl --user -xe | rg -i 'perceptrum|secret|dbus|webkit|ffmpeg'
```

Se a UI ficar em `reconnecting` ou nao sair de Offline, valide nesta ordem:

```bash
curl -fsS http://127.0.0.1:4000/api/runtime/agent-health | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s); console.log(JSON.stringify({ok:j.ok, agent:j.agent, commands:j.commands}, null, 2));})"
pgrep -a -f 'perceptrum-agent|perceptrum-desktop|desktop-local-server|ffmpeg'
tail -160 "${XDG_STATE_HOME:-$HOME/.local/state}/Perceptrum/logs/perceptrum-agent.log"
tail -160 "${XDG_STATE_HOME:-$HOME/.local/state}/Perceptrum/logs/perceptrum-desktop.log"
```

Interprete o resultado assim:

- `agent.stale=true`, `agent.status` ausente ou `linux_agent_not_running`: o agente residente nao esta pollando comandos; reinicie o app pelo launcher Linux.
- `commands.pending` crescendo e `commands.completed` parado: ha desalinhamento de sessao/pairing ou agente parado.
- `webcam_device_not_found`: confirme `/dev/videoN`, `webcam_index` e `APP_AGENT_WEBCAM_DEVICE`.
- `webcam_permission_denied`: confirme grupo `video`/ACL e faca logout/login apos `sudo usermod -aG video "$USER"`.
- `webcam_frame_timeout` ou `rtsp_frame_timeout`: teste a fonte diretamente com `ffmpeg`/`ffprobe`.
- `reconnecting_by_camera` ou `next_retry_delay_seconds_by_camera` no health: a sessao RTSP esta tentando reconectar; valide rede, credenciais, path RTSP e disponibilidade da camera.

Confirmar comandos pendentes sem imprimir token:

```bash
CLIENT_ID="$(node -e "const fs=require('fs'),p=process.env.APP_RUNTIME_CONFIG_ROOT||process.env.HOME+'/.config/Perceptrum';const j=JSON.parse(fs.readFileSync(p+'/agent_config.json','utf8'));process.stdout.write(j.client_id||'')")"
TOKEN="$(secret-tool lookup app perceptrum key exe_token 2>/dev/null || true)"
curl -fsS "http://127.0.0.1:4000/api/agent/commands?client_id=$CLIENT_ID" \
  -H "Authorization: Bearer $TOKEN" | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const a=JSON.parse(s||'[]'); console.log(JSON.stringify(a.map(c=>({id:c.id,command_type:c.command_type,status:c.status,camera_id:c.camera_id})), null, 2));})"
unset TOKEN
```

Pacote:

```bash
cd Perceptrum
dpkg-deb --info out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
dpkg-deb --contents out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb | rg 'perceptrum-(desktop|agent)|perceptrum-local-backend|index.html'
```

## Logs e dados locais

Raizes XDG padrao:

```text
${XDG_DATA_HOME:-$HOME/.local/share}
${XDG_CONFIG_HOME:-$HOME/.config}
${XDG_CACHE_HOME:-$HOME/.cache}
${XDG_STATE_HOME:-$HOME/.local/state}
```

Locais principais no runtime Linux padrao:

```text
logs: ${XDG_STATE_HOME:-$HOME/.local/state}/Perceptrum/logs/perceptrum-agent.log
health: ${XDG_DATA_HOME:-$HOME/.local/share}/PerceptrumData/agent_health.json
agent config: ${XDG_CONFIG_HOME:-$HOME/.config}/Perceptrum/agent_config.json
secret path attribute: ${XDG_CONFIG_HOME:-$HOME/.config}/Perceptrum/secrets/exe_token.txt
thumbnails: ${XDG_CACHE_HOME:-$HOME/.cache}/Perceptrum/agentcore/camera-thumbnails/
clips: ${XDG_DATA_HOME:-$HOME/.local/share}/PerceptrumData/frames/cam_<cameraId>/YYYY/MM/DD/
events: ${XDG_STATE_HOME:-$HOME/.local/state}/Perceptrum/events/agent_events.jsonl
inference temp: ${XDG_CACHE_HOME:-$HOME/.cache}/Perceptrum/agentcore/inference-temp/
jobs inference temp: ${XDG_CACHE_HOME:-$HOME/.cache}/Perceptrum/agentcore/jobs-inference-temp/
visual reports: DrakonSite/visual-artifacts/
ctest logs: Perceptrum/out/build/<build-name>/Testing/Temporary/LastTest.log
package: Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
```

Para inspecionar artefatos recentes de camera sem expor imagens inline:

```bash
find "${XDG_CACHE_HOME:-$HOME/.cache}/Perceptrum/agentcore/camera-thumbnails" -type f -name '*-latest.jpg' -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' 2>/dev/null | sort | tail -20
find "${XDG_DATA_HOME:-$HOME/.local/share}/PerceptrumData/frames" -type f -name '*.mp4' -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' 2>/dev/null | sort | tail -20
find "${XDG_CACHE_HOME:-$HOME/.cache}/Perceptrum/agentcore/jobs-inference-temp" -type f -name 'job_*_command_*.json' -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' 2>/dev/null | sort | tail -20
```

O launcher Linux define `STORAGE_ROOT` como `${XDG_DATA_HOME:-$HOME/.local/share}/PerceptrumData` e passa `SQLITE_DB_PATH` absoluto para o backend. O caminho esperado no runtime desktop e:

```text
database: ${XDG_DATA_HOME:-$HOME/.local/share}/PerceptrumData/storage/sqlite/local-site/perceptrum_site.sqlite
local R2/media: ${XDG_DATA_HOME:-$HOME/.local/share}/PerceptrumData/r2/
desktop session: ${XDG_DATA_HOME:-$HOME/.local/share}/PerceptrumData/desktop-session/
```

Para tornar o local do banco deterministico em teste manual:

```bash
export APP_RUNTIME_DATA_ROOT="$HOME/.local/share/PerceptrumData"
export STORAGE_ROOT="$APP_RUNTIME_DATA_ROOT"
export SQLITE_DB_PATH="$STORAGE_ROOT/storage/sqlite/local-site/perceptrum_site.sqlite"
```

Buscar artefatos:

```bash
find "${XDG_DATA_HOME:-$HOME/.local/share}" -maxdepth 4 -iname '*perceptrum*' -print 2>/dev/null
find "${XDG_CONFIG_HOME:-$HOME/.config}" -maxdepth 4 -iname '*perceptrum*' -print 2>/dev/null
find "${XDG_CACHE_HOME:-$HOME/.cache}" -maxdepth 4 -iname '*perceptrum*' -print 2>/dev/null
find "${XDG_STATE_HOME:-$HOME/.local/state}" -maxdepth 4 -iname '*perceptrum*' -print 2>/dev/null
```

Os logs e snapshots de health nao devem conter API keys, exe-token, credenciais RTSP, cookies, grants, workspace/relay tokens ou segredos OAuth. Em caso de bug, colete somente trechos ja redigidos.

## Comandos finais para o usuario Ubuntu

Teste rapido sem instalar:

```bash
git status --short --branch
cd DrakonSite && npm run build && npm run visual:linux
cd ../Perceptrum && cmake -S . -B out/build/linux-release -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DPERCEPTRUM_ENABLE_AGENT_CORE=ON \
  -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON \
  -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON \
  -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON \
  -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON
cmake --build out/build/linux-release -j"$(nproc)"
ctest --test-dir out/build/linux-release --output-on-failure
cpack --config out/build/linux-release/CPackConfig.cmake
APP_STATIC_ROOT="$PWD/../DrakonSite/dist" \
PERCEPTRUM_BACKEND_COMMAND="$PWD/out/build/linux-release/linux-backend-runtime/perceptrum-local-backend.sh" \
out/build/linux-release/perceptrum-desktop --check-backend --print-web-root --no-open
```

Teste instalando o `.deb`:

```bash
cd Perceptrum
sudo apt install ./out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
perceptrum-desktop --check-backend --print-web-root --no-open
perceptrum-desktop
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

Remover dados locais do usuario atual depois de purge, quando desejado:

```bash
rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/perceptrum"
rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/perceptrum"
rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/perceptrum"
rm -rf "${XDG_STATE_HOME:-$HOME/.local/state}/perceptrum"
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
