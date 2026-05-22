# drakon-server

Servidor CLI/headless do Drakon, escrito em C++23 para Linux/Ubuntu.

Este projeto não possui interface gráfica. Ele é responsável por:

- ler configurações e banco de dados;
- conectar câmeras RTSP/ONVIF;
- capturar frames em 1 FPS, 10 FPS ou outra taxa configurada;
- organizar imagens em diretórios com timestamp;
- rodar inferência sobre frames/clipes;
- salvar resultados estruturados em JSON;
- gerar alertas estruturados em JSON;
- disponibilizar os arquivos para o dashboard Drakon ler e exibir.

## Conceito

O drakon-server é o motor de captura/análise.

O dashboard Drakon é o cliente visual que lê:

- `data/frames/`
- `data/inference/`
- `data/alerts/`
- `data/events/`
- `data/indexes/`

## Estado atual

Este scaffold inicial implementa:

- CLI;
- validação de config com `nlohmann::json`;
- criação de diretórios de runtime;
- schema SQLite inicial;
- comandos de banco para inicialização, status e listagem de câmeras;
- captura inicial RTSP/webcam/file/test sem inferência;
- escrita de frames JPEG e metadata JSON;
- validação e execução dry-run de jobs, steps e agentes;
- inferência inicial com provider `mock` explícito;
- geração inicial de eventos e alertas a partir de inferências;
- simulação dry-run de webhooks;
- índices JSONL para frames, jobs, inferências, eventos e alertas;
- comando `run` para execução como serviço headless;
- unit systemd e pacote `.deb` via CPack;
- checagem de dependências externas;
- CTest básico.

Ainda não implementa:

- inferência real em API externa;
- API HTTP;
- dashboard.

## Build

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j$(nproc)
ctest --test-dir build --output-on-failure
```

## CLI

```bash
./build/drakon-server --help
./build/drakon-server version
./build/drakon-server validate-config --config config/drakon-server.example.json
./build/drakon-server prepare-runtime --config config/drakon-server.example.json
./build/drakon-server check-deps
./build/drakon-server status
./build/drakon-server db-init --config config/drakon-server.example.json
./build/drakon-server db-status --config config/drakon-server.example.json
./build/drakon-server list-cameras --config config/drakon-server.example.json
./build/drakon-server capture-test --config config/drakon-server.example.json --camera-id cam_test_01 --seconds 1 --dry-run
./build/drakon-server index-frames --config config/drakon-server.example.json
./build/drakon-server validate-job --job config/jobs/dry-run-job.example.json
./build/drakon-server run-job --job config/jobs/dry-run-job.example.json --dry-run --config config/drakon-server.example.json
./build/drakon-server infer-frame --config config/drakon-server.example.json --frame <frame-ou-metadata>
./build/drakon-server infer-batch --config config/drakon-server.example.json --frames-index data/indexes/frames.jsonl
./build/drakon-server generate-alerts --config config/drakon-server.example.json
./build/drakon-server send-webhooks --config config/drakon-server.example.json --dry-run
./build/drakon-server serve-api --config config/drakon-server.example.json --port 8077
./build/drakon-server run --config config/drakon-server.example.json --once
```

## Estrutura runtime

```text
data/
  db/
  frames/
  inference/
  alerts/
  events/
  indexes/
  logs/
runtime/
config/
```

`prepare-runtime` cria os diretórios necessários sem apagar arquivos existentes.

`capture-test --dry-run` gera frames sintéticos para testar o pipeline sem
câmera real. Para RTSP com credenciais, use `credentials_ref` apontando para uma
variável de ambiente; não coloque senha em claro no JSON.

Frames capturados são gravados em
`data/frames/<camera_id>/<YYYY>/<MM>/<DD>/<HH>/<mm>/fps_<fps>/` com metadados
JSON ao lado da imagem. O índice `data/indexes/frames.jsonl` permite leitura
pelo dashboard sem depender do banco.

Jobs são descritos como JSON em `config/jobs/`. Nesta fase, `run-job` aceita
somente `--dry-run`: ele valida steps/agentes, não liga câmera, não chama LLM,
não entrega alertas e registra a simulação em `data/indexes/jobs.jsonl`.

Inferência só executa em modo `mock` quando `inference.provider` está definido
como `mock`. Esse modo grava resultados identificados como mock em
`data/inference/` e indexa em `data/indexes/inference.jsonl`; nenhum dado é
enviado para API externa nesta fase.

`generate-alerts` lê `data/indexes/inference.jsonl`, cria eventos em
`data/events/`, alertas em `data/alerts/` e reconstrói
`data/indexes/events.jsonl` e `data/indexes/alerts.jsonl`.
`send-webhooks` só executa em `--dry-run` nesta fase; nenhum webhook real é
enviado.

`run --config <path>` valida config, prepara diretórios e mantém o processo ativo
para uso com systemd. `run --once` executa a mesma inicialização e encerra, útil
para testes de empacotamento e saúde do serviço.

## Serviço Linux e pacote .deb

O pacote Debian é gerado por CPack e instala:

```text
/opt/drakon-server/bin/drakon-server
/etc/drakon-server/drakon-server.env.example
/etc/drakon-server/drakon-server.json.example
/lib/systemd/system/drakon-server.service
/var/lib/drakon-server/
/var/log/drakon-server/
```

Build do pacote:

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)
cmake --build build --target package
```

Instalação prevista em um host Ubuntu:

```bash
sudo apt install ./build/drakon-server_0.1.0_amd64.deb
sudo cp /etc/drakon-server/drakon-server.json.example /etc/drakon-server/drakon-server.json
sudo cp /etc/drakon-server/drakon-server.env.example /etc/drakon-server/drakon-server.env
sudo editor /etc/drakon-server/drakon-server.json
sudo editor /etc/drakon-server/drakon-server.env
sudo systemctl daemon-reload
sudo systemctl enable --now drakon-server
```

O serviço escreve dados em `/var/lib/drakon-server`, logs em
`/var/log/drakon-server` e runtime em `/run/drakon-server`. Ele não deve exigir
escrita dentro de `/opt/drakon-server`.

Remoção:

```bash
sudo systemctl disable --now drakon-server
sudo apt remove drakon-server
```

Purge:

```bash
sudo systemctl disable --now drakon-server
sudo apt purge drakon-server
```

Dados em `/var/lib/drakon-server` e `/var/log/drakon-server` devem ser removidos
manualmente apenas quando o operador decidir que podem ser descartados.

## Segurança

- Não salve senhas RTSP em claro no JSON.
- Use `credentials_ref`, `dsn_ref` e referências `env:*` para secrets.
- Logs e erros devem mascarar URLs RTSP, tokens, chaves e DSNs.
