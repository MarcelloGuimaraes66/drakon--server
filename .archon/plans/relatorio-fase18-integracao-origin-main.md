# Relatorio fase 18 - Integracao origin/main sem perder porta Linux

Data: 2026-05-25 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Branch local: `archon/linux-port-origin-main-sync`

## Objetivo

Integrar `origin/main` preservando a porta Linux/Ubuntu local, sem push.

## Backup Prompt 17

Backup validado antes da integracao:

```text
.archon/backups/20260525-082035-pre-origin-main-sync/
```

Validacoes feitas:

- `untracked-relevant.tar.gz` passou em `gzip -t`.
- `local-head.txt` aponta para commit existente `1d8fa6166faf526423887d55e1184c483547b953`.
- `remote-head.txt` aponta para commit existente `be49cb0a13752cdae5f4dd211b05255799f17198`.
- Branch de seguranca existente: `archon/backup-before-origin-main-sync-20260525-082035`.

## Commits locais criados

- `94d2fe7` - `Checkpoint Linux port before origin main sync`
- `HEAD` - `Merge origin main into Linux port`

Nenhum push foi feito.

## Conflitos resolvidos

- `.gitignore`: preservados ignores locais de empacotamento Linux (`_CPack_Packages/`, `perceptrum-desktop_*.deb`, `perceptrum-desktop_*.tar.gz`) e incorporados ignores remotos (`scratch/`, `/-`).
- `DrakonSite/server/index.ts`: preservados `APP_STATIC_ROOT`, `/__perceptrum/health`, `/api/runtime/local-session`, `/api/runtime/camera-discovery` e fallback/static local; incorporados `APP_AGENT_BASE_URL`, `APP_SERVER_ROLE`, proxy de `/api/agent`, relay websocket, workspace relay e `startLocalAgentIngressPump`.
- `DrakonSite/src/react-app/components/Layout.tsx`: preservado shell Fluent comum (`fluent-shell`, `fluent-commandbar`, `fluent-toolbar-button`, `fluent-flyout`) e incorporados indicadores/sessoes de workspace remoto, controles de acesso e gating por permissoes.
- `Perceptrum/Perceptrum/logging/Logging.cpp`: preservado gate Linux que desabilita exportacao remota sem token store explicito; incorporado uso remoto de `GetPerceptrumAgentBaseUrl()` no caminho nao Linux.

## Decisoes de integracao

- AppHost continua recebendo as mudancas Windows-only de `origin/main`; a porta Linux nao passa a depender de WinUI/WebView2.
- React comum manteve a barreira de plataforma: sem dependencia WinUI, GTK ou WebView2.
- Backend local preservou SQLite/local-session/camera-discovery e passou a conter ingress local do agente, papeis UI/agent e relay de workspace.
- C++ incorporou AgentCore/camera/jobs/PortalCounter/GPU decode de `origin/main`, enquanto o target Linux padrao continua validado como runtime minimo com gates.
- `brand.config.json` manteve `activeBrand` como `perceptrum` apos o build local e incorporou `workspaceAccessEnabled`.

## Arquivos alterados pelo merge

```text
.gitignore
AppHost/App.xaml.cpp
AppHost/App.xaml.h
AppHost/AppHost.vcxproj
AppHost/MainWindow.xaml.cpp
AppHost/MainWindow.xaml.h
AppHost/Packaging/stage-runtime.mjs
AppHost/Pages/JobsPage.xaml.cpp
AppHost/Pages/SettingsPage.xaml
AppHost/Pages/SettingsPage.xaml.cpp
AppHost/Pages/SettingsPage.xaml.h
AppHost/Pages/ShellPage.xaml.cpp
AppHost/Pages/ShellPage.xaml.h
AppHost/Pages/SiteHostPage.xaml.cpp
AppHost/Pages/SiteHostPage.xaml.h
AppHost/Platform/AppRuntimeConfig.cpp
AppHost/Platform/AppRuntimeConfig.h
AppHost/Platform/LocalBackendHost.cpp
AppHost/Platform/LocalBackendHost.h
AppHost/Platform/PerceptrumRuntimeHost.cpp
AppHost/Platform/TrayIconHost.cpp
AppHost/Runtime/desktop-local-server.mjs
AppHost/Services/DrakonApiClient.cpp
AppHost/Services/DrakonApiClient.h
DrakonSite/.env.local.example
DrakonSite/.env.server.example
DrakonSite/README.md
DrakonSite/deploy_backend.sh
DrakonSite/docs/central-auth-deploy.md
DrakonSite/ops/nginx/perceptrum-central-auth.nginx.conf.example
DrakonSite/ops/secrets/central-auth.env.example
DrakonSite/server/index.ts
DrakonSite/server/pg-d1.ts
DrakonSite/src/react-app/App.tsx
DrakonSite/src/react-app/components/CameraBulkImportModal.tsx
DrakonSite/src/react-app/components/CameraCustomAgentEditorModal.tsx
DrakonSite/src/react-app/components/CameraEventToast.tsx
DrakonSite/src/react-app/components/ChatInput.tsx
DrakonSite/src/react-app/components/Layout.tsx
DrakonSite/src/react-app/components/NotificationsDropdown.tsx
DrakonSite/src/react-app/components/ScheduleBuilder.tsx
DrakonSite/src/react-app/components/SystemActivityModal.tsx
DrakonSite/src/react-app/components/TutorialOverlay.tsx
DrakonSite/src/react-app/components/settings/AccountUsersPanel.tsx
DrakonSite/src/react-app/components/settings/SettingsTabs.tsx
DrakonSite/src/react-app/components/settings/WorkspaceAccessPanel.tsx
DrakonSite/src/react-app/contexts/EventsContext.tsx
DrakonSite/src/react-app/contexts/RemoteWorkspaceContext.tsx
DrakonSite/src/react-app/hooks/useAgentCameraDirectory.ts
DrakonSite/src/react-app/hooks/useCameraEvents.tsx
DrakonSite/src/react-app/hooks/useDashboardAlertRefresh.ts
DrakonSite/src/react-app/hooks/useEffectiveUser.ts
DrakonSite/src/react-app/hooks/useOnboarding.tsx
DrakonSite/src/react-app/hooks/useThumbnailPolling.tsx
DrakonSite/src/react-app/i18n.ts
DrakonSite/src/react-app/lib/DashboardSummaryStore.ts
DrakonSite/src/react-app/lib/accountAccess.ts
DrakonSite/src/react-app/lib/onboarding.ts
DrakonSite/src/react-app/lib/onboardingChat.ts
DrakonSite/src/react-app/pages/AIAgents.tsx
DrakonSite/src/react-app/pages/Cameras.tsx
DrakonSite/src/react-app/pages/Chat.tsx
DrakonSite/src/react-app/pages/Hub.tsx
DrakonSite/src/react-app/pages/Jobs.tsx
DrakonSite/src/react-app/pages/Settings.tsx
DrakonSite/src/react-app/tutorialChatStepTranslations.ts
DrakonSite/src/react-app/utils/cameraCaptureAcceleration.ts
DrakonSite/src/react-app/utils/cameraService.ts
DrakonSite/src/react-app/utils/scheduleUtils.ts
DrakonSite/src/react-app/utils/sharedCameraPresentation.ts
DrakonSite/src/shared/brand.ts
DrakonSite/src/shared/cameraImport.ts
DrakonSite/src/shared/types.ts
DrakonSite/src/tests/scheduleUtils.test.ts
DrakonSite/src/worker/accountAccess.ts
DrakonSite/src/worker/accountDeletion.ts
DrakonSite/src/worker/cameraResourceAdmission.ts
DrakonSite/src/worker/centralIdentity.ts
DrakonSite/src/worker/env.d.ts
DrakonSite/src/worker/index.ts
DrakonSite/src/worker/jobScheduler.ts
DrakonSite/src/worker/localAgentIngress.ts
DrakonSite/src/worker/operationalQuery/__tests__/db.test.ts
DrakonSite/src/worker/operationalQuery/__tests__/executor.test.ts
DrakonSite/src/worker/operationalQuery/__tests__/planner.test.ts
DrakonSite/src/worker/operationalQuery/db.ts
DrakonSite/src/worker/operationalQuery/executor.ts
DrakonSite/src/worker/operationalQuery/grounding.ts
DrakonSite/src/worker/operationalQuery/planner.ts
DrakonSite/src/worker/operationalQuery/schema.ts
DrakonSite/src/worker/sharedCameraAccess.ts
DrakonSite/src/worker/sharedFindRelayState.ts
DrakonSite/src/worker/sharedJobPlan.ts
DrakonSite/src/worker/workspaceLocalState.ts
DrakonSite/src/worker/workspaceRelayClient.ts
DrakonSite/src/worker/workspaceRelayState.ts
Perceptrum/Perceptrum/Perceptrum.cpp
Perceptrum/Perceptrum/Perceptrum.vcxproj
Perceptrum/Perceptrum/Perceptrum.vcxproj.filters
Perceptrum/Perceptrum/camera/CameraConfig.h
Perceptrum/Perceptrum/camera/CameraSession.cpp
Perceptrum/Perceptrum/camera/CameraSession.h
Perceptrum/Perceptrum/camera/FrameDiskWriter.cpp
Perceptrum/Perceptrum/camera/FrameDiskWriter.h
Perceptrum/Perceptrum/camera/PortalCounter.cpp
Perceptrum/Perceptrum/camera/PortalCounter.h
Perceptrum/Perceptrum/camera/RtspCapture.cpp
Perceptrum/Perceptrum/camera/RtspCapture.h
Perceptrum/Perceptrum/comm/BackendConfig.h
Perceptrum/Perceptrum/core/AgentCore.cpp
Perceptrum/Perceptrum/core/AgentCore.h
Perceptrum/Perceptrum/jobs/JobPayloadParser.cpp
Perceptrum/Perceptrum/jobs/JobRuntime.cpp
Perceptrum/Perceptrum/jobs/JobRuntime.h
Perceptrum/Perceptrum/jobs/JobTypes.h
Perceptrum/Perceptrum/logging/Logging.cpp
Perceptrum/Perceptrum/runtime/HeadlessService.cpp
Perceptrum/PerceptrumCore/PerceptrumCore.vcxproj
brand.config.json
branding/apply-brand.mjs
```

## Validacao executada

Passou:

```bash
git status --short --branch
cd DrakonSite && npm run test:platform-boundaries
cd DrakonSite && npm run test:local-sqlite-bootstrap
cd DrakonSite && npm run test:semantic
cd DrakonSite && npm run build
cd Perceptrum && cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
cd Perceptrum && cmake --build out/build/linux-debug -j$(nproc)
cd Perceptrum && ctest --test-dir out/build/linux-debug --output-on-failure
```

Resultados:

- `test:platform-boundaries`: OK.
- `test:local-sqlite-bootstrap`: OK.
- `test:semantic`: 15/15 OK.
- `npm run build`: OK (`tsc -b` e Vite).
- CMake configure: OK.
- CMake build: OK.
- CTest: 52/52 OK.

Observacao: o build CMake exibiu warnings do esbuild sobre `import.meta` no bundle CJS de `desktop-local-server.mjs`, mas a compilacao concluiu e os testes passaram.

## Falhas restantes

Nenhuma falha restante para esta fase. O repositorio integrado compila no caminho validado Linux e os testes obrigatorios passaram.
