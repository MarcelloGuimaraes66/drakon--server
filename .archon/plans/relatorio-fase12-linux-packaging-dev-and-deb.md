# Relatorio fase 12 - Linux packaging dev e DEB

Data: 2026-05-24

## Resultado

Pacote Linux gerado com CPack:

- `Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb`
- `Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.tar.gz`

O `.deb` declara:

- `Package: perceptrum-desktop`
- `Version: 1.0.0`
- `Architecture: amd64`
- `Installed-Size: 35999`

## Arquivos instalados

Confirmado por `cmake --install` com `DESTDIR=/tmp/perceptrum-cmake-install` e por `dpkg-deb -c`.

Binarios e launchers:

- `/usr/bin/perceptrum-desktop`
- `/usr/bin/perceptrum-agent`
- `/usr/bin/perceptrum-desktop-launcher.sh`

Desktop integration:

- `/usr/share/applications/perceptrum.desktop`
- `/usr/share/icons/hicolor/1024x600/apps/perceptrum.png`

Web build:

- `/usr/share/perceptrum-desktop/web/index.html`
- `/usr/share/perceptrum-desktop/web/assets/*.js`
- `/usr/share/perceptrum-desktop/web/assets/*.css`
- `/usr/share/perceptrum-desktop/web/branding/current/*`
- demais assets emitidos por `DrakonSite/dist`

Backend local Node:

- `/usr/share/perceptrum-desktop/backend/perceptrum-local-backend.sh`
- `/usr/share/perceptrum-desktop/backend/desktop-local-server.cjs`
- `/usr/share/perceptrum-desktop/backend/bootstrap/perceptrum_site.seed.sqlite`
- `/usr/share/perceptrum-desktop/backend/bootstrap/perceptrum_site.seed.schema.sql`
- `/usr/share/perceptrum-desktop/backend/bootstrap/perceptrum_site.seed.import-report.json`
- `/usr/share/perceptrum-desktop/backend/node_modules/better-sqlite3-multiple-ciphers/*`
- `/usr/share/perceptrum-desktop/backend/node_modules/bindings/*`
- `/usr/share/perceptrum-desktop/backend/node_modules/file-uri-to-path/*`

## Dependencias Debian

Declaradas no controle do pacote:

- `libcurl4`
- `libgtk-3-0`
- `libwebkit2gtk-4.1-0`
- `ffmpeg`
- `nodejs`
- `xdg-utils`
- `libsecret-tools`

## Runtime backend local

O launcher `/usr/bin/perceptrum-desktop-launcher.sh` define por padrao:

- `APP_STATIC_ROOT=/usr/share/perceptrum-desktop/web`
- `PERCEPTRUM_BACKEND_COMMAND=/usr/share/perceptrum-desktop/backend/perceptrum-local-backend.sh`

O backend local empacotado executa `node desktop-local-server.cjs`, usa `NODE_PATH` apontando para os modulos nativos instalados no proprio pacote e provisiona SQLite a partir do seed em `backend/bootstrap`.

O host Linux ainda aceita override via ambiente:

- `APP_STATIC_ROOT`
- `PERCEPTRUM_WEB_ROOT`
- `PERCEPTRUM_BACKEND_COMMAND`
- `PERCEPTRUM_BACKEND_WORKDIR`
- `PERCEPTRUM_BACKEND_PORT`
- `APP_BASE_URL`

## Instalar e remover

Instalar em Ubuntu/Debian:

```bash
sudo apt install ./Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
```

Alternativa com `dpkg`:

```bash
sudo dpkg -i Perceptrum/out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb
sudo apt -f install
```

Executar:

```bash
perceptrum-desktop-launcher.sh
```

Remover pacote mantendo dados do usuario:

```bash
sudo apt remove perceptrum-desktop
```

Purgar metadados de pacote tambem nao remove os diretorios XDG do usuario:

```bash
sudo apt purge perceptrum-desktop
```

## Dados e configuracao

O pacote instala somente arquivos sob `/usr`. Dados e configuracao do usuario ficam fora da area do pacote e sao preservados em remove/upgrade.

Raizes padrao do runtime Linux:

- Dados: `~/.local/share/PerceptrumData`
- Config: `${XDG_CONFIG_HOME:-~/.config}/Perceptrum`
- Cache: `${XDG_CACHE_HOME:-~/.cache}/Perceptrum`
- Estado: `${XDG_STATE_HOME:-~/.local/state}/Perceptrum`
- Logs: `${XDG_STATE_HOME:-~/.local/state}/Perceptrum/logs`

Arquivos relevantes:

- `agent_config.json` fica na raiz de config.
- `client_id.txt`, `exe_id.txt`, `paired_timezone.txt` e `perceptrum_base_url.txt` ficam na raiz de config.
- O token do EXE usa Secret Service via `secret-tool`; o fallback explicito em arquivo usa `config/secrets/exe_token.txt` com permissao `0600`.
- O SQLite local do backend fica sob a raiz de dados, em `sqlite/local-site/perceptrum_site.sqlite`.

## Validacao executada

Sequencia obrigatoria executada:

```bash
cd DrakonSite
npm run build

cd ../Perceptrum
cmake -S . -B out/build/linux-release -G Ninja -DCMAKE_BUILD_TYPE=Release -DPERCEPTRUM_BUILD_WEB=OFF
cmake --build out/build/linux-release -j$(nproc)
ctest --test-dir out/build/linux-release --output-on-failure
cmake --build out/build/linux-release --target package
```

Resultado:

- `npm run build`: sucesso.
- `cmake configure`: sucesso.
- `cmake --build`: sucesso.
- `ctest`: 48/48 testes passaram.
- `package`: `.tar.gz` e `.deb` gerados.

Validacao adicional:

- `dpkg-deb -I`: confirmou dependencias Debian declaradas.
- `dpkg-deb -c`: confirmou conteudo do pacote.
- `DESTDIR=/tmp/perceptrum-cmake-install cmake --install out/build/linux-release`: confirmou a arvore instalada por `cmake --install`.
- Smoke test isolado do backend gerado: `/api/runtime/health` retornou HTTP 200 com SQLite seed provisionado.
