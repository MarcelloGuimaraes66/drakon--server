# Relatorio fase 41 - validacao final Linux webcam RTSP LLM packaging

Data: 2026-05-30

## Escopo executado

Validacao final no Ubuntu depois da integracao das fases 36 a 40, sem commit, sem push, sem reset/clean/restore destrutivo e sem imprimir segredos.

Foram lidos:

- relatorios das fases 36, 37, 38, 39 e 40;
- `RUNBOOK-LINUX.md`;
- `Perceptrum/linux-desktop/run-linux-dev.sh`;
- `Perceptrum/CMakeLists.txt`;
- arquivos Linux de camera, frame writer, RTSP e job runtime;
- contratos `linuxCameraStartContract.ts`, `cameraStartDiagnostics.ts` e `cameraRecordings.ts`.

## Estado Git

Branch:

```text
archon/linux-port-origin-main-sync
```

O worktree ja estava sujo com alteracoes e arquivos nao rastreados das fases anteriores. Nesta fase foram editados somente:

- `RUNBOOK-LINUX.md`;
- `.archon/plans/relatorio-fase41-validacao-final-linux-webcam-rtsp-llm-packaging.md`.

## Suite web

Resultado:

```text
npm run test:platform-boundaries: passou
npm run test:local-sqlite-bootstrap: passou, com warning esperado de SQLite experimental
npm test -- centralIdentityBrandHint: falhou porque package.json nao tem script test
npx tsx --test src/tests/centralIdentityBrandHint.test.ts: passou, 3/3
npm test -- linuxCameraStartContract: falhou porque package.json nao tem script test
npm run test:linux-camera-start-contract: passou, 4/4
npm run build: passou
```

Build web gerado:

```text
DrakonSite/dist/index.html
DrakonSite/dist/assets/index-BnjsRQua.css
DrakonSite/dist/assets/index-y5U5EPRK.js
```

## CMake, build e CTest

Debug:

```text
cmake linux-debug com gates AgentCore/Camera/RTSP/FrameWriter/JobRuntime: passou
cmake --build out/build/linux-debug: passou
ctest linux-debug: 61/61 testes executados passaram
linux_job_runtime_real_provider_openai_manual: Disabled
```

Release:

```text
cmake linux-release com gates AgentCore/Camera/RTSP/FrameWriter/JobRuntime: passou
cmake --build out/build/linux-release: passou
ctest linux-release: 61/61 testes executados passaram
linux_job_runtime_real_provider_openai_manual: Disabled
```

Observacao: o stage do backend local em Release emitiu o warning conhecido do esbuild sobre `import.meta` em output CJS.

## Packaging Linux

`cpack --config out/build/linux-release/CPackConfig.cmake` passou e gerou:

```text
Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
sha256: 251b9c0d68cfe12f4a0fd4fd4f604007f9bcc79e6a27722e53de1be36c4adbbb

Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.tar.gz
sha256: b76de42a54cdeac7372d44c13e7112887595658eead0bcd34bce868ba65c45f3
```

Conteudo validado no `.deb` e no `.tar.gz`:

```text
/usr/bin/perceptrum-desktop
/usr/bin/perceptrum-agent
/usr/bin/perceptrum-desktop-launcher.sh
/usr/share/applications/perceptrum.desktop
/usr/share/perceptrum-desktop/backend/perceptrum-local-backend.sh
/usr/share/perceptrum-desktop/backend/desktop-local-server.cjs
/usr/share/perceptrum-desktop/backend/bootstrap/perceptrum_site.seed.sqlite
/usr/share/perceptrum-desktop/web/index.html
/usr/share/perceptrum-desktop/web/assets/
```

Dependencias declaradas pelo `.deb`:

```text
libcurl4, ffmpeg, nodejs, xdg-utils, libsecret-tools, dbus-user-session, libgtk-3-0, libwebkit2gtk-4.1-0
Recommends: gnome-keyring | kwalletmanager
```

## Webcam real

`/dev/video0` existe:

```text
crw-rw----+ root video /dev/video0
```

O usuario atual nao esta no grupo `video`, mas a ACL do device permitiu leitura real.

Captura direta:

```text
ffmpeg -y -hide_banner -f v4l2 -framerate 15 -i /dev/video0 -frames:v 1 /tmp/perceptrum-final-webcam.jpg
resultado: passou
arquivo: /tmp/perceptrum-final-webcam.jpg, JPEG 1920x1080, 131808 bytes
```

Validacao pelo agente:

```text
APP_AGENT_WEBCAM_INDEX=0
APP_AGENT_CAMERA_ID=42
APP_AGENT_RECORDING_PROFILES=10,60,300
APP_AGENT_RECORDING_CAPTURE_SECONDS=3
gates de AgentCore/Camera/RTSP/FrameWriter/JobRuntime ligados
```

Status durante a execucao:

```text
agent_runtime_running: true
headless_ready: true
rtsp_camera_started: true
rtsp_last_error: vazio
job_runtime_last_error: job_runtime_waiting_for_pairing
status: secure_store_unavailable
```

O `status=secure_store_unavailable` vem da ausencia de `secret-tool` neste ambiente. A captura de camera e o frame writer ainda foram validados com sucesso.

Artefatos reais gerados em 2026-05-30:

```text
/home/marcello-guimaraes/.cache/Perceptrum/agentcore/camera-thumbnails/42-latest.jpg
/home/marcello-guimaraes/.local/share/PerceptrumData/frames/cam_42/2026/05/30/42_20260530_181416_20260530_181426_10s.mp4
/home/marcello-guimaraes/.local/share/PerceptrumData/frames/cam_42/2026/05/30/42_20260530_181416_20260530_181516_60s.mp4
/home/marcello-guimaraes/.local/share/PerceptrumData/frames/cam_42/2026/05/30/42_20260530_181416_20260530_181916_300s.mp4
```

## App e agente residente

Smoke sem abrir janela:

```text
APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 ./Perceptrum/linux-desktop/run-linux-dev.sh --check-backend --print-web-root --no-open
backendStatus=started
launchUrl=http://127.0.0.1:4000/dashboard
windowMode=webkitgtk
webkitgtkCompiled=true
```

Smoke do launcher com agente:

```text
APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 PERCEPTRUM_LINUX_WINDOW_MODE=browser BROWSER=true ./Perceptrum/linux-desktop/run-linux-dev.sh
backendStatus=started
agentStatus=started
```

Nao foi mantida uma janela WebKit interativa aberta no fim da validacao; a validacao foi por launcher/backend/agente e por captura real do agente.

## RTSP

Nao havia URL RTSP real configurada:

```text
APP_AGENT_RTSP_URL: ausente
RTSP_URL: ausente
PERCEPTRUM_RTSP_URL: ausente
agent_config.json: sem linux_rtsp_camera real
```

Dependencia ausente: URL RTSP real acessivel.

Cobertura automatizada relacionada passou em CTest:

```text
linux_rtsp_thumbnail_gates_generate_health_and_event: passou
linux_job_runtime_rtsp_sources_and_invalid_candidate: passou
```

Portanto, RTSP real, reconnect/backoff e frame/thumbnail contra stream real ainda dependem de uma camera RTSP acessivel.

## LLM

Credenciais reais:

```text
OPENAI_API_KEY: ausente
ZAI_API_KEY: ausente
secret-tool: ausente
settings/config local com chave OpenAI/Z.ai: nao encontrado sem imprimir segredos
```

Dependencia ausente: OPENAI_API_KEY ou ZAI_API_KEY real, ou chave equivalente enviada pelo payload/settings.

Nao foi feita chamada LLM real. A validacao automatizada confirmou falha controlada sem chave:

```text
linux_job_runtime_real_provider_without_key_fails: passou
erro esperado: missing_openai_api_key
linux_job_runtime_real_provider_openai_manual: Disabled
```

Tambem havia artefato real de camera disponivel para pergunta (`42-latest.jpg` e clips `cam_42`), mas a pergunta real para camera foi bloqueada por credencial/provider.

## Respostas objetivas

- O app abre no Ubuntu? Parcialmente validado: o host Linux inicializa, encontra WebKitGTK, sobe backend e gera `launchUrl`; janela interativa nao foi mantida aberta nesta execucao automatizada.
- O agente residente sobe? Sim, o launcher reportou `agentStatus=started`; o agente direto tambem rodou com `agent_runtime_running=true`.
- Webcam local conecta? Sim, `/dev/video0` gerou JPEG direto e o agente gerou thumbnail/clips.
- RTSP foi validado ou depende de URL real? Depende de URL RTSP real. Testes automatizados de candidatos/erro passaram.
- Thumbnails/clips/frames foram gravados? Sim, `42-latest.jpg` e clips 10s/60s/300s em `cam_42`.
- Pergunta para camera chamou LLM real? Nao. Bloqueada por ausencia de OpenAI/Z.ai key e Secret Service.
- Pacote `.deb` foi gerado? Sim, junto com `.tar.gz`.
- Quais validacoes ainda dependem de Windows/Mac? Windows AppHost/WebView2/installer/assinatura em maquina Windows; macOS host/packaging nao existe neste repo e precisa de projeto/ambiente proprio.

## Comandos que o usuario deve rodar agora

Ubuntu, para repetir smoke sem instalar:

```bash
APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 ./Perceptrum/linux-desktop/run-linux-dev.sh --check-backend --print-web-root --no-open
APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 ./Perceptrum/linux-desktop/run-linux-dev.sh
```

Ubuntu, para instalar o pacote:

```bash
cd Perceptrum
sudo apt install ./out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
perceptrum-desktop --check-backend --print-web-root --no-open
perceptrum-desktop
```

Ubuntu, para validar webcam:

```bash
ffmpeg -y -hide_banner -f v4l2 -framerate 15 -i /dev/video0 -frames:v 1 /tmp/perceptrum-final-webcam.jpg
find ~/.cache/Perceptrum/agentcore/camera-thumbnails -type f -printf '%TY-%Tm-%Td %TH:%TM:%TS %s %p\n' | sort | tail
find ~/.local/share/PerceptrumData/frames -type f -printf '%TY-%Tm-%Td %TH:%TM:%TS %s %p\n' | sort | tail
```

Para validar RTSP real:

```bash
export APP_AGENT_RTSP_URL='rtsp://USER:PASS@CAMERA_IP:554/STREAM'
# rode pelo launcher/UI ou pelo teste manual do RUNBOOK-LINUX.md
```

Para validar LLM real:

```bash
export PERCEPTRUM_LINUX_LLM_PROVIDER=openai
export OPENAI_API_KEY='<OPENAI_API_KEY>'
# nao compartilhe o valor da chave
```

## Matriz final Windows/Mac/Linux

Linux Ubuntu:

```text
Validado: web tests/build, CMake Debug/Release, CTest Debug/Release, CPack DEB/TGZ, pacote, backend local, launcher smoke, agente, webcam real, thumbnails e clips.
Dependente: RTSP real por falta de URL; LLM real por falta de chave/provider/secret-tool.
Risco conhecido: secure store indisponivel neste ambiente sem libsecret-tools/Secret Service; usar APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 somente em dev/CI isolado.
```

Windows:

```text
Precisa validar: AppHost WinUI/WebView2 real, bridge open-external-url-window, janelas auxiliares, build.ps1, Inno Setup, Windows App Runtime prereq e assinatura Authenticode.
Risco conhecido: depende de Visual Studio Build Tools, Windows SDK, WebView2, Inno Setup, certificado externo e politica corporativa de ShellExecute/navegador.
```

Mac:

```text
Precisa validar: build web compartilhado em macOS e definir host/packaging macOS.
Risco conhecido: nao ha host nativo nem packaging macOS neste repositorio.
```
