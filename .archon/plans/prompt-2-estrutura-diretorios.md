# Prompt 2 - Estrutura de diretorios runtime do drakon-server

Data: 2026-05-21

## Objetivo

Definir a estrutura de diretorios runtime antes de implementar codigo. Esta
estrutura deve servir ao servidor headless, ao banco local, aos arquivos JSON,
aos indices JSONL e ao dashboard Drakon.

Nenhum diretorio runtime foi criado nesta fase, exceto os relatorios em
`.archon/plans/`.

## Raiz recomendada

O repositorio deve continuar em:

```text
/home/marcello-guimaraes/dev/drakon-server
```

Em runtime, o servidor deve trabalhar com tres raizes configuraveis:

```text
config/
runtime/
data/
```

Essas raizes podem ser relativas ao diretorio atual no modo desenvolvimento ou
absolutas quando rodar como servico `systemd`.

## Layout canonico

```text
config/
  drakon-server.example.json
  drakon-server.local.json
  secrets.local.json            # opcional, 0600, nunca commitado

runtime/
  drakon-server.pid
  state.json
  locks/
  sockets/
  health/

data/
  db/
    drakon-server.sqlite3
    migrations/

  frames/
    <camera_id>/
      <YYYY>/
        <MM>/
          <DD>/
            <HH>/
              <mm>/
                fps_1/
                  <timestamp_utc>_<sequence>.jpg
                  <timestamp_utc>_<sequence>.json
                fps_10/
                  <timestamp_utc>_<sequence>.jpg
                  <timestamp_utc>_<sequence>.json

  clips/
    <camera_id>/
      <YYYY>/
        <MM>/
          <DD>/
            <timestamp_utc>_<duration>s_<profile>.mp4
            <timestamp_utc>_<duration>s_<profile>.json

  inference/
    <camera_id>/
      <YYYY>/
        <MM>/
          <DD>/
            <HH>/
              <inference_id>.json
              raw/

  alerts/
    <YYYY>/
      <MM>/
        <DD>/
          <alert_id>.json

  events/
    <YYYY>/
      <MM>/
        <DD>/
          <event_id>.json

  jobs/
    <job_id>/
      <job_run_id>/
        run.json
        steps/
          <step_id>.json

  indexes/
    frames.jsonl
    inference.jsonl
    alerts.jsonl
    events.jsonl
    jobs.jsonl
    cameras.jsonl
    rotations/

  logs/
    drakon-server.log
    audit.log

  tmp/
    writes/
    uploads/
```

## Ajustes sobre a proposta inicial

A proposta inicial do prompt foi mantida no essencial:

- `data/frames/<camera_id>/<YYYY>/<MM>/<DD>/<HH>/<mm>/fps_1`
- `data/frames/<camera_id>/<YYYY>/<MM>/<DD>/<HH>/<mm>/fps_10`
- `data/inference/<camera_id>/<YYYY>/<MM>/<DD>/<HH>`
- `data/alerts/<YYYY>/<MM>/<DD>`
- `data/events/<YYYY>/<MM>/<DD>`
- `data/indexes/*.jsonl`
- `data/logs`
- `runtime`
- `config`

Foram adicionados:

- `data/db/`: SQLite e migracoes.
- `data/clips/`: necessario porque o dashboard atual ja tem conceito de
  timeline de gravacoes.
- `data/jobs/`: snapshots de execucao e saidas por step.
- `data/tmp/`: escrita atomica e staging.
- `runtime/locks`: evitar duas instancias operando o mesmo `data_dir`.

## Compatibilidade com DrakonSite

O `DrakonSite/src/worker/cameraRecordings.ts` procura gravacoes em formato:

```text
cam_<cameraId>/YYYY/MM/DD
```

e expoe stream por:

```text
/api/camera-recordings/<scope>/<relativePath>
```

Para o `drakon-server`, a decisao recomendada e:

- Layout canonico novo: `data/frames/<camera_id>/...` e `data/clips/<camera_id>/...`.
- Dashboard novo: ler via `GET /dashboard/indexes` ou diretamente
  `data/indexes/*.jsonl`.
- Compatibilidade opcional futura: gerar links ou uma arvore
  `data/recordings_compat/cam_<id>/YYYY/MM/DD` apenas se o dashboard legado
  exigir.

Nao criar symlinks de compatibilidade no MVP sem decisao explicita, porque
isso complica empacotamento e retencao.

## Nome de arquivos

Frames:

```text
<timestamp_utc_compact>_<sequence_6d>.<ext>
```

Exemplo:

```text
20260521T190000123Z_000042.jpg
20260521T190000123Z_000042.json
```

Clips:

```text
<start_utc_compact>_<end_utc_compact>_<cadence_seconds>s.mp4
```

Exemplo:

```text
20260521T190000Z_20260521T190010Z_10s.mp4
```

JSON de entidade:

```text
<id>.json
```

## Politica de escrita atomica

Para cada arquivo publicado:

1. Escrever em `data/tmp/writes/<id>.tmp`.
2. Fazer `fsync` quando aplicavel.
3. Renomear para o path final.
4. Escrever sidecar JSON.
5. Adicionar linha no JSONL.
6. Atualizar SQLite em transacao curta.

Se o processo cair entre etapas, o rebuild deve conseguir reconstruir indices a
partir dos JSONs e ignorar `.tmp`.

## Politica de paths em JSON

- `image_path`, `metadata_path`, `raw_response_path`, `clip_path` e paths
  equivalentes devem ser relativos a `data/`.
- APIs podem converter para URL publica local, por exemplo `/media/<path>`.
- Nunca expor caminho absoluto em resposta do dashboard por padrao.

## Politica de retencao

Retencao deve ser configuravel por tipo:

- Frames: curto prazo, padrao recomendado 7 dias.
- Clips: padrao recomendado 14 dias.
- Inferencias: padrao recomendado 30 dias.
- Alertas: padrao recomendado 180 dias.
- Eventos: padrao recomendado 180 dias.
- Logs: padrao recomendado 14 dias.

Regras:

- Retencao remove arquivos de media primeiro e registra evento.
- JSON de alerta/evento pode sobreviver sem imagem, mas deve marcar media
  removida.
- Indices JSONL recebem `op: "delete"` ou `op: "tombstone"` para itens
  removidos.
- Banco SQLite deve refletir remocao logica antes da remocao fisica.

## Politica de indices

Arquivos ativos:

```text
data/indexes/frames.jsonl
data/indexes/inference.jsonl
data/indexes/alerts.jsonl
data/indexes/events.jsonl
data/indexes/jobs.jsonl
data/indexes/cameras.jsonl
```

Rotacao recomendada:

```text
data/indexes/rotations/frames-YYYYMM.jsonl
data/indexes/rotations/alerts-YYYYMM.jsonl
```

Politica:

- Append-only no arquivo ativo.
- Rotacionar por tamanho ou mes.
- Rebuild cria um arquivo novo `.rebuild.tmp`, valida contagem/checksum e troca
  por rename atomico.
- Dashboard deve ler incrementalmente por offset ou por `timestamp_utc` e
  `record_id`.

## Diretórios runtime

`runtime/state.json` deve conter apenas estado volatil:

```json
{
  "schema_version": "drakon.v1",
  "instance_id": "drakon-local-01",
  "started_at_utc": "2026-05-21T19:00:00Z",
  "status": "running",
  "active_cameras": [],
  "active_jobs": []
}
```

Nao colocar secrets em `runtime/state.json`.

`runtime/locks/` deve conter lock por `data_dir`, para evitar corrupcao de
SQLite/JSONL por duas instancias.

## Logs

Logs ficam em `data/logs/` e devem seguir redacao obrigatoria:

- Mascarar URL RTSP.
- Mascarar tokens de webhook, Telegram, API LLM e DSN.
- Nao registrar request/response bruto de LLM por padrao.
- Nao registrar payload completo de config se contiver `*_ref`.

## Fonte de verdade por tipo de arquivo

| Tipo | Fonte de verdade | Observacao |
|---|---|---|
| Config declarativa | `config/drakon-server.local.json` e SQLite apos import | Config pode popular banco no startup. |
| Frame | arquivo de imagem + sidecar JSON + SQLite | JSONL e indice de leitura. |
| Inferencia | JSON estruturado + SQLite | Raw response opcional e redigida. |
| Alerta | JSON estruturado + SQLite | Delivery fica em `deliveries`. |
| Evento | JSON estruturado + SQLite | Eventos operacionais tambem alimentam dashboard. |
| Camera | SQLite no runtime, config no bootstrap | `cameras.jsonl` publica mudancas. |
| Job | SQLite e snapshot JSON por run | `jobs.jsonl` publica estado. |

## Criterios de aceitacao para Prompt 3

O scaffold inicial deve conseguir:

- Resolver `config_dir`, `runtime_dir` e `data_dir`.
- Validar que paths ficam dentro das raizes esperadas.
- Criar diretorios de runtime somente quando o usuario pedir implementacao.
- Carregar `config/drakon-server.example.json`.
- Imprimir paths resolvidos sem expor secrets.
- Nao criar ainda captura RTSP, inferencia, banco real ou API real.
