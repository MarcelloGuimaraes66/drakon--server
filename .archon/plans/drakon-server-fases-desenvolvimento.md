# Fases de desenvolvimento do drakon-server

## Fase 0 - Higiene do repositorio

Objetivo: deixar claro qual repositorio Git sera usado antes do primeiro commit.

Tarefas:

- Confirmar que o repositorio raiz em `/home/marcello-guimaraes/dev/drakon-server` e o repositorio correto.
- Decidir o que fazer com o repositorio Git aninhado em `drakon-server/.git`.
- Manter `.archon/` como area de planejamento.
- Nao versionar secrets nem dados de runtime.

Resultado esperado:

- Arvore sem ambiguidade de Git antes do primeiro commit.

## Fase 1 - Base CLI, config e testes

Objetivo: criar um executavel C++23 minimo que compile e valide configuracao.

Tarefas:

- Criar `src/main.cpp`.
- Criar headers iniciais em `include/drakon/`.
- Implementar comandos:
  - `--help`
  - `version`
  - `validate-config`
  - `list-cameras`
- Criar `config/cameras.example.json` sem credenciais reais.
- Escolher biblioteca JSON ou implementar leitura minima temporaria com plano de substituicao.
- Fazer CMake configurar, compilar e rodar CTest.

Resultado esperado:

- `cmake -S . -B build` passa.
- `cmake --build build` passa.
- `ctest --test-dir build --output-on-failure` passa.

## Fase 2 - RuntimePaths e JSON/JSONL

Objetivo: padronizar todos os paths e arquivos gerados.

Tarefas:

- Implementar criacao de diretorios por camera/timestamp/perfil.
- Implementar escritor atomico de JSON.
- Implementar append seguro de JSONL.
- Gerar indices:
  - `frames.jsonl`
  - `inference.jsonl`
  - `alerts.jsonl`
  - `events.jsonl`
- Adicionar testes de path e serializacao.

Resultado esperado:

- Dashboard consegue ler uma massa de arquivos gerada localmente.

## Fase 3 - SQLite local

Objetivo: persistir metadados e estado local sem exigir servidor externo.

Tarefas:

- Adicionar dependencia SQLite.
- Criar schema inicial.
- Implementar migracoes simples.
- Registrar cameras, perfis, frames, eventos, alertas e estado de runtime.
- Testar banco temporario em CTest.

Resultado esperado:

- Execucoes repetidas conseguem retomar estado basico.

## Fase 4 - Captura RTSP

Objetivo: conectar cameras RTSP e salvar frames reais.

Tarefas:

- Adicionar FFmpeg/libav no CMake.
- Implementar `CaptureEngine`.
- Implementar reconexao com backoff.
- Suportar 1 FPS, 10 FPS e perfis configuraveis.
- Sanitizar URLs nos logs.
- Salvar frames em `data/frames`.
- Gerar `frames.jsonl`.

Resultado esperado:

- Uma camera RTSP configurada gera frames em diretorios por timestamp.

## Fase 5 - Inferencia e eventos

Objetivo: inserir o pipeline de analise sem acoplar modelo especifico.

Tarefas:

- Criar interface `InferenceRunner`.
- Implementar runner stub.
- Persistir resultados em `data/inference`.
- Gerar eventos em `data/events`.
- Atualizar indices JSONL.

Resultado esperado:

- Fluxo completo funciona mesmo antes de modelos reais.

## Fase 6 - Alertas

Objetivo: transformar resultados/eventos em alertas estruturados.

Tarefas:

- Criar regras configuraveis simples.
- Gerar documentos JSON de alerta.
- Atualizar `alerts.jsonl`.
- Definir severidades e tipos.

Resultado esperado:

- Dashboard consegue listar alertas sem consultar o processo.

## Fase 7 - PostgreSQL opcional

Objetivo: permitir backend centralizado sem quebrar uso local.

Tarefas:

- Adicionar driver escolhido.
- Usar DSN via variavel de ambiente.
- Implementar gateway comum para SQLite/PostgreSQL.
- Testar somente quando ambiente estiver configurado.

Resultado esperado:

- PostgreSQL funciona como modo opcional.

## Fase 8 - Operacao Linux

Objetivo: rodar como servico headless em Ubuntu.

Tarefas:

- Criar unidade systemd.
- Criar arquivo de ambiente exemplo.
- Definir usuario/diretorios.
- Criar scripts de validacao operacional.

Resultado esperado:

- `systemctl start drakon-server` roda em ambiente configurado.

## Fase 9 - Pacote .deb

Objetivo: distribuir instalador para Ubuntu.

Tarefas:

- Configurar CPack ou empacotamento Debian.
- Instalar binario, docs, config exemplo e systemd unit.
- Garantir que dados e secrets nao entrem no pacote.

Resultado esperado:

- Arquivo `.deb` instalavel e removivel de forma limpa.
