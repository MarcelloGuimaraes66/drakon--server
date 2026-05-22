# Prompt 11 - Auditoria do repositório aninhado e teste funcional completo

Data local: 2026-05-21
Projeto: `/home/marcello-guimaraes/dev/drakon-server`

## Estado do Git principal

Comandos executados:

```bash
pwd
git status --short
git remote -v
git branch --show-current
```

Resultado:

- `pwd`: `/home/marcello-guimaraes/dev/drakon-server`
- branch atual: `main`
- remote:
  - fetch: `https://github.com/MarcelloGuimaraes66/drakon--server.git`
  - push: `https://github.com/MarcelloGuimaraes66/drakon--server.git`
- status:

```text
?? .archon/
?? .gitignore
?? CMakeLists.txt
?? README.md
?? config/
?? docs/
?? drakon-server/
?? include/
?? packaging/
?? src/
?? tests/
```

Observação: o repositório principal ainda não tem os arquivos versionados em Git local. Nenhum commit foi feito nesta fase.

## Estado do Git aninhado

O diretório `drakon-server/.git` existe.

Comandos executados:

```bash
test -d drakon-server/.git
find drakon-server -maxdepth 3 -print
git -C drakon-server status --short
git -C drakon-server remote -v
git -C drakon-server branch --show-current
git -C drakon-server rev-parse --is-inside-work-tree
git -C drakon-server rev-parse --show-toplevel
git -C drakon-server log --oneline -n 5
git -C drakon-server ls-files
find drakon-server -path 'drakon-server/.git' -prune -o -type f -print
git -C drakon-server status --short --branch
```

Resultado:

- `drakon-server/.git`: existe.
- top-level do Git aninhado: `/home/marcello-guimaraes/dev/drakon-server/drakon-server`.
- branch atual: `main`.
- remote:
  - fetch: `https://github.com/MarcelloGuimaraes66/drakon--server.git`
  - push: `https://github.com/MarcelloGuimaraes66/drakon--server.git`
- `git log`: falhou com `fatal: your current branch 'main' does not have any commits yet`.
- `git ls-files`: sem arquivos rastreados.
- `find` fora de `.git`: sem arquivos.
- status:

```text
## No commits yet on main...origin/main [gone]
```

## Comparação e recomendação sobre `drakon-server/` interno

O repositório aninhado aponta para o mesmo remote do projeto principal, mas não contém commits, arquivos rastreados nem arquivos úteis fora do diretório `.git`.

Recomendação: **apagar depois de autorização explícita**. Não há conteúdo para integrar. Como medida mais conservadora, o diretório pode ser movido para backup antes de apagar, mas tecnicamente ele parece ser apenas um Git vazio criado dentro do projeto por engano.

Nada foi apagado nesta auditoria.

## Build e CTest

Comandos executados:

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j$(nproc)
ctest --test-dir build --output-on-failure
```

Resultado:

- CMake configure: sucesso.
- Build: sucesso, `ninja: no work to do`.
- CTest: sucesso.

```text
100% tests passed, 0 tests failed out of 24
```

## Runtime isolado

O CLI atual não oferece override direto de `runtime.data_root` por argumento de linha de comando. Como `config/drakon-server.example.json` define `data_root` como `data`, os testes funcionais gravaram no diretório runtime padrão do projeto.

Nenhum dado foi apagado.

## Resultado dos comandos CLI solicitados

| Comando | Resultado |
|---|---|
| `./build/drakon-server --help` | sucesso, exit 0 |
| `./build/drakon-server version` | sucesso, `drakon-server 0.1.0`, exit 0 |
| `./build/drakon-server validate-config --config config/drakon-server.example.json` | sucesso, config válida, `drakon.v1`, SQLite, 2 capture profiles, 1 câmera |
| `./build/drakon-server prepare-runtime --config config/drakon-server.example.json` | sucesso, diretórios preparados em `data/` e `runtime/` |
| `./build/drakon-server check-deps --config config/drakon-server.example.json` | sucesso, encontrou `ffmpeg`, `ffprobe`, `node`, `python3`; mock inference sem dependência externa |
| `./build/drakon-server status --config config/drakon-server.example.json` | sucesso, `scaffold-ready`, RTSP disponível via OpenCV/FFmpeg, inference `mock`, database `sqlite` |
| `./build/drakon-server db-init --config config/drakon-server.example.json` | sucesso, schema SQLite inicializado e 1 câmera importada |
| `./build/drakon-server db-status --config config/drakon-server.example.json` | sucesso, conectado e inicializado; tabelas mínimas existem |
| `./build/drakon-server list-cameras --config config/drakon-server.example.json` | sucesso, listou `cam_test_01` desabilitada/source `test` |
| `./build/drakon-server capture-test --config config/drakon-server.example.json --camera-id camera_001 --seconds 2 --dry-run` | erro funcional esperado, exit 1: `camera_001` não existe no config atual |
| `./build/drakon-server index-frames --config config/drakon-server.example.json` | sucesso, `frames.jsonl` reconstruído com 14 registros naquele momento |
| `./build/drakon-server validate-job --job config/jobs/dry-run-job.example.json` | sucesso, job válido com 2 steps e 1 agente |
| `./build/drakon-server run-job --job config/jobs/dry-run-job.example.json --dry-run --config config/drakon-server.example.json` | sucesso, dry-run executado sem câmera/LLM real |
| `./build/drakon-server infer-frame --config config/drakon-server.example.json --frame data/frames/mock-frame.jpg` | erro funcional esperado, exit 1: arquivo `data/frames/mock-frame.jpg` não existe |
| `./build/drakon-server infer-batch --config config/drakon-server.example.json --frames-index data/indexes/frames.jsonl` | sucesso, 14 frames processados e 0 falhas naquele momento |
| `./build/drakon-server generate-alerts --config config/drakon-server.example.json` | sucesso, leu 15 inferências, gerou 2 eventos e 1 alerta |
| `./build/drakon-server send-webhooks --config config/drakon-server.example.json --dry-run` | sucesso, 1 alerta lido, 0 webhooks habilitados, entrega real desabilitada |
| `timeout 5s ./build/drakon-server serve-api --config config/drakon-server.example.json --port 18080` | sucesso, stub/plano; não abriu socket |
| `./build/drakon-server run --config config/drakon-server.example.json --once` | sucesso, inicialização do serviço validada e encerrada |

## Validação complementar com câmera existente

Como o comando solicitado usa `camera_001`, que não existe no config, foi executada uma checagem complementar com a câmera existente `cam_test_01`.

```bash
./build/drakon-server capture-test --config config/drakon-server.example.json --camera-id cam_test_01 --seconds 2 --dry-run
```

Resultado:

- sucesso;
- `frames_saved: 2`;
- backend: OpenCV VideoCapture com FFmpeg/libav disponível;
- nenhuma câmera real foi acionada.

Também foi executado `infer-frame` em um JPG real gerado em `data/frames/`.

Resultado:

- sucesso;
- inference `mock`;
- resultado salvo em `data/inference/...`;
- índice atualizado em `data/indexes/inference.jsonl`;
- nenhuma API externa foi chamada.

## Arquivos e diretórios gerados/verificados

Diretórios verificados:

- `data/db/`
- `data/frames/`
- `data/inference/`
- `data/alerts/`
- `data/events/`
- `data/indexes/`
- `data/logs/`
- `runtime/`

Arquivos principais encontrados:

- `data/db/drakon-server.sqlite3`
- `data/indexes/frames.jsonl`
- `data/indexes/inference.jsonl`
- `data/indexes/alerts.jsonl`
- `data/indexes/events.jsonl`
- `data/indexes/jobs.jsonl`
- `data/logs/drakon-server.log`
- JSONs de frames em `data/frames/...`
- JSONs de inferência em `data/inference/...`
- JSON de alerta em `data/alerts/...`
- JSONs de eventos em `data/events/...`

Contagens observadas após a validação:

```text
data/indexes/frames.jsonl lines=16
data/indexes/inference.jsonl lines=132
data/indexes/alerts.jsonl lines=1
data/indexes/events.jsonl lines=2
```

## Validação JSON/JSONL

Comandos executados com `jq`:

- validação linha a linha de:
  - `data/indexes/frames.jsonl`;
  - `data/indexes/inference.jsonl`;
  - `data/indexes/alerts.jsonl`;
  - `data/indexes/events.jsonl`.
- validação dos arquivos `*.json` sob `data/`.

Resultado:

```text
valid JSONL: data/indexes/frames.jsonl
valid JSONL: data/indexes/inference.jsonl
valid JSONL: data/indexes/alerts.jsonl
valid JSONL: data/indexes/events.jsonl
valid JSON files under data
```

Primeiras linhas verificadas:

- `frames.jsonl`: contém registros `frame` com `camera_id`, `frame_id`, `timestamp_utc`, paths relativos, dimensões, checksum e status.
- `inference.jsonl`: contém registros `inference` com `mock=true`, provider `mock`, model `mock-frame-analyzer-v1`, `risk_score` e path relativo.
- `alerts.jsonl`: contém alerta fixture `alert_inf_fixture_alert_01_1`.
- `events.jsonl`: contém eventos fixture relacionados a `person_detected`.

## Verificação de secrets

Foram pesquisados padrões sensíveis em `data/`, `runtime/`, logs, índices e SQLite via `strings`, incluindo:

- `TEST_TOKEN`;
- URL RTSP com credenciais;
- `password`;
- `senha`;
- `secret`;
- `api_key`;
- `token`;
- `DRAKON_POSTGRES_DSN`;
- `OPENAI_API_KEY`;
- `GEMINI_API_KEY`.

Resultado: **nenhum vazamento encontrado** nos arquivos verificados.

## O que já está funcionando

- Build C++23 com CMake/Ninja;
- CTest com 24 testes passando;
- CLI headless;
- validação de config;
- preparação de runtime;
- checagem de dependências;
- SQLite local;
- importação/listagem de câmeras do config;
- captura dry-run com câmera `test`;
- frame store com JSON e JSONL;
- jobs/steps/agentes em dry-run;
- inferência mock;
- batch de inferência mock;
- geração de eventos e alertas;
- webhooks em dry-run;
- `serve-api` como plano/stub;
- `run --once` para validar inicialização de serviço;
- pacote `.deb` existente em `build/drakon-server_0.1.0_amd64.deb` desde o Prompt 10.

## O que ainda é mock/stub

- Inferência real: não implementada, apenas provider `mock`.
- Webhooks reais: não implementados, apenas `--dry-run`.
- API local: `serve-api` não abre servidor HTTP; apenas lista endpoints planejados.
- Jobs reais/agendamento contínuo: `run-job` ainda é dry-run.
- PostgreSQL: contrato/configuração existe, conexão real ainda não implementada.

## Problemas encontrados

1. Existe um Git aninhado em `drakon-server/.git`.
   - Não contém arquivos úteis.
   - Deve ser removido somente após autorização.

2. O comando funcional solicitado usa `camera_001`, mas o config atual contém apenas `cam_test_01`.
   - Resultado: `camera not found in config: camera_001`.

3. O comando funcional solicitado usa `data/frames/mock-frame.jpg`, mas esse arquivo não existe.
   - Resultado: `frame path not found`.

4. Não existe override CLI para runtime temporário.
   - O teste funcional usou `data/` do projeto, conforme `config/drakon-server.example.json`.

## Próxima fase recomendada

Prompt 12 recomendado:

1. Remover o Git aninhado `drakon-server/` somente após autorização explícita.
2. Corrigir o config ou os comandos de teste para usar um ID consistente:
   - ou adicionar `camera_001`;
   - ou padronizar os testes em `cam_test_01`.
3. Criar suporte a `--data-root` ou config temporário oficial para testes isolados.
4. Criar fixture canônico `data/frames/mock-frame.jpg` ou ajustar `infer-frame` para aceitar um frame fixture gerado por teste.
5. Implementar API HTTP local mínima, se essa for a próxima prioridade do dashboard.
6. Depois, iniciar integração com câmera RTSP real em ambiente controlado, ainda sem LLM real.

## Confirmações

- Nenhum commit foi feito.
- Nenhum push foi feito.
- `git reset --hard` não foi executado.
- O diretório `drakon-server/` interno não foi apagado.
- Nenhum arquivo foi apagado.
- Nenhuma credencial foi hardcoded.
- Nenhum secret foi encontrado nos arquivos gerados verificados.
- Nenhuma API externa real foi chamada.
- Inferência executada apenas em modo mock.
