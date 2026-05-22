# Prompt 8 - Inferencia LLM e resultados JSON estruturados

Data: 2026-05-21

## Objetivo

Implementar a camada inicial de inferencia do `drakon-server`, sem interface grafica, com:

- modulo `inference`;
- configuracao de provider/modelo;
- comandos CLI `infer-frame` e `infer-batch`;
- resultado JSON estruturado em `data/inference/`;
- indice `data/indexes/inference.jsonl`;
- modo `mock` explicito;
- testes sem chamada a API externa.

## Referencia lida no perceptrum_desktop_aspp

Foram consultados como referencia:

- `Perceptrum/Perceptrum/orchestrator/LocalLlmClient.h`
- `Perceptrum/Perceptrum/orchestrator/LocalLlmClient.cpp`
- `Perceptrum/Perceptrum/orchestrator/ChatModelConfig.h`
- `Perceptrum/Perceptrum/orchestrator/ChatModelConfig.cpp`
- `Perceptrum/Perceptrum/orchestrator/PromptBuilder.h`
- `Perceptrum/Perceptrum/orchestrator/PromptBuilder.cpp`
- `Perceptrum/Perceptrum/orchestrator/ChatV2Orchestrator.*`
- `Perceptrum/Perceptrum/orchestrator/skills/GenerateReportSkill.*`
- `Perceptrum/Perceptrum/orchestrator/skills/VideoSearchSkill.*`

`InferenceStub.*` nao foi encontrado no reposititorio fonte local.

Conclusao aplicada:

- O Perceptrum tem cliente LLM e prompts acoplados a orquestrador, UI/backend e fluxos de skill.
- Nesta fase do `drakon-server`, foi implementado somente o contrato headless inicial.
- Nenhum codigo do Perceptrum foi copiado cegamente.

## Arquivos criados

- `include/drakon/inference/inference.h`
- `src/inference/inference.cpp`
- `tests/run_infer_frame_mock.cmake`
- `tests/verify_inference_index.cmake`
- `.archon/plans/prompt-8-inferencia-json.md`

## Arquivos ajustados

- `include/drakon/config/config_loader.h`
- `src/config/config_loader.cpp`
- `config/drakon-server.example.json`
- `src/main.cpp`
- `CMakeLists.txt`
- `README.md`

## Configuracao

O contrato de config agora inclui:

```json
{
  "inference": {
    "enabled": true,
    "provider": "mock",
    "model": "mock-frame-analyzer-v1",
    "api_key_ref": null,
    "prompt_id": "default_frame_analysis",
    "prompt_version": "v1",
    "prompt_template": "...",
    "allow_raw_response": false
  }
}
```

Regras implementadas:

- `provider=mock` executa somente inferencia simulada.
- Provider diferente de `mock` nao chama API externa nesta fase.
- Provider externo sem `api_key_ref` retorna erro funcional claro.
- Provider externo com `api_key_ref` tambem retorna erro claro de nao implementado nesta fase.
- Nenhuma API key e hardcodada.
- Nenhum secret e salvo em logs.

## Comandos

Inferir um frame ou sidecar:

```bash
./build/drakon-server infer-frame --config config/drakon-server.example.json --frame <path>
```

Inferir todos os frames de um indice:

```bash
./build/drakon-server infer-batch --config config/drakon-server.example.json --frames-index data/indexes/frames.jsonl
```

`--frame` aceita imagem ou metadata JSON. Para imagens, o modulo localiza o sidecar JSON canonico no mesmo diretorio.

## Resultado JSON

O resultado e salvo em:

```text
data/inference/<camera_id>/<YYYY>/<MM>/<DD>/<HH>/<inference_id>.json
```

Campos gravados:

- `inference_id`
- `frame_id`
- `camera_id`
- `timestamp`
- `timestamp_utc`
- `frame_timestamp_utc`
- `model_provider`
- `model`
- `prompt`
- `objects`
- `events`
- `risk_score`
- `alert_candidates`
- `raw_response_path`
- `status`
- `error`
- `mock`
- `frame`

Em modo mock:

- `status` fica `mock`;
- `mock` fica `true`;
- `objects`, `events` e `alert_candidates` ficam vazios;
- `risk_score` fica `0.0`;
- nenhum resultado e apresentado como se fosse real.

## Indice JSONL

Indice:

```text
data/indexes/inference.jsonl
```

Cada linha contem:

- `schema_version`
- `record_type`
- `inference_id`
- `frame_id`
- `camera_id`
- `timestamp`
- `model_provider`
- `model`
- `mock`
- `risk_score`
- `status`
- `error`
- `result_path`

## Testes adicionados

- `drakon_server_infer_frame_mock`
- `drakon_server_infer_batch_mock`
- `drakon_server_verify_inference_index`

Os testes dependem dos frames gerados por `capture-test --dry-run` e nao chamam rede.

## Validacao executada

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j$(nproc)
ctest --test-dir build --output-on-failure
```

Resultado:

```text
100% tests passed, 0 tests failed out of 17
```

Tambem foi executado:

```bash
./build/drakon-server infer-batch --config config/drakon-server.example.json --frames-index data/indexes/frames.jsonl
```

Resultado observado:

```text
inference_batch: ok
failed: 0
```

## Proximos passos recomendados

1. Adicionar provider real atras de feature/config explicita, sem fallback automatico.
2. Implementar cliente HTTP separado com mascaramento de secrets.
3. Suportar `raw_response_path` apenas quando `allow_raw_response=true`.
4. Persistir inferencias no SQLite.
5. Conectar jobs a `infer-frame`/`infer-batch` mantendo dry-run como caminho seguro de teste.
6. Criar politica de retencao para `inference.jsonl`.

## Confirmacoes

- Nenhuma API externa foi chamada.
- Nenhuma API key foi hardcodada.
- Nenhum secret foi salvo em log.
- Nenhuma inferencia real foi inventada.
- Resultados mock sao identificados como `mock`.
- Nenhuma interface grafica foi criada.
- Nenhum commit foi feito.
- Nenhum push foi feito.
- Nenhum arquivo foi apagado.
- O repositorio fonte `perceptrum_desktop_aspp` nao foi alterado.
