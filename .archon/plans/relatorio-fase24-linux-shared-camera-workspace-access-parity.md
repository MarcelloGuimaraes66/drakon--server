# Relatorio fase 24 - Linux shared camera, workspace e access parity

Data: 2026-05-25 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Branch local: `archon/linux-port-origin-main-sync`
Push: nao realizado

## Objetivo

Garantir que shared camera, remote workspace, account access e desktop relay carreguem no backend local Linux com SQLite, sem acoplar a UI comum ao AppHost WinUI e sem quebrar o caminho Windows.

## Modulos inspecionados

- `sharedCameraAccess`: normaliza perfis `find_only`, `shared_job_execution` e `shared_job_execution_with_event_media`; monta descritores de camera local vs `shared_find`.
- `cameraResourceAdmission`: calcula estimativa CPU/GPU com fallback por resolucao quando telemetria local nao existe.
- `workspaceLocalState`: mantem aprovacoes e respostas proxy em memoria do processo local.
- `workspaceRelayClient` e `workspaceRelayState`: criam sessoes WebSocket de relay e roteiam mensagens por `public_id`.
- `accountAccess`: resolve dono/admin/member, permissoes, escopos e grants por recurso.
- `AccountUsersPanel` e `WorkspaceAccessPanel`: usam endpoints locais HTTP, nao WinUI/AppHost.

## Endpoints mapeados

Account/local:

- `GET /api/account-users`
- `POST /api/account-users`
- `PATCH /api/account-users/:memberId`
- `POST /api/account-users/:memberId/password`

Shared camera/local:

- `POST /api/shared-find/users/resolve`
- `GET /api/shared-find/incoming`
- `GET /api/shared-find/outgoing`
- `POST /api/shared-find/sync`
- `GET /api/shared-find/cameras`
- `POST /api/shared-find/cameras/:cameraId/shares`
- `POST /api/shared-find/shares/:shareId/accept`
- `POST /api/shared-find/shares/:shareId/deny`
- `POST /api/shared-find/shares/:shareId/revoke`

Workspace/local desktop:

- `GET/PATCH /api/desktop-workspace-access/settings`
- `POST /api/desktop-workspace-access/heartbeat`
- `GET /api/desktop-workspace-access/pending-requests`
- `GET /api/desktop-workspace-access/active-sessions`
- `POST /api/desktop-workspace-access/users/resolve`
- `GET /api/desktop-workspace-access/resource-catalog`
- `POST /api/desktop-workspace-access/invites`
- `GET /api/desktop-workspace-access/invites/incoming`
- `GET /api/desktop-workspace-access/invites/outgoing`
- `GET /api/desktop-workspace-access/available`
- `POST /api/desktop-workspace-access/invites/:inviteId/accept|deny|revoke`
- `POST /api/desktop-workspace-access/sessions`
- `GET /api/desktop-workspace-access/sessions/:sessionId`
- `GET /api/desktop-workspace-access/sessions/:sessionId/bootstrap`
- `POST /api/desktop-workspace-access/sessions/:sessionId/approve|deny|end`
- `POST /api/desktop-workspace-access/remote-proxy`
- `GET /api/desktop-workspace-access/asset`

Central/server:

- `POST /api/workspace-access/users/resolve`
- `POST /api/workspace-access/invites`
- `GET /api/workspace-access/invites/incoming|outgoing`
- `GET /api/workspace-access/available`
- `POST /api/workspace-access/invites/:inviteId/accept|deny|revoke`
- `POST /api/workspace-access/presence`
- `POST /api/workspace-access/sessions`
- `GET /api/workspace-access/sessions`
- `GET /api/workspace-access/sessions/:sessionId`
- `POST /api/workspace-access/sessions/:sessionId/approve|deny|activate|end`
- `POST /api/workspace-relay/session`
- `POST /api/find-relay/session`
- `POST /api/find-relay/searches`
- `POST /api/find-relay/searches/:operatorSearchId/cancel`
- `POST /api/find-relay/jobs/start`
- `POST /api/find-relay/jobs/:operatorJobRunId/stop`

## Tabelas e indices mapeados

SQLite local/bootstrap:

- `app_users` com colunas de identidade central (`central_public_id`, `central_grant_token`, device session e refresh timestamps).
- `account_memberships` e indices `idx_account_memberships_account`, `idx_account_memberships_status`.
- `account_membership_resource_grants` e indices `idx_account_membership_resource_grants_member_type`, `idx_account_membership_resource_grants_type_resource`.
- `workspace_access_settings` e indice unico `idx_workspace_access_settings_user`.
- `shared_find_cameras_cache` e indice `idx_shared_find_cameras_cache_user_scope`.
- `shared_find_invitations_cache` e indices `idx_shared_find_invitations_cache_user_direction_status`, `idx_shared_find_invitations_cache_user_camera`.
- `cameras` com campos `origin_type`, `shared_share_id`, `shared_owner_public_id`, `shared_owner_local_camera_id`, `shared_status`, `shared_permission_profile`, `shared_access_config_json`.
- `drakon_find_searches`, `drakon_find_search_cameras`, `drakon_find_hits`, `drakon_find_audit_logs` com campos `relay_request_id`, `relay_operator_camera_id` e indices de relay/scope.
- `commands`, `job_step_targets`, `job_runs` com `execution_domain` e referencias de owner remoto.
- `shared_job_segments` com indices `idx_shared_job_segments_user_job_run`, `idx_shared_job_segments_status_updated`, `idx_shared_job_segments_request_id`.

Central identity/server:

- `server_users` e `central_device_sessions`.
- `camera_find_shares` e indices por invitee/status/scope/owner.
- `shared_job_dispatches` e `shared_job_events`.
- `workspace_access_invites`, `workspace_host_presence`, `workspace_access_sessions`, `workspace_access_audit_logs` e seus indices por owner/operator/status/created_at.

## Alteracoes realizadas

- O backend local agora retorna estado degradado seguro para endpoints de leitura de Workspace Access quando o servidor central nao esta configurado, a conta ainda nao esta vinculada ou o relay central esta indisponivel:
  - `heartbeat`: `200` com `degraded: true`, `remote.relay_available: false`.
  - `active-sessions`: `200` com `sessions: []` e metadados degradados.
  - `invites/incoming`, `invites/outgoing`, `available`: `200` com listas vazias e metadados degradados.
- Acoes que dependem de servidor central continuam falhando explicitamente com `503` quando nao ha central (`users/resolve`, criar convite, aceitar/negar/revogar, criar sessao).
- `loadAccountUsersResourceCatalog` passou a tolerar SQLite novo sem tabelas opcionais de jobs/agentes, retornando arrays vazios em vez de derrubar `/api/account-users` ou `/api/desktop-workspace-access/resource-catalog`.
- Logs de relay em `workspaceRelayClient`, `sharedFindRelayClient` e caminhos de shared job foram redigidos para nao registrar payloads completos, grants, tokens, session ids, request ids ou segment ids.
- `test-local-sqlite-bootstrap` agora cobre schema local, ingestao SQLite, signup local, account users, catalogo local, listas degradadas de Workspace Access, heartbeat com relay indisponivel e ausencia de vazamento de segredo.

## Estados UI Linux

- Sem workspace remoto: listas locais voltam vazias e a UI renderiza os estados vazios existentes.
- Com dados locais: `settings`, `account-users` e `resource-catalog` continuam servidos por SQLite local.
- Relay indisponivel: endpoints de leitura retornam `degraded: true` sem erro visual de carregamento.
- Permissao negada: `requireSettingsAccess` e respostas 403 do central continuam preservadas; a UI mostra a mensagem de erro operacional.

## Suporte por recurso

Totalmente suportados localmente:

- Account owner/admin/member local com SQLite.
- Resource catalog local para cameras/jobs/agentes quando tabelas existem; vazio seguro quando ainda nao existem.
- Workspace access settings locais.
- Shared camera cache local e descritores de execucao para cameras locais e `shared_find`.
- Admissao de recursos de camera com fallback por resolucao.

Degradados localmente:

- Convites/listas/available workspaces quando o central nao esta disponivel: mostram vazio com `degraded: true`.
- Heartbeat/presenca quando relay central nao esta disponivel: retorna relay offline sem falhar a UI.
- Relay client em background: falha silenciosa/degradada sem expor identificadores sensiveis em log.

Ainda dependentes de servidor central:

- Resolver usuarios por handle/email para convites remotos.
- Criar, aceitar, negar e revogar convites reais.
- Criar e ativar sessoes remotas entre workspaces.
- Relay WebSocket efetivo (`/api/workspace-relay/session`) e relay shared find/job (`/api/find-relay/*`).
- Persistencia central de `workspace_access_*`, `camera_find_shares`, `shared_job_dispatches` e `shared_job_events`.

## Validacao executada

Passou:

```bash
cd DrakonSite
npm run test:local-sqlite-bootstrap
npm run test:platform-boundaries
npm run build
npm run visual:linux
cd ../Perceptrum
cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug -DPERCEPTRUM_ENABLE_AGENT_CORE=ON -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON
cmake --build out/build/linux-debug -j$(nproc)
ctest --test-dir out/build/linux-debug --output-on-failure
```

Resultados:

- `npm run test:local-sqlite-bootstrap`: passou.
- `npm run test:platform-boundaries`: passou.
- `npm run build`: passou.
- `npm run visual:linux`: passou na segunda execucao e gravou 16 screenshots em `DrakonSite/visual-artifacts`.
- `ctest --test-dir out/build/linux-debug --output-on-failure`: 57/57 testes passaram apos reconfigurar `linux-debug` com gates de camera/RTSP/frame writer/job runtime habilitados.

Observacoes:

- A primeira execucao de `ctest` em `out/build/linux-debug` falhou porque o cache CMake existente estava com `PERCEPTRUM_ENABLE_CAMERA_CAPTURE`, `PERCEPTRUM_ENABLE_RTSP_CAPTURE`, `PERCEPTRUM_ENABLE_FRAME_WRITER` e `PERCEPTRUM_ENABLE_JOB_RUNTIME` em `OFF`.
- A primeira execucao visual capturou um frame uniforme em `linux-host/dark/cameras`; a repeticao passou sem excecoes e com `distinctColors` adequado.
- O staging CJS do backend manteve o aviso conhecido de `import.meta`.
- WebKitGTK manteve o aviso conhecido de API depreciada `webkit_web_view_run_javascript`.
