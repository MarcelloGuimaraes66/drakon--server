# Prompt 9 - Alertas, eventos, API/webhook e integracao dashboard

Data: 2026-05-21

## Objetivo

Implementar a camada inicial de alertas e eventos do `drakon-server`, gerando arquivos JSON/JSONL que o dashboard Drakon possa ler.

## Arquivos criados

- `include/drakon/alerts/alerts.h`
- `src/alerts/alerts.cpp`
- `include/drakon/events/events.h`
- `src/events/events.cpp`
- `tests/seed_alert_inference.cmake`
- `tests/verify_alerts_events_index.cmake`
- `.archon/plans/prompt-9-alertas-eventos-dashboard.md`

## Arquivos ajustados

- `include/drakon/config/config_loader.h`
- `src/config/config_loader.cpp`
- `src/main.cpp`
- `CMakeLists.txt`
- `README.md`

## Modulos

### `events`

Responsavel por:

- gravar evento JSON em `data/events/YYYY/MM/DD/<event_id>.json`;
- reconstruir `data/indexes/events.jsonl`;
- criar linhas JSONL com campos consumiveis pelo dashboard.

### `alerts`

Responsavel por:

- ler `data/indexes/inference.jsonl`;
- abrir os resultados JSON de inferencia;
- gerar eventos a partir de `events`;
- gerar eventos e alertas a partir de `alert_candidates`;
- gravar alerta JSON em `data/alerts/YYYY/MM/DD/<alert_id>.json`;
- reconstruir `data/indexes/alerts.jsonl`;
- simular envio de webhooks em dry-run.

## Geracao a partir de inferencia

O comando:

```bash
./build/drakon-server generate-alerts --config config/drakon-server.example.json
```

Le:

```text
data/indexes/inference.jsonl
```

Para cada inferencia:

- `events[]` gera eventos observados;
- `alert_candidates[]` gera um evento aberto e um alerta pendente;
- inferencias sem `events` e sem `alert_candidates` nao inventam alerta.

IDs sao deterministicos a partir do `inference_id`, permitindo repetir o comando sem criar nomes novos:

```text
event_<inference_id>_<n>
event_<inference_id>_alert_<n>
alert_<inference_id>_<n>
```

Os JSONs sao regravados se o mesmo alerta/evento for gerado novamente, e os indices sao reconstruidos.

## Campos do alerta

O JSON de alerta inclui:

- `alert_id`
- `event_id`
- `camera_id`
- `job_id`
- `severity`
- `type`
- `title`
- `description`
- `timestamp`
- `timestamp_utc`
- `frame_refs`
- `inference_refs`
- `recommended_action`
- `delivery_status`
- `acknowledged`
- `metadata`

O indice `data/indexes/alerts.jsonl` inclui esses campos e `alert_path`.

## Campos do evento

O JSON de evento inclui:

- `event_id`
- `camera_id`
- `source`
- `event_type`
- `timestamp`
- `timestamp_utc`
- `frame_refs`
- `inference_refs`
- `alert_refs`
- `status`
- `metadata`

O indice `data/indexes/events.jsonl` inclui esses campos e `event_path`.

## Webhooks

O comando implementado nesta fase e:

```bash
./build/drakon-server send-webhooks --config config/drakon-server.example.json --dry-run
```

Comportamento:

- le `data/indexes/alerts.jsonl`;
- conta alertas pendentes;
- conta webhooks habilitados no config;
- nao envia rede;
- nao resolve `url_ref`;
- nao loga secrets.

Sem `--dry-run`, o comando falha de forma explicita:

```text
real webhook delivery is not implemented in this phase; use --dry-run
```

Configuracao preparada:

- `alerts.enabled`
- `alerts.dedupe_window_seconds`
- `alerts.channels`
- `alerts.webhooks[].webhook_id`
- `alerts.webhooks[].name`
- `alerts.webhooks[].enabled`
- `alerts.webhooks[].url_ref`
- `alerts.webhooks[].secret_ref`

URLs inline nao sao usadas no exemplo. O caminho recomendado e `url_ref` via secrets/config seguro.

## API local para dashboard

O comando foi preparado como plano executavel, sem abrir socket:

```bash
./build/drakon-server serve-api --config config/drakon-server.example.json --port 8077
```

Saida informa:

- `api: planned`
- `socket_opened: no`
- endpoints planejados:
  - `GET /health`
  - `GET /status`
  - `GET /dashboard/indexes`
  - `GET /alerts`
  - `GET /events`
  - `GET /frames`

Motivo: implementar servidor HTTP local completo aumenta escopo; os arquivos JSON/JSONL ja permitem integracao inicial do dashboard sem servidor.

## Testes adicionados

- `drakon_server_seed_alert_fixture`
- `drakon_server_generate_alerts`
- `drakon_server_send_webhooks_dry_run`
- `drakon_server_serve_api_plan`
- `drakon_server_verify_alerts_events_index`

O fixture cria uma inferencia mock com:

- `events[]`
- `alert_candidates[]`
- `risk_score`

Isso valida a geracao real de JSON/JSONL sem depender de LLM real.

## Validacao executada

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j$(nproc)
ctest --test-dir build --output-on-failure
```

Resultado:

```text
100% tests passed, 0 tests failed out of 22
```

Tambem foram executados:

```bash
./build/drakon-server generate-alerts --config config/drakon-server.example.json
./build/drakon-server send-webhooks --config config/drakon-server.example.json --dry-run
./build/drakon-server serve-api --config config/drakon-server.example.json --port 8077
```

Resultados observados:

```text
alerts: generated
events_index_records: 2
alerts_index_records: 1
```

```text
webhooks: dry-run-ok
alerts_read: 1
enabled_webhooks: 0
simulated_deliveries: 0
real_delivery: disabled
```

## Proximos passos recomendados

1. Implementar envio real de webhooks somente com `url_ref` resolvido via secrets.
2. Criar tabela/registro de deliveries no SQLite.
3. Adicionar dedupe real por janela temporal.
4. Implementar servidor HTTP local opcional com autenticao/token local.
5. Adicionar paginacao e filtros para `/alerts` e `/events`.
6. Integrar jobs para chamar `generate-alerts` apos inferencia.

## Confirmacoes

- Nenhum commit foi feito.
- Nenhum push foi feito.
- Nenhuma interface grafica foi criada.
- Nenhuma URL de webhook foi hardcodada.
- Nenhum webhook real foi enviado.
- Nenhum secret foi exposto em logs.
- Modo dry-run de webhooks existe e foi testado.
- Nenhum arquivo foi apagado.
