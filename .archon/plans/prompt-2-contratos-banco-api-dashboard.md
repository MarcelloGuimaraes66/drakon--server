# Prompt 2 - Contratos de banco, API, JSONL e dashboard

Data: 2026-05-21

## Escopo

Este relatorio define contratos futuros para SQLite/PostgreSQL, API local,
webhooks, indices JSONL e leitura pelo dashboard Drakon.

As referencias lidas mostram que o sistema atual usa:

- `DrakonSite/src/worker/index.ts` para rotas de dashboard, cameras, jobs,
  eventos, alertas e comandos do agente.
- `DrakonSite/server/sqlite-d1.ts` e `DrakonSite/server/pg-d1.ts` como
  adaptadores SQLite/PostgreSQL no backend Node.
- Tabelas historicas como `cameras`, `commands`, `events`, `detections`,
  `jobs`, `job_steps`, `job_step_agents`, `job_step_alert_rules`,
  `job_run_alerts`, `notifications`, `model_api_keys` e
  `telegram_settings`.

Nao foram copiados dados seedados nem valores sensiveis.

## Separacao de responsabilidades

| Meio | Uso recomendado | Fonte de verdade |
|---|---|---|
| JSON estruturado | Auditoria local por frame, inferencia, alerta, evento e job run | Sim para artefatos gerados. |
| JSONL | Indice append-only para dashboard, rebuild e consumo incremental | Nao; e indice derivado. |
| SQLite | Estado operacional local, consultas, dedupe, jobs, deliveries | Sim no MVP local. |
| PostgreSQL | Sincronizacao central ou modo multi-servidor futuro | Opcional; nao MVP. |
| Cache | Consultas agregadas, dashboard summary, offsets de leitura | Nao. |
| Config JSON | Bootstrap declarativo e exemplos | Fonte declarativa, importada para SQLite. |

## Tabelas minimas

### `cameras`

Finalidade: catalogo de cameras e estado desejado.

Campos recomendados:

- `camera_id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `enabled INTEGER NOT NULL`
- `source_type TEXT NOT NULL`
- `source_uri_masked TEXT`
- `device_path TEXT`
- `credentials_ref TEXT`
- `location_json TEXT`
- `description TEXT`
- `fps_profiles_json TEXT NOT NULL`
- `analysis_profile_json TEXT`
- `metadata_json TEXT`
- `status TEXT NOT NULL`
- `last_seen_at_utc TEXT`
- `created_at_utc TEXT NOT NULL`
- `updated_at_utc TEXT NOT NULL`

Nao armazenar senha RTSP em claro.

### `capture_sessions`

Finalidade: sessao de captura por camera.

- `capture_session_id TEXT PRIMARY KEY`
- `camera_id TEXT NOT NULL`
- `status TEXT NOT NULL`
- `started_at_utc TEXT NOT NULL`
- `stopped_at_utc TEXT`
- `source_uri_masked TEXT`
- `fps_profiles_json TEXT`
- `frames_captured INTEGER DEFAULT 0`
- `frames_stored INTEGER DEFAULT 0`
- `frames_dropped INTEGER DEFAULT 0`
- `last_frame_at_utc TEXT`
- `error_code TEXT`
- `error_message TEXT`

### `frames`

Finalidade: metadados consultaveis dos frames.

- `frame_id TEXT PRIMARY KEY`
- `camera_id TEXT NOT NULL`
- `capture_session_id TEXT NOT NULL`
- `timestamp_utc TEXT NOT NULL`
- `timestamp_local TEXT`
- `timezone TEXT`
- `fps_profile TEXT NOT NULL`
- `sequence INTEGER NOT NULL`
- `image_path TEXT NOT NULL`
- `metadata_path TEXT NOT NULL`
- `width INTEGER`
- `height INTEGER`
- `checksum TEXT`
- `status TEXT NOT NULL`
- `created_at_utc TEXT NOT NULL`

Indices: `(camera_id, timestamp_utc)`, `(capture_session_id, sequence)`.

### `jobs`

Finalidade: definicao e estado desejado de jobs.

- `job_id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `enabled INTEGER NOT NULL`
- `camera_ids_json TEXT NOT NULL`
- `trigger_json TEXT`
- `schedule_json TEXT`
- `agent_id TEXT`
- `inference_profile TEXT`
- `alert_policy_json TEXT`
- `output_policy_json TEXT`
- `status TEXT NOT NULL`
- `created_at_utc TEXT NOT NULL`
- `updated_at_utc TEXT NOT NULL`

### `job_steps`

- `step_id TEXT PRIMARY KEY`
- `job_id TEXT NOT NULL`
- `step_order INTEGER NOT NULL`
- `type TEXT NOT NULL`
- `name TEXT NOT NULL`
- `enabled INTEGER NOT NULL`
- `input_json TEXT`
- `condition_json TEXT`
- `action_json TEXT`
- `next_on_success TEXT`
- `next_on_failure TEXT`
- `timeout_seconds INTEGER`
- `retry_policy_json TEXT`

Indice unico: `(job_id, step_order)`.

### `agents`

- `agent_id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `type TEXT NOT NULL`
- `model_provider TEXT NOT NULL`
- `model TEXT`
- `prompt_template_id TEXT`
- `tools_allowed_json TEXT`
- `output_schema_json TEXT`
- `safety_policy_json TEXT`
- `enabled INTEGER NOT NULL`
- `created_at_utc TEXT NOT NULL`
- `updated_at_utc TEXT NOT NULL`

### `inferences`

- `inference_id TEXT PRIMARY KEY`
- `frame_id TEXT`
- `camera_id TEXT NOT NULL`
- `job_id TEXT`
- `agent_id TEXT`
- `timestamp_utc TEXT NOT NULL`
- `model_provider TEXT`
- `model TEXT`
- `prompt_id TEXT`
- `prompt_version TEXT`
- `result_json TEXT`
- `objects_json TEXT`
- `events_detected_json TEXT`
- `risk_score REAL`
- `alert_candidates_json TEXT`
- `raw_response_path TEXT`
- `status TEXT NOT NULL`
- `error_json TEXT`

### `alerts`

- `alert_id TEXT PRIMARY KEY`
- `event_id TEXT`
- `inference_id TEXT`
- `camera_id TEXT`
- `job_id TEXT`
- `severity TEXT NOT NULL`
- `type TEXT NOT NULL`
- `title TEXT NOT NULL`
- `description TEXT`
- `timestamp_utc TEXT NOT NULL`
- `timestamp_local TEXT`
- `frame_refs_json TEXT`
- `inference_refs_json TEXT`
- `delivery_targets_json TEXT`
- `delivery_status_json TEXT`
- `recommended_action TEXT`
- `acknowledged INTEGER DEFAULT 0`
- `metadata_json TEXT`

### `events`

- `event_id TEXT PRIMARY KEY`
- `camera_id TEXT`
- `source TEXT NOT NULL`
- `event_type TEXT NOT NULL`
- `timestamp_utc TEXT NOT NULL`
- `timestamp_local TEXT`
- `frame_refs_json TEXT`
- `inference_refs_json TEXT`
- `alert_refs_json TEXT`
- `status TEXT NOT NULL`
- `metadata_json TEXT`

Indices: `(timestamp_utc)`, `(event_type, timestamp_utc)`, `(camera_id, timestamp_utc)`.

### `deliveries`

Finalidade: estado de envio para webhook/API/Telegram/outros canais.

- `delivery_id TEXT PRIMARY KEY`
- `alert_id TEXT`
- `event_id TEXT`
- `target_type TEXT NOT NULL`
- `target_id TEXT NOT NULL`
- `status TEXT NOT NULL`
- `attempt_count INTEGER DEFAULT 0`
- `next_attempt_at_utc TEXT`
- `last_attempt_at_utc TEXT`
- `last_error TEXT`
- `created_at_utc TEXT NOT NULL`
- `updated_at_utc TEXT NOT NULL`

### `runtime_state`

Chave/valor para estado operacional.

- `key TEXT PRIMARY KEY`
- `value_json TEXT NOT NULL`
- `updated_at_utc TEXT NOT NULL`

Exemplos: `schema_version`, `instance_id`, `last_index_offsets`,
`active_capture_sessions`.

## SQLite e PostgreSQL

MVP:

- SQLite local com WAL.
- Migracoes versionadas.
- Prepared statements.
- Transacoes curtas para frame/inferencia/alerta/evento.

PostgreSQL futuro:

- Usar como replica/sincronizacao central ou instalacao multi-servidor.
- Nao depender de PostgreSQL para capturar frames no MVP.
- Manter SQL portavel sempre que possivel; onde divergir, esconder atras de
  repositorios tipados.

## Indices JSONL

### Regras gerais

- Uma linha JSON por operacao.
- Append-only.
- Ordenacao primaria por `timestamp_utc`, secundaria por `record_id`.
- Cada linha carrega resumo suficiente para o dashboard listar sem abrir o
  JSON completo.
- Cada linha aponta para o JSON estruturado por `path`.
- O JSON estruturado e o SQLite sao usados para validar/reconstruir o indice.

Campos comuns:

```json
{
  "schema_version": "drakon.v1",
  "record_type": "frame",
  "record_id": "...",
  "op": "upsert",
  "timestamp_utc": "...",
  "path": "...",
  "summary": {}
}
```

`op`: `upsert`, `delete`, `tombstone`.

### `frames.jsonl`

Linha:

```json
{
  "schema_version": "drakon.v1",
  "record_type": "frame",
  "record_id": "frame_ulid",
  "op": "upsert",
  "timestamp_utc": "2026-05-21T19:00:00.123Z",
  "path": "frames/cam_01/2026/05/21/15/00/fps_1/...",
  "summary": {
    "camera_id": "cam_01",
    "fps_profile": "fps_1",
    "image_path": "...jpg",
    "width": 1920,
    "height": 1080,
    "status": "stored"
  }
}
```

### `inference.jsonl`

Resumo deve conter `camera_id`, `frame_id`, `job_id`, `agent_id`,
`risk_score`, `status` e quantidade de eventos detectados.

### `alerts.jsonl`

Resumo deve conter `camera_id`, `job_id`, `severity`, `type`, `title`,
`acknowledged`, `frame_refs`, `delivery_status` e paths de midia quando houver.

### `events.jsonl`

Resumo deve conter `camera_id`, `source`, `event_type`, `status`, mensagem
curta e referencias a frames/inferencias/alertas.

### `jobs.jsonl`

Resumo deve conter `job_id`, `name`, `enabled`, `status`, `active_run_id`,
`camera_ids`, `step_count`, `last_started_at_utc` e `last_completed_at_utc`.

### `cameras.jsonl`

Resumo deve conter `camera_id`, `name`, `enabled`, `source_type`, `status`,
`fps_profiles`, `last_seen_at_utc`, `thumbnail_path` opcional e localizacao
sanitizada.

## Rotacao e rebuild de JSONL

Rotacao:

- Por mes ou por tamanho maximo.
- Manter arquivo ativo sem compactacao.
- Arquivos antigos podem ser compactados depois que dashboard suportar leitura.

Rebuild:

1. Varrer SQLite por tabela ou varrer JSON estruturado.
2. Ordenar por `timestamp_utc` e `record_id`.
3. Escrever `*.rebuild.tmp`.
4. Validar quantidade e JSON parseavel por linha.
5. Renomear para `*.jsonl`.

Consistencia:

- A linha JSONL deve apontar para um JSON que existe, exceto `delete` e
  `tombstone`.
- `summary.status` deve refletir o status do JSON estruturado e do SQLite.
- Em caso de divergencia, SQLite e JSON estruturado vencem; JSONL e reconstruido.

## Leitura pelo dashboard

O dashboard deve preferir:

- `GET /dashboard/indexes` para descobrir paths, offsets e versoes.
- `GET /alerts`, `GET /events`, `GET /frames` para paginacao.
- `GET /cameras`, `GET /jobs`, `GET /status` para estado atual.

O dashboard nao deve varrer diretorios profundos no caminho critico. Pode usar
JSONL como indice e abrir JSON especifico apenas quando o usuario pedir detalhe.

## API local futura

Todas as rotas devem ser locais por padrao em `127.0.0.1`. Autenticacao por
Bearer token local ou socket Unix pode entrar antes de expor rede.

### `GET /health`

Resposta:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "instance_id": "drakon-local-01",
  "uptime_seconds": 123,
  "checks": {
    "config": "ok",
    "database": "ok",
    "data_dir": "ok",
    "indexes": "ok"
  }
}
```

### `GET /status`

Resumo operacional:

```json
{
  "status": "running",
  "started_at_utc": "...",
  "cameras": {
    "total": 2,
    "running": 1,
    "degraded": 0
  },
  "jobs": {
    "total": 3,
    "running": 1
  },
  "alerts": {
    "unacknowledged": 4
  }
}
```

### `GET /cameras`

Lista cameras com campos publicos e mascarados. Nao retornar RTSP com senha.

Filtros futuros: `enabled`, `status`, `source_type`.

### `GET /alerts`

Paginacao por cursor:

```text
GET /alerts?limit=50&cursor=<record_id>&severity=high
```

Resposta contem `alerts`, `has_more`, `next_cursor`.

### `GET /events`

Filtros: `event_type`, `camera_id`, `after`, `limit`.

Compatibilidade com dashboard atual: suportar `after_id` futuramente se o
dashboard continuar usando IDs numericos. Internamente, preferir ULID.

### `GET /frames`

Filtros: `camera_id`, `from`, `to`, `fps_profile`, `limit`.

Resposta deve retornar metadados e URL/path de imagem, nao imagem inline.

### `POST /webhooks/alert`

Uso futuro restrito:

- Receber alerta externo ou testar pipeline de alerta local.
- Exigir autenticacao.
- Validar assinatura se vier de integracao externa.
- Nunca aceitar segredo em query string.

Payload:

```json
{
  "alert_id": "external-optional",
  "source": "external",
  "severity": "medium",
  "type": "external_alert",
  "title": "Alerta externo",
  "description": "Mensagem",
  "metadata": {}
}
```

Para webhooks de saida, a configuracao deve ficar em `config` com
`webhook_secret_ref`; `deliveries` registra tentativas.

### `POST /jobs/reload`

Recarrega jobs/config sem reiniciar processo.

Resposta: quantidade de jobs carregados, erros de validacao sanitizados.

### `POST /runtime/restart-camera`

Payload:

```json
{
  "camera_id": "cam_01",
  "reason": "manual"
}
```

Deve ser idempotente e registrar evento.

### `GET /dashboard/indexes`

Resposta:

```json
{
  "schema_version": "drakon.v1",
  "indexes": {
    "frames": {
      "path": "indexes/frames.jsonl",
      "record_type": "frame",
      "updated_at_utc": "2026-05-21T19:00:00Z"
    },
    "alerts": {
      "path": "indexes/alerts.jsonl",
      "record_type": "alert",
      "updated_at_utc": "2026-05-21T19:00:00Z"
    }
  }
}
```

## Cuidados de seguranca da API

- Bind em `127.0.0.1` por padrao.
- Exigir token para mutacoes.
- Nao aceitar secrets em query string.
- Redigir logs de headers `Authorization`, URLs RTSP, DSNs, API keys e tokens.
- Limitar tamanho de payload.
- Rate limit em mutacoes e webhooks.
- Validar path traversal para arquivos de media.
- Retornar erro estruturado sem stack trace por padrao.

## Compatibilidade com dashboard atual

O dashboard atual consome principalmente:

- `/api/dashboard`
- `/api/dashboard-alerts`
- `/api/events`
- `/api/cameras`
- `/api/cameras/:cameraId/recordings/summary`
- `/api/cameras/:cameraId/recordings/segments`
- `/api/jobs`

O `drakon-server` deve nascer com contrato proprio, mas modelado para mapear
esses dados:

- `GET /status` alimenta stats de `/api/dashboard`.
- `GET /alerts` alimenta `/api/dashboard-alerts`.
- `GET /events` alimenta toasts/eventos.
- `GET /frames` e indices alimentam midia.
- `GET /dashboard/indexes` evita varredura de diretorios.

## Decisoes pendentes

- Framework HTTP C++ para API local: `cpp-httplib`, Drogon, Boost.Beast ou
  outro.
- Biblioteca SQLite C++: wrapper proprio sobre `sqlite3` ou biblioteca leve.
- Se PostgreSQL entra no Prompt 3 ou fica explicitamente fora ate o Prompt 5+.
- Se o dashboard sera ajustado para JSONL direto ou se uma API de compatibilidade
  vai traduzir para os endpoints atuais.
