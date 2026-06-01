# Prompt 39 - Integrar UI nova com paridade Fluent multiplataforma

Objetivo:
Incorporar as novidades de UI React vindas do GitHub mantendo a interface visual bonita, consistente com os tokens Fluent e identica entre Windows WebView2, Linux host/browser e tema claro/escuro, sem introduzir dependencia de host especifico na UI comum.

Contexto obrigatorio:
- Leia `.archon/plans/relatorio-fase36-preservar-porta-ubuntu-e-inventariar-novidades-github.md`.
- Leia `.archon/plans/relatorio-fase37-integrar-identidade-central-brand-e-shared-access.md`.
- Leia `.archon/plans/relatorio-fase38-resolver-worker-index-preservando-linux-camera-jobs-runtime.md`.
- Leia antes de editar:
  - `DrakonSite/src/react-app/index.css`
  - `DrakonSite/src/react-app/components/Layout.tsx`
  - `DrakonSite/src/react-app/components/NotificationsDropdown.tsx`
  - `DrakonSite/src/react-app/components/CameraEditorModal.tsx`
  - `DrakonSite/src/react-app/components/CameraCustomAgentEditorModal.tsx`
  - `DrakonSite/src/react-app/pages/Settings.tsx`
  - `DrakonSite/src/react-app/pages/Jobs.tsx`
  - `DrakonSite/src/react-app/pages/DrakonFind.tsx`
  - `DrakonSite/src/react-app/pages/Cameras.tsx`
  - `DrakonSite/src/react-app/pages/AIAgents.tsx`
  - `DrakonSite/src/react-app/i18n.ts`
  - `DrakonSite/docs/visual-battery.md`
- Leia o diff remoto dos arquivos de UI desde o merge-base da fase 36.

Restricoes:
- Nao fazer commit.
- Nao fazer push.
- Nao usar reset/clean/restore destrutivo.
- Nao introduzir import de WinUI, WebView2, GTK, C++ ou host desktop na UI React comum.
- Nao criar gradientes, sombras, cards ou estilos proprios fora dos tokens Fluent ja adotados.
- Nao quebrar tema claro/escuro.
- Nao remover fluxos de camera, jobs e agente ja usados no Ubuntu.

Tarefas:
1. Integrar mudancas de UI vindas do GitHub em:
   - Settings;
   - Jobs;
   - DrakonFind;
   - Layout;
   - NotificationsDropdown;
   - CameraEditorModal;
   - CameraCustomAgentEditorModal;
   - i18n.
2. Garantir que o enhancement de prompt use a novidade remota quando aplicavel, incluindo `language: "match_input_language"`.
3. Preservar as alteracoes locais de paridade Fluent feitas nos prompts anteriores.
4. Revisar CSS para eliminar:
   - cards proprios desnecessarios;
   - sombras customizadas;
   - gradientes proprios;
   - cores fora dos tokens;
   - texto que possa estourar container.
5. Confirmar que as telas de camera/jobs continuam exibindo status de erro/start failure corretamente.
6. Atualizar a bateria visual para cobrir:
   - Linux browser/host;
   - tema claro;
   - tema escuro;
   - telas internas afetadas.
7. Rodar build e testes visuais possiveis.

Validacao obrigatoria:
```bash
git status --short --branch
cd DrakonSite && npm run test:platform-boundaries
cd DrakonSite && npm run build
cd DrakonSite && npm run visual:battery
```

Se `visual:battery` nao existir, localizar o script equivalente em `package.json` ou em `DrakonSite/scripts/visual-battery.mjs` e rodar o comando correto.

Saida esperada:
- Criar `.archon/plans/relatorio-fase39-integrar-ui-nova-com-paridade-fluent-multiplataforma.md`.
- O relatorio deve listar:
  - telas alteradas;
  - novidades do GitHub incorporadas;
  - ajustes Fluent realizados;
  - evidencias de build/teste visual;
  - pontos ainda dependentes de validacao manual.

