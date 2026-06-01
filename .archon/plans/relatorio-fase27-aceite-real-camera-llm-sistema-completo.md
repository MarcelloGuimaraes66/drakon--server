# Relatorio fase 27 - Aceite real de camera, LLM e sistema completo

Data: 2026-05-25 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Branch local: `archon/linux-port-origin-main-sync`
Push: nao realizado
Executor: Codex no ambiente local informado

## Objetivo

Executar aceite funcional completo no Ubuntu com o maximo possivel de recursos reais, sem apagar banco/dados do usuario, sem imprimir chaves e sem chamar LLM pago sem chave configurada.

## Contexto lido

- `.archon/plans/relatorio-fase26-secure-store-logging-packaging-final.md`
- `Perceptrum/linux-desktop/run-linux-dev.sh`
- `Perceptrum/CMakeLists.txt`
- `Perceptrum/linux/tests/mock_command_server.js`
- `Perceptrum/linux/tests/verify_camera_recordings_endpoint.mjs`
- `DrakonSite/scripts/test-local-sqlite-bootstrap.mjs`
- `DrakonSite/scripts/visual-battery.mjs`

## Validacao obrigatoria

| Comando | Status | Evidencia |
| --- | --- | --- |
| `./Perceptrum/linux-desktop/run-linux-dev.sh --check-backend --print-web-root --no-open` | OK | Build debug incremental; `backendStatus=discovered`, `paired=true`, `provisioned=true`, `agentRuntime=linux_minimal_agent_runtime`, `webRoot=DrakonSite/dist`. |
| `cd DrakonSite && npm run visual:linux` | OK | Gerou 20 screenshots Linux host dark/light em `DrakonSite/visual-artifacts`; summary sem excecoes. |
| `cd Perceptrum && ctest --test-dir out/build/linux-release --output-on-failure` | OK | 52/52 testes passaram em 31.11s. |

## Aceite por recurso

| Recurso | Status | Evidencia |
| --- | --- | --- |
| App Linux via script dev | OK | `run-linux-dev.sh` subiu o host, descobriu backend local e imprimiu roots runtime sem abrir janela. |
| App Linux via binario release | OK | `Perceptrum/out/build/linux-release/perceptrum-desktop --help` respondeu CLI; release foi exercitado no `ctest`. |
| App Linux via pacote `.deb` | OK | `.deb` extraido em `/tmp/perceptrum-deb-*`; binario de `usr/bin/perceptrum-desktop` rodou com web/backend do pacote e `backendStatus=discovered`. |
| Dashboard | OK | Screenshot dark/light Linux host e browser gerado. |
| Cameras | OK | Screenshot dark/light Linux host e browser gerado; camera discovery backend retornou `ok=true`, `count=0`. |
| Jobs | OK sintetico | Teste `linux_job_runtime_polls_commands_and_posts_fake_inference` passou; resultados de comandos 101/102 gravados em `/tmp/perceptrum-ctest-runtime/linux_job_runtime_polls_commands_and_posts_fake_inference/results.json`. |
| Chat | OK | Screenshot dark/light Linux host e browser gerado. Provider real bloqueado sem chave; provider fake validado no job runtime. |
| Events | OK | Screenshot dark/light Linux host e browser gerado; eventos do agente sintetico em `state/events/agent_events.jsonl`. |
| Billing | OK | Screenshot dark/light Linux host e browser gerado. |
| Settings | OK | Screenshot dark/light Linux host e browser gerado. |
| Account/workspace/shared camera | OK | `npm run test:local-sqlite-bootstrap` passou; cobre signup local, `/api/account-users`, resource catalog e rotas `/api/desktop-workspace-access/*` em estado local degradado sem relay central. |
| Backend health | OK | `/api/runtime/health` respondeu `ready=true`; `/__perceptrum/health` respondeu durante bootstrap. |
| Local session | OK | `run-linux-dev.sh` retornou `paired=true` e `provisioned=true`; bootstrap local SQLite passou. POST manual sem cookie retornou 401 esperado. |
| SQLite | OK | `npm run test:local-sqlite-bootstrap` passou e verificou DB sob storage root temporario. |
| R2/local storage | OK | Bootstrap local passou com storage root temporario e validacao de schema/rotas sem usar dados reais do usuario. |
| Camera discovery | OK | `/api/runtime/camera-discovery` retornou `ok=true`, `count=0` no host atual. |
| Agente status | OK | `perceptrum-agent status` retornou `missing_snapshot` antes de run e `stopped` apos run com config provisionada. |
| Agente healthcheck | OK | Healthcheck com agente live e secret mock local retornou `linux_minimal_runtime` e exit 0. |
| Agente start/stop | OK | `perceptrum-agent run` iniciou, escreveu `agent_health.json` e parou via SIGTERM. |
| Agente comandos | OK sintetico | Mock command server local entregou `job_start` e `job_stop`; resultados foram postados pelo agente. |
| Camera sintetica `lavfi` | OK sintetico | Build `out/build/linux-acceptance` com gates ON; testes RTSP/recordings passaram 4/4. |
| Camera real `APP_AGENT_RTSP_URL` | BLOQUEADO por hardware/chave | `APP_AGENT_RTSP_URL` nao estava configurado no ambiente; nenhuma captura real foi tentada. |
| Thumbnails | OK sintetico | JPG gerado: `/tmp/perceptrum-ctest-runtime/linux_rtsp_thumbnail_gates_generate_health_and_event/cache/agentcore/camera-thumbnails/linux-rtsp-test-latest.jpg`. |
| Clips/recordings | OK sintetico | MP4s 10s/60s/300s gerados em `/tmp/perceptrum-ctest-runtime/linux_rtsp_thumbnail_gates_generate_health_and_event/data/frames/cam_linux-rtsp-test/2026/05/25/`. |
| Events de camera | OK sintetico | `linux_rtsp_thumbnail` registrado em `/tmp/perceptrum-ctest-runtime/linux_rtsp_thumbnail_gates_generate_health_and_event/state/events/agent_events.jsonl`. |
| Recordings endpoint/helper | OK sintetico | `linux_camera_recordings_endpoint_lists_synthetic_segments` passou e validou cadencias 10/60/300. |
| Criar/iniciar/parar job de teste | OK sintetico | Mock local criou fluxo por comandos `job_start` e `job_stop`, validando polling, execucao e resultado. |
| Tabelas/results de jobs | OK sintetico | `results.json` e `cache/agentcore/jobs-inference-temp/job_23_command_101.json` gerados. |
| LLM fake/local | OK sintetico | `PERCEPTRUM_LINUX_LLM_PROVIDER=fake` retornou `fake_local_inference_ok` no teste de job runtime. |
| LLM real | BLOQUEADO por hardware/chave | Nenhuma chave real (`OPENAI_API_KEY`/`ZAI_API_KEY`) estava configurada; nao houve chamada paga. |
| Erro sem chave de LLM | OK | Com `PERCEPTRUM_LINUX_LLM_PROVIDER=openai` e chaves unset, o comando de inferencia falhou claramente com `missing_openai_api_key`; artefato em `/tmp/perceptrum-llm-missing-GTDbuM/results.json`. |
| Visual Linux host dark/light | OK | `npm run visual:linux` gerou 20 screenshots `linux-host-*` sem excecoes. |
| Visual browser dark/light | OK | `npm run visual:browser` gerou 20 screenshots `browser-*` sem excecoes. |
| Windows WebView2 | BLOQUEADO por hardware/chave | Host atual e Ubuntu, nao Windows; pendencia registrada para execucao em ambiente Windows com WebView2. |

## Build auxiliar de aceite

Para cobrir camera/RTSP/frame writer/job runtime, foi criado um build separado:

```bash
cmake -S . -B out/build/linux-acceptance -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DPERCEPTRUM_ENABLE_AGENT_CORE=ON \
  -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON \
  -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON \
  -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON \
  -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON
cmake --build out/build/linux-acceptance -j$(nproc)
ctest --test-dir out/build/linux-acceptance -R 'linux_rtsp_thumbnail_gates_generate_health_and_event|linux_camera_recordings_endpoint_lists_synthetic_segments|linux_job_runtime_polls_commands_and_posts_fake_inference|agentcore_portable_job_runtime_gate_initializes' --output-on-failure
```

Resultado: 4/4 testes passaram em 21.27s.

## Artefatos principais

- Screenshots: `DrakonSite/visual-artifacts/`
- Summary visual atual browser: `DrakonSite/visual-artifacts/summary.json`
- Testes release: `Perceptrum/out/build/linux-release/Testing/Temporary/LastTest.log`
- Build auxiliar: `Perceptrum/out/build/linux-acceptance/`
- Camera sintetica: `/tmp/perceptrum-ctest-runtime/linux_rtsp_thumbnail_gates_generate_health_and_event/`
- Recordings endpoint: `/tmp/perceptrum-ctest-runtime/linux_camera_recordings_endpoint_lists_synthetic_segments/`
- Job/LLM fake: `/tmp/perceptrum-ctest-runtime/linux_job_runtime_polls_commands_and_posts_fake_inference/`
- Erro LLM sem chave: `/tmp/perceptrum-llm-missing-GTDbuM/results.json`

Observacao de higiene: `storage/` apareceu como artefato local nao versionado durante os testes de backend. Ele foi deixado intacto para cumprir a restricao de nao apagar banco/dados do usuario.

## Resultado final

Aceite aprovado para os recursos exercitaveis no Ubuntu local:

- OK real: app dev, app release, pacote `.deb`, backend, SQLite, local storage, camera discovery, agente, UI Linux/browser.
- OK sintetico: camera `lavfi`, thumbnails, clips, events, recordings, jobs e LLM fake/local.
- BLOQUEADO por hardware/chave: camera RTSP real, LLM real e Windows WebView2.
- FALHA: nenhuma falha aberta neste aceite.
