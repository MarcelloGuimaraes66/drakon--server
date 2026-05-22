# Drakon Server - Contratos JSON, DB e API

## 1. Cameras

Fonte: `CameraConfig`, `DrakonSite/db/patches/perceptrum_sql.sql`, endpoints `/api/cameras`.

Campos relevantes:

```json
{
  "id": "123",
  "name": "Gate",
  "connection_method": "rtsp",
  "rtsp_url": "rtsp://...",
  "ip_address": "192.168.1.10",
  "rtsp_port": "554",
  "username": "optional",
  "password": "secret-ref-only",
  "webcam_index": -1,
  "store_frames": true,
  "retention_days": 7,
  "frame_capture_interval_seconds": 1,
  "analysis_speed": 3,
  "model_tier": "light",
  "timezone": "America/Manaus",
  "utc_offset_seconds": -14400,
  "enabled_algorithms": ["custom_v2"],
  "algorithms": []
}
```

Regra para o novo servidor: credenciais devem ser referenciadas por `secret_ref` ou env, nunca persistidas em logs ou JSONL publico.

## 2. Jobs

Fonte: `JobStartPayload`.

Envelope de comando `job_start`:

```json
{
  "version": 1,
  "job_run_id": "uuid",
  "execution_target_end_utc": "2026-05-21T12:00:00Z",
  "job": {
    "id": 1,
    "user_id": "user",
    "name": "Daily check",
    "description": "",
    "timezone": "America/Manaus",
    "schedule_mode": "daily",
    "active_from": "2026-05-21",
    "active_until": null,
    "status": "active"
  },
  "trigger": {
    "trigger_type": "schedule",
    "timezone": "America/Manaus",
    "local_date": "2026-05-21",
    "local_time": "08:00",
    "triggered_at_utc": "2026-05-21T12:00:00Z",
    "raw": {}
  },
  "steps": [],
  "all_camera_ids": [1, 2],
  "camera_start_payloads": {
    "1": {}
  }
}
```

## 3. Steps

Fonte: `JobStepDef`.

```json
{
  "id": 10,
  "step_run_id": "uuid",
  "step_order": 1,
  "name": "Observe gate",
  "timeout_seconds": 60,
  "analysis_completion_mode": "drain_to_analysis_target",
  "analysis_target_end_utc": "2026-05-21T12:01:00Z",
  "analysis_hard_stop_seconds": 30,
  "input_from_step_id": null,
  "input_inject_key": "",
  "on_missing_input": "skip",
  "start_condition": {
    "mode": "sequential",
    "from_step_id": null,
    "answer_key": "Sentimento_Resposta",
    "camera_id": null,
    "target_key": "",
    "extract": "",
    "time_hhmm": "",
    "time_offset_seconds": 0
  },
  "pipelines": [],
  "targets": [],
  "agents": [],
  "alerts": []
}
```

Modos de start condition observados: `sequential`, `positive`, `negative`, `time`, `custom`.

## 4. Agentes

Fonte: `JobAgentDef`, `JobInferenceGroup`, `AlgorithmConfig`.

```json
{
  "id": 100,
  "agent_run_id": "uuid",
  "agent_key": "custom_v2",
  "camera_id": 1,
  "prompt_template": "Describe what matters.",
  "params_json": "{}",
  "input_schema_json": "{}",
  "priority_level": "MEDIUM",
  "inference_model": "ultra",
  "api_key": "secret-ref-only",
  "model_fps": 1,
  "run_every_seconds": 60,
  "running_resolution": 640,
  "only_capture_on_motion": true,
  "input_type": "video",
  "video_packaging_mode": "frame_sequence",
  "alert_condition": "Alert if...",
  "negative_condition": "Ignore if...",
  "analysis_regions": [],
  "face_targets": [],
  "negative_reference_images": [],
  "temporal_plan_hash": "",
  "temporal_plan_version": "",
  "temporal_compiled_at": "",
  "temporal_compile_model": "",
  "temporal_plan_envelope": {}
}
```

Valores normalizados:

- `input_type`: `video`, `image`.
- `video_packaging_mode`: preferir `frame_sequence`; `mosaic_2x2` ainda existe; `mosaic_3x3` esta deprecado.
- `inference_model`: `legacy`, `pro`, `ultra`, `ultra_plus`, `light`, `core`.
- `model_fps`: 1 a 5 para video; 1 para imagem.
- `run_every_seconds`: normalizado para 10 ou 60 no runtime atual.
- `running_resolution`: 640 ou 1024.

## 5. Prompts

Prompt pode vir em campos separados ou em bloco legado:

```text
<prompt core>

alert_condition: <condicao>
negative_condition: <condicao negativa>
```

Novo contrato recomendado:

```json
{
  "prompt_core": "...",
  "alert_condition": "...",
  "negative_condition": "...",
  "language": "pt-BR"
}
```

## 6. Resultado de Inferencia

Campos observados em `JobRuntime`:

```json
{
  "agent_key": "custom_v2",
  "camera_id": 1,
  "camera_name": "Gate",
  "answer": "Short factual answer.",
  "alert_condition": false,
  "llm_alert_condition": false,
  "final_alert_condition": false,
  "alert_condition_first_pass": false,
  "validator_alert_condition": false,
  "alert_region_ids": [],
  "alert_region_names": [],
  "operator_results": [],
  "temporal_operator_results": [],
  "identity_cards": [],
  "usage": {
    "prompt_tokens": 0,
    "output_tokens": 0,
    "total_tokens": 0
  },
  "media": {
    "frame_paths": [],
    "clip_path": ""
  },
  "created_at_utc": "2026-05-21T12:00:00Z"
}
```

## 7. Alertas

Fonte: `JobAlertRule`, `maybeFireAlerts_`, `/api/agent/job-alert-media`, tabelas `notifications`, `detections`, `events`.

Contrato recomendado:

```json
{
  "alert_id": "uuid",
  "job_id": 1,
  "step_id": 10,
  "agent_id": 100,
  "camera_id": 1,
  "camera_name": "Gate",
  "type": "agent_alert",
  "title": "Alert",
  "message": "Condition met",
  "answer": "...",
  "alert_condition_text": "...",
  "alert_region_ids": [],
  "media_type": "image",
  "image_path": "data/alerts/...",
  "video_path": "data/alerts/...",
  "created_at_utc": "2026-05-21T12:00:00Z",
  "webhook_status": "pending"
}
```

## 8. Eventos

Endpoint atual `/api/agent/events` aceita:

```json
{
  "camera_id": 1,
  "event_id": "external-id",
  "camera_session_id": "uuid",
  "job_run_id": "uuid",
  "step_run_id": "uuid",
  "agent_run_id": "uuid",
  "event_type": "job_started",
  "message": "",
  "details": {}
}
```

Eventos importantes: `job_started`, `job_stopped`, `camera_connection_failed`, `agent_api_error`, eventos `drakon_find_*`, eventos de step e alertas.

## 9. Logs

O AppHost usa `system-activity.jsonl`. O novo servidor deve usar JSONL local:

```json
{
  "ts_utc": "2026-05-21T12:00:00Z",
  "level": "info",
  "component": "camera.capture",
  "camera_id": "1",
  "message": "capture started",
  "fields": {}
}
```

Logs devem mascarar RTSP credentials, API keys, tokens e headers Authorization.

## 10. Diretorios de Frames

Fonte atual de video: `baseDir/cam_<id>/YYYY/MM/DD/<id>_YYYYMMDD_HHMMSS_YYYYMMDD_HHMMSS_10s.mp4`.

Novo layout recomendado:

```text
data/frames/cam_<camera_id>/YYYY/MM/DD/HH/fps_1/<camera_id>_YYYYMMDD_HHMMSS_mmm.jpg
data/frames/cam_<camera_id>/YYYY/MM/DD/HH/fps_10/<camera_id>_YYYYMMDD_HHMMSS_mmm.jpg
data/clips/cam_<camera_id>/YYYY/MM/DD/<camera_id>_YYYYMMDD_HHMMSS_YYYYMMDD_HHMMSS_10s.mp4
data/jobs/job_<job_id>/step_<step_id>/cam_<camera_id>/...
```

## 11. JSON/JSONL para Dashboard

Arquivos minimos:

- `data/indexes/frames.jsonl`: um registro por frame salvo.
- `data/indexes/clips.jsonl`: um registro por clip.
- `data/indexes/inference.jsonl`: um registro por inferencia.
- `data/indexes/alerts.jsonl`: um registro por alerta.
- `data/indexes/events.jsonl`: um registro por evento operacional.
- `data/indexes/runtime-status.json`: snapshot atual de cameras/jobs/threads.

Exemplo `frames.jsonl`:

```json
{"ts_utc":"2026-05-21T12:00:00.123Z","camera_id":"1","fps":1,"path":"data/frames/cam_1/2026/05/21/12/fps_1/1_20260521_120000_123.jpg","width":1280,"height":720,"motion":true}
```

## 12. Tabelas SQLite/PostgreSQL Relevantes

Principais tabelas do fonte:

- `cameras`: cadastro, RTSP/webcam, store_frames, retencao, timezone, analysis_speed, model_tier.
- `camera_algorithms`: agentes diretos por camera, prompt, config, regioes, temporal plan.
- `commands`: fila `command_type`, `payload`, `status`, `result`.
- `events`: historico operacional.
- `notifications`: notificacoes/alertas para UI.
- `detections`: deteccoes com image/video key.
- `jobs`, `job_steps`, `job_step_targets`, `job_step_agents`, `job_step_alert_rules`.
- `job_runtime_states`: estado atual de jobs.
- `job_runs`, `camera_runtime_sessions`: execucoes agendadas.
- `capture_thread_metrics_latest`, `agent_error_logs`.
- `telegram_settings`, `openai_settings`, `exe_pairings`.

## 13. APIs/Webhooks Existentes

Endpoints de referencia para compatibilidade:

- Cameras: `/api/cameras`, `/api/cameras/:id`, `/api/cameras/:cameraId/start`, `/api/cameras/:cameraId/stop`.
- Jobs: `/api/jobs`, `/api/jobs/:id/start`, `/api/jobs/:id/stop`, `/api/jobs/:jobId/steps`.
- Agente: `/api/agent/commands`, `/api/agent/commands/:commandId/result`, `/api/agent/events`, `/api/agent/thumbnails`, `/api/agent/job-alert-media`, `/api/agent/error-logs`, `/api/agent/open-monitor-snapshot`.
- Dashboard: `/api/dashboard`, `/api/dashboard-alerts`, `/api/open-monitor`, `/api/events`, `/api/notifications`, `/api/detections`.
- Webhook atual: `/api/stripe/webhook` e especificos de billing nao entram no servidor.

Para `drakon-server`, expor primeiro API local opcional:

- `GET /health`
- `GET /v1/cameras`
- `POST /v1/cameras/:id/start`
- `POST /v1/cameras/:id/stop`
- `POST /v1/jobs/:id/start`
- `POST /v1/jobs/:id/stop`
- `GET /v1/events`
- `GET /v1/alerts`
- `POST /v1/webhooks/test`

## 14. Integracao com LLM

Fonte usa OpenAI/Chat Completions e modelos por tier. Novo contrato:

```json
{
  "provider": "openai",
  "base_url": "https://api.openai.com/v1",
  "model": "gpt-5.1",
  "api_key_env": "OPENAI_API_KEY",
  "timeout_ms": 30000,
  "retries": 1,
  "response_format": "json_object"
}
```

O runtime deve aceitar tambem endpoint local OpenAI-compatible. Nunca gravar `api_key`, bearer token ou payload bruto com segredo em logs.
