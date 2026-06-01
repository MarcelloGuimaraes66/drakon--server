# Relatorio fase 38 - resolver worker/index preservando Linux camera, jobs e runtime

## Escopo executado

Resolvido manualmente `DrakonSite/src/worker/index.ts` por merge seletivo entre:

- versao local atual do worktree;
- `origin/main` em `4357fcc6f1a4ecffc2dfbba53ece6216b0f95077`;
- diff remoto desde o merge-base `be49cb0a13752cdae5f4dd211b05255799f17198`.

Nao houve commit, push, reset, clean, restore destrutivo ou publicacao de segredos.

## Trechos do GitHub incorporados

- Imports e uso de `buildLocalSegmentStartCameraPayloads`, `extractCentralIdentityGrantBrandHint` e `buildLegacyLocalAppUserId`.
- Header/realm de brand por request via `resolveRequestEffectiveBrandId` e uso desse brand efetivo nas chamadas ao servidor central.
- Preservacao do hint de brand no refresh de identidade central usando o grant armazenado.
- Invalidacao/sincronizacao de sessao central quando grant, brand ou usuario central deixam de bater com a sessao local.
- Fluxos Google/central identity brand-aware, incluindo relink/reauth e mensagens de erro mais especificas.
- Novos campos de shared access: `invitee_handle`, `invitee_email` e `origin_brand_id` nos caches/serializacao.
- Novos campos de shared jobs: `preserve_running_camera_ids_json` e `allow_event_media`.
- Propagacao de `allow_event_media` nos eventos/acks de shared job e inclusao de `start_camera_payloads` para segmentos locais compartilhados.
- Rotas de workspace access reconciliadas mantendo os fallbacks locais degradados e adicionando o brand efetivo nas chamadas centrais.

## Endpoints Linux preservados

Foram preservados em `worker/index.ts`:

- `/api/runtime/camera-discovery`.
- `/api/agent/commands`.
- `/api/agent/commands/:commandId/result`.
- `/api/agent/bootstrap-cameras`.
- `/api/cameras/:cameraId/start`.
- `/api/cameras/:cameraId/stop`.
- `/api/camera-thumbnails`.
- `/api/agent-camera-directory`.
- `/api/camera-recordings/*`.
- `/api/cameras/:cameraId/recordings/summary`.
- `/api/cameras/:cameraId/recordings/segments`.
- `/api/job-clips/*`.

Tambem foram preservados:

- contrato `evaluateLinuxCameraStartResult`;
- erro/status para `linux_agent_not_running`, timeout e falhas de start;
- suporte a `WEBCAM` com `webcam_index` para `/dev/videoN`;
- suporte RTSP e candidatos de transporte;
- comandos `start_camera`, `stop_camera`, `job_start` e `job_stop`;
- caminhos locais de thumbnails, clips/frames e logs usados pelo runtime Linux.

## Migrations e schema ajustados

- `shared_job_segments` mantem/adiciona `preserve_running_camera_ids_json TEXT NOT NULL DEFAULT '[]'`.
- `shared_job_segments` mantem/adiciona `allow_event_media INTEGER NOT NULL DEFAULT 1`.
- `shared_find_invitations_cache` mantem/adiciona `invitee_handle TEXT`.
- `shared_find_invitations_cache` mantem/adiciona `invitee_email TEXT NOT NULL DEFAULT ''`.
- `server_users`, `app_users` e `central_device_sessions` preservam as migracoes brand-aware vindas das fases 37/38.
- As alteracoes sao aditivas ou migracoes controladas existentes; nao apagam dados locais Ubuntu.

## Contratos backend local/worker

O worker segue alinhado com:

- `DrakonSite/server/index.ts` e `AppHost/Runtime/desktop-local-server.mjs` para `/api/runtime/health`, `/api/runtime/agent-health`, `/api/runtime/local-session`, `/api/runtime/camera-discovery`, proxy de `/api/agent/*` e WebSockets de relay.
- `DrakonSite/src/shared/linuxCameraStartContract.ts` para decisao de sucesso/falha de camera start.
- `DrakonSite/src/shared/cameraStartDiagnostics.ts` para diagnosticos exibidos pela UI.
- `DrakonSite/src/worker/cameraRecordings.ts` para leitura de clips/frames locais.

## Validacao executada

- `git status --short --branch`: executado antes e depois.
- `cd DrakonSite && npm run test:platform-boundaries`: passou.
- `cd DrakonSite && npm run test:local-sqlite-bootstrap`: passou, com warning esperado de SQLite experimental do Node.
- `cd DrakonSite && npm test -- linuxCameraStartContract`: falhou porque nao existe script `test` no `package.json`.
- Equivalente executado: `cd DrakonSite && npm run test:linux-camera-start-contract`: passou, 4 testes.
- `cd DrakonSite && npm test -- centralIdentityBrandHint`: falhou porque nao existe script `test` no `package.json`.
- Equivalente executado: `cd DrakonSite && npx tsx --test src/tests/centralIdentityBrandHint.test.ts`: passou, 3 testes.
- `cd DrakonSite && npm run build`: passou; `prebuild` reaplicou brand ativa `Perceptrum`.
- `git diff --check -- DrakonSite/src/worker/index.ts`: passou sem output.
- Como `/dev/video0` existe, foi executado:
  `ffmpeg -y -hide_banner -f v4l2 -framerate 15 -i /dev/video0 -frames:v 1 /tmp/perceptrum-worker-index-webcam-check.jpg`
  Resultado: passou e gerou JPEG `1920x1080` em `/tmp/perceptrum-worker-index-webcam-check.jpg`.

## Build web

Build web passou com Vite:

- `dist/index.html`
- `dist/assets/index-DGa4B93z.css`
- `dist/assets/index-DX52nZkj.js`

## Camera/jobs testaveis

Camera/jobs seguem testaveis porque os endpoints e contratos de runtime Linux foram mantidos e o build passou. A webcam local tambem foi validada diretamente por `ffmpeg` em `/dev/video0`.

Validacao funcional completa ainda deve ser feita pelo launcher Linux com agente residente:

- iniciar app pelo `Perceptrum/linux-desktop/run-linux-dev.sh`;
- confirmar `/api/runtime/agent-health`;
- iniciar camera `WEBCAM`/RTSP pela UI;
- confirmar thumbnails e clips em disco;
- disparar job/inferencia real ou fake conforme ambiente.

## Bloqueios restantes para UI/AppHost

Sem bloqueio de build ou contrato identificado nesta fase.

Pendencias praticas restantes sao de validacao integrada fora do `worker/index.ts`:

- smoke do AppHost/desktop local com agente residente;
- fluxo UI completo de start/stop/reconnecting;
- shared job relay real entre owner/operator;
- teste de inferencia real depende de chaves/modelos configurados no ambiente, sem expor segredos.
