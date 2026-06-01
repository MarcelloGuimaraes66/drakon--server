# Prompt 37 - Integrar identidade central, brand e shared access

Objetivo:
Integrar as novidades de identidade central, separacao de brand `drakon`/`perceptrum`, shared access e tipos compartilhados vindas de `origin/main`, preservando a porta Ubuntu e a compatibilidade Windows/Mac/Linux.

Contexto obrigatorio:
- Leia `.archon/plans/relatorio-fase36-preservar-porta-ubuntu-e-inventariar-novidades-github.md`.
- Leia os diffs remotos desde o merge-base registrado no relatorio da fase 36.
- Leia antes de editar:
  - `DrakonSite/src/worker/centralIdentity.ts`
  - `DrakonSite/src/worker/localIdentity.ts`
  - `DrakonSite/src/worker/accountAccess.ts`
  - `DrakonSite/src/worker/sharedJobPlan.ts`
  - `DrakonSite/src/worker/jobScheduler.ts`
  - `DrakonSite/src/shared/types.ts`
  - `DrakonSite/server/brand.ts`
- Se o backup da fase 36 nao existir ou nao estiver verificavel, pare.

Restricoes:
- Nao fazer commit.
- Nao fazer push.
- Nao usar `git reset --hard`, `git clean`, `git checkout --`, `git restore` destrutivo ou comandos equivalentes.
- Nao sobrescrever arquivos Linux/Ubuntu.
- Nao quebrar D1/SQLite/Postgres.
- Nao introduzir dependencia WinUI, WebView2, GTK ou C++ na UI React comum.
- Nao publicar segredos.

Tarefas:
1. Reconfirmar merge-base e `origin/main` atuais.
2. Extrair do GitHub apenas as mudancas relacionadas a:
   - `centralIdentity.ts`;
   - `localIdentity.ts`;
   - `accountAccess.ts`;
   - `sharedJobPlan.ts`;
   - `jobScheduler.ts`;
   - `types.ts`;
   - `server/brand.ts`;
   - novo `centralIdentityBrandHint.ts`;
   - novo teste `centralIdentityBrandHint.test.ts`.
3. Incorporar `DrakonSite/src/worker/centralIdentityBrandHint.ts`.
4. Incorporar `DrakonSite/src/tests/centralIdentityBrandHint.test.ts`.
5. Atualizar identidade central:
   - adicionar `brand_id` onde o GitHub passou a exigir;
   - manter separacao entre `drakon` e `perceptrum`;
   - manter compatibilidade com usuarios/claims existentes.
6. Atualizar migracoes locais:
   - preservar dados existentes;
   - evitar migrations destrutivas;
   - manter SQLite local usado pelo Ubuntu;
   - manter D1/Postgres quando o codigo ja suportar esses ambientes.
7. Atualizar shared access/jobs:
   - `preserve_running_camera_ids_json`;
   - `allow_event_media`;
   - `invitee_handle`;
   - `invitee_email`;
   - qualquer tipo compartilhado correspondente.
8. Evitar alterar `DrakonSite/src/worker/index.ts` nesta fase, exceto se for estritamente necessario para compilar. Se precisar tocar nele, documente exatamente o motivo e limite a alteracao.
9. Rodar testes focados de identidade/schema/tipos.

Validacao obrigatoria:
```bash
git status --short --branch
cd DrakonSite && npm run test:platform-boundaries
cd DrakonSite && npm run test:local-sqlite-bootstrap
cd DrakonSite && npm test -- centralIdentityBrandHint
cd DrakonSite && npm run build
```

Se algum comando nao existir, registre o comando ausente e rode o teste equivalente mais proximo definido em `package.json`.

Saida esperada:
- Criar `.archon/plans/relatorio-fase37-integrar-identidade-central-brand-e-shared-access.md`.
- O relatorio deve listar:
  - arquivos alterados;
  - mudancas trazidas do GitHub;
  - migracoes/schema afetados;
  - testes executados;
  - falhas restantes;
  - riscos para o Prompt 38.

