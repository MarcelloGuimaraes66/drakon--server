# Prompt 4 - Configuracao e banco do drakon-server

Data: 2026-05-21

## Objetivo executado

Foi implementada a leitura robusta de configuracao com `nlohmann::json` e a
camada inicial de banco SQLite do `drakon-server`.

Nao foi feito commit. Nao foi feito push. Nenhum arquivo foi apagado.

## Dependencias verificadas

Presentes no ambiente:

- `nlohmann/json.hpp`
- `sqlite3.h`
- `libsqlite3.so`

Nao foi encontrado `libpq`. Por isso, PostgreSQL ficou apenas como interface
preparada, sem conexao real e sem link com `libpq`.

## Arquivos criados

- `include/drakon/database/database.h`
- `include/drakon/database/postgres_database.h`
- `src/database/sqlite_database.cpp`
- `.archon/plans/prompt-4-config-banco.md`

## Arquivos ajustados

- `CMakeLists.txt`
- `.gitignore`
- `README.md`
- `config/drakon-server.example.json`
- `include/drakon/config/config_loader.h`
- `src/config/config_loader.cpp`
- `src/main.cpp`

## Config implementado

O parser manual do Prompt 3 foi substituido por `nlohmann::json`.

Validacoes implementadas:

- `schema_version == "drakon.v1"`;
- `runtime.data_root`;
- `runtime.log_root`;
- paths runtime dentro da raiz do projeto;
- `database.type`;
- `database.path` para SQLite;
- `database.connection_string_ref` para PostgreSQL;
- `capture.profiles`;
- cameras com `camera_id`, `name`, `source_type` e `fps_profiles`;
- `source_type`: `rtsp`, `webcam`, `file`, `test`;
- referencia de camera para capture profile existente;
- rejeicao de URL RTSP com credenciais nao mascaradas;
- rejeicao de campos secretos inline quando `allow_inline_secrets=false`.

O exemplo `config/drakon-server.example.json` agora usa:

- `runtime.data_root`;
- `runtime.log_root`;
- `database.type`;
- `database.path`.

## Banco implementado

Suporte efetivo inicial:

- SQLite local.

PostgreSQL:

- contrato preparado em `include/drakon/database/postgres_database.h`;
- parsing de `database.type = "postgres"` e `connection_string_ref`;
- conexao real ainda nao implementada.

## Schema SQLite minimo

Tabelas criadas por `db-init`:

- `cameras`;
- `jobs`;
- `agents`;
- `frames`;
- `inferences`;
- `alerts`;
- `events`.

Indices iniciais:

- `idx_frames_camera_timestamp`;
- `idx_inferences_camera_timestamp`;
- `idx_alerts_timestamp`;
- `idx_events_type_timestamp`.

`db-init` tambem importa as cameras do config para a tabela `cameras`, sem
salvar credenciais em claro.

## CLI adicionada

Novos comandos:

- `drakon-server db-init --config <path>`;
- `drakon-server db-status --config <path>`;
- `drakon-server list-cameras --config <path>`.

Comandos existentes preservados:

- `--help`;
- `version`;
- `validate-config`;
- `prepare-runtime`;
- `check-deps`;
- `status`.

## Comandos executados

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j$(nproc)
ctest --test-dir build --output-on-failure
```

Tambem foram executados manualmente:

```bash
./build/drakon-server validate-config --config config/drakon-server.example.json
./build/drakon-server db-init --config config/drakon-server.example.json
./build/drakon-server db-status --config config/drakon-server.example.json
./build/drakon-server list-cameras --config config/drakon-server.example.json
```

## Testes CTest

Testes executados:

- `drakon_server_help`;
- `drakon_server_version`;
- `drakon_server_validate_config`;
- `drakon_server_prepare_runtime`;
- `drakon_server_check_deps`;
- `drakon_server_db_init`;
- `drakon_server_db_status`;
- `drakon_server_list_cameras`.

Resultado:

```text
100% tests passed, 0 tests failed out of 8
```

## Estado observado do banco

`db-status` confirmou:

- tipo: SQLite;
- conectado: sim;
- inicializado: sim;
- `cameras`: 1 linha;
- demais tabelas minimas: criadas com 0 linhas.

`list-cameras` listou:

- `cam_test_01`;
- nome `Test camera placeholder`;
- estado `disabled`;
- source type `test`.

## Artefatos runtime gerados

Arquivos runtime gerados e ignorados pelo git:

- `data/db/drakon-server.sqlite3`;
- `data/logs/drakon-server.log`.

## Proximos passos

1. Adicionar testes C++ unitarios dedicados para config e redacao de secrets.
2. Criar migracoes SQLite versionadas.
3. Adicionar tabela `runtime_state` e controle de versao de schema.
4. Implementar escritores JSON/JSONL atomicos.
5. Implementar import/reload de jobs e agentes.
6. Implementar fonte `test`/`file` antes de RTSP.
7. Implementar PostgreSQL real somente quando `libpq` e o contrato de sync
   estiverem definidos.

## Confirmacoes

- Nenhum commit foi feito.
- Nenhum push foi feito.
- Nenhum arquivo foi apagado.
- Nao foi criada interface grafica.
- Nao foi implementado RTSP.
- Nao foi implementada inferencia.
- Nao foram hardcodadas credenciais.
