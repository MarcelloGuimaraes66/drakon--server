# Auditoria Linux/GitHub - recursos Perceptrum

Data local: 2026-05-25

## Veredito

O checkout atual roda a interface Linux com o mesmo build web, backend SQLite local e host WebKitGTK. A bateria web/Linux basica passou.

O sistema local ainda nao equivale ao `origin/main` nem ao runtime Windows completo. O Linux atual usa `linux_minimal_agent_runtime`: o proprio CMake garante que `AgentCore.cpp`, `CameraSession.cpp`, `FrameDiskWriter.cpp` e `JobRuntime.cpp` ficam fora do target Linux padrao. O unico caminho de camera validado no Linux e o adaptador leve de thumbnail RTSP via ffmpeg, atras de feature gates.

## Comparacao com GitHub

Branch local: `main`, atras de `origin/main` por 6 commits.

Commits remotos ausentes localmente:

- `be49cb0 Split desktop Google OAuth and control-plane routing`
- `b845247 Add shared camera admission and dual local backend roles`
- `3538abd Add account access controls and desktop settings integration`
- `bead8fa Add remote workspace access and desktop relay support`
- `eecf43f Enable desktop daily reports and refresh Drakon branding`
- `03e2dca Add chat tutorial flow, portal counter jobs, and GPU camera decode`

Arquivos funcionais existentes no `origin/main` e ausentes no `HEAD` local incluem:

- `DrakonSite/src/worker/localAgentIngress.ts`
- `DrakonSite/src/worker/sharedCameraAccess.ts`
- `DrakonSite/src/worker/cameraResourceAdmission.ts`
- `DrakonSite/src/worker/workspaceLocalState.ts`
- `DrakonSite/src/worker/workspaceRelayClient.ts`
- `DrakonSite/src/worker/workspaceRelayState.ts`
- `DrakonSite/src/react-app/components/settings/AccountUsersPanel.tsx`
- `DrakonSite/src/react-app/components/settings/WorkspaceAccessPanel.tsx`
- `DrakonSite/src/react-app/utils/cameraCaptureAcceleration.ts`
- `Perceptrum/Perceptrum/camera/PortalCounter.cpp`
- `Perceptrum/Perceptrum/camera/PortalCounter.h`

Conclusao: antes de declarar paridade com GitHub, a porta Linux precisa ser rebaseada/mesclada sobre `origin/main` e a bateria deve ser executada novamente.

## Validacoes executadas

Passaram:

- `npm run test:platform-boundaries`
- `npm run test:local-sqlite-bootstrap`
- `npm run test:semantic` - 15 testes OK
- `npm run build`
- `cmake -S . -B out/build/linux-debug-audit -G Ninja -DCMAKE_BUILD_TYPE=Debug`
- `cmake --build out/build/linux-debug-audit -j$(nproc)`
- `npm run visual:linux` - 16 screenshots, 0 excecoes JS capturadas
- `./Perceptrum/linux-desktop/run-linux-dev.sh --check-backend --print-web-root --no-open`
- `curl http://127.0.0.1:4000/__perceptrum/health`
- `POST /api/runtime/camera-discovery` com timeout curto

CTest:

- 51/52 testes passaram.
- Falhou `apphost_project_files_not_touched_by_linux_ctest`, porque ha diff local em `AppHost/Runtime/desktop-local-server.mjs`. A falha e de guarda de worktree, nao de compilacao/runtime.

## Estado funcional local

Host/UI:

- `perceptrum-desktop` compila com WebKitGTK.
- `run-linux-dev.sh --check-backend` resolve:
  - `webRoot=DrakonSite/dist`
  - `launchUrl=http://127.0.0.1:4000/dashboard`
  - `windowMode=webkitgtk`
  - `backendStatus=discovered`

Backend local:

- `/__perceptrum/health` respondeu `ok=true`, `backend=sqlite`, `staticReady=true`.
- Banco local existe em `~/.local/share/PerceptrumData/local-site/perceptrum_site.sqlite`.
- Tabelas principais existem, mas a base atual esta vazia para `cameras`, `jobs`, `job_steps`, `detections`, `events`, `commands`, `openai_settings` e `zai_settings`.

Agente:

- Runtime limpo escreveu `agent_health.json` corretamente.
- Status funcional: `linux_minimal_agent_runtime`.
- `full_agent_core`, `camera_capture`, `rtsp_capture`, `frame_writer` e `job_runtime` aparecem como bloqueados por gates no status do AgentCore minimal.

Cameras:

- Descoberta de cameras respondeu sem erro, mas encontrou 0 dispositivos nesta rede.
- Nao ha `rtsp://` configurado em `~/.config/Perceptrum` ou `~/.local/share/PerceptrumData`.
- Smoke RTSP sintetico com `lavfi:testsrc` passou e gerou:
  - `/tmp/perceptrum-audit-rtsp/cache/agentcore/rtsp-thumbnails/linux-rtsp-test-latest.jpg`
  - `/tmp/perceptrum-audit-rtsp/data/agent_events.jsonl`

Arquivos de captura:

- Nao ha referencias a `fpd` ou `.fpd` no codigo versionado local.
- O runtime Windows/legado usa `FrameDiskWriter` para segmentos/capturas; o Linux minimal nao compila `FrameDiskWriter` no target padrao.
- O caminho Linux validado grava thumbnail `.jpg`, `agent_health.json` e `agent_events.jsonl`.

LLM/inferencia:

- O codigo contem caminhos para OpenAI/Z.ai em `openai_settings`, `zai_settings`, `model_api_keys`, `LocalLlmClient`, `AgentCore` e `CameraSession`.
- No SQLite local nao ha chaves configuradas: `openai_settings=0`, `zai_settings=0`, `model_api_keys` sem evidencias de chave ativa nesta auditoria.
- Nao foi feita chamada real a LLM para evitar custo/segredo e porque nao ha chave configurada.

Secure store:

- `secret-tool` nao esta instalado neste Ubuntu.
- O pacote `.deb` declara dependencia `libsecret-tools`.
- Sem `secret-tool`, provisionamento normal pode falhar fechado. O fallback plaintext so funciona com `APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1`.
- Ha arquivo local `~/.config/Perceptrum/secrets/exe_token.txt` com permissao `600`, mas isso depende do fallback.

Empacotamento:

- Existe pacote: `Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb`.
- O pacote contem `perceptrum-agent`, `perceptrum-desktop`, launcher, backend local, seed SQLite e web build.

## Bloqueadores para declarar "todos os recursos OK"

1. Rebase/merge da porta Linux sobre `origin/main`.
2. Trazer para o Linux os recursos recentes do GitHub: ingress local do agente, shared camera admission/access, workspace relay/access, portal counter/GPU camera decode e telas novas de settings.
3. Implementar ou portar o runtime pesado no Linux: `AgentCore`, `CameraSession`, `JobRuntime`, `FrameDiskWriter` e captura real de camera.
4. Instalar/validar `secret-tool` ou definir oficialmente o modo fallback de secure store para dev.
5. Configurar uma camera real RTSP/Webcam e validar captura real, thumbnails/eventos e diretorios finais.
6. Configurar chaves OpenAI/Z.ai/modelos e executar uma inferencia real controlada.
7. Rodar visual Windows WebView2 em Windows; isso nao pode ser validado neste Ubuntu.
