# Relatorio fase 20 - Linux backend control-plane e agent ingress

Data: 2026-05-25 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Branch local: `archon/linux-port-origin-main-sync`
Push: nao realizado

## Objetivo

Consolidar o backend local Linux com as rotas e modulos compartilhados integrados do GitHub para local agent ingress, roles locais UI/agent, roteamento de control-plane, admissao de recursos de camera, shared camera access, workspace relay/local state e integracao com settings do desktop.

## Resultado

O backend local Linux continua usando o worker/backend web compartilhado (`DrakonSite/src/worker/index.ts`) e o runtime empacotado por `AppHost/Runtime/desktop-local-server.mjs`. Nao foi introduzido WinUI/WebView2 na UI React comum e nao foi criado um backend Linux divergente.

Foram aplicadas estas alteracoes:

- `AppHost/Runtime/desktop-local-server.mjs`: adicionou WebSocket local para `/ws/find-relay` e `/ws/workspace-relay`, usando os mesmos estados compartilhados `sharedFindRelayState` e `workspaceRelayState`.
- `DrakonSite/server/index.ts`: adicionou `/api/runtime/health` e `/api/auth/country` no servidor local compartilhado usado em desenvolvimento/testes Linux.
- `DrakonSite/scripts/test-local-sqlite-bootstrap.mjs`: ampliou a cobertura SQLite temporaria para health runtime, deteccao de pais e fila local de agent ingress com dados sinteticos.
- `Perceptrum/CMakeLists.txt`: incluiu os novos modulos worker/control-plane no staging do runtime backend Linux para regenerar o bundle quando eles mudarem.

## Rotas suportadas no Linux

Rotas locais de host/runtime:

- `GET /__perceptrum/health`: health legado sem segredos.
- `GET /api/runtime/health`: diagnostico do runtime local sem tokens/chaves.
- `GET /api/auth/country`: deteccao local por headers `cf-ipcountry`, `x-country-code` ou `x-app-country-code`.
- `POST /api/runtime/local-session`: provisionamento local via `/api/pairing/generate` e `/api/pairing/pair`.
- `POST /api/runtime/camera-discovery`: descoberta local de cameras.
- `GET /media/*`: midia local R2.
- rotas SPA estaticas a partir de `APP_STATIC_ROOT`.

Rotas de agente/control-plane:

- `/api/agent` e `/api/agent/*`: servidas pelo worker no role `agent` ou encaminhadas para `APP_AGENT_BASE_URL` no role `ui`.
- `POST /api/agent/events`: ingress local enfileiravel.
- `POST /api/agent/thumbnails`: ingress local enfileiravel, com coalescing por camera.
- `POST /api/agent/capture-thread-metrics`: ingress local enfileiravel, com coalescing por cliente.
- `POST /api/agent/open-monitor-snapshot`: ingress local enfileiravel, com coalescing por cliente.
- `GET /api/pairing/status`, `POST /api/pairing/generate`, `POST /api/pairing/pair`, `POST /api/pairing/disconnect`: status/provisionamento do agente via worker compartilhado.

Rotas de relay/workspace/shared access:

- `GET /ws/find-relay`: WebSocket local de shared find.
- `GET /ws/workspace-relay`: WebSocket local de workspace relay.
- `/api/workspace-access/*`: local state, invites, sessoes, approval e resource catalog no worker.
- `/api/workspace-relay/session`: sessao do relay central via worker.
- `/api/shared-find/*`, `/api/find-relay/*`, `/api/find-shares/*`: shared camera/find flows via worker compartilhado.

Rotas de camera resource admission:

- `POST /api/cameras/:cameraId/start`: calcula `resource_estimate` por `cameraResourceAdmission.ts` antes de enfileirar comando.
- `POST /api/cameras/:cameraId/capture-acceleration/apply`: aplica modo de captura CPU/NVIDIA.
- `POST /api/agent/cameras/:cameraId/start` e `POST /api/agent/cameras/:cameraId/stop`: control-plane do agente.

## Rotas Windows-only

Nao identifiquei rota HTTP/backend nova que precise permanecer Windows-only. O que permanece especifico de plataforma nao e rota backend compartilhada:

- UI shell WinUI/WebView2 e integracoes visuais nativas do host Windows.
- Recursos nativos de empacotamento/tray/autostart/instalador que nao pertencem ao worker HTTP.
- Bridges nativas completas ainda fora do runtime Linux minimo validado.

Justificativa tecnica: as funcionalidades pedidas nesta fase vivem no worker TypeScript ou no host HTTP local; por isso foram mantidas em modulos compartilhados e no runtime local empacotado, sem mover dependencias nativas para a UI React comum.

## Segredos

Health, diagnostico e testes nao expuseram bearer token, hashes, chaves centrais ou secrets. O teste novo valida explicitamente que o bearer token sintetico nao aparece no health nem na fila local de ingress.

## Validacao executada

Passou:

```bash
cd DrakonSite && npm run test:local-sqlite-bootstrap
cd DrakonSite && npm run build
cd Perceptrum && cmake --build out/build/linux-debug -j$(nproc)
./Perceptrum/linux-desktop/run-linux-dev.sh --check-backend --print-web-root --no-open
curl -fsS http://127.0.0.1:4000/__perceptrum/health
```

Resultado observado no check Linux:

- `backendBaseUrl=http://127.0.0.1:4000`
- `launchUrl=http://127.0.0.1:4000/dashboard`
- `windowMode=webkitgtk`
- `backendStatus=discovered`
- `agentStatus=provisioned`

O build CMake regenerou o staging do backend Linux. O esbuild manteve os avisos ja conhecidos sobre `import.meta` em saida CJS, sem falhar o bundle.

## Estado final

- Push: nao realizado.
- Validacoes obrigatorias: verdes.
- Bloqueadores reais: nenhum encontrado nesta fase.
