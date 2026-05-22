# Prompt 10 - Systemd, pacote .deb e auditoria final

Data: 2026-05-21

## Objetivo

Preparar o `drakon-server` para execução Linux/headless via systemd e geração de pacote Debian, sem instalar nada com `sudo`, sem commit e sem push.

## Arquivos criados

- `packaging/linux/drakon-server.service`
- `packaging/linux/drakon-server.env.example`
- `packaging/linux/drakon-server.json.example`
- `packaging/linux/INSTALL.md`
- `docs/auditoria-final.md`
- `.archon/plans/prompt-10-systemd-deb-auditoria-final.md`

## Arquivos alterados

- `CMakeLists.txt`
- `README.md`
- `src/main.cpp`
- `src/config/config_loader.cpp`

## Implementação

### Serviço systemd

Foi criado `packaging/linux/drakon-server.service` com:

- `ExecStartPre` para `validate-config`;
- `ExecStartPre` para `prepare-runtime`;
- `ExecStart` com `drakon-server run --config ${DRAKON_CONFIG}`;
- `DynamicUser=yes`;
- `StateDirectory=drakon-server`;
- `LogsDirectory=drakon-server`;
- `RuntimeDirectory=drakon-server`;
- `Environment=DRAKON_CONFIG=/etc/drakon-server/drakon-server.json`;
- proteções de runtime como `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict` e `ProtectHome=true`;
- escrita permitida apenas em `/var/lib/drakon-server`, `/var/log/drakon-server` e `/run/drakon-server`.

O unit não ativa `PrivateDevices`, porque câmeras reais podem precisar de acesso a dispositivos locais.

### Env/config exemplos

Foi criado `drakon-server.env.example` sem secrets reais. Ele define:

- `DRAKON_CONFIG=/etc/drakon-server/drakon-server.json`;
- `DRAKON_LOG_LEVEL=info`;
- exemplos comentados para referências de secrets via ambiente.

Foi criado `drakon-server.json.example` para instalação em sistema, usando:

- `data_root`: `/var/lib/drakon-server`;
- `runtime_root`: `/run/drakon-server`;
- `config_root`: `/etc/drakon-server`;
- `log_root`: `/var/log/drakon-server`;
- SQLite em `/var/lib/drakon-server/db/drakon-server.sqlite3`;
- inference desabilitada por padrão;
- cameras vazias por padrão.

### Comando de serviço

Foi implementado:

```bash
drakon-server run --config <path> [--once]
```

O comando valida config, prepara diretórios, imprime estado inicial e mantém o processo ativo até `SIGTERM`/`SIGINT`. O modo `--once` executa a inicialização e encerra, permitindo teste rápido do serviço sem daemonizar.

### Validação de paths de sistema

A validação de config continua bloqueando paths fora do projeto, mas agora aceita explicitamente os roots de instalação Linux:

- `/etc/drakon-server`;
- `/var/lib/drakon-server`;
- `/var/log/drakon-server`;
- `/run/drakon-server`.

Isso permite validar o config empacotado sem relaxar a política para paths arbitrários.

### CPack Debian

Foi configurado CPack com gerador `DEB`.

Pacote gerado:

```text
build/drakon-server_0.1.0_amd64.deb
```

Conteúdo validado do pacote:

- `/opt/drakon-server/bin/drakon-server`;
- `/etc/drakon-server/drakon-server.env.example`;
- `/etc/drakon-server/drakon-server.json.example`;
- `/lib/systemd/system/drakon-server.service`;
- `/usr/share/doc/drakon-server/INSTALL.md`;
- `/usr/share/doc/drakon-server/README.md`;
- `/usr/share/doc/drakon-server/auditoria-final.md`;
- `/var/lib/drakon-server/`;
- `/var/log/drakon-server/`.

Dependências Debian detectadas por `dpkg-shlibdeps`:

- `libavformat62`;
- `libc6`;
- `libgcc-s1`;
- `libopencv-core410`;
- `libopencv-imgcodecs410`;
- `libopencv-imgproc410`;
- `libopencv-videoio410`;
- `libsqlite3-0`;
- `libstdc++6`.

## Comandos executados

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j$(nproc)
ctest --test-dir build --output-on-failure
cmake --build build --target package
dpkg-deb -c build/drakon-server_0.1.0_amd64.deb
dpkg-deb -I build/drakon-server_0.1.0_amd64.deb
```

## Resultado dos testes

```text
100% tests passed, 0 tests failed out of 24
```

Novos testes adicionados:

- `drakon_server_run_once`;
- `drakon_server_validate_packaging_config`.

## Auditoria final

### O que já funciona

- CLI headless;
- validação de config JSON;
- preparação de runtime;
- SQLite local com schema inicial;
- comandos `db-init`, `db-status` e `list-cameras`;
- captura `capture-test` com dry-run/test source e suporte inicial a OpenCV/FFmpeg;
- frame store com diretórios por timestamp;
- metadata JSON de frame;
- índice `frames.jsonl`;
- jobs/steps/agentes em dry-run;
- inferência mock estruturada;
- índices `jobs.jsonl`, `inference.jsonl`, `events.jsonl` e `alerts.jsonl`;
- geração de eventos e alertas a partir de inferências;
- webhooks em dry-run;
- API local documentada como planejada;
- execução `run` para serviço systemd;
- pacote `.deb` via CPack.

### O que é mock ou planejado

- Inferência real ainda não chama API externa; apenas `provider=mock` executa.
- Jobs ainda rodam apenas com `--dry-run`.
- Webhooks ainda rodam apenas com `--dry-run`.
- `serve-api` documenta endpoints planejados e não abre socket HTTP.

### O que precisa de câmera real

- Validação de RTSP real;
- validação de webcam real;
- teste prolongado de captura e escrita de frames;
- ajuste de credenciais via `credentials_ref`/ambiente.

### O que precisa de LLM real

- Cliente HTTP para provider explícito;
- resolução segura de `api_key_ref`;
- política de raw response;
- validação de schema de saída real;
- limites de custo, timeout e retry.

### O que precisa de banco real

- SQLite já tem schema inicial.
- PostgreSQL ainda é apenas contrato/configuração; falta implementar conexão, migrations e persistência real.

### Pronto para teste interno

- Build C++23 Debug;
- CTest completo do pipeline mock;
- pacote `.deb` gerado;
- unit systemd pronto para instalação manual;
- config/env de exemplo sem secrets;
- validação `run --once` para health check inicial.

## Confirmações

- Nenhum commit foi feito.
- Nenhum push foi feito.
- `sudo` não foi usado.
- Nenhum pacote foi instalado no sistema.
- Nenhum secret real foi empacotado.
- Nenhuma interface gráfica foi criada.
- Nenhum arquivo de usuário foi apagado.
