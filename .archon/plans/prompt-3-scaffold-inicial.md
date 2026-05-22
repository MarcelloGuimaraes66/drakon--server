# Prompt 3 - Scaffold inicial do drakon-server

Data: 2026-05-21

## Objetivo executado

Foi criado o scaffold inicial C++23/CMake do `drakon-server` como programa
CLI/headless, sem interface grafica, sem navegador, sem RTSP, sem inferencia e
sem banco de dados real nesta fase.

Nao foi feito commit. Nao foi feito push. Nenhum arquivo foi apagado.

## Arquivos criados ou ajustados

Arquivos ajustados:

- `CMakeLists.txt`
- `README.md`

Arquivos criados:

- `config/drakon-server.example.json`
- `include/drakon/config/config_loader.h`
- `include/drakon/runtime/redaction.h`
- `include/drakon/runtime/runtime_paths.h`
- `include/drakon/runtime/version.h`
- `src/config/config_loader.cpp`
- `src/runtime/redaction.cpp`
- `src/runtime/runtime_paths.cpp`
- `src/main.cpp`
- `.archon/plans/prompt-3-scaffold-inicial.md`

Diretorios runtime confirmados/criados por `prepare-runtime`:

- `runtime/`
- `data/frames/`
- `data/inference/`
- `data/alerts/`
- `data/events/`
- `data/indexes/`
- `data/logs/`

## CLI implementada

Comandos implementados:

- `drakon-server --help`
- `drakon-server version`
- `drakon-server validate-config --config <path>`
- `drakon-server prepare-runtime --config <path>`
- `drakon-server check-deps`
- `drakon-server status`

## Config exemplo

Arquivo:

- `config/drakon-server.example.json`

Secoes incluidas:

- `database`
- `runtime`
- `capture`
- `inference`
- `alerts`
- `security`
- `cameras`

O exemplo nao contem credenciais reais. A politica `allow_inline_secrets` fica
em `false`.

## Validacao inicial

`validate-config` faz validacao inicial de scaffold:

- arquivo existe e e legivel;
- formato JSON basico com chaves/containers balanceados;
- chaves obrigatorias presentes;
- `schema_version == "drakon.v1"`;
- `runtime`, `database`, `capture`, `inference` e `alerts` como objetos;
- `cameras` como array;
- paths runtime dentro da raiz do projeto;
- rejeicao de credenciais RTSP nao mascaradas;
- rejeicao de campos secretos inline simples quando `allow_inline_secrets=false`.

Esta validacao ainda nao substitui JSON Schema completo.

## Prepare runtime

`prepare-runtime` carrega o config, resolve paths e cria os diretorios:

- `data`
- `data/frames`
- `data/inference`
- `data/alerts`
- `data/events`
- `data/indexes`
- `data/logs`
- `runtime`

Tambem anexa uma linha em `data/logs/drakon-server.log`.

## Check deps

`check-deps` verifica:

- `ffmpeg`
- `ffprobe`
- `node` opcional
- `python3` ou `python` opcional

O comando nao falha quando provedores de inferencia nao estao configurados.

## Comandos executados

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j$(nproc)
ctest --test-dir build --output-on-failure
./build/drakon-server status
./build/drakon-server check-deps
```

## Resultado dos testes

CTest executado:

- `drakon_server_help`
- `drakon_server_version`
- `drakon_server_validate_config`
- `drakon_server_prepare_runtime`
- `drakon_server_check_deps`

Resultado:

```text
100% tests passed, 0 tests failed out of 5
```

## Resultado de check-deps observado

No ambiente atual foram encontrados:

- `ffmpeg`
- `ffprobe`
- `node`
- `python3`

## Status funcional atual

`drakon-server status` retorna:

- projeto `drakon-server`;
- versao `0.1.0`;
- config exemplo valida;
- `data_dir`, `runtime_dir` e `logs_dir` resolvidos;
- captura: `scaffold-only`;
- RTSP: `not-implemented`;
- inferencia: `not-implemented`;
- database: `not-implemented`.

## Proximos passos

1. Adicionar testes C++ unitarios para redacao de secrets e validacao de config.
2. Evoluir validacao JSON para schema/tipos mais fortes.
3. Implementar camada SQLite local e migracoes minimas.
4. Implementar escritores atomicos JSON/JSONL.
5. Implementar captura de fonte `test`/`file` antes de RTSP.
6. Implementar RTSP FFmpeg somente depois que config, runtime e persistencia
   estiverem estaveis.

## Confirmacoes

- Nenhum commit foi feito.
- Nenhum push foi feito.
- Nenhum arquivo foi apagado.
- Nenhum codigo do repositorio fonte `perceptrum_desktop_aspp` foi alterado.
- Nao foi implementado RTSP.
- Nao foi implementada inferencia.
- Nao foi implementado banco.
