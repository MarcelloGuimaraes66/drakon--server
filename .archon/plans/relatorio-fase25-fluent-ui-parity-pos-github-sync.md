# Relatorio fase 25 - Fluent UI parity pos GitHub sync

Data: 2026-05-25 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Branch local: `archon/linux-port-origin-main-sync`
Push: nao realizado

## Objetivo

Converter e validar as telas internas novas/alteradas depois do sync GitHub para usar os tokens Fluent centralizados do shell React comum, preservando paridade visual entre Linux host e Windows WebView2.

## Contexto lido

- `.archon/plans/relatorio-fase24-linux-shared-camera-workspace-access-parity.md`
- `DrakonSite/docs/visual-battery.md`

## Varredura visual

Foram varridos `DrakonSite/src/react-app` e `DrakonSite/scripts/visual-battery.mjs` para classes/padroes de:

- cards/superficies proprias (`bg-gray-*`, `bg-slate-*`, `bg-[#...]`, `bg-white/[...]`)
- gradientes (`bg-gradient-*`, `linear-gradient`, `radial-gradient`, `from-*`, `via-*`, `to-*`)
- sombras (`shadow-*`, `shadow-[...]`)
- bordas e textos por cor fora dos tokens Fluent
- raio grande em cards e paineis (`rounded-2xl`, `rounded-3xl`, `rounded-[...]`)

As telas antigas ainda contem classes Tailwind locais no TSX, especialmente Dashboard, Jobs, Chat, Billing e Settings. A paridade foi mantida por uma camada central em `.fluent-internal-content`, que agora neutraliza gradientes/sombras/raios grandes e remapeia cores para tokens Fluent em dark/light. As telas novas de account/workspace tambem receberam classes Fluent explicitas nos principais paineis, inputs, botoes e modais.

## Telas migradas/ajustadas

- Dashboard: coberto pela camada central Fluent para superficies, sombras, gradientes, bordas, textos e raios.
- Cameras: coberto pela camada central; bateria visual agora inclui uma camera `shared_find` para validar badge/estado de camera compartilhada.
- Jobs: coberto pela camada central, incluindo editor/modal e estados densos.
- Chat: coberto pela camada central para gradientes, sombras, flyouts e paineis internos.
- Events: coberto pela camada central para lista, detalhes, media e botoes.
- Billing: coberto pela camada central para hero/plans/tabelas, removendo efeito visual de gradientes/sombras proprios em runtime.
- Settings: coberto pela camada central; os principais paineis de perfil/conectividade/API continuam normalizados pelo shell.
- Account users: `AccountUsersPanel` passou a usar `fluent-card`, `fluent-input`, `fluent-toolbar-button` e `fluent-primary-button` em header, formulario de criacao, lista de usuarios, editores, escopos e password reset.
- Workspace access: `WorkspaceAccessPanel` passou a usar `fluent-card`, `fluent-input`, `fluent-toolbar-button`, `fluent-primary-button`, `fluent-modal-backdrop` e `fluent-modal-panel` em policy/share/incoming/outgoing/available, dialogo de convite e estados de carregamento/aviso.
- Shared camera/workspace flows: fixtures visuais cobrem camera compartilhada, account users, invites incoming/outgoing, available workspace e grants por recurso.

## Arquivos alterados

- `DrakonSite/src/react-app/index.css`
  - adiciona tokens de texto success/warning/danger.
  - adiciona `fluent-primary-button` e estados Fluent.
  - amplia normalizacao de cores, bordas, sombras, backdrop e raios em `.fluent-internal-content`.
- `DrakonSite/src/react-app/components/settings/AccountUsersPanel.tsx`
  - marca superficies, inputs e botoes principais com classes Fluent.
- `DrakonSite/src/react-app/components/settings/WorkspaceAccessPanel.tsx`
  - marca cards, inputs, botoes, modal e estados do fluxo remoto com classes Fluent.
- `DrakonSite/scripts/visual-battery.mjs`
  - adiciona fixtures para shared camera, account users, workspace access e resource catalog.
  - amplia rotas padrao para account/workspace e demais telas operacionais.
  - desabilita extensoes/background networking no Chrome headless.
  - recaptura screenshots uniformes antes de falhar e fecha cada pagina CDP.
- `DrakonSite/docs/visual-battery.md`
  - documenta a nova cobertura visual.

## Screenshots Linux gerados

`npm run visual:linux` gerou 20 screenshots em `DrakonSite/visual-artifacts`:

- `linux-host-dark-1440x1000-dashboard.png`
- `linux-host-dark-1440x1000-cameras.png`
- `linux-host-dark-1440x1000-ai-agents.png`
- `linux-host-dark-1440x1000-jobs.png`
- `linux-host-dark-1440x1000-chat.png`
- `linux-host-dark-1440x1000-settings.png`
- `linux-host-dark-1440x1000-settings-tab-users.png`
- `linux-host-dark-1440x1000-settings-tab-workspace-access.png`
- `linux-host-dark-1440x1000-events.png`
- `linux-host-dark-1440x1000-billing.png`
- `linux-host-light-1440x1000-dashboard.png`
- `linux-host-light-1440x1000-cameras.png`
- `linux-host-light-1440x1000-ai-agents.png`
- `linux-host-light-1440x1000-jobs.png`
- `linux-host-light-1440x1000-chat.png`
- `linux-host-light-1440x1000-settings.png`
- `linux-host-light-1440x1000-settings-tab-users.png`
- `linux-host-light-1440x1000-settings-tab-workspace-access.png`
- `linux-host-light-1440x1000-events.png`
- `linux-host-light-1440x1000-billing.png`

Resumo escrito em `DrakonSite/visual-artifacts/summary.json`.

## Validacao executada

Passou:

```bash
cd DrakonSite
npm run test:platform-boundaries
npm run build
npm run visual:linux
```

Resultados:

- `npm run test:platform-boundaries`: passou, `React common UI platform boundary OK`.
- `npm run build`: passou, Vite gerou `dist/assets/index-DGa4B93z.css` e `dist/assets/index-1bTrwAOP.js`.
- `npm run visual:linux`: passou e gravou 20 screenshots.

Observacoes da validacao:

- O Chrome headless emitiu avisos de VAAPI/GCM conhecidos no ambiente Ubuntu; nao falharam a bateria.
- O Babel manteve o aviso conhecido de `Jobs.tsx` acima de 500KB.
- Antes de desabilitar extensoes/componentes no Chrome headless, a segunda captura em sequencia podia sair uniforme; o launcher foi ajustado para eliminar esse falso negativo.

## Windows WebView2

Nao foi possivel executar WebView2 neste Ubuntu. Rodar no Windows com o app/WebView2 apontando para uma URL local ja servida:

PowerShell:

```powershell
cd DrakonSite
$env:VISUAL_WINDOWS_WEBVIEW2_URL = "http://127.0.0.1:<port>"
npm run visual:windows
```

cmd:

```cmd
cd DrakonSite
set VISUAL_WINDOWS_WEBVIEW2_URL=http://127.0.0.1:<port>
npm run visual:windows
```

## Riscos visuais restantes

- A normalizacao Fluent central preserva compatibilidade ampla, mas Dashboard, Jobs, Chat e Billing ainda contem muitas classes Tailwind antigas no TSX; se algum elemento for renderizado fora de `.fluent-internal-content`, ele pode escapar dos tokens.
- A bateria visual cobre desktop 1440x1000 em dark/light; mobile pode ser validado com `--width=390 --height=844`.
- WebView2 ainda precisa de confirmacao em Windows real por diferencas de fonte/subpixel e comportamento do host.
