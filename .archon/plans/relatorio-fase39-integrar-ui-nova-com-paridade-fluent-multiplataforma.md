# Relatorio fase 39 - integrar UI nova com paridade Fluent multiplataforma

## Escopo executado

Integracao seletiva das novidades de UI React vindas de `origin/main` desde o merge-base da fase 36, preservando as alteracoes locais de paridade Fluent, Linux camera/jobs runtime e shared access ja aplicadas nas fases 37 e 38.

Nao houve commit, push, reset, clean, restore destrutivo ou merge amplo.

## Telas e arquivos alterados

- `DrakonSite/src/react-app/components/Layout.tsx`
- `DrakonSite/src/react-app/components/NotificationsDropdown.tsx`
- `DrakonSite/src/react-app/components/CameraEditorModal.tsx`
- `DrakonSite/src/react-app/components/CameraCustomAgentEditorModal.tsx`
- `DrakonSite/src/react-app/pages/Settings.tsx`
- `DrakonSite/src/react-app/pages/Jobs.tsx`
- `DrakonSite/src/react-app/pages/DrakonFind.tsx`
- `DrakonSite/src/react-app/i18n.ts`
- `DrakonSite/package.json`
- `DrakonSite/scripts/visual-battery.mjs`
- `DrakonSite/docs/visual-battery.md`

Tambem foram revisados, sem mudanca funcional nesta fase, os fluxos de status/erro de camera em `Cameras.tsx`, `AIAgents.tsx` e `cameraService.ts`.

## Novidades do GitHub incorporadas

- `Layout` agora sincroniza notificacoes de shared find em background, em foco e por intervalo, chamando `dashboardSummaryStore.refresh()` apos sincronizacao.
- `NotificationsDropdown` agora:
  - sincroniza convites de shared find ao abrir;
  - abre modal de convite pendente;
  - carrega dados do convite por share id;
  - permite aceitar ou recusar o convite;
  - atualiza o contador/notificacoes apos acoes.
- `CameraEditorModal` agora mostra convites de shared access com `@handle`/email quando disponivel, filtra convites revogados/negados e localiza mensagens/erros.
- `DrakonFind` agora mostra convites pendentes com textos localizados, origem por handle/email e toasts de aceite/recusa.
- `Settings` incorporou o bridge remoto `open-external-url-window` para abrir links de chaves OpenAI/Z.ai no AppHost quando disponivel, mantendo fallback normal de browser.
- `Jobs` e `CameraCustomAgentEditorModal` agora enviam `language: "match_input_language"` no enhancement de prompt.
- `Jobs` incorporou os textos remotos localizados para criacao de steps.
- `i18n` recebeu chaves de shared camera access, shared find invitations e textos de steps.

## Ajustes Fluent realizados

- A UI nova foi adaptada para usar classes/tokens Fluent existentes (`fluent-flyout`, `fluent-modal-panel`, `fluent-panel`, `fluent-toolbar-button`, `fluent-primary-button`, `fluent-status-*`) em vez de introduzir novos gradientes/sombras no dropdown/modal de notificacoes.
- A secao de convites pendentes em Drakon Find foi convertida para painel Fluent, removendo o gradiente novo do diff remoto.
- A bateria visual agora inclui `/drakon-find`, os temas `dark` e `light`, browser e Linux host.
- `visual:battery` foi adicionado como alias para executar a matriz existente com `--target all`; Windows WebView2 continua condicionado a `VISUAL_WINDOWS_WEBVIEW2_URL`.

## Evidencias de validacao

- `git status --short --branch`: executado; branch `archon/linux-port-origin-main-sync`, worktree ja continha varias alteracoes locais preexistentes.
- `cd DrakonSite && npm run test:platform-boundaries`: passou.
- `cd DrakonSite && npm run build`: passou.
- `cd DrakonSite && npm run visual:battery`: passou.
  - 44 screenshots gerados em `DrakonSite/visual-artifacts`.
  - 22 screenshots `browser`.
  - 22 screenshots `linux-host`.
  - Rotas cobertas: `/dashboard`, `/cameras`, `/ai-agents`, `/jobs`, `/drakon-find`, `/chat`, `/settings`, `/settings?tab=users`, `/settings?tab=workspace-access`, `/events`, `/billing`.
  - Temas cobertos: `dark` e `light`.
  - `windows-webview2` foi pulado de forma controlada por falta de `VISUAL_WINDOWS_WEBVIEW2_URL`.
- `git diff --check`: passou sem output.

## Status de camera/jobs

Os fluxos de camera/jobs preservados nas fases anteriores seguem presentes:

- `Cameras.tsx` e `AIAgents.tsx` continuam usando `describeCameraStartBlockedError` e `describeCameraStartFailureError`.
- `cameraService.ts` continua propagando `error_code`, payload de falha e diagnosticos de start failure.
- Notificacoes de `camera_start_blocked`, `agent_api_error`, `job_start_blocked`, `job_step_start_blocked`, `job_staled` e `job_started` continuam roteadas para Cameras/Jobs/Agents conforme o tipo.

## Pontos dependentes de validacao manual

- Abrir o desktop Linux real e confirmar interacao visual com convites de shared access quando houver convites pendentes reais.
- Validar aceite/recusa de shared find contra backend central real com contas distintas.
- Validar abertura de URL externa de Settings no AppHost Windows/WebView2 real.
- Validar WebView2 visual com `VISUAL_WINDOWS_WEBVIEW2_URL` apontando para host Windows ativo.
- Revalidar start/stop de camera WEBCAM/RTSP e jobs com agente residente real, pois a bateria visual usa fixtures/mocks.
