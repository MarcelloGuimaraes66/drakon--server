# Relatorio fase 9 - Rodar hoje no Ubuntu com WebKitGTK

Data: 2026-05-24 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`

## 1. Objetivo

Validar o caminho para rodar o Perceptrum hoje neste Ubuntu como app desktop Linux, com janela WebKitGTK embutida, mesmo `DrakonSite/dist` da versao Windows e backend Node local.

## 2. Observacao sobre Archon

O comando Archon foi iniciado e resolveu o executor principal para `codex/gpt-5.5`, mas o subprocesso `codex exec` ficou sem saida e sem CPU por mais de 2 minutos. A tentativa foi encerrada com `SIGTERM` e o prompt 9 foi executado diretamente neste workspace.

## 3. Estado do ambiente

- `DrakonSite/node_modules`: existe.
- `DrakonSite/dist/index.html`: existe.
- Node: `v22.22.2`.
- npm: `10.9.7`.
- WebKitGTK: `webkit2gtk-4.1 2.52.3`.

## 4. Script de execucao local

Script versionavel presente:

- `Perceptrum/linux-desktop/run-linux-dev.sh`

O script:

- resolve o repo a partir da propria localizacao;
- valida `npm`, `cmake`, `ninja` e `webkit2gtk-4.1`;
- gera `DrakonSite/dist` se faltar;
- configura e compila `Perceptrum/out/build/linux-debug`;
- exporta `APP_STATIC_ROOT`;
- exporta `PERCEPTRUM_WEB_SOURCE_DIR`;
- define `PERCEPTRUM_LINUX_WINDOW_MODE=webkit` por padrao;
- executa `perceptrum-desktop --webkit`.

## 5. Build web

Comando:

```bash
cd DrakonSite
npm run build
```

Resultado: sucesso.

Resumo:

```text
vite v7.3.1 building client environment for production...
2046 modules transformed.
dist/index.html
dist/assets/index-eE6n0e6F.css
dist/assets/index-5IV6gQvy.js
built in 3.66s
```

## 6. Testes Node

Comandos:

```bash
npm run test:local-sqlite-bootstrap
npm run test:platform-boundaries
```

Resultado:

```text
Local SQLite bootstrap OK.
React common UI platform boundary OK.
```

## 7. CMake e build Linux

Comandos:

```bash
cd Perceptrum
cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build out/build/linux-debug -j$(nproc)
```

Resultado:

```text
-- Configuring done (0.1s)
-- Generating done (0.0s)
-- Build files have been written to: /home/marcello-guimaraes/dev/perceptrum_desktop_aspp/Perceptrum/out/build/linux-debug
ninja: no work to do.
```

## 8. CTest

Comando:

```bash
ctest --test-dir out/build/linux-debug --output-on-failure
```

Resultado:

```text
100% tests passed, 0 tests failed out of 46
Total Test time (real) = 29.77 sec
```

## 9. Validacao do backend local e WebKitGTK

Comando:

```bash
APP_STATIC_ROOT="$PWD/../DrakonSite/dist" \
PERCEPTRUM_WEB_SOURCE_DIR="$PWD/../DrakonSite" \
PERCEPTRUM_LINUX_WINDOW_MODE=webkit \
./out/build/linux-debug/perceptrum-desktop --check-backend --print-web-root --webkit
```

Resultado: sucesso.

Trechos relevantes:

```text
[local-server] SQLite database: /home/marcello-guimaraes/dev/perceptrum_desktop_aspp/DrakonSite/storage/sqlite/local-site/perceptrum_site.sqlite
[local-server] brand=perceptrum profile=local backend=sqlite listening on http://localhost:4000
webRoot=/home/marcello-guimaraes/dev/perceptrum_desktop_aspp/DrakonSite/dist
backendBaseUrl=http://127.0.0.1:4000
launchUrl=http://127.0.0.1:4000/dashboard
windowMode=webkitgtk
webkitgtkCompiled=true
backendStatus=started
```

## 10. Comando para abrir o app hoje

Opcao recomendada:

```bash
cd /home/marcello-guimaraes/dev/perceptrum_desktop_aspp
./Perceptrum/linux-desktop/run-linux-dev.sh
```

O script tambem foi validado em modo check:

```bash
./Perceptrum/linux-desktop/run-linux-dev.sh --check-backend --print-web-root
```

Resultado: sucesso, com `webkitgtkCompiled=true` e `backendStatus=started`.

Opcao manual equivalente:

```bash
cd /home/marcello-guimaraes/dev/perceptrum_desktop_aspp/Perceptrum
APP_STATIC_ROOT="$PWD/../DrakonSite/dist" \
PERCEPTRUM_WEB_SOURCE_DIR="$PWD/../DrakonSite" \
PERCEPTRUM_LINUX_WINDOW_MODE=webkit \
./out/build/linux-debug/perceptrum-desktop --webkit
```

## 11. Limites desta fase

Esta fase valida a execucao desktop Linux da UI comum com backend local. Ela nao ativa:

- AgentCore completo;
- CameraSession;
- RTSP;
- FrameDiskWriter;
- JobRuntime.

Esses itens continuam para fases posteriores.

## 12. Fronteiras Windows

`git diff --name-only -- AppHost '*.vcxproj' '*.sln'` nao retornou arquivos.

Nao houve alteracao em:

- `AppHost/`
- `.vcxproj`
- `.sln`

## 13. Processos remanescentes

Apos os testes automatizados, nao havia processo remanescente relevante de:

- `perceptrum-desktop`
- `perceptrum-agent`
- `server/index.ts`
- `tsx`
- `archon workflow`
- `codex exec`

## 14. Commit e push

Nenhum commit foi feito.

Nenhum push foi feito.
