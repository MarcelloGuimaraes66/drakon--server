# Prompt 2 - Contratos JSON do drakon-server

Data: 2026-05-21

## Escopo

Este relatorio define os contratos JSON do `drakon-server` antes de qualquer
implementacao. Foram usados como base:

- `.archon/plans/prompt-1-analise-fonte-perceptrum.md`
- `.archon/plans/prompt-1-mapa-extracao-modulos.md`
- `.archon/plans/prompt-1-riscos-extracao.md`
- Leitura local dos modulos de camera, jobs, core, orchestrator, comm,
  `DrakonSite/server`, `DrakonSite/src/worker`, `DrakonSite/src/react-app` e
  `AppHost`.

Nenhum codigo-fonte foi alterado. O repositorio fonte foi apenas lido.

## Convencoes globais

Todo JSON gerado ou lido pelo servidor deve seguir estas regras:

- `schema_version`: string obrigatoria em arquivos persistidos. Versao inicial:
  `drakon.v1`.
- Timestamps: ISO-8601.
  - `timestamp_utc`: sempre UTC com `Z`, por exemplo
    `2026-05-21T19:00:00.123Z`.
  - `timestamp_local`: valor local ja convertido para exibicao.
  - `timezone`: nome IANA, por exemplo `America/Manaus`.
- IDs: recomendar ULID ou UUIDv7 para novos objetos de runtime, por manter
  ordenacao temporal e baixa colisao.
- Caminhos: sempre relativos a `data_dir`, exceto quando documentado como
  caminho absoluto interno. JSON publicado ao dashboard deve preferir path
  relativo.
- Secrets: nenhum valor secreto deve aparecer em JSON versionado, indice JSONL,
  logs, resposta de API ou erro. Usar `credentials_ref`, `api_key_ref`,
  `webhook_secret_ref` e valores mascarados.
- URIs de origem: usar `source_uri_masked`; nunca persistir URL RTSP com senha
  em claro quando houver alternativa.
- Estado: usar enums estaveis em minusculo: `enabled`, `disabled`, `running`,
  `stopped`, `pending`, `success`, `failed`, `skipped`, `degraded`.

## Contrato de configuracao principal

Arquivo futuro documentado: `config/drakon-server.example.json`.

Este arquivo sera criado apenas no Prompt 3. O contrato deve conter:

```json
{
  "schema_version": "drakon.v1",
  "runtime": {
    "instance_id": "drakon-local-01",
    "data_dir": "data",
    "runtime_dir": "runtime",
    "config_dir": "config",
    "log_dir": "data/logs",
    "bind_address": "127.0.0.1",
    "api_port": 8077,
    "timezone": "America/Manaus",
    "shutdown_timeout_seconds": 30
  },
  "database": {
    "mode": "sqlite",
    "sqlite_path": "data/db/drakon-server.sqlite3",
    "postgres": {
      "enabled": false,
      "dsn_ref": "env:DRAKON_POSTGRES_DSN"
    }
  },
  "security": {
    "secrets_provider": "env",
    "local_secret_file": "config/secrets.local.json",
    "allow_inline_secrets": false,
    "redact_logs": true
  },
  "capture_profiles": [
    {
      "profile_id": "fps_1",
      "fps": 1,
      "enabled": true,
      "image_format": "jpg",
      "quality": 90
    },
    {
      "profile_id": "fps_10",
      "fps": 10,
      "enabled": false,
      "image_format": "jpg",
      "quality": 85
    }
  ],
  "frame_store": {
    "enabled": true,
    "layout": "camera/yyyy/mm/dd/hh/mm/profile",
    "write_metadata_sidecar": true,
    "checksum": "sha256",
    "atomic_writes": true
  },
  "inference": {
    "enabled": false,
    "default_provider": "stub",
    "providers": []
  },
  "jobs": {
    "enabled": true,
    "reload_on_config_change": false,
    "max_parallel_jobs": 2
  },
  "agents": {
    "enabled": true,
    "default_timeout_seconds": 60
  },
  "alerts": {
    "enabled": true,
    "dedupe_window_seconds": 300,
    "channels": []
  },
  "webhooks": {
    "enabled": false,
    "targets": []
  },
  "dashboard": {
    "enabled": true,
    "indexes_dir": "data/indexes",
    "media_base_url": "/media",
    "compatibility_mode": "jsonl-first"
  },
  "retention": {
    "frames_days": 7,
    "inference_days": 30,
    "alerts_days": 180,
    "events_days": 180,
    "logs_days": 14
  },
  "cameras": [],
  "jobs_definitions": []
}
```

Campos sensiveis aceitos somente por referencia:

- `env:VAR_NAME`
- `file:/absolute/path`
- `secret-tool:service/name`
- `db:secret_name`

## JSON de camera

Fonte de referencia: `CameraConfig.h`, tabelas `cameras`, rotas
`/api/cameras` e `/api/agent/cameras`.

Campos minimos:

```json
{
  "schema_version": "drakon.v1",
  "camera_id": "cam_01",
  "name": "Entrada principal",
  "enabled": true,
  "source_type": "rtsp",
  "rtsp_url": "rtsp://user:***@192.168.0.10:554/stream1",
  "device_path": null,
  "location": {
    "label": "Portaria",
    "country": "BR",
    "state": "AM",
    "city": "Manaus",
    "timezone": "America/Manaus"
  },
  "description": "Camera da entrada principal",
  "fps_profiles": ["fps_1"],
  "analysis_profile": {
    "capture_on_motion_only": false,
    "analysis_regions": [],
    "default_agent_id": null
  },
  "credentials_ref": "env:CAM_01_RTSP_CREDENTIALS",
  "metadata": {},
  "created_at": "2026-05-21T19:00:00Z",
  "updated_at": "2026-05-21T19:00:00Z"
}
```

Regras:

- `source_type`: `rtsp`, `webcam`, `file` ou `test`.
- Para `rtsp`, `rtsp_url` deve estar mascarada quando persistida fora de
  `config` privado. A senha deve ficar em `credentials_ref`.
- Para `webcam`, usar `device_path` (`/dev/video0`) ou `webcam_index`.
- `fps_profiles` referencia perfis declarados em `capture_profiles`.
- `analysis_profile.analysis_regions` deve usar coordenadas normalizadas
  `[0.0, 1.0]`, como nos contratos `AnalysisRegionGeometry` e `JobTypes`.

## JSON de frame

Campos minimos:

```json
{
  "schema_version": "drakon.v1",
  "frame_id": "01JY0000000000000000000001",
  "camera_id": "cam_01",
  "capture_session_id": "01JY0000000000000000000000",
  "timestamp_utc": "2026-05-21T19:00:00.123Z",
  "timestamp_local": "2026-05-21T15:00:00.123-04:00",
  "timezone": "America/Manaus",
  "fps_profile": "fps_1",
  "sequence": 42,
  "image_path": "frames/cam_01/2026/05/21/15/00/fps_1/20260521T190000123Z_000042.jpg",
  "metadata_path": "frames/cam_01/2026/05/21/15/00/fps_1/20260521T190000123Z_000042.json",
  "width": 1920,
  "height": 1080,
  "source_uri_masked": "rtsp://user:***@192.168.0.10:554/stream1",
  "checksum": "sha256:...",
  "status": "stored"
}
```

Regras:

- `sequence` e monotonicamente crescente por `capture_session_id`.
- `image_path` deve ser relativo a `data/`.
- `metadata_path` aponta para este sidecar JSON.
- `status`: `captured`, `stored`, `dropped`, `failed`, `deleted`.

## JSON de job

Fonte de referencia: `JobTypes.h`, `JobPayloadParser.*`, rotas
`/api/jobs` e `jobScheduler.ts`.

```json
{
  "schema_version": "drakon.v1",
  "job_id": "job_portaria_01",
  "name": "Monitoramento da portaria",
  "enabled": true,
  "camera_ids": ["cam_01"],
  "trigger": {
    "type": "schedule"
  },
  "schedule": {
    "timezone": "America/Manaus",
    "mode": "daily",
    "windows": [
      {
        "start_local": "08:00",
        "end_local": "18:00"
      }
    ]
  },
  "steps": [],
  "agent_id": "agent_portaria",
  "inference_profile": "vision_default",
  "alert_policy": {
    "enabled": true,
    "dedupe_window_seconds": 300
  },
  "output_policy": {
    "persist_json": true,
    "persist_raw_response": false
  },
  "created_at": "2026-05-21T19:00:00Z",
  "updated_at": "2026-05-21T19:00:00Z"
}
```

Regras:

- `trigger.type`: `manual`, `schedule`, `event`, `startup`.
- `steps` deve conter objetos no contrato de step.
- `camera_ids` e uma lista logica. Alocacao de camera em runtime fica em
  `capture_sessions` e `runtime_state`.

## JSON de step

```json
{
  "schema_version": "drakon.v1",
  "step_id": "step_01",
  "type": "inference",
  "name": "Analisar entrada",
  "enabled": true,
  "input": {
    "frame_selector": "latest",
    "camera_ids": ["cam_01"]
  },
  "condition": {
    "mode": "sequential"
  },
  "action": {
    "agent_id": "agent_portaria",
    "inference_profile": "vision_default"
  },
  "next_on_success": "step_02",
  "next_on_failure": null,
  "timeout_seconds": 60,
  "retry_policy": {
    "max_attempts": 2,
    "backoff_seconds": 10
  }
}
```

Regras:

- `type`: `capture`, `inference`, `condition`, `alert`, `webhook`,
  `wait`, `aggregate`.
- `condition.mode`: `sequential`, `positive`, `negative`, `time`, `custom`.
- O contrato suporta pipelines futuros sem portar `JobRuntime.cpp` inteiro.

## JSON de agente

```json
{
  "schema_version": "drakon.v1",
  "agent_id": "agent_portaria",
  "name": "Agente da portaria",
  "type": "vision_llm",
  "model_provider": "openai_compatible",
  "model": "configured-by-profile",
  "prompt_template_id": "prompt_portaria_v1",
  "tools_allowed": ["read_frame_metadata"],
  "output_schema": {
    "type": "json_object",
    "required": ["summary", "risk_score", "events_detected"]
  },
  "safety_policy": {
    "redact_secrets": true,
    "max_raw_response_bytes": 65536
  },
  "enabled": true
}
```

Regras:

- `model_provider`: `stub`, `openai`, `openai_compatible`, `gemini`,
  `local`.
- Chaves de API entram por `api_key_ref` no perfil de inferencia, nao no agente.
- `tools_allowed` deve ser allowlist. Nada de comandos arbitrarios no MVP.

## JSON de inferencia

```json
{
  "schema_version": "drakon.v1",
  "inference_id": "01JY0000000000000000000002",
  "frame_id": "01JY0000000000000000000001",
  "camera_id": "cam_01",
  "job_id": "job_portaria_01",
  "agent_id": "agent_portaria",
  "timestamp_utc": "2026-05-21T19:00:02.000Z",
  "model_provider": "stub",
  "model": "stub-v1",
  "prompt_id": "prompt_portaria_v1",
  "prompt_version": "1",
  "result": {
    "summary": "Sem evento relevante",
    "confidence": 0.80
  },
  "objects": [],
  "events_detected": [],
  "risk_score": 0.0,
  "alert_candidates": [],
  "raw_response_path": null,
  "status": "success",
  "error": null
}
```

Regras:

- `raw_response_path` deve ser `null` por padrao. Persistir resposta bruta so
  com politica explicita e redacao.
- `error` deve conter codigo e mensagem sanitizada, nunca request completo.
- `risk_score`: numero de `0.0` a `1.0`.

## JSON de alerta

```json
{
  "schema_version": "drakon.v1",
  "alert_id": "01JY0000000000000000000003",
  "event_id": "01JY0000000000000000000004",
  "inference_id": "01JY0000000000000000000002",
  "camera_id": "cam_01",
  "job_id": "job_portaria_01",
  "severity": "medium",
  "type": "inference_match",
  "title": "Evento detectado",
  "description": "Descricao curta para o dashboard",
  "timestamp_utc": "2026-05-21T19:00:03.000Z",
  "timestamp_local": "2026-05-21T15:00:03.000-04:00",
  "frame_refs": ["01JY0000000000000000000001"],
  "inference_refs": ["01JY0000000000000000000002"],
  "delivery_targets": ["dashboard"],
  "delivery_status": {
    "dashboard": "stored"
  },
  "recommended_action": "Verificar camera",
  "acknowledged": false,
  "metadata": {}
}
```

Regras:

- `severity`: `low`, `medium`, `high`, `critical`.
- Primeiro persistir localmente, depois emitir webhook/canal externo.
- `alert_id` pode ser deterministico quando usado para deduplicacao.

## JSON de evento

```json
{
  "schema_version": "drakon.v1",
  "event_id": "01JY0000000000000000000004",
  "camera_id": "cam_01",
  "source": "capture",
  "event_type": "frame_stored",
  "timestamp_utc": "2026-05-21T19:00:00.123Z",
  "timestamp_local": "2026-05-21T15:00:00.123-04:00",
  "frame_refs": ["01JY0000000000000000000001"],
  "inference_refs": [],
  "alert_refs": [],
  "status": "success",
  "metadata": {}
}
```

Regras:

- `source`: `runtime`, `capture`, `frame_store`, `inference`, `job`,
  `alert`, `api`, `webhook`.
- `event_type` deve ser estavel. Exemplos iniciais:
  `runtime_started`, `camera_started`, `camera_stopped`,
  `camera_connection_failed`, `frame_stored`, `inference_completed`,
  `alert_created`, `job_started`, `job_completed`, `job_failed`.

## Contrato JSONL comum

Os indices em `data/indexes/*.jsonl` devem conter uma linha JSON por evento de
indice. Cada linha precisa ter:

```json
{
  "schema_version": "drakon.v1",
  "record_type": "frame",
  "record_id": "01JY0000000000000000000001",
  "op": "upsert",
  "timestamp_utc": "2026-05-21T19:00:00.123Z",
  "path": "frames/cam_01/2026/05/21/15/00/fps_1/20260521T190000123Z_000042.json",
  "summary": {}
}
```

Detalhes por indice estao no relatorio
`prompt-2-contratos-banco-api-dashboard.md`.

## Decisoes tomadas

- O JSON estruturado por entidade e a fonte auditavel para media, inferencia,
  alerta e evento.
- JSONL sera usado como indice append-only para o dashboard e para rebuild.
- SQLite sera a fonte operacional local na primeira implementacao.
- PostgreSQL sera opcional e posterior.
- Secrets ficam fora dos JSONs publicados e fora de exemplos reais.

## Decisoes pendentes

- Escolher implementacao exata de ULID/UUIDv7 em C++.
- Escolher biblioteca de validacao JSON Schema ou validacao manual tipada.
- Definir se o dashboard inicial lera diretamente `data/indexes/*.jsonl` ou
  via API local do `drakon-server`.
