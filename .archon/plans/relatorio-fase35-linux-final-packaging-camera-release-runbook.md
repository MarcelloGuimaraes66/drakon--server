# Relatorio fase 35 - Linux final packaging camera release runbook

Data: 2026-05-27 08:32 America/Manaus
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Branch local: `archon/linux-port-origin-main-sync`
Executor: Codex/gpt-5.5
Commit/push: nao realizado

## Objetivo

Fechar o build Linux testavel com webcam/RTSP, agente residente, gravacao, inferencia, pacote `.deb`/`.tar.gz` e runbook final, sem declarar paridade falsa.

## Referencias lidas

- `.archon/plans/relatorio-fase29-linux-camera-start-root-cause-session-alignment.md`
- `.archon/plans/relatorio-fase30-linux-camera-session-manager-webcam-residente.md`
- `.archon/plans/relatorio-fase31-linux-backend-camera-contract-status-ui.md`
- `.archon/plans/relatorio-fase32-linux-rtsp-parity-candidates-reconnect.md`
- `.archon/plans/relatorio-fase33-linux-jobs-llm-real-inference-from-camera-artifacts.md`
- `.archon/plans/relatorio-fase34-linux-webcam-real-acceptance-ubuntu.md`
- `RUNBOOK-LINUX.md`
- `Perceptrum/CMakeLists.txt`
- `Perceptrum/linux-desktop/run-linux-dev.sh`
- `Perceptrum/linux-desktop/stage-backend-runtime.mjs`

## Validacao executada

```bash
git status --short --branch
(cd DrakonSite && npm run test:platform-boundaries)
(cd DrakonSite && npm run test:local-sqlite-bootstrap)
(cd DrakonSite && npm run test:linux-camera-start-contract)
(cd DrakonSite && npm run test:desktop-sqlite-encryption)
(cd DrakonSite && npm run test:semantic)
(cd DrakonSite && npm run build)
(cd Perceptrum && cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug -DPERCEPTRUM_ENABLE_AGENT_CORE=ON -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON)
(cd Perceptrum && cmake --build out/build/linux-debug -j$(nproc))
(cd Perceptrum && ctest --test-dir out/build/linux-debug --output-on-failure)
(cd Perceptrum && cmake -S . -B out/build/linux-release -G Ninja -DCMAKE_BUILD_TYPE=Release -DPERCEPTRUM_ENABLE_AGENT_CORE=ON -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON)
(cd Perceptrum && cmake --build out/build/linux-release -j$(nproc))
(cd Perceptrum && ctest --test-dir out/build/linux-release --output-on-failure)
(cd Perceptrum && cpack --config out/build/linux-release/CPackConfig.cmake)
```

Resultados:

- `git status --short --branch`: branch `archon/linux-port-origin-main-sync`; arvore ja continha alteracoes extensas de fases anteriores.
- `npm run test:platform-boundaries`: passou.
- `npm run test:local-sqlite-bootstrap`: passou.
- `npm run test:linux-camera-start-contract`: passou, 4/4.
- `npm run test:desktop-sqlite-encryption`: passou.
- `npm run test:semantic`: passou, 15/15.
- `npm run build`: passou; Vite gerou `dist/index.html`, CSS e JS.
- CMake Debug configure/build: passou.
- CTest Debug completo: 61/61 executados passaram; `linux_job_runtime_real_provider_openai_manual` ficou `Disabled`.
- CMake Release configure/build: passou.
- CTest Release completo: 61/61 executados passaram; `linux_job_runtime_real_provider_openai_manual` ficou `Disabled`.
- CPack Release: gerou `.tar.gz` e `.deb`.

Avisos observados:

- `stage-backend-runtime.mjs`/esbuild avisou que `import.meta` fica vazio no output CJS.
- `perceptrum-desktop` Release avisou uso deprecated de `webkit_web_view_run_javascript`.
- `dpkg --dry-run -i` como usuario comum retornou codigo 0, mas avisou que nao conseguiu abrir `/var/log/dpkg.log` por permissao.

## Smokes

Launcher/backend:

```bash
./Perceptrum/linux-desktop/run-linux-dev.sh --check-backend --print-web-root --no-open
APP_STATIC_ROOT="$PWD/../DrakonSite/dist" PERCEPTRUM_BACKEND_COMMAND="$PWD/out/build/linux-release/linux-backend-runtime/perceptrum-local-backend.sh" out/build/linux-release/perceptrum-desktop --check-backend --print-web-root --no-open
```

Resultado:

- ambos retornaram `backendStatus=started`;
- `launchUrl=http://127.0.0.1:4000/dashboard`;
- `webkitgtkCompiled=true`;
- `agentStatus=unavailable` no check sem janela, sem declarar agente residente ativo nesse smoke.

Agente/backend/comandos/camera sintetica:

```bash
(cd Perceptrum && out/build/linux-release/perceptrum-agent version && out/build/linux-release/perceptrum-agent check-deps)
(cd Perceptrum && ctest --test-dir out/build/linux-release -R 'linux_agent_local_provision_polls_command_result_smoke|linux_job_runtime_polls_commands_and_posts_fake_inference|linux_camera_recordings_endpoint_lists_synthetic_segments' --output-on-failure)
```

Resultado:

- `perceptrum-agent version`: `1.0.0`.
- `check-deps`: encontrou `ffmpeg`, `ffprobe` e `node`.
- Smoke filtrado Release: 3/3 passaram.

Webcam real:

```bash
ls -l /dev/video0
timeout 20s ffmpeg -y -hide_banner -f v4l2 -framerate 15 -i /dev/video0 -frames:v 1 /tmp/perceptrum-webcam-phase35.jpg
file /tmp/perceptrum-webcam-phase35.jpg
stat -c '%s %n' /tmp/perceptrum-webcam-phase35.jpg
```

Resultado:

- `/dev/video0` existe como `crw-rw----+ root video`.
- Captura direta passou.
- Arquivo gerado: `/tmp/perceptrum-webcam-phase35.jpg`.
- Tipo: JPEG 1920x1080.
- Tamanho: `129800` bytes.
- O driver ajustou `15 fps` para `5 fps`, sem falhar a captura.

## Pacotes

Arquivos gerados:

```text
Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.tar.gz
```

SHA256:

```text
50e251203e409e3cdfcafdd7f7a2a2dab157bb65204846da0bc45c5a6972ad60  out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
5866a53544d902aa303f8a15148a5377fd1d9e145106ee94885ee7ae910bbde8  out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.tar.gz
```

Tamanho:

```text
17M out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
17M out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.tar.gz
```

Conteudo validado no `.deb`:

- `/usr/bin/perceptrum-agent`
- `/usr/bin/perceptrum-desktop`
- `/usr/bin/perceptrum-desktop-launcher.sh`
- `/usr/share/applications/perceptrum.desktop`
- `/usr/share/icons/hicolor/1024x600/apps/perceptrum.png`
- `/usr/share/perceptrum-desktop/backend/bootstrap/perceptrum_site.seed.sqlite`
- `/usr/share/perceptrum-desktop/backend/desktop-local-server.cjs`
- `/usr/share/perceptrum-desktop/backend/perceptrum-local-backend.sh`
- `/usr/share/perceptrum-desktop/web/index.html`
- `/usr/share/perceptrum-desktop/web/assets/index-DGa4B93z.css`
- `/usr/share/perceptrum-desktop/web/assets/index-DX52nZkj.js`

Metadados do `.deb`:

- Package: `perceptrum-desktop`
- Version: `1.0.0`
- Architecture: `amd64`
- Depends: `libcurl4, ffmpeg, nodejs, xdg-utils, libsecret-tools, dbus-user-session, libgtk-3-0, libwebkit2gtk-4.1-0`
- Recommends: `gnome-keyring | kwalletmanager`

Conteudo essencial tambem foi encontrado no `.tar.gz`.

## Dependencias externas nao declaradas como prontas

- RTSP real nao foi executado nesta fase porque depende de camera RTSP/rede/credenciais reais.
- LLM real OpenAI/Z.ai nao foi executado nesta fase; o teste manual OpenAI permanece desabilitado para evitar custo acidental.
- Instalacao real do `.deb` nao foi feita para nao alterar o sistema global; o pacote foi gerado, inspecionado e validado com `dpkg --dry-run -i`.

## RUNBOOK atualizado

`RUNBOOK-LINUX.md` foi atualizado com:

- release final validado em 2026-05-27;
- caminhos e SHA256 dos pacotes;
- conteudo esperado do pacote;
- comandos finais para rodar em dev;
- comandos finais para instalar/rodar pacote;
- diagnostico de camera, thumbnails, clips e logs;
- diagnostico explicito para UI em `reconnecting`;
- referencias de paths para logs, banco, thumbnails, clips e inferencia.

## Comandos finais para o usuario

Rodar em dev:

```bash
APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 ./Perceptrum/linux-desktop/run-linux-dev.sh
```

Instalar pacote e abrir:

```bash
cd Perceptrum
sudo apt install ./out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
perceptrum-desktop --check-backend --print-web-root --no-open
perceptrum-desktop
```

Diagnosticar camera:

```bash
curl -fsS http://127.0.0.1:4000/api/runtime/agent-health
find "${XDG_CACHE_HOME:-$HOME/.cache}/Perceptrum/agentcore/camera-thumbnails" -type f -name '*-latest.jpg' -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' 2>/dev/null | sort | tail -20
find "${XDG_DATA_HOME:-$HOME/.local/share}/PerceptrumData/frames" -type f -name '*.mp4' -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' 2>/dev/null | sort | tail -20
tail -160 "${XDG_STATE_HOME:-$HOME/.local/state}/Perceptrum/logs/perceptrum-agent.log"
```

Testar webcam fora do app:

```bash
ls -l /dev/video*
ffmpeg -hide_banner -f v4l2 -list_formats all -i /dev/video0
ffmpeg -y -hide_banner -f v4l2 -framerate 15 -i /dev/video0 -frames:v 1 /tmp/perceptrum-webcam-test.jpg
file /tmp/perceptrum-webcam-test.jpg
```

Testar RTSP real fora do app:

```bash
ffprobe -hide_banner -rtsp_transport tcp -i 'rtsp://USER:PASS@CAMERA_IP:554/STREAM' -v error -show_streams
ffmpeg -hide_banner -rtsp_transport tcp -i 'rtsp://USER:PASS@CAMERA_IP:554/STREAM' -frames:v 1 /tmp/perceptrum-test-frame.jpg
file /tmp/perceptrum-test-frame.jpg
```

Configurar OpenAI real:

```bash
export PERCEPTRUM_LINUX_LLM_PROVIDER=openai
export OPENAI_API_KEY='<OPENAI_API_KEY>'
```

Nenhuma API key, token, senha RTSP ou payload base64 foi impresso neste relatorio.
