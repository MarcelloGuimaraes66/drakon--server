# Prompt 36 - Preservar porta Ubuntu e inventariar novidades do GitHub

Objetivo:
Preservar integralmente a porta Ubuntu atual antes de integrar novas mudancas do GitHub e produzir um inventario tecnico do que mudou em `origin/main`, sem modificar codigo funcional nesta fase.

Contexto obrigatorio:
- O repositório local contem uma porta Ubuntu ja refatorada, com muitas alteracoes nao commitadas.
- O remoto e `https://github.com/edguimkit/perceptrum_desktop_aspp.git`.
- A branch local esperada e `archon/linux-port-origin-main-sync`.
- A comparacao anterior indicou novidades depois do merge-base `be49cb0`, incluindo os commits:
  - `673c297 Expand shared access and desktop packaging flows`
  - `4357fcc Preserve central identity brand hint on refresh`
- Nao assuma que `origin/main` ainda esta parado nesses commits; confirme com `git fetch`.

Restricoes:
- Nao fazer commit.
- Nao fazer push.
- Nao usar `git reset --hard`, `git clean`, `git checkout --`, `git restore` destrutivo ou comandos equivalentes.
- Nao sobrescrever arquivos Linux/Ubuntu locais.
- Nao apagar dados de usuario, banco SQLite, logs, caches ou secrets.
- Nao instalar pacotes do sistema.
- Esta fase deve criar apenas backups, inventarios e relatorio.

Tarefas:
1. Confirmar estado inicial:
   - branch atual;
   - `HEAD`;
   - `origin/main`;
   - merge-base atual com `origin/main`;
   - lista curta de arquivos modificados e untracked.
2. Rodar `git fetch origin --prune`.
3. Criar diretorio de backup:
   - `.archon/backups/<timestamp>-pre-github-novidades-ubuntu/`
4. Salvar no backup:
   - `git-status.txt` com `git status --short --branch`;
   - `local-head.txt` com `git rev-parse HEAD` e `git log --oneline -n 30`;
   - `origin-main-head.txt` com `git rev-parse origin/main` e `git log --oneline -n 30 origin/main`;
   - `merge-base.txt` com `git merge-base HEAD origin/main`;
   - `tracked.diff` com `git diff --binary`;
   - `staged.diff` com `git diff --cached --binary`;
   - `untracked-files.txt` com arquivos untracked relevantes;
   - `remote-new-commits.txt` com `git log --oneline --decorate <merge-base>..origin/main`;
   - `remote-new-files.txt` com `git diff --name-status <merge-base>..origin/main`;
   - `remote-new-stat.txt` com `git diff --stat <merge-base>..origin/main`;
   - `local-linux-files.txt` com inventario de `Perceptrum/linux*`, `RUNBOOK-LINUX.md`, scripts Linux, testes Linux e arquivos locais novos de camera/jobs/runtime.
5. Criar tar dos untracked relevantes da porta Ubuntu, prompts e relatorios Archon, excluindo:
   - `.git`
   - `node_modules`
   - `dist`
   - `out`
   - `storage`
   - `.visual-chrome-profile`
   - `visual-artifacts`
   - caches grandes
6. Gerar inventario das novidades do GitHub desde o merge-base:
   - identidade central/brand;
   - shared access/jobs/permissoes;
   - UI React/i18n/notificacoes;
   - Windows AppHost/packaging/signing;
   - testes novos;
   - schema/banco.
7. Identificar arquivos de maior risco por sobreposicao com mudancas locais, destacando obrigatoriamente:
   - `DrakonSite/src/worker/index.ts`
8. Confirmar que nenhum arquivo funcional foi alterado, exceto backups e relatorio.

Validacao obrigatoria:
```bash
git status --short --branch
git fetch origin --prune
git merge-base HEAD origin/main
git log --oneline --decorate $(git merge-base HEAD origin/main)..origin/main
git diff --name-status $(git merge-base HEAD origin/main)..origin/main
find .archon/backups -maxdepth 2 -type f | sort | tail -n 120
```

Saida esperada:
- Criar `.archon/plans/relatorio-fase36-preservar-porta-ubuntu-e-inventariar-novidades-github.md`.
- O relatorio deve conter:
  - caminho do backup;
  - HEAD local;
  - HEAD remoto;
  - merge-base usado;
  - commits novos do GitHub;
  - arquivos novos/alterados classificados por area;
  - lista de conflitos provaveis;
  - recomendacao objetiva se e seguro seguir para o Prompt 37.

