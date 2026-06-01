# Relatorio fase 29 - Linux camera start root cause e session alignment

Data: 2026-05-26 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Branch local: `archon/linux-port-origin-main-sync`
Executor: Codex/gpt-5.5
Commit/push: nao realizado

## Causa raiz encontrada

A falha `camera start timed out waiting for Linux agent` era causada por desalinhamento de sessao/runtime, nao por captura profunda de camera.

Evidencias locais:

- A porta `127.0.0.1:4000` estava ocupada por `node .../linux-backend-runtime/desktop-local-server.cjs`, pid `490190`.
- O ambiente desse backend tinha `SQLITE_DB_PATH=storage/sqlite/local-site/perceptrum_site.sqlite`, relativo.
- O cwd do backend era `/home/marcello-guimaraes/.local/share/PerceptrumData`, entao o arquivo aberto era `/home/marcello-guimaraes/.local/share/PerceptrumData/storage/sqlite/local-site/perceptrum_site.sqlite`.
- Nao havia `perceptrum-agent run` residente no `ps`; portanto o backend tinha pairing `connected`, mas nenhum agente estava pollando.
- O banco real principal continha pairing `local:1`/`desktop-1779788669672` e comandos `start_camera` falhados para esse alvo. O banco legado `/home/marcello-guimaraes/.local/share/PerceptrumData/local-site/perceptrum_site.sqlite` tambem existe, com dados mais antigos.

O bug funcional no backend era aceitar qualquer `exe_pairings.status='connected'` para `start_camera`, mesmo com `last_seen_at` stale. Isso permitia enfileirar comando para um agente que nao estava vivo, e a UI so recebia timeout depois.

## Arquivos alterados

- `Perceptrum/linux-desktop/main.cpp`
  - normaliza `STORAGE_ROOT` e `SQLITE_DB_PATH` para paths absolutos no launcher;
  - usa o DB desktop real em `PerceptrumData/storage/sqlite/local-site/perceptrum_site.sqlite`;
  - considera health snapshot stale como agente indisponivel;
  - inicia o agente residente com stdout/stderr redirecionados para log dedicado e inclui exit code + cauda redigida quando ele sai imediatamente.
- `Perceptrum/linux-desktop/run-linux-dev.sh`
  - exporta roots XDG consistentes para backend/UI/agente;
  - exporta `SQLITE_DB_PATH` absoluto;
  - derruba backend Perceptrum antigo em `:4000` quando o ambiente diverge.
- `AppHost/Runtime/desktop-local-server.mjs`
  - adiciona `/api/runtime/agent-health` com env/runtime/agent snapshot sem segredos.
- `DrakonSite/server/index.ts`
  - adiciona o mesmo diagnostico `/api/runtime/agent-health` no servidor dev.
- `DrakonSite/src/worker/index.ts`
  - `start_camera` e `probe_webcams` falham cedo quando o pairing existe mas o heartbeat esta stale;
  - `start_camera` retorna `error_code: linux_agent_not_running`.
- `Perceptrum/CMakeLists.txt`
  - adiciona smoke `linux_agent_local_provision_polls_command_result_smoke`.
- `RUNBOOK-LINUX.md`
  - adiciona diagnostico de processos, env do backend, agent health, comandos pendentes e paths/logs.

## Banco e runtime

Como saber se backend e agente estao usando o mesmo banco/roots:

```bash
./Perceptrum/linux-desktop/run-linux-dev.sh --check-backend --print-web-root --no-open
curl -fsS http://127.0.0.1:4000/api/runtime/agent-health
pid="$(lsof -tiTCP:4000 -sTCP:LISTEN | head -1)"
tr '\0' '\n' < "/proc/$pid/environ" | rg '^(SQLITE_DB_PATH|STORAGE_ROOT|APP_RUNTIME_DATA_ROOT|APP_RUNTIME_CONFIG_ROOT|APP_RUNTIME_CACHE_ROOT|APP_RUNTIME_STATE_ROOT|APP_RUNTIME_LOG_ROOT|APP_BASE_URL|PORT)='
ls -l "/proc/$pid/fd" | rg 'perceptrum_site.sqlite|PerceptrumData'
```

Esperado no desktop Linux:

```text
STORAGE_ROOT=/home/marcello-guimaraes/.local/share/PerceptrumData
SQLITE_DB_PATH=/home/marcello-guimaraes/.local/share/PerceptrumData/storage/sqlite/local-site/perceptrum_site.sqlite
APP_RUNTIME_DATA_ROOT=/home/marcello-guimaraes/.local/share/PerceptrumData
APP_RUNTIME_CONFIG_ROOT=/home/marcello-guimaraes/.config/Perceptrum
APP_RUNTIME_CACHE_ROOT=/home/marcello-guimaraes/.cache/Perceptrum
APP_RUNTIME_STATE_ROOT=/home/marcello-guimaraes/.local/state/Perceptrum
APP_RUNTIME_LOG_ROOT=/home/marcello-guimaraes/.local/state/Perceptrum/logs
```

## Comando para abrir e confirmar polling

Comando exato para abrir o app:

```bash
./Perceptrum/linux-desktop/run-linux-dev.sh
```

Em outro terminal, confirmar agente pollando:

```bash
curl -fsS http://127.0.0.1:4000/api/runtime/agent-health | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s); console.log({ok:j.ok, stale:j.agent?.stale, status:j.agent?.status, client_id:j.agent?.client_id, exe_id:j.agent?.exe_id, polled:j.agent?.job_runtime_commands_polled});})"
```

`ok` deve ser `true`, `stale` deve ser `false`, e `job_runtime_commands_polled` deve aumentar quando houver comando entregue.

## Comandos executados

```bash
git status --short --branch
(cd DrakonSite && npm run build)
(cd Perceptrum && cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug -DPERCEPTRUM_ENABLE_AGENT_CORE=ON -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON)
(cd Perceptrum && cmake --build out/build/linux-debug -j$(nproc))
(cd Perceptrum && ctest --test-dir out/build/linux-debug -R 'agent|linux|job|camera' --output-on-failure)
./Perceptrum/linux-desktop/run-linux-dev.sh --check-backend --print-web-root --no-open
```

Resultados:

- `npm run build`: passou.
- `cmake`: passou.
- `cmake --build`: passou; manteve aviso conhecido de WebKitGTK deprecated.
- `ctest -R 'agent|linux|job|camera'`: 52/52 passaram.
- `run-linux-dev --check-backend`: passou, derrubou o backend stale em `:4000` e iniciou backend com `SQLITE_DB_PATH` absoluto no banco real.

## Observacoes

- Nenhum token, hash de token, senha ou API key foi impresso neste relatorio.
- O arquivo novo `/home/marcello-guimaraes/.local/share/PerceptrumData/sqlite/local-site/perceptrum_site.sqlite` foi criado durante um check intermediario antes do ajuste final de path. Ele nao foi apagado para cumprir a restricao de nao apagar dados do usuario.
