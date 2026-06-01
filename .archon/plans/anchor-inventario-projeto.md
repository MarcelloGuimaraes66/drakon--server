# Anchor - Inventario do Projeto Perceptrum Desktop Linux

Data: 2026-05-03  
Escopo: estudo local do repositorio para planejamento da migracao desktop Linux/Ubuntu.  
Restricoes aplicadas: sem alteracao de codigo-fonte, sem commit, sem push, sem exclusao de arquivos.

## Resumo executivo

O repositorio esta organizado em tres superficies principais:

- `AppHost/`: host desktop Windows moderno em C++/WinRT, WinUI 3 e WebView2. Ele inicializa backend local Node, hospeda a UI web, provisiona sessao do runtime residente e controla tray/janela/logs.
- `DrakonSite/`: aplicacao web React/Vite e worker/backend TypeScript reutilizavel em Cloudflare Worker, servidor Node local e runtime desktop. Contem adaptadores Postgres, SQLite e SQLite criptografado.
- `Perceptrum/Perceptrum/`: runtime/agente C++ de cameras, RTSP/FFmpeg/OpenCV, jobs, inferencia, Chat V2/local LLM, eventos e pareamento.

Existe evidencia de uma fatia Linux ja compilada em `Perceptrum/out/build/linux-debug`, com `perceptrum-desktop`, `perceptrum-agent`, arquivo `.desktop`, pacote `.deb`, dependencias GTK3/WebKitGTK e unit systemd. Porem, na arvore fonte atual nao aparecem `Perceptrum/CMakeLists.txt` nem `Perceptrum/linux/`, embora o cache CMake e o manifesto de instalacao apontem para esses caminhos. Isso torna o build Linux atual nao reprodutivel a partir do checkout presente.

## Inventario por modulo

### AppHost

Funcao observada:

- `AppHost/App.xaml.cpp`: bootstrap do aplicativo WinUI, criacao de backend local, servico C++ residente, WebView2 e tray.
- `AppHost/Platform/AppRuntimeConfig.cpp`: resolve porta local, caminhos de runtime, `runtimeRoot`, `DrakonSite`, Node, frontend estatico, `LOCALAPPDATA`, logs, storage e `uiBaseUrl`.
- `AppHost/Platform/LocalBackendHost.cpp`: sobe `node.exe` com `desktop-local-server.mjs/cjs`, injeta variaveis de ambiente, valida `/api/runtime/health`, usa Job Object e WinHTTP.
- `AppHost/Platform/PerceptrumRuntimeHost.cpp`: inicia o mesmo executavel com `--internal-role=service-cpp`, grava token/client/exe id em storage local protegido e controla shutdown por evento Win32.
- `AppHost/Pages/SiteHostPage.xaml.cpp`: hospeda o frontend no WebView2, injeta bridge JS para provisionar sessao via `/api/runtime/local-session`, reescreve callback OAuth e sincroniza tema.
- `AppHost/Platform/TrayIconHost.cpp`: shell tray Windows via `Shell_NotifyIconW`.
- `AppHost/Packaging/`: build Windows via PowerShell, MSBuild, Inno Setup, Windows App Runtime e staging de Node/backend/frontend.

Dependencias fortes Windows:

- WinUI 3, C++/WinRT, Microsoft.UI.Xaml, WebView2, Windows App SDK.
- `CreateProcessW`, `WaitForSingleObject`, Job Objects, WinHTTP, DPAPI, ShellNotifyIcon, PowerShell, `LOCALAPPDATA`.
- Packaging Windows com MSBuild/Inno Setup.

Conclusao: `AppHost` deve ser tratado como implementacao Windows da casca desktop, nao como base portavel direta para Linux.

### DrakonSite

Funcao observada:

- Frontend React 19/Vite/Tailwind em `DrakonSite/src/react-app`.
- Worker/backend em `DrakonSite/src/worker` com APIs de auth, cameras, jobs, billing, chat, relays, operacoes, reporting e semantica.
- Servidor local Node em `DrakonSite/server/index.ts` para dev/server.
- Servidor desktop especializado em `AppHost/Runtime/desktop-local-server.mjs`, que embute worker, serve assets estaticos, media local, camera discovery e healthcheck.

Dados e adaptadores:

- `DrakonSite/server/pg-d1.ts`: adaptador Postgres compatibilizando chamadas estilo D1.
- `DrakonSite/server/sqlite-d1.ts`: adaptador SQLite via `node:sqlite`.
- `DrakonSite/server/sqlite-d1-encrypted.ts`: SQLite criptografado via `better-sqlite3-multiple-ciphers`.
- `DrakonSite/server/sqlite-encryption.ts`: resolve `APP_SQLITE_ENCRYPTION`, `APP_SQLITE_KEY_HEX`, cipher e migracao de plaintext para criptografado.
- `DrakonSite/scripts/convert-postgres-dump-to-sqlite.mjs`: converte dump Postgres em SQLite, com schema-only e selecao de usuarios.
- `DrakonSite/db/patches/perceptrum_sql.sql`: dump Postgres 17.5 base.

Branding:

- `brand.config.json` define `activeBrand=perceptrum`, caminhos Windows/macOS/Linux, features por marca, assets e nomes.
- `DrakonSite/server/brand.ts` escolhe backend: Perceptrum padrao SQLite, Drakon padrao Postgres, com override por `APP_DB_BACKEND`.

Conclusao: `DrakonSite` e o backend desktop Node sao altamente reaproveitaveis em Linux, desde que o empacotamento traga Node, native modules, frontend build, seed SQLite e variaveis equivalentes.

### Perceptrum runtime/agente

Funcao observada:

- `Perceptrum/Perceptrum/runtime/HeadlessService.cpp`: loop headless que aguarda sessao local, carrega token/client, instancia `AgentCore`, inicializa time sync, cameras e jobs.
- `Perceptrum/Perceptrum/core/AgentCore.*`: nucleo de eventos, comandos, inferencia, video search, Drakon Find, temporal state, integracao backend e uploads.
- `Perceptrum/Perceptrum/camera/*`: captura RTSP/FFmpeg/OpenCV, buffer, escrita de frames/clips, motion detection e metricas.
- `Perceptrum/Perceptrum/jobs/*`: runtime de jobs, steps, alertas, clips, consumo de tokens e integracao com Telegram.
- `Perceptrum/Perceptrum/orchestrator/*`: Chat V2, skill registry, prompt builder, conhecimento local e local LLM.
- `Perceptrum/Perceptrum/platform/*`: camada parcial multiplataforma para paths, processos, secure store e shutdown.

Estado de portabilidade:

- Ja existem caminhos portaveis em `platform_common.cpp`, incluindo `HOME`, `XDG_DATA_HOME`, `/proc/self/exe`, timezone por `/etc/timezone` e `/etc/localtime`.
- Ja existem processos POSIX em `platform_process.cpp` com `fork`, `execv`, pipes, `waitpid`, `SIGTERM` e `SIGKILL`.
- Ja existe shutdown POSIX por `SIGINT`/`SIGTERM` em `platform_shutdown.cpp`.
- O secure store em Linux atualmente grava texto normal; so Windows usa DPAPI.
- Varios fontes ainda incluem ou usam Win32 diretamente, inclusive `CameraSession.cpp`, `AgentCore.cpp`, `FrameDiskWriter.cpp`, `JobRuntime.cpp`, UI legado `Perceptrum.cpp`, tray/dialogs e metricas PDH.

Conclusao: ha uma base de runtime comum, mas a portabilidade real exige continuar extraindo chamadas Win32 de camera/video/jobs para `platform_*` ou caminhos POSIX equivalentes.

### Linux atual observado

Artefatos existentes em `Perceptrum/out/build/linux-debug`:

- Binarios: `perceptrum-desktop`, `perceptrum-agent`.
- Launchers: `perceptrum-desktop-launcher.sh`, `perceptrum-agent-launcher.sh`.
- Desktop entry: `perceptrum.desktop`, comentario "Native GTK desktop shell for the Perceptrum runtime".
- Pacote: `Perceptrum/out/package/perceptrum-desktop_1.0.0_amd64.deb`.
- CPack: projeto `PerceptrumLinux`, generator Ninja, package DEB.
- Dependencias Debian: `ffmpeg, systemd, libgtk-3-0, libwebkit2gtk-4.1-0, libsoup-3.0-0`.
- Manifesto instala em `/opt/perceptrum/bin`, `/usr/bin`, `/usr/share/applications`, `/etc/default/perceptrum-agent`, `/lib/systemd/system/perceptrum-agent.service`, `/etc/perceptrum/brand.config.json`, `/opt/perceptrum/ui`.

Inconsistencias:

- `Perceptrum/CMakeLists.txt` nao existe no checkout atual.
- `Perceptrum/linux/` nao existe no checkout atual.
- `CPackConfig.cmake` referencia `Perceptrum/linux/debian/postinst`, `prerm`, `postrm` e `conffiles`, mas esses arquivos nao estao presentes.
- `compile_commands.json` mostra compilacao de arquivos que no fonte atual ainda possuem includes Win32 nao guardados ou chamadas Win32 espalhadas.

## Superficies funcionais a preservar

- Login local/Google, callback OAuth e sessao residente.
- Backend local HTTP em loopback com healthcheck.
- UI React completa: dashboard, cameras, agents, jobs, chat, billing, settings, eventos e hub.
- Persistencia local SQLite criptografada para Perceptrum desktop empacotado.
- Storage R2 local em filesystem.
- Camera discovery local via UDP WS-Discovery, probes HTTP/TCP/RTSP e tabela de vizinhos.
- Captura RTSP, frames, clips MP4, thumbnails, areas/poligonos, inferencia por imagem/video.
- Jobs e agendador com timezone.
- Chat V2 e local LLM por `llama-server`.
- Notificacoes e integracoes externas documentadas em `ACESSOS_EXTERNOS_CYBER.md`.

## Inventario de riscos imediatos

- Build Linux nao reprodutivel no checkout atual por ausencia dos fontes CMake/Linux.
- `AppHost` nao e portavel e deve ser substituido por shell Linux nativa ou outra tecnologia desktop.
- Agente C++ ainda tem muitos acoplamentos Win32 fora da camada `platform_*`.
- Segredos em Linux nao possuem protecao equivalente ao DPAPI.
- Packaging Windows e Linux estao desconectados; o Linux observado esta apenas em artefatos.
- SQLite criptografado depende de native module Node; o pacote Linux precisa validar ABI/Node/runtime.
- `AppHost/App.xaml.cpp` contem uma duplicacao textual aparente em `ScheduleLocalAppDataCleanupAfterAccountDeletionFromWeb`, que deve ser revisada antes de validar build Windows, embora este estudo nao altere codigo.

## Proxima decisao arquitetural

A rota recomendada e manter `DrakonSite` como UI/backend comum, manter `Perceptrum/Perceptrum` como runtime/agente comum e criar um `LinuxHost` nativo GTK/WebKitGTK que implemente o contrato do AppHost sem herdar WinUI/WebView2. O trabalho critico antes de feature parity e restaurar versionamento dos artefatos CMake/Linux e estabilizar a camada `platform_*`.
