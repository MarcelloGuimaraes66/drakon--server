# Relatorio fase 19 - Build pos sync GitHub

Data: 2026-05-25 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Branch local: `archon/linux-port-origin-main-sync`
HEAD validado: `9b62740 Merge origin main into Linux port`

## Objetivo

Estabilizar o estado integrado apos o merge de `origin/main`, garantindo TypeScript, Vite, CMake, CTest e o host Linux em estado verde sem remover funcionalidades remotas recem-integradas e sem push.

## Resultado

O sistema integrado compila no caminho validado Linux e todas as validacoes obrigatorias passaram.

Nao foi necessario alterar codigo nesta fase: a branch integrada ja estava verde apos a fase 18. Este relatorio foi criado para registrar a reexecucao completa exigida pelo Prompt 19.

## Rotas e integrações preservadas

`AppHost/Runtime/desktop-local-server.mjs` continua servindo ou roteando:

- `/__perceptrum/health`
- `/api/runtime/local-session`
- `/api/runtime/camera-discovery`
- `/api/agent` e `/api/agent/*` via proxy quando `APP_AGENT_BASE_URL` esta configurado
- `startLocalAgentIngressPump` para ingress local do agente

`DrakonSite/server/index.ts` tambem preserva:

- `/__perceptrum/health`
- `/api/runtime/local-session`
- `/api/runtime/camera-discovery`
- proxy `/api/agent/*`
- relay websocket `/ws/workspace-relay`
- `startLocalAgentIngressPump`

`Perceptrum/linux-desktop/run-linux-dev.sh` continua abrindo o caminho Linux com backend local HTTP e modo WebKitGTK por padrao quando disponivel. A validacao com `--check-backend --print-web-root --no-open` reportou:

- `webRoot=/home/marcello-guimaraes/dev/perceptrum_desktop_aspp/DrakonSite/dist`
- `backendBaseUrl=http://127.0.0.1:4000`
- `launchUrl=http://127.0.0.1:4000/dashboard`
- `windowMode=webkitgtk`
- `webkitgtkCompiled=true`
- `backendStatus=discovered`

## Validacao executada

Passou:

```bash
cd DrakonSite && npm run test:platform-boundaries
cd DrakonSite && npm run test:local-sqlite-bootstrap
cd DrakonSite && npm run test:semantic
cd DrakonSite && npm run build
cd Perceptrum && cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
cd Perceptrum && cmake --build out/build/linux-debug -j$(nproc)
cd Perceptrum && ctest --test-dir out/build/linux-debug --output-on-failure
./Perceptrum/linux-desktop/run-linux-dev.sh --check-backend --print-web-root --no-open
```

Resultados:

- `test:platform-boundaries`: OK. React comum sem dependencia WinUI/GTK/WebView2.
- `test:local-sqlite-bootstrap`: OK. Bootstrap SQLite local funcional.
- `test:semantic`: OK, 15/15 testes passaram.
- `npm run build`: OK. `tsc -b` e Vite concluiram; Vite transformou 2055 modulos e gerou `dist`.
- CMake configure: OK em `Perceptrum/out/build/linux-debug`.
- CMake build: OK, Ninja sem trabalho pendente.
- CTest: OK, 52/52 testes passaram.
- `run-linux-dev.sh --check-backend --print-web-root --no-open`: OK, backend local descoberto e modo WebKitGTK compilado.

## Correcoes aplicadas

Nenhuma correcao de codigo foi necessaria nesta fase. Nao houve uso de `any`, `@ts-ignore`, remocao de testes, guards falsos ou movimentacao de dependencias de plataforma para a UI React comum.

## Areas ainda faltantes para paridade funcional

O estado validado Linux permanece como runtime minimo integrado. A paridade funcional completa ainda depende de trabalhos fora do escopo desta fase para:

- bridge nativa Linux equivalente aos recursos nativos completos do host Windows;
- tray/autostart/instalador final com cobertura de aceite completa;
- AgentCore completo, cameras/RTSP/jobs e aceleracao/GPU em Linux alem dos gates atualmente validados.

Estas lacunas nao bloqueiam a build pos-sync: o caminho Linux local, o servidor local, o build web e os testes obrigatorios estao verdes.

## Estado final

- Branch: `archon/linux-port-origin-main-sync`
- Push: nao realizado.
- Build integrado: verde.
- Bloqueadores reais: nenhum encontrado nesta fase.
