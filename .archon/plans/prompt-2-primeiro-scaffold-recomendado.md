# Prompt 2 - Primeiro scaffold recomendado

Data: 2026-05-21

## Resumo

Os contratos do Prompt 2 estao definidos o suficiente para iniciar o Prompt 3
com scaffold minimo. O Prompt 3 nao deve implementar RTSP, inferencia, banco
real nem API completa. A primeira implementacao deve criar a base CLI/headless,
validacao de config e estrutura de contratos.

## Confirmacoes desta fase

- Nenhum codigo-fonte foi alterado.
- Nenhum arquivo C++ foi criado.
- O repositorio fonte `perceptrum_desktop_aspp` foi apenas lido.
- Nao foi feito pull no repositorio fonte.
- Nao foi feito commit.
- Nao foi feito push.
- Nao foram apagados arquivos.

## Contratos definidos

Relatorios gerados neste Prompt 2:

- `prompt-2-contratos-json.md`
- `prompt-2-estrutura-diretorios.md`
- `prompt-2-contratos-banco-api-dashboard.md`
- `prompt-2-primeiro-scaffold-recomendado.md`

Contratos cobertos:

- Config principal `config/drakon-server.example.json`.
- JSON de camera.
- JSON de frame.
- JSON de job.
- JSON de step.
- JSON de agente.
- JSON de inferencia.
- JSON de alerta.
- JSON de evento.
- Indices JSONL para dashboard.
- Estrutura `data/`, `runtime/` e `config/`.
- Banco SQLite/PostgreSQL.
- API local futura.
- Politica de timestamps e IDs.
- Politica de secrets.
- Criterios para Prompt 3.

## Primeira implementacao recomendada

Criar uma base C++23 compilavel, sem dependencias pesadas de camera:

1. CLI:
   - `drakon-server --help`
   - `drakon-server --version`
   - `drakon-server validate-config --config config/drakon-server.example.json`
   - `drakon-server print-paths --config config/drakon-server.example.json`

2. Runtime paths:
   - Resolver `config_dir`, `runtime_dir`, `data_dir`, `log_dir`.
   - Validar path traversal.
   - Nao criar diretorios automaticamente sem comando explicito.

3. Config:
   - Ler JSON com `nlohmann-json`.
   - Validar campos obrigatorios.
   - Validar enums.
   - Rejeitar secrets inline quando `allow_inline_secrets=false`.
   - Mascarar RTSP/DSN/token em erros e logs.

4. Contratos:
   - Definir tipos internos iniciais para camera, capture profile, job, step,
     agent, inference profile e alerta.
   - Ainda sem captura RTSP.
   - Ainda sem inferencia real.
   - Ainda sem SQLite real, salvo stub de contrato.

5. Testes:
   - Config valida.
   - Config invalida falha com erro claro.
   - Redacao de secrets.
   - Resolucao de paths.
   - CLI help/version.

## Arquivos que o Prompt 3 devera criar ou ajustar

Se ainda nao existirem, criar:

```text
CMakeLists.txt
README.md
.gitignore
config/
  drakon-server.example.json
include/
  drakon/
    contracts/
      ids.h
      timestamps.h
    config/
      config.h
      config_loader.h
    runtime/
      runtime_paths.h
      redaction.h
      version.h
src/
  main.cpp
  config/
    config_loader.cpp
  runtime/
    runtime_paths.cpp
    redaction.cpp
tests/
  CMakeLists.txt
  config_loader_tests.cpp
  redaction_tests.cpp
  cli_smoke_tests.cpp
docs/
  contracts/
    json-contracts.md
    runtime-layout.md
    api-contract.md
```

Observacao: o repositorio alvo ja possui alguns arquivos nao rastreados. O
Prompt 3 deve ler o estado atual antes de criar/alterar qualquer arquivo e deve
preservar mudancas existentes.

## Dependencias permitidas no scaffold

Permitidas:

- C++23.
- CMake.
- `nlohmann-json`.
- Biblioteca padrao C++.

Evitar no Prompt 3:

- FFmpeg.
- OpenCV.
- SQLite real.
- PostgreSQL/libpq.
- libcurl.
- Servidor HTTP.
- Systemd.
- Qualquer LLM provider.

Motivo: a primeira entrega precisa validar contratos e bootstrap sem bloquear
em dependencias nativas de captura.

## Criterios de aceitacao do Prompt 3

O Prompt 3 so deve ser considerado completo quando:

- O projeto configura com CMake.
- O binario imprime help/version.
- `validate-config` aceita o exemplo sem secrets reais.
- `validate-config` rejeita RTSP com senha inline quando a politica proibir.
- Logs e erros mascaram `rtsp://user:pass@host`, tokens, DSNs e chaves.
- Testes rodam via CTest.
- Nenhum commit/push e feito.
- Nenhum arquivo do repositorio fonte e alterado.

## Decisoes pendentes antes ou durante Prompt 3

1. ID:
   - Preferencia: ULID ou UUIDv7.
   - Se nao houver biblioteca pronta, usar interface `IdGenerator` e stub
     deterministico nos testes.

2. Validacao JSON:
   - Preferencia inicial: validacao manual tipada com mensagens claras.
   - JSON Schema formal pode entrar depois.

3. Banco:
   - SQLite deve ser o primeiro banco real, mas nao precisa entrar no Prompt 3.

4. API:
   - Framework HTTP ainda pendente.
   - A API local deve ficar para depois do scaffold de config/runtime.

5. Dashboard:
   - Decidir se o dashboard vai ler JSONL diretamente ou por API local.
   - MVP recomendado: API local para consultas e JSONL como indice/rebuild.

6. Secrets:
   - Decidir fallback local: `secret-tool`, arquivo 0600, env vars ou combinacao.
   - MVP recomendado: env vars e arquivo local 0600 com opt-in explicito.

## Riscos

- Criar captura RTSP cedo demais vai misturar dependencias de FFmpeg/OpenCV
  antes de validar contratos.
- Copiar `CameraSession.cpp`, `AgentCore.cpp` ou `JobRuntime.cpp` carregaria
  acoplamento desktop/backend antigo.
- Persistir RTSP completo, API key ou token em JSON/JSONL/log quebra a regra de
  seguranca mais importante.
- Divergir do dashboard sem contrato de indice/API pode obrigar retrabalho.
- O repositorio alvo tem um git aninhado observado anteriormente; antes de um
  commit futuro, isso deve ser tratado com decisao explicita do usuario.

## Ordem recomendada apos Prompt 3

1. Prompt 3: scaffold CLI/config/runtime/redaction/tests.
2. Prompt 4: SQLite migrations e repositorios tipados.
3. Prompt 5: JSON/JSONL writers atomicos e rebuild de indices.
4. Prompt 6: captura de teste/file/webcam sem RTSP.
5. Prompt 7: RTSP FFmpeg com reconexao e metricas.
6. Prompt 8: jobs/steps runtime simples.
7. Prompt 9: inferencia stub e depois provedores reais.
8. Prompt 10: alertas, deliveries e webhooks.
