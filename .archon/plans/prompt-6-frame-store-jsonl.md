# Prompt 6 - Frame store, timestamps e indices JSONL

Data: 2026-05-21

## Objetivo

Criar o frame store canonico do drakon-server, com:

- diretorios por camera e timestamp;
- nomes de arquivo canonicos;
- metadados JSON ao lado do frame;
- indice `data/indexes/frames.jsonl` para leitura direta pelo dashboard;
- comando `drakon-server index-frames --config <path>`;
- testes sem dependencia de camera real.

## Contratos lidos

Foram considerados os contratos definidos no Prompt 2:

- `.archon/plans/prompt-2-contratos-json.md`
- `.archon/plans/prompt-2-estrutura-diretorios.md`
- `.archon/plans/prompt-2-contratos-banco-api-dashboard.md`

O contrato aplicado nesta fase preserva `runtime.data_root` como raiz relativa/configuravel e nao hardcoda caminhos absolutos.

## Arquivos criados

- `include/drakon/frame_store/frame_store.h`
- `src/frame_store/frame_store.cpp`
- `tests/verify_frame_store.cmake`
- `.archon/plans/prompt-6-frame-store-jsonl.md`

## Arquivos ajustados

- `CMakeLists.txt`
- `README.md`
- `src/camera/capture.cpp`
- `src/main.cpp`

## Implementacao

Foi criado o modulo `drakon::frame_store` com:

- `FrameStoreRequest`
- `FrameStoreResult`
- `FrameStore`
- `rebuild_frame_index`
- `sanitize_path_part`

A captura `capture-test` passou a usar `FrameStore` para gravar frames.

O caminho canonico implementado e:

```text
data/frames/<camera_id>/<YYYY>/<MM>/<DD>/<HH>/<mm>/fps_<fps>/
```

O nome canonico de imagem implementado e:

```text
<timestamp_utc>_<camera_id>_<sequence>.jpg
```

Exemplo gerado em teste:

```text
data/frames/cam_test_01/2026/05/21/16/15/fps_1/20260521T201510438Z_cam_test_01_000001.jpg
```

O sidecar JSON e salvo como:

```text
<frame_id>.json
```

Exemplo:

```text
data/frames/cam_test_01/2026/05/21/16/15/fps_1/frame_cam_test_01_20260521T201510438Z_000001.json
```

## Indice JSONL

O indice canonico e:

```text
data/indexes/frames.jsonl
```

Cada linha contem, no minimo:

- `frame_id`
- `camera_id`
- `timestamp_utc`
- `timestamp_local`
- `fps_profile`
- `image_path`
- `metadata_path`
- `width`
- `height`
- `source`
- `checksum`

Tambem foram incluidos:

- `schema_version`
- `record_type`
- `status`

Os paths gravados no JSON/JSONL sao relativos ao `data_root`, permitindo que o dashboard leia os indices sem depender do banco.

## Comando novo

```bash
./build/drakon-server index-frames --config config/drakon-server.example.json
```

Comportamento:

- le o config;
- usa `runtime.data_root`;
- varre `data/frames`;
- le sidecars `.json`;
- reconstrui `data/indexes/frames.jsonl` ordenado por `timestamp_utc` e `frame_id`;
- ignora metadados invalidos com warning;
- nao depende de banco.

## Testes adicionados

- `drakon_server_index_frames`
- `drakon_server_verify_frame_store`

O teste `verify_frame_store.cmake` confirma:

- existencia de imagem canonica;
- existencia de sidecar canonico;
- existencia de `data/indexes/frames.jsonl`;
- indice nao vazio;
- campos JSONL obrigatorios;
- referencia a nome de frame canonico.

## Validacao executada

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j$(nproc)
ctest --test-dir build --output-on-failure
```

Resultado:

```text
100% tests passed, 0 tests failed out of 11
```

## Observacoes

- Nenhuma inferencia foi implementada.
- Nenhuma interface grafica foi criada.
- Nenhum caminho absoluto foi hardcodado no frame store.
- A captura dry-run anterior continua funcionando.
- URLs/fontes sensiveis continuam recebendo valores mascarados vindos da camada de captura.
- `index-frames` tambem consegue reconstruir indice a partir de sidecars antigos, enquanto novos frames seguem o nome canonico desta fase.

## Proximos passos recomendados

1. Integrar persistencia dos frames no SQLite quando o contrato de banco for usado pela captura.
2. Criar politica de rotacao/retencao para `frames.jsonl`.
3. Adicionar indice incremental por data se o volume de frames crescer.
4. Preparar o contrato de eventos/inferencia para escrever `inference.jsonl`, `events.jsonl` e `alerts.jsonl` nas proximas fases.

## Confirmacoes

- Codigo-fonte do repositorio fonte `perceptrum_desktop_aspp` nao foi alterado.
- Nenhum commit foi feito.
- Nenhum push foi feito.
- Nenhum arquivo foi apagado.
