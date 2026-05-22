# Prompt 7 - Jobs, steps e agentes

Data: 2026-05-21

## Objetivo

Implementar a estrutura inicial de jobs, steps e agentes no `drakon-server`, com:

- tipos C++ para job, step, agent, trigger, condition, action, schedule e runtime status;
- parser JSON de job;
- validador de contrato;
- executor dry-run;
- comandos CLI:
  - `drakon-server validate-job --job <path>`
  - `drakon-server run-job --job <path> --dry-run`
- indice JSONL `data/indexes/jobs.jsonl`;
- testes CTest sem camera real, LLM real ou alerta real.

## Referencia lida no perceptrum_desktop_aspp

O reposititorio fonte foi lido apenas como referencia. Nenhum arquivo foi alterado nele.

Arquivos/diretorios consultados:

- `Perceptrum/Perceptrum/jobs/JobTypes.h`
- `Perceptrum/Perceptrum/jobs/JobPayloadParser.h`
- `Perceptrum/Perceptrum/jobs/JobPayloadParser.cpp`
- `Perceptrum/Perceptrum/jobs/JobRuntime.h`
- `Perceptrum/Perceptrum/orchestrator/SkillTypes.h`
- `Perceptrum/Perceptrum/orchestrator/SkillRegistry.h`
- `Perceptrum/Perceptrum/orchestrator/skills/shared/JobBlueprintShared.h`
- `Perceptrum/Perceptrum/orchestrator/skills/shared/JobBlueprintShared.cpp`
- `Perceptrum/Perceptrum/core/AgentCore.h`

Conclusao aplicada:

- O Perceptrum possui runtime completo e acoplado a camera, LLM, alertas e backend.
- Para o `drakon-server`, esta fase trouxe apenas o contrato portavel e o dry-run.
- Nao foi copiado o runtime monolitico do Perceptrum.

## Arquivos criados

- `include/drakon/agents/agent.h`
- `src/agents/agent.cpp`
- `include/drakon/jobs/job_types.h`
- `include/drakon/jobs/job_parser.h`
- `include/drakon/jobs/job_executor.h`
- `src/jobs/job_types.cpp`
- `src/jobs/job_parser.cpp`
- `src/jobs/job_executor.cpp`
- `config/jobs/dry-run-job.example.json`
- `tests/verify_jobs_index.cmake`
- `.archon/plans/prompt-7-jobs-steps-agentes.md`

## Arquivos ajustados

- `CMakeLists.txt`
- `README.md`
- `src/main.cpp`

## Contrato implementado

Tipos principais:

- `Job`
- `Step`
- `Agent`
- `Trigger`
- `Condition`
- `Action`
- `Schedule`
- `RuntimeStatus`

Campos validados:

- `schema_version`
- `job_id`
- `name`
- `enabled`
- `camera_ids`
- `trigger.type`
- `schedule.mode`
- `steps`
- `steps[].step_id`
- `steps[].type`
- `steps[].name`
- `steps[].condition.type`
- `steps[].action.type`
- `steps[].timeout_seconds`
- `steps[].retry_policy`
- `agents[].agent_id`
- `agents[].model_provider`
- `agents[].model`

Tambem sao validados:

- `next_on_success` e `next_on_failure` apontando para steps existentes;
- `agent_id` apontando para agente declarado;
- duplicidade de `step_id` e `agent_id`;
- RTSP URL com credencial sem mascara;
- campos secret-like inline, como `api_key`, `token`, `password`, `secret`, `dsn` e `connection_string`.

## CLI

Validacao:

```bash
./build/drakon-server validate-job --job config/jobs/dry-run-job.example.json
```

Execucao dry-run:

```bash
./build/drakon-server run-job --job config/jobs/dry-run-job.example.json --dry-run
```

Opcionalmente, o `run-job` aceita `--config <path>` para usar `runtime.data_root` do config:

```bash
./build/drakon-server run-job --job config/jobs/dry-run-job.example.json --dry-run --config config/drakon-server.example.json
```

Sem `--config`, o comando infere o projeto quando o job esta em `config/jobs/` e grava em `data/indexes/jobs.jsonl`.

## Dry-run

O executor dry-run:

- nao aciona camera automaticamente;
- nao chama LLM;
- nao emite alerta real;
- simula steps habilitados;
- marca steps desabilitados ou com `condition.type=never` como `skipped`;
- grava um registro por execucao em `data/indexes/jobs.jsonl`.

Linha JSONL contem:

- `schema_version`
- `record_type`
- `job_id`
- `job_name`
- `run_id`
- `timestamp_utc`
- `dry_run`
- `runtime_status`
- `trigger_type`
- `schedule_mode`
- `camera_ids`
- `steps_total`
- `steps_completed`
- `steps_skipped`
- `steps_failed`
- `steps`
- `agents`

## Validacao executada

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j$(nproc)
ctest --test-dir build --output-on-failure
```

Resultado:

```text
100% tests passed, 0 tests failed out of 14
```

Tambem foi executado:

```bash
./build/drakon-server validate-job --job config/jobs/dry-run-job.example.json
./build/drakon-server run-job --job config/jobs/dry-run-job.example.json --dry-run
```

Ambos concluiram com sucesso.

## Testes adicionados

- `drakon_server_validate_job`
- `drakon_server_run_job_dry_run`
- `drakon_server_verify_jobs_index`

## Persistencia

Nesta fase a persistencia de definicao fica em arquivo JSON versionado sob:

```text
config/jobs/
```

A persistencia de execucao para dashboard fica em:

```text
data/indexes/jobs.jsonl
```

O schema SQLite ja possui tabelas `jobs` e `agents`, mas a escrita no banco nao foi ligada nesta fase para manter o escopo dry-run e sem efeitos colaterais.

## Proximos passos recomendados

1. Criar comandos `list-jobs` e `job-status`.
2. Persistir jobs/agentes no SQLite quando `db-init` ja tiver sido executado.
3. Integrar `run-job` com leitura real de `frames.jsonl`.
4. Implementar runtime controlado para steps dependentes.
5. Depois disso, adicionar inferencia stub estruturada antes de qualquer LLM real.

## Confirmacoes

- Nenhuma inferencia real foi executada.
- Nenhum alerta real foi emitido.
- Nenhuma camera foi acionada automaticamente por job.
- Nenhuma interface grafica foi criada.
- Nenhum commit foi feito.
- Nenhum push foi feito.
- Nenhum arquivo foi apagado.
- O repositorio fonte `perceptrum_desktop_aspp` nao foi alterado.
