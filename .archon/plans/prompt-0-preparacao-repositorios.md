# Prompt 0 - Preparacao dos repositorios

Data da preparacao: 2026-05-21

## Objetivo

Preparar neste Ubuntu os repositorios fonte e alvo usados para o desenvolvimento do `drakon-server`, sem commit, sem push, sem apagar arquivos e sem alterar codigo do repositorio-fonte.

## Repositorio-fonte: perceptrum_desktop_aspp

- URL esperada: `https://github.com/edguimkit/perceptrum_desktop_aspp.git`
- Diretorio local: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
- Existe localmente: sim
- E repositorio Git: sim
- Remote `origin`:

```text
origin  https://github.com/edguimkit/perceptrum_desktop_aspp.git (fetch)
origin  https://github.com/edguimkit/perceptrum_desktop_aspp.git (push)
```

- Branch atual: `main`
- Status Git:

```text
## main...origin/main [behind 4]
 M Perceptrum/Perceptrum/logging/Logging.cpp
 M Perceptrum/Perceptrum/platform/platform_secure_store.cpp
 M Perceptrum/Perceptrum/runtime/BrandingRuntime.h
 M Perceptrum/Perceptrum/runtime/HeadlessService.cpp
 M Perceptrum/Perceptrum/runtime/HeadlessService.h
?? .archon/
?? Perceptrum/CMakeLists.txt
?? Perceptrum/Perceptrum/core/AgentCoreStatus.cpp
?? Perceptrum/Perceptrum/core/AgentCoreStatus.h
?? Perceptrum/Perceptrum/runtime/interfaces/
?? Perceptrum/linux-desktop/
?? Perceptrum/linux/
```

Observacao: o reposito-fonte ja possuia alteracoes locais e arquivos nao rastreados. Foi feito apenas ajuste do remote e `git fetch --all --prune`; nenhum arquivo de codigo foi alterado por esta preparacao.

## Repositorio alvo: drakon-server

- URL esperada: `https://github.com/MarcelloGuimaraes66/drakon--server.git`
- Diretorio local: `/home/marcello-guimaraes/dev/drakon-server`
- Existe localmente: sim
- E repositorio Git: sim
- Remote `origin`:

```text
origin  https://github.com/MarcelloGuimaraes66/drakon--server.git (fetch)
origin  https://github.com/MarcelloGuimaraes66/drakon--server.git (push)
```

- Branch atual: `main`
- Status Git:

```text
## No commits yet on main
?? .archon/
?? .gitignore
?? CMakeLists.txt
?? README.md
?? drakon-server/
```

Pastas garantidas no repositorio alvo:

```text
.archon/prompts
.archon/plans
docs
```

Observacao: o repositorio alvo esta inicializado localmente, mas ainda nao possui commits. O diretorio nao rastreado `drakon-server/` contem um repositorio Git aninhado vazio identificado em leituras anteriores; isso deve ser tratado antes do primeiro commit para evitar submodule acidental ou confusao de raiz.

## Comandos executados

```bash
cd /home/marcello-guimaraes
mkdir -p dev
cd dev
git -C perceptrum_desktop_aspp remote set-url origin https://github.com/edguimkit/perceptrum_desktop_aspp.git
git -C perceptrum_desktop_aspp fetch --all --prune
git -C drakon-server remote set-url origin https://github.com/MarcelloGuimaraes66/drakon--server.git
git -C drakon-server fetch --all --prune
mkdir -p /home/marcello-guimaraes/dev/drakon-server/.archon/prompts
mkdir -p /home/marcello-guimaraes/dev/drakon-server/.archon/plans
mkdir -p /home/marcello-guimaraes/dev/drakon-server/docs
```

## Proximos passos

1. Nao rodar `git pull` no `perceptrum_desktop_aspp` antes de revisar as alteracoes locais, porque a branch `main` esta `behind 4` e ha arquivos modificados/nao rastreados.
2. Decidir como tratar o repositorio Git aninhado em `/home/marcello-guimaraes/dev/drakon-server/drakon-server/.git` antes do primeiro commit do alvo.
3. Usar os relatorios em `.archon/plans/` para iniciar a primeira implementacao do `drakon-server`.
4. Implementar primeiro a base CLI/config/build/testes no repositorio alvo, mantendo o fonte apenas como referencia tecnica.
5. Antes de qualquer commit futuro, rodar:

```bash
git -C /home/marcello-guimaraes/dev/perceptrum_desktop_aspp status --short --branch
git -C /home/marcello-guimaraes/dev/drakon-server status --short --branch
```

## Garantias desta fase

- Nao foi feito commit.
- Nao foi feito push.
- Nenhum arquivo foi apagado.
- Nao foi executado `git reset --hard`.
- Nenhum pacote apt foi instalado.
- Nenhuma credencial foi criada, hardcodada ou registrada em log.
- Nenhuma interface grafica foi criada.
