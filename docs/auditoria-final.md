# Auditoria final do drakon-server

## Funciona hoje

- CLI headless com `--help`, `version`, `status`, `run --once` e validação de config.
- Criação de diretórios de runtime sem apagar dados existentes.
- Validação de configuração JSON com bloqueio de secrets inline e RTSP com credenciais expostas.
- SQLite local com schema inicial e comandos `db-init`, `db-status` e `list-cameras`.
- Captura `capture-test` com modo `test`/`dry-run` e suporte inicial a RTSP, webcam e arquivo via OpenCV/FFmpeg.
- Frame store com diretórios por timestamp, metadata JSON e `data/indexes/frames.jsonl`.
- Jobs, steps e agentes com validação e execução `--dry-run`.
- Inferência estruturada com provider `mock`.
- Eventos, alertas e índices JSONL para dashboard.
- Webhooks somente em `--dry-run`.
- Estrutura de systemd e pacote `.deb` via CPack.

## Mocks e planos

- `inference.provider=mock` gera resultado identificado como mock e não chama API externa.
- `run-job` é dry-run; ainda não agenda execução contínua nem aciona câmera/LLM.
- `send-webhooks` é dry-run; nenhuma entrega HTTP real é feita.
- `serve-api` documenta endpoints planejados, mas ainda não abre servidor HTTP.

## Precisa de ambiente real

- Câmera RTSP/webcam real com credentials por referência de ambiente.
- Provider LLM real, cliente HTTP, modelos configurados e API key por referência.
- PostgreSQL real; hoje a configuração é validada, mas conexão PostgreSQL ainda não foi implementada.
- Teste de retenção, rotação de JSONL e carga prolongada.

## Pronto para teste interno

- Build Debug/Release.
- CTest completo do pipeline mock.
- Geração de pacote `.deb`.
- Validação do serviço com `run --once`.
- Instalação manual em host Ubuntu usando os arquivos de exemplo, sem empacotar secrets.
