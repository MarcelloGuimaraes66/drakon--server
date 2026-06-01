# Relatorio fase 36 - preservar porta Ubuntu e inventariar novidades GitHub

## Escopo executado

Esta fase preservou o estado local antes de qualquer integracao com `origin/main`.
Nao houve merge, rebase, reset, restore, checkout destrutivo, commit ou push.

Backup criado:

`.archon/backups/20260530-172722-pre-github-novidades-ubuntu/`

Arquivos principais salvos no backup:

- `initial-and-fetched-state.txt`
- `git-status.txt`
- `local-head.txt`
- `origin-main-head.txt`
- `merge-base.txt`
- `tracked.diff`
- `staged.diff`
- `untracked-files.txt`
- `remote-new-commits.txt`
- `remote-new-files.txt`
- `remote-new-stat.txt`
- `local-linux-files.txt`
- `untracked-relevant.tar.gz`

## Estado Git confirmado

Branch local:

`archon/linux-port-origin-main-sync`

HEAD local:

`9b62740e78d6c7440b6ab62ace52b7b97c8acccc`

HEAD remoto `origin/main` apos `git fetch origin --prune`:

`4357fcc6f1a4ecffc2dfbba53ece6216b0f95077`

Merge-base usado:

`be49cb0a13752cdae5f4dd211b05255799f17198`

Observacao: o fetch confirmou que `origin/main` permanece em `4357fcc`; nao apareceram commits novos alem dos dois ja esperados.

## Commits novos no GitHub

- `4357fcc Preserve central identity brand hint on refresh`
- `673c297 Expand shared access and desktop packaging flows`

Resumo remoto desde o merge-base:

- 26 arquivos alterados
- 4401 insercoes
- 486 remocoes

## Arquivos novos/alterados por area

### Identidade central e brand

- `DrakonSite/server/brand.ts`
- `DrakonSite/src/worker/centralIdentity.ts`
- `DrakonSite/src/worker/centralIdentityBrandHint.ts`
- `DrakonSite/src/worker/index.ts`
- `DrakonSite/src/worker/localIdentity.ts`
- `DrakonSite/src/tests/centralIdentityBrandHint.test.ts`

Mudancas principais:

- `APP_RUNTIME_ENV=server` passa a forcar backend `postgres`.
- `server_users` ganha `brand_id`.
- unicidade de email/handle passa a ser por realm de brand.
- grants de identidade central passam a carregar `brand_id`.
- refresh de contexto central passa a reaproveitar hint de brand do grant.
- login local/Google ganha fluxo mais rigoroso de relink, reauth e erro por brand.
- novo helper `centralIdentityBrandHint.ts` extrai hint de brand do grant.

### Shared access, jobs e permissoes

- `DrakonSite/src/shared/types.ts`
- `DrakonSite/src/worker/accountAccess.ts`
- `DrakonSite/src/worker/index.ts`
- `DrakonSite/src/worker/jobScheduler.ts`
- `DrakonSite/src/worker/sharedJobPlan.ts`
- `DrakonSite/src/react-app/components/CameraEditorModal.tsx`
- `DrakonSite/src/react-app/pages/DrakonFind.tsx`
- `DrakonSite/src/react-app/components/NotificationsDropdown.tsx`
- `DrakonSite/src/react-app/components/Layout.tsx`
- `DrakonSite/src/react-app/hooks/useDashboardAlerts.ts`

Mudancas principais:

- convites de shared find passam a expor `invitee_handle` e `invitee_email`.
- shared job segments ganham `preserve_running_camera_ids_json` e `allow_event_media`.
- jobs compartilhados passam a resolver desktop runtime do dono da camera com mais validacao.
- sync de convites compartilhados entra no layout/notificacoes.
- UI de convite passa a mostrar handles/emails e estados localizados.
- `accountAccess.ts` troca literais booleanos SQL por `1`.

### UI React, i18n e notificacoes

- `DrakonSite/src/react-app/components/CameraCustomAgentEditorModal.tsx`
- `DrakonSite/src/react-app/components/CameraEditorModal.tsx`
- `DrakonSite/src/react-app/components/Layout.tsx`
- `DrakonSite/src/react-app/components/NotificationsDropdown.tsx`
- `DrakonSite/src/react-app/hooks/useDashboardAlerts.ts`
- `DrakonSite/src/react-app/i18n.ts`
- `DrakonSite/src/react-app/pages/DrakonFind.tsx`
- `DrakonSite/src/react-app/pages/Jobs.tsx`
- `DrakonSite/src/react-app/pages/Settings.tsx`

Mudancas principais:

- novos textos i18n para editor de prompt, shared camera access e Drakon Find.
- notificacoes passam a hidratar/sincronizar convites de acesso compartilhado.
- Drakon Find exibe convites pendentes com acoes de aceitar/recusar.
- Jobs remove strings hardcoded de passos e prompt editor.
- Settings pode solicitar ao AppHost abertura de URL externa em janela do desktop.

### Windows AppHost, packaging e signing

- `.gitignore`
- `AppHost/App.xaml.cpp`
- `AppHost/App.xaml.h`
- `AppHost/Pages/SiteHostPage.xaml.cpp`
- `AppHost/Packaging/AppHost.iss`
- `AppHost/Packaging/build.ps1`
- `AppHost/Packaging/sign-windows-artifacts.ps1`

Mudancas principais:

- novo bridge `open-external-url-window` da web para AppHost.
- AppHost valida URLs HTTP/HTTPS e abre via shell do Windows.
- instalador Inno ajustado para ingles e sem dialogo de idioma.
- build passa a sugerir script de assinatura.
- novo script `sign-windows-artifacts.ps1` para assinar payload/installer por thumbprint, subject ou PFX.
- `.gitignore` ignora snapshots `_deploy`, dumps temporarios e `AppHost/stage-hotfix-*`.

### Testes novos

- `DrakonSite/src/tests/centralIdentityBrandHint.test.ts`

O teste cobre preservacao do hint de brand durante refresh de identidade central.

### Schema e banco

- `DrakonSite/src/worker/centralIdentity.ts`
- `DrakonSite/src/worker/index.ts`
- `DrakonSite/src/worker/localIdentity.ts`
- `DrakonSite/src/worker/accountAccess.ts`
- `DrakonSite/src/worker/jobScheduler.ts`

Mudancas principais:

- `server_users.brand_id`.
- indices unicos por `brand_id` e email/handle normalizados.
- rebuild SQLite de `server_users` quando necessario para remover unicidade global de email.
- suporte Postgres para migracao de referencias de `app_users`.
- `app_users` troca indice unico global de email por indice de lookup.
- `shared_find_invitations_cache` ganha `invitee_handle` e `invitee_email`.
- `shared_job_segments` ganha `preserve_running_camera_ids_json` e `allow_event_media`.

## Conflitos provaveis e arquivos de maior risco

### Sobreposicao exata local x remoto

- `DrakonSite/src/worker/index.ts`

Este e o maior risco da proxima fase:

- diff remoto: 1 arquivo, 2111 insercoes e 315 remocoes.
- diff local atual: 1 arquivo, 421 insercoes e 111 remocoes.
- o arquivo concentra identidade central, shared access, jobs, camera command routing, schema e endpoints.
- a porta Ubuntu tambem alterou fluxos de camera/jobs/runtime nesse arquivo.

### Risco sem sobreposicao exata, mas com acoplamento funcional

- `DrakonSite/src/worker/jobScheduler.ts` e `DrakonSite/src/worker/sharedJobPlan.ts`: remoto muda plano de jobs compartilhados; porta Ubuntu tem runtime/jobs locais em arquivos proximos.
- `DrakonSite/src/worker/centralIdentity.ts` e `DrakonSite/src/worker/localIdentity.ts`: remoto muda schema/migracoes e pode afetar SQLite local usado pelo desktop Ubuntu.
- `DrakonSite/src/react-app/components/CameraEditorModal.tsx`, `DrakonSite/src/react-app/pages/DrakonFind.tsx`, `NotificationsDropdown.tsx` e `Layout.tsx`: remoto muda shared camera access; porta Ubuntu tem mudancas locais em cameras e workspace access em outros componentes.
- `AppHost/*`: remoto e Windows-only, mas deve ser mantido isolado para nao contaminar a porta Ubuntu.
- `.gitignore`: remoto adiciona regras; verificar antes de integrar para nao esconder artefatos Archon ou Linux relevantes.

### Arquivos locais Linux/Ubuntu preservados no inventario

O inventario detalhado esta em:

`.archon/backups/20260530-172722-pre-github-novidades-ubuntu/local-linux-files.txt`

Inclui alteracoes e untracked em `Perceptrum/linux*`, `RUNBOOK-LINUX.md`, scripts/testes Linux, camera/jobs/runtime e relatorios/prompts Archon.

## Confirmacao de arquivos funcionais

Nesta fase, os unicos arquivos criados devem ser artefatos de preservacao/inventario:

- `.archon/backups/20260530-172722-pre-github-novidades-ubuntu/*`
- `.archon/plans/relatorio-fase36-preservar-porta-ubuntu-e-inventariar-novidades-github.md`

Nao foi feita integracao de codigo funcional.

## Recomendacao para Prompt 37

E seguro seguir para o Prompt 37 somente com uma estrategia de integracao seletiva e arquivo-a-arquivo.

Recomendacao objetiva:

- seguir para o Prompt 37;
- preservar o backup desta fase como ponto de retorno manual;
- integrar primeiro identidade central/brand e shared access fora de `worker/index.ts` quando possivel;
- tratar `DrakonSite/src/worker/index.ts` como conflito critico e revisar manualmente cada bloco, preservando camera/jobs/runtime Linux;
- nao aplicar merge amplo automatico sobre a arvore local.

