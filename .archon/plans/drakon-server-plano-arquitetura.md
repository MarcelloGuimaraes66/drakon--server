# Plano de arquitetura do drakon-server

## Objetivo tecnico

Construir um servidor CLI/headless em C++23 para captura, processamento e indexacao de cameras. O processo deve operar sem interface grafica, sem navegador e sem credenciais hardcoded, produzindo arquivos estruturados que o dashboard Drakon possa ler.

## Arquitetura proposta

```text
CLI
|-- ConfigService
|-- RuntimePaths
|-- DatabaseGateway
|   |-- SQLite
|   `-- PostgreSQL
|-- CameraRegistry
|-- CaptureEngine
|   |-- RTSP/FFmpeg
|   `-- ONVIF discovery/control
|-- FrameWriter
|-- InferenceRunner
|-- EventAlertService
|-- JsonWriters
|   |-- JSON documents
|   `-- JSONL indexes
`-- ServiceRuntime
```

## CLI

Comandos iniciais:

```bash
drakon-server --help
drakon-server version
drakon-server validate-config --config config/cameras.example.json
drakon-server list-cameras --config config/cameras.example.json
drakon-server capture --config config/cameras.example.json --camera CAMERA_ID
drakon-server run --config config/cameras.example.json
```

O CLI deve retornar codigos de saida previsiveis:

- `0`: sucesso.
- `1`: erro de uso/configuracao.
- `2`: falha de runtime recuperavel.
- `3`: falha de dependencia externa.

## Configuracao

Formato recomendado inicial: JSON versionado.

Campos minimos:

- `version`
- `runtime.data_dir`
- `runtime.log_dir`
- `database.mode`
- `database.sqlite_path`
- `database.postgres_dsn_env`
- `cameras[].id`
- `cameras[].name`
- `cameras[].rtsp_url_env`
- `cameras[].capture_profiles[]`
- `inference.enabled`
- `alerts.enabled`

Credenciais devem ser lidas de variaveis de ambiente, arquivos locais ignorados pelo Git ou secret managers futuros. URLs com usuario/senha nao devem aparecer em logs.

## Diretorios de runtime

Estrutura recomendada:

```text
data/
|-- frames/{camera_id}/YYYY/MM/DD/HH/{profile}/
|-- inference/{camera_id}/YYYY/MM/DD/HH/
|-- alerts/YYYY/MM/DD/
|-- events/YYYY/MM/DD/
`-- indexes/
    |-- frames.jsonl
    |-- inference.jsonl
    |-- alerts.jsonl
    `-- events.jsonl
```

Arquivos devem usar nomes derivados de timestamp UTC ou local configurado, com precisao suficiente para evitar colisao.

## SQLite e PostgreSQL

Fase inicial:

- SQLite como armazenamento local padrao para metadados, estado de cameras e checkpoints.
- PostgreSQL opcional por configuracao, sem obrigar o ambiente de desenvolvimento a ter servidor instalado.

Modelo minimo:

- `cameras`
- `capture_profiles`
- `frames`
- `inference_results`
- `alerts`
- `events`
- `runtime_state`

## Captura RTSP

Usar FFmpeg/libav como backend principal para RTSP. OpenCV pode ser usado como camada auxiliar, mas a captura RTSP critica deve ficar em um modulo isolado para permitir troca de backend.

Responsabilidades:

- conectar/reconectar com backoff;
- capturar em perfis de FPS configuraveis;
- registrar metadados de frame;
- nao registrar secrets da URL;
- tolerar camera offline sem derrubar todo o processo.

## Salvamento de frames

Responsabilidades:

- criar diretorios sob demanda;
- gravar imagem atomica quando possivel;
- registrar JSON lateral opcional por frame;
- anexar linha ao indice `data/indexes/frames.jsonl`;
- manter convencao de path estavel para o dashboard.

## Inferencia

Manter interface `InferenceRunner` desacoplada:

- entrada: frame + metadados;
- saida: resultado estruturado;
- implementacao inicial: stub deterministico para validar o fluxo;
- implementacoes futuras: OpenCV DNN, ONNX Runtime, chamadas externas ou modelos especificos.

## Alertas

Alertas devem ser documentos JSON independentes e tambem entradas em JSONL.

Campos minimos:

- `id`
- `timestamp`
- `camera_id`
- `severity`
- `type`
- `message`
- `source_frame`
- `inference_result`
- `metadata`

## JSON e JSONL

Usar JSON estruturado e versionado:

- `schema_version`
- timestamps em ISO 8601;
- IDs estaveis;
- paths relativos ao `data_dir`;
- uma linha valida por evento nos arquivos `.jsonl`.

## Servico systemd

Unidade futura:

- executa `drakon-server run --config /etc/drakon-server/config.json`;
- usuario dedicado, sem privilegios desnecessarios;
- logs em journald e/ou `data/logs`;
- restart controlado;
- environment file em `/etc/drakon-server/drakon-server.env`.

## Pacote .deb

Empacotamento futuro via CPack ou estrutura Debian:

- binario em `/usr/bin/drakon-server`;
- config exemplo em `/usr/share/doc/drakon-server/`;
- config ativa em `/etc/drakon-server/`;
- unidade systemd em `/lib/systemd/system/`;
- diretorios de dados em `/var/lib/drakon-server/`.

## Ordem arquitetural recomendada

1. Base CLI, config e build/testes.
2. RuntimePaths e escritores JSON/JSONL.
3. SQLite para metadados locais.
4. Captura RTSP com FFmpeg.
5. Pipeline frame -> inferencia stub -> eventos/alertas.
6. PostgreSQL opcional.
7. systemd.
8. pacote `.deb`.
