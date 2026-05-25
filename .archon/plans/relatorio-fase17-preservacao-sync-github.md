# Relatorio fase 17 - Preservacao pre-sync GitHub

Data: 2026-05-25 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`

## Objetivo

Preservar o estado local atual antes de baixar/mesclar `origin/main`, sem resolver ainda a integracao.

## Referencias lidas

- `.archon/plans/auditoria-linux-github-recursos.md`
- `.archon/plans/relatorio-fase9-linux-run-today-webkit-local.md`
- `.archon/plans/relatorio-fase10-linux-webkit-bridge-local-session.md`
- `.archon/plans/relatorio-fase11-fluent-visual-parity-internal-pages.md`
- `.archon/plans/relatorio-fase12-linux-packaging-dev-and-deb.md`
- `.archon/plans/relatorio-fase13-linux-host-agent-session-integration.md`
- `.archon/plans/relatorio-fase14-linux-camera-discovery-runtime.md`
- `.archon/plans/relatorio-fase15-linux-agentcore-camera-rtsp-gates.md`
- `.archon/plans/relatorio-fase16-linux-final-acceptance-and-release.md`

## Refs preservadas

- HEAD local: `1d8fa6166faf526423887d55e1184c483547b953`
- `origin/main`: `be49cb0a13752cdae5f4dd211b05255799f17198`
- Branch local de seguranca: `archon/backup-before-origin-main-sync-20260525-082035`
- A branch de seguranca aponta para: `1d8fa6166faf526423887d55e1184c483547b953`

Commits remotos ausentes localmente:

```text
be49cb0 Split desktop Google OAuth and control-plane routing
b845247 Add shared camera admission and dual local backend roles
3538abd Add account access controls and desktop settings integration
bead8fa Add remote workspace access and desktop relay support
eecf43f Enable desktop daily reports and refresh Drakon branding
03e2dca Add chat tutorial flow, portal counter jobs, and GPU camera decode
```

## Backup criado

Diretorio:

```text
.archon/backups/20260525-082035-pre-origin-main-sync/
```

Arquivos criados:

```text
git-status.txt
local-head.txt
remote-head.txt
tracked.diff
staged.diff
untracked-files.txt
diff-vs-origin-main.txt
remote-files-ausentes-localmente.txt
untracked-relevant.tar.gz
```

Tamanhos verificados:

```text
0 .archon/backups/20260525-082035-pre-origin-main-sync/staged.diff
438 .archon/backups/20260525-082035-pre-origin-main-sync/remote-head.txt
1186 .archon/backups/20260525-082035-pre-origin-main-sync/remote-files-ausentes-localmente.txt
1328 .archon/backups/20260525-082035-pre-origin-main-sync/local-head.txt
1347 .archon/backups/20260525-082035-pre-origin-main-sync/git-status.txt
4838 .archon/backups/20260525-082035-pre-origin-main-sync/untracked-files.txt
14445 .archon/backups/20260525-082035-pre-origin-main-sync/diff-vs-origin-main.txt
111940 .archon/backups/20260525-082035-pre-origin-main-sync/tracked.diff
139871 .archon/backups/20260525-082035-pre-origin-main-sync/untracked-relevant.tar.gz
```

`staged.diff` tem 0 bytes porque nao havia alteracoes staged no momento do backup. Os demais arquivos aplicaveis tem tamanho maior que zero.

O tar de untracked relevantes foi criado a partir de `untracked-files.txt`, excluindo `.git`, `node_modules`, `dist`, `out`, `.visual-chrome-profile`, `visual-artifacts`, `.archon/backups` e caches/diretorios temporarios grandes.

## Inventario local preservado

Alteracoes tracked locais:

```text
.gitignore
AppHost/Runtime/desktop-local-server.mjs
DrakonSite/package.json
DrakonSite/server/brand.ts
DrakonSite/server/index.ts
DrakonSite/src/react-app/components/Layout.tsx
DrakonSite/src/react-app/components/jobs/JobsTabs.tsx
DrakonSite/src/react-app/components/settings/SettingsTabs.tsx
DrakonSite/src/react-app/index.css
DrakonSite/src/react-app/pages/Billing.tsx
DrakonSite/src/react-app/pages/Events.tsx
DrakonSite/src/worker/index.ts
Perceptrum/Perceptrum/comm/PairingClient.cpp
Perceptrum/Perceptrum/comm/PairingClient.h
Perceptrum/Perceptrum/logging/Logging.cpp
Perceptrum/Perceptrum/platform/platform_secure_store.cpp
Perceptrum/Perceptrum/runtime/BrandingRuntime.h
Perceptrum/Perceptrum/runtime/HeadlessService.cpp
Perceptrum/Perceptrum/runtime/HeadlessService.h
```

Untracked relevantes preservados no tar:

- `.archon/plans/*`
- `.archon/prompts/*`
- `DrakonSite/docs/visual-battery.md`
- `DrakonSite/scripts/assert-platform-boundaries.mjs`
- `DrakonSite/scripts/test-local-sqlite-bootstrap.mjs`
- `DrakonSite/scripts/visual-battery.mjs`
- `DrakonSite/server/camera-discovery.ts`
- `Perceptrum/CMakeLists.txt`
- `Perceptrum/Perceptrum/core/AgentCoreStatus.cpp`
- `Perceptrum/Perceptrum/core/AgentCoreStatus.h`
- `Perceptrum/Perceptrum/runtime/interfaces/*`
- `Perceptrum/linux-desktop/*`
- `Perceptrum/linux/*`
- `RUNBOOK-LINUX.md`

Arquivos funcionais em `origin/main` ausentes no `HEAD` local, conforme backup:

```text
DrakonSite/src/react-app/components/settings/AccountUsersPanel.tsx
DrakonSite/src/react-app/components/settings/WorkspaceAccessPanel.tsx
DrakonSite/src/react-app/contexts/RemoteWorkspaceContext.tsx
DrakonSite/src/react-app/hooks/useAgentCameraDirectory.ts
DrakonSite/src/react-app/hooks/useEffectiveUser.ts
DrakonSite/src/react-app/lib/accountAccess.ts
DrakonSite/src/react-app/lib/onboardingChat.ts
DrakonSite/src/react-app/tutorialChatStepTranslations.ts
DrakonSite/src/react-app/utils/cameraCaptureAcceleration.ts
DrakonSite/src/react-app/utils/sharedCameraPresentation.ts
DrakonSite/src/tests/scheduleUtils.test.ts
DrakonSite/src/worker/accountAccess.ts
DrakonSite/src/worker/cameraResourceAdmission.ts
DrakonSite/src/worker/localAgentIngress.ts
DrakonSite/src/worker/operationalQuery/__tests__/db.test.ts
DrakonSite/src/worker/operationalQuery/__tests__/planner.test.ts
DrakonSite/src/worker/sharedCameraAccess.ts
DrakonSite/src/worker/sharedJobPlan.ts
DrakonSite/src/worker/workspaceLocalState.ts
DrakonSite/src/worker/workspaceRelayClient.ts
DrakonSite/src/worker/workspaceRelayState.ts
Perceptrum/Perceptrum/camera/PortalCounter.cpp
Perceptrum/Perceptrum/camera/PortalCounter.h
```

## Plano de conflitos provaveis

### AppHost/Runtime e backend local

- `AppHost/Runtime/desktop-local-server.mjs` tem alteracao local da fase 16 para `GET /__perceptrum/health`; `origin/main` tambem altera o runtime desktop para OAuth desktop, roteamento control-plane e backend local.
- `DrakonSite/server/index.ts` recebeu localmente `/api/runtime/local-session`, camera discovery local e fluxo SQLite local; `origin/main` traz ingress do agente local, dual local backend roles, OAuth/control-plane e relay.
- Plano seguro: mesclar por contrato de endpoint, preservando `/__perceptrum/health`, `/api/runtime/local-session`, `/api/runtime/camera-discovery`, health SQLite local e as novas rotas remotas. Depois validar backend local com smoke HTTP antes de build visual.

### DrakonSite worker/backend SQLite/local runtime

- `DrakonSite/src/worker/index.ts` e arquivos novos remotos de worker concentram o maior risco. O diff contra `origin/main` mostra grande divergencia em worker, scheduler, access controls, relay e shared camera admission.
- Arquivos remotos ausentes localmente incluem `localAgentIngress.ts`, `sharedCameraAccess.ts`, `cameraResourceAdmission.ts`, `workspaceLocalState.ts`, `workspaceRelayClient.ts` e `workspaceRelayState.ts`.
- Plano seguro: aceitar a arquitetura modular remota como base, reaplicar os endpoints/fallbacks Linux localmente e garantir que SQLite/local runtime continue sem depender de Cloudflare-only APIs no desktop.

### UI React/Fluent

- Mudancas locais de fase 11 alteram `Layout.tsx`, `index.css`, abas de settings/jobs e paginas `Events`/`Billing` para paridade Fluent e bateria visual Linux.
- `origin/main` adiciona `AccountUsersPanel.tsx`, `WorkspaceAccessPanel.tsx`, `RemoteWorkspaceContext`, hooks de usuario efetivo, onboarding chat, apresentacao de camera compartilhada e aceleracao de captura.
- Plano seguro: preservar os novos componentes e fluxos remotos, reaplicar tokens/classes Fluent comuns sem remover telas novas. Apos merge, rodar build e bateria visual browser/Linux cobrindo `/dashboard`, `/cameras`, `/ai-agents`, `/jobs`, `/chat`, `/settings`, `/events` e `/billing`.

### Perceptrum C++ AgentCore/Camera/Jobs

- Localmente existem adaptadores Linux, `AgentCoreStatus`, interfaces de runtime, `PairingClient` portavel, secure store Linux e gates RTSP thumbnail.
- `origin/main` altera `AgentCore`, `CameraSession`, `FrameDiskWriter`, `JobRuntime`, `RtspCapture` e adiciona `PortalCounter`.
- Plano seguro: trazer os arquivos remotos pesados como base para Windows/runtime completo, mantendo o target Linux protegido por gates e sem compilar fontes Win32 no caminho Linux padrao. Depois revisar explicitamente `CMakeLists.txt` para garantir que `AgentCore.cpp`, `CameraSession.cpp`, `FrameDiskWriter.cpp` e `JobRuntime.cpp` so entrem no Linux quando portados.

### Linux host, CMake e packaging

- O suporte Linux local vive majoritariamente em arquivos untracked: `Perceptrum/CMakeLists.txt`, `Perceptrum/linux-desktop/*`, `Perceptrum/linux/*` e `RUNBOOK-LINUX.md`.
- `origin/main` traz alteracoes em AppHost packaging e projetos Windows, mas nao contem a estrutura Linux local.
- Plano seguro: antes de qualquer resolucao, adicionar/mesclar os arquivos Linux como arquivos novos preservados; entao reconciliar packaging para manter `.deb`, launcher, backend packaged, seed SQLite, dependencias Debian e scripts de validacao sem interferir no Windows.

## Veredito para Prompt 18

E seguro executar o Prompt 18 somente no sentido de iniciar a integracao controlada, porque:

- `git fetch --prune origin` foi executado.
- O HEAD local foi preservado em branch local de seguranca.
- Diffs tracked/staged, lista de untracked, tar de untracked relevantes e comparativos contra `origin/main` foram salvos.
- Os arquivos de backup aplicaveis foram verificados.
- Nenhum push foi feito.
- Nenhum comando destrutivo foi executado.

A integracao em si continua de alto risco e deve ser tratada arquivo por arquivo, especialmente `DrakonSite/src/worker/index.ts`, `DrakonSite/server/index.ts`, `AppHost/Runtime/desktop-local-server.mjs`, UI settings/cameras/jobs e C++ camera/jobs.
