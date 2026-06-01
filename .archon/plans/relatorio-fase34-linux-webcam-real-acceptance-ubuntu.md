# Relatorio fase 34 - Linux webcam real acceptance Ubuntu

Data: 2026-05-26 America/Manaus / 2026-05-27 UTC
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Executor: Codex/gpt-5.5
Commit/push: nao realizado

## Referencias lidas

- `.archon/plans/relatorio-fase29-linux-camera-start-root-cause-session-alignment.md`
- `.archon/plans/relatorio-fase30-linux-camera-session-manager-webcam-residente.md`
- `.archon/plans/relatorio-fase31-linux-backend-camera-contract-status-ui.md`
- `.archon/plans/relatorio-fase32-linux-rtsp-parity-candidates-reconnect.md`
- `.archon/plans/relatorio-fase33-linux-jobs-llm-real-inference-from-camera-artifacts.md`
- `RUNBOOK-LINUX.md`

## Pre-check local

- `/dev/video0`: existe como `crw-rw----+ root video`.
- ACL: `user:marcello-guimaraes:rw-`, suficiente para leitura/gravação pelo usuario atual.
- `ffmpeg`: `/usr/bin/ffmpeg`, versao `8.0.1-3ubuntu2`.
- Banco real inspecionado: `~/.local/share/PerceptrumData/storage/sqlite/local-site/perceptrum_site.sqlite`.
- Logs inspecionados sem imprimir chaves: `perceptrum-agent.log` e `perceptrum-desktop.log`.
- `sqlite3` CLI nao esta instalado; usei `better-sqlite3-multiple-ciphers` via Node do proprio projeto para consultas locais.

## Captura direta da webcam

Comando:

```bash
ffmpeg -y -hide_banner -f v4l2 -framerate 15 -i /dev/video0 -frames:v 1 /tmp/perceptrum-webcam-real.jpg
```

Resultado:

- Passou.
- O driver ajustou `15 fps` para `5 fps`.
- Arquivo gerado: `/tmp/perceptrum-webcam-real.jpg`.
- `file`: JPEG 1920x1080.
- Tamanho observado: `104601` bytes.

## Builds e testes

Comandos obrigatorios executados:

```bash
(cd DrakonSite && npm run build)
(cd Perceptrum && cmake --build out/build/linux-debug -j$(nproc))
APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 ./Perceptrum/linux-desktop/run-linux-dev.sh
```

Resultados:

- `npm run build`: passou.
- `cmake --build out/build/linux-debug`: passou.
- `run-linux-dev.sh`: abriu o host Linux, backend em `http://127.0.0.1:4000`, WebKitGTK compilado e agente iniciado.

Teste adicional apos correcoes:

```bash
(cd Perceptrum && ctest --test-dir out/build/linux-debug -R 'job|llm|inference|camera' --output-on-failure)
```

Resultado:

- 5/5 testes executados passaram.
- `linux_job_runtime_real_provider_openai_manual` continuou `Disabled`, como esperado.

## Falhas encontradas e corrigidas

### 1. UI pareava novo exe_id e Start dava timeout

Na primeira tentativa real pela UI, o botao Start foi clicado na pagina `/cameras`, mas o backend retornou `Camera start timed out waiting for Linux agent`.

Evidencia:

- A UI/WebKit chamou `/api/runtime/local-session` e substituiu o pairing para `exe_id=desktop-1779841452155`.
- O agente residente havia sido iniciado com o `exe_id` anterior.
- Com isso, o comando `start_camera` foi enfileirado para uma sessao que o agente nao estava pollando.

Correcoes:

- `Perceptrum/linux-desktop/main.cpp`
  - passa `APP_PROVISIONED_EXE_ID` para o backend local quando ja existe config provisionada;
  - reinicia o agente residente depois de persistir nova sessao/token recebida pelo WebKit bridge.

### 2. Pergunta de chat para camera nao era suportada no runtime Linux minimal

O backend de chat enfileira `orchestrator_query`, mas `LinuxJobRuntime` aceitava apenas `start_camera`, `stop_camera`, `probe_webcams`, `job_start` e `job_stop`.

Correcoes:

- `Perceptrum/linux/LinuxJobRuntime.h`
- `Perceptrum/linux/LinuxJobRuntime.cpp`
  - adiciona `executeOrchestratorQuery`;
  - coleta `camera_id`/`camera_ids` do payload;
  - reutiliza o thumbnail real em `camera-thumbnails/<camera_id>-latest.jpg`;
  - chama provider real via `RealInferenceResult`;
  - publica resposta em `/api/agent/chat-response`;
  - publica resultado final do comando sem imprimir chave/API key.

## Aceite pela UI real

Automacao usada:

- Chrome headless via DevTools carregando a UI real em `http://127.0.0.1:4000/cameras`.
- Sessao local temporaria criada para `local:1`; o token nao foi impresso.
- Clique real no botao React com `aria-label="Start"`.

Antes do clique:

- Pagina `/cameras` mostrava:
  - `Online 0`
  - `Offline 1`
  - camera `Webcam webcam-ubuntu`
  - status `Offline`
  - botao `Start`

Depois do clique e refresh:

- Pagina `/cameras` mostrou:
  - `Online 1`
  - `Offline 0`
  - camera `Webcam webcam-ubuntu`
  - status `Online`
  - botao `Stop`

Evidencias visuais salvas em:

- `/tmp/perceptrum-ui-evidence/cameras-after-start.png`
- `/tmp/perceptrum-ui-evidence/cameras-online.png`

## Estado backend/agente observado

Health apos Start:

```json
{
  "ok": true,
  "agent": {
    "status": "running",
    "stale": false,
    "commands_polled": 3,
    "completed": 3,
    "failed": 0,
    "active_camera_sessions": ["1"],
    "camera_session_last_thumbnails": {
      "1": "/home/marcello-guimaraes/.cache/Perceptrum/agentcore/camera-thumbnails/1-latest.jpg"
    },
    "camera_session_clip_directories": {
      "1": "/home/marcello-guimaraes/.local/share/PerceptrumData/frames/cam_1/2026/05/26"
    },
    "last_command_type": "start_camera",
    "last_error": ""
  }
}
```

Banco final relevante:

- `cameras.id=1`: `connection_method=WEBCAM`, `webcam_index=0`, `is_online=1`, `is_service_running=1`.
- `commands.id=9`: `start_camera`, `completed`, `camera_session_id=a1ef16fe-e3fb-4e68-a918-34297aae4c5c`.
- `camera_runtime_sessions`: sessao `a1ef16fe-e3fb-4e68-a918-34297aae4c5c` com `status=online`.
- `commands.id=7`: `orchestrator_query`, `completed`.
- `chat_messages`: pergunta do usuario e resposta final do assistente com `camera_ids=1`, sem pendencia.

## Arquivos gerados

Thumbnail:

```text
2026-05-26 20:37:48 259958 ~/.cache/Perceptrum/agentcore/camera-thumbnails/1-latest.jpg
```

Clips recentes:

```text
2026-05-26 20:38:00 2081646 ~/.local/share/PerceptrumData/frames/cam_1/2026/05/26/1_20260526_203749_10s.mp4
2026-05-26 20:38:10 1651994 ~/.local/share/PerceptrumData/frames/cam_1/2026/05/26/1_20260526_203800_10s.mp4
2026-05-26 20:38:19 1696967 ~/.local/share/PerceptrumData/frames/cam_1/2026/05/26/1_20260526_203810_10s.mp4
2026-05-26 20:38:29 1651504 ~/.local/share/PerceptrumData/frames/cam_1/2026/05/26/1_20260526_203819_10s.mp4
2026-05-26 20:38:39 1693450 ~/.local/share/PerceptrumData/frames/cam_1/2026/05/26/1_20260526_203829_10s.mp4
2026-05-26 20:38:48 1521123 ~/.local/share/PerceptrumData/frames/cam_1/2026/05/26/1_20260526_203839_10s.mp4
2026-05-26 20:39:00 1835052 ~/.local/share/PerceptrumData/frames/cam_1/2026/05/26/1_20260526_203848_10s.mp4
```

## Pergunta para webcam

Foi criada uma sessao de chat local e enviada pergunta para `camera_id=1`.

Resultado:

- `openai_settings` existe para `local:1`.
- `OPENAI_API_KEY` nao estava no ambiente, mas a chave salva no banco foi usada pelo backend e enviada ao agente sem ser impressa.
- O agente pollou `orchestrator_query`.
- O LLM real respondeu e `/api/agent/chat-response` promoveu a mensagem pendente para `message_type=final`.
- O comando `orchestrator_query` ficou `completed`.

Resposta objetiva:

- A pergunta chamou LLM real: sim.
- Nao ficou bloqueada por chave/provider.
- Nenhuma API key, token ou base64 de imagem foi registrado neste relatorio.

## Respostas objetivas

- Start funcionou na UI? Sim. O clique no botao `Start` da UI real enfileirou `start_camera` e a UI passou para `Online`/`Stop`.
- Camera ficou online? Sim. Banco e UI mostraram online; o health mostrou `active_camera_sessions=["1"]`.
- Thumbnail apareceu? Sim, `~/.cache/Perceptrum/agentcore/camera-thumbnails/1-latest.jpg`.
- Clip apareceu? Sim, varios `.mp4` em `~/.local/share/PerceptrumData/frames/cam_1/2026/05/26/`.
- Pergunta para webcam chamou LLM real ou ficou bloqueada? Chamou LLM real via OpenAI usando a chave salva; nao bloqueou por provider/chave.
- Ficou presa em reconnecting? Nao. A UI saiu de Offline para Online/Stop; nao ficou em `reconnecting`.

## Comandos que o usuario deve rodar agora

Para abrir novamente o app:

```bash
APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 ./Perceptrum/linux-desktop/run-linux-dev.sh
```

Para inspecionar runtime/agente depois de abrir:

```bash
curl -fsS http://127.0.0.1:4000/api/runtime/agent-health
pgrep -a -f 'perceptrum|desktop-local-server|ffmpeg'
find ~/.cache/Perceptrum/agentcore/camera-thumbnails -type f -printf '%TY-%Tm-%Td %TH:%TM:%TS %s %p\n' | sort | tail
find ~/.local/share/PerceptrumData/frames -type f -printf '%TY-%Tm-%Td %TH:%TM:%TS %s %p\n' | sort | tail
tail -160 ~/.local/state/Perceptrum/logs/perceptrum-agent.log
```

Observacao: a sessao do app usada no teste encerrou ao final da automacao local; rode o comando acima para reabrir e continuar inspecionando pela UI.
