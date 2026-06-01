# Plano recalibrado pos reset GitHub

Data: 2026-05-03
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Escopo: recalibrar a migracao Linux/Ubuntu apos conferir os relatorios do Archon e o estado real da arvore atual.

## Regras aplicadas

- Nenhum codigo foi alterado.
- Nenhum commit foi criado.
- Nenhum push foi executado.
- Nenhum arquivo foi apagado.
- `Perceptrum/out/build` foi usado apenas como evidencia historica, nao como fonte de verdade.
- `AppHost`, `.vcxproj` e `.sln` nao foram alterados.

## Estado real da arvore atual

Estado Git observado:

- Branch atual: `main`.
- Arquivos nao rastreados antes deste relatorio: os cinco relatorios em `.archon/plans` e o prompt em `.archon/prompts`.
- Este arquivo foi gerado como saida obrigatoria do prompt.

Diretorios principais presentes:

- `.archon/`
- `AppHost/`
- `DrakonSite/`
- `Perceptrum/`
- `branding/`

Arquivos/projetos relevantes presentes:

- `AppHost/AppHost.vcxproj`
- `Perceptrum/Perceptrum.sln`
- `Perceptrum/Perceptrum/Perceptrum.vcxproj`
- `Perceptrum/PerceptrumCore/PerceptrumCore.vcxproj`
- `Perceptrum/vcpkg.json`
- `DrakonSite/package.json`
- `brand.config.json`

Confirmacoes pedidas:

- `Perceptrum/CMakeLists.txt`: ausente.
- `Perceptrum/linux`: ausente.
- `Perceptrum/linux-desktop`: ausente.
- `Perceptrum/packaging/linux`: ausente.
- `Perceptrum/out/build/linux-debug`: presente, mas nao-canonico.
- `Perceptrum/out/package/perceptrum-desktop_1.0.0_amd64.deb`: presente, mas nao-canonico.

Conclusao: o checkout limpo atual nao contem uma base Linux CMake reprodutivel. O pacote Linux existente e seus binarios sao produtos de build historicos, nao uma fonte recompilavel no estado atual.

## Fonte canonica atual

### `AppHost/`

Fonte canonica somente para a casca desktop Windows.

Evidencia real:

- `AppHost/AppHost.vcxproj` define `ConfigurationType=Application`, `OutputType=Winexe`, `UseWinUI=true`, `CppWinRTOptimized=true`, `WindowsAppSDKPackageVersion=1.7.250513003` e `WebView2PackageVersion=1.0.2903.40`.
- `AppHost/readme.txt` descreve o projeto como scaffold WinUI 3 + C++/WinRT.
- `AppHost/Pages/SiteHostPage.xaml` contem `WebView2`.
- `AppHost/Platform/LocalBackendHost.cpp` usa WinHTTP, `CreateProcessW`, Job Object e handles Win32.
- `AppHost/Platform/TrayIconHost.cpp` usa `Shell_NotifyIconW`.
- `AppHost/Platform/DesktopDatabaseKeyStore.cpp` e `SecureLocalStore.cpp` dependem de APIs Windows.

Classificacao corrigida:

- Nao ha evidencia de WPF ou WinUI 3 gerenciado/C# como base principal.
- Ha XAML, mas e XAML de WinUI 3/C++/WinRT, nao WPF.
- Ha WebView2 dentro de uma aplicacao WinUI 3 nativa.
- Portanto, `AppHost` deve ser tratado como host Windows WinUI 3 + C++/WinRT + WebView2, com forte dependencia de Windows App SDK e Win32.

Decisao: nao portar `AppHost` diretamente para Linux. Reproduzir seu contrato funcional em um host Linux separado.

### `DrakonSite/`

Fonte canonica para UI web, worker/backend TypeScript, servidor local e adaptadores de banco.

Arquivos e superficies reais observadas:

- `DrakonSite/src/react-app/*`: frontend React/Vite.
- `DrakonSite/src/worker/*`: backend/worker com auth, cameras, jobs, chat, billing, reporting e estado operacional.
- `DrakonSite/server/index.ts`: servidor Node.
- `DrakonSite/server/pg-d1.ts`: adaptador Postgres.
- `DrakonSite/server/sqlite-d1.ts`: adaptador SQLite.
- `DrakonSite/server/sqlite-d1-encrypted.ts`: SQLite criptografado.
- `DrakonSite/server/sqlite-encryption.ts`: politica de criptografia SQLite.
- `AppHost/Runtime/desktop-local-server.mjs`: servidor desktop local usado pelo host Windows e reaproveitavel como contrato para Linux.
- `AppHost/Runtime/camera-discovery.mjs`: descoberta local de cameras.

Decisao: preservar `DrakonSite` como base comum UI/backend para Windows e Linux.

### `Perceptrum/Perceptrum/`

Fonte canonica para o runtime/agente C++.

Diretorios reais presentes:

- `app`
- `camera`
- `comm`
- `core`
- `generated`
- `jobs`
- `logging`
- `orchestrator`
- `orchestrator/knowledge`
- `orchestrator/skills`
- `platform`
- `runtime`

Arquivos fonte reais principais presentes:

- Raiz legado: `Perceptrum.cpp`, `Perceptrum.h`, `framework.h`, `targetver.h`.
- `app`: `PairingDialog.cpp/.h`, `TrayIcon.cpp/.h`.
- `camera`: `CameraSession.cpp/.h`, `FrameBuffer.cpp/.h`, `FrameDiskWriter.cpp/.h`, `InferenceStub.cpp/.h`, `MotionDetector.cpp/.h`, `RtspCapture.cpp/.h`, `CameraConfig.h`, `Frame.h`, `PerfMetrics.h`.
- `comm`: `PairingClient.cpp/.h`, `SecureLocalStore.cpp/.h`, `TelegramNotifier.cpp/.h`, `TelegramNotifierSendVideo.cpp`, `TelegramSettingsRepo.cpp/.h`, `BackendConfig.h`, `BackendConfig_old.h`, `PgClient.h`, `TelegramSettings.h`.
- `core`: `AgentCore.cpp/.h`, `AnalysisRegionGeometry.cpp/.h`, `ContentCoverageTracker.h`, `Localization.h`, `TemporalEngine.h`, `TemporalEvidence.h`, `VideoPolygonOverlayRenderer.cpp/.h`.
- `jobs`: `JobPayloadParser.cpp/.h`, `JobRuntime.cpp/.h`, `JobRuntime_old.cpp`, `JobTypes.h`.
- `logging`: `Logging.cpp/.h`, `Logging_old.cpp`.
- `orchestrator`: `ChatModelConfig.cpp/.h`, `ChatV2Orchestrator.cpp/.h`, `ConfigUtils.cpp/.h`, `HttpUtils.cpp/.h`, `KnowledgeBase.cpp/.h`, `LocalLlmClient.cpp/.h`, `LocalLlmRuntimeManager.cpp/.h`, `OperationTaskState.cpp/.h`, `PromptBuilder.cpp/.h`, `RoutingLexicon.cpp/.h`, `SkillRegistry.cpp/.h`, `SkillTypes.h`.
- `orchestrator/skills`: `ControlCameraSkill`, `ControlJobSkill`, `CreateCameraAgentSkill`, `CreateCameraSkill`, `CreateCamerasBatchSkill`, `CreateJobSkill`, `EditCameraAgentSkill`, `EditCameraSkill`, `EditCamerasBatchSkill`, `EditJobSkill`, `ExplainAppSkill`, `GenerateReportSkill`, `ReadStateSkill`, `ScanNetworkSkill`, `VideoSearchSkill` e helpers em `shared`.
- `platform`: `platform_common.cpp/.h`, `platform_process.cpp/.h`, `platform_secure_store.cpp/.h`, `platform_shutdown.cpp/.h`.
- `runtime`: `BrandingRuntime.cpp/.h`, `HeadlessService.cpp/.h`.

Estado de portabilidade real:

- Existe camada parcial multiplataforma em `platform_*`.
- `platform_process.cpp` ja contem caminho POSIX com `fork`, `execv`, `kill`, `SIGTERM` e `SIGKILL`.
- `platform_shutdown.cpp` ja contem caminho POSIX com `SIGINT` e `SIGTERM`.
- `platform_common.cpp` ja contem caminho Linux para `HOME`, `XDG_DATA_HOME` e `/proc/self/exe`.
- `platform_secure_store.cpp` ainda protege secrets com DPAPI em Windows, mas o caminho nao Windows permanece como arquivo em texto normal.
- Existem muitos acoplamentos Win32 ainda nos caminhos de runtime comum, especialmente `AgentCore.cpp`, `CameraSession.cpp`, `FrameDiskWriter.cpp`, `JobRuntime.cpp`, `Logging.cpp`, `HeadlessService.cpp`, `PerfMetrics.h` e o UI legado.

Decisao: preservar este nucleo como fonte canonica, mas criar lista CMake Linux explicita e excluir UI Win32 legado ate haver refatoracao.

### `brand.config.json`

Fonte canonica de branding e paths de marca.

Evidencia real:

- `activeBrand` e `perceptrum`.
- Existem marcas `drakon` e `perceptrum`.
- Para `perceptrum`, `dataRootLinux` existe e aponta para `~/.local/share/PerceptrumData`.
- Para `drakon`, `dataRootLinux` existe e aponta para `~/.local/share/DrakonData`.

Decisao: usar `brand.config.json` como fonte de branding e layout padrao, ajustando o plano Linux para separar app/config de sistema de dados de usuario.

## Artefatos presentes e nao-canonicos

Tudo sob `Perceptrum/out` deve ser tratado como artefato. Pode orientar recuperacao, mas nao deve ser copiado como fonte de verdade sem revisao.

Artefatos principais observados:

- `Perceptrum/out/build/linux-debug/perceptrum-desktop`: ELF Linux x86-64, com debug_info, nao stripped.
- `Perceptrum/out/build/linux-debug/perceptrum-agent`: ELF Linux x86-64, com debug_info, nao stripped.
- `Perceptrum/out/build/linux-debug/libperceptrum_core.a`: arquivo `ar`.
- `Perceptrum/out/build/linux-debug/CMakeCache.txt`
- `Perceptrum/out/build/linux-debug/CPackConfig.cmake`
- `Perceptrum/out/build/linux-debug/compile_commands.json`
- `Perceptrum/out/build/linux-debug/install_manifest.txt`
- `Perceptrum/out/build/linux-debug/perceptrum.desktop`
- `Perceptrum/out/build/linux-debug/perceptrum-desktop-launcher.sh`
- `Perceptrum/out/build/linux-debug/perceptrum-agent-launcher.sh`
- `Perceptrum/out/build/ui/*`: build frontend empacotado.
- `Perceptrum/out/package/perceptrum-desktop_1.0.0_amd64.deb`: pacote Debian historico.

Metadados uteis, ainda nao-canonicos:

- Projeto CMake historico: `PerceptrumLinux`.
- Generator: Ninja.
- Build type: Debug.
- `CMAKE_HOME_DIRECTORY`: `Perceptrum`.
- CPack: `DEB`, pacote `perceptrum-desktop`, versao `1.0.0`.
- Dependencias Debian declaradas: `ffmpeg, systemd, libgtk-3-0, libwebkit2gtk-4.1-0, libsoup-3.0-0`.
- Dependencias detectadas no pacote: OpenCV 4.10, libcurl, FFmpeg/libav, GTK3, WebKitGTK 4.1, JavaScriptCoreGTK, libsoup 3.
- Desktop entry: "Native GTK desktop shell for the Perceptrum runtime".

Arquivos fonte historicos referenciados por artefatos, mas ausentes no checkout:

- `Perceptrum/CMakeLists.txt`
- `Perceptrum/linux/main.cpp`
- `Perceptrum/linux-desktop/main.cpp`
- `Perceptrum/linux-desktop/DesktopConfig.cpp`
- `Perceptrum/linux-desktop/XdgPaths.cpp`
- `Perceptrum/linux/debian/postinst`
- `Perceptrum/linux/debian/prerm`
- `Perceptrum/linux/debian/postrm`
- `Perceptrum/linux/debian/conffiles`
- `Perceptrum/linux/perceptrum-agent.service`
- `Perceptrum/linux/perceptrum-agent.env`
- `Perceptrum/linux/prepare-runtime-layout.sh`
- `Perceptrum/packaging/linux/perceptrum.svg`

Conclusao: os artefatos provam que houve uma fatia Linux anterior com GTK/WebKitGTK, CPack, agente e pacote `.deb`, mas a fonte dessa fatia nao esta no checkout atual. A recuperacao deve recriar/restaurar esses arquivos em fonte versionada.

## O que foi perdido em relacao a refatoracao anterior

Pelo cruzamento entre `compile_commands.json`, `CPackConfig.cmake`, `cmake_install.cmake`, manifestos e a arvore atual, foram perdidos ou nao estao versionados:

- Entrada CMake raiz Linux em `Perceptrum/CMakeLists.txt`.
- Estrutura `Perceptrum/linux/`.
- Estrutura `Perceptrum/linux-desktop/`.
- Entrada do agente Linux em `Perceptrum/linux/main.cpp`.
- Host desktop Linux GTK/WebKitGTK em `Perceptrum/linux-desktop/main.cpp`.
- Configuracao desktop Linux em `DesktopConfig.cpp` e paths XDG em `XdgPaths.cpp`.
- Scripts Debian de install/remove/purge.
- Unit systemd e arquivo env do agente.
- Script `prepare-runtime-layout.sh`.
- Icone Linux em `Perceptrum/packaging/linux/perceptrum.svg`.
- Presets ou comandos CMake versionados para reproduzir `PerceptrumLinux`.
- Regras CPack versionadas para instalar binarios, UI, branding, knowledge base, launchers e systemd.

Nao se deve reconstruir essa fatia copiando cegamente `out/`. O caminho seguro e usar `out/` como inventario de comportamento e reimplementar/restaurar em fonte canonica.

## Matriz de paridade recalibrada

| Area | Windows atual confirmado | Linux atual no checkout | Status recalibrado | Acao |
|---|---|---|---|---|
| Shell desktop | WinUI 3 + C++/WinRT + WebView2 | Somente artefato GTK/WebKitGTK em `out` | Bloqueado | Restaurar/criar LinuxHost versionado |
| CMake Linux | Nao aplicavel ao AppHost | `Perceptrum/CMakeLists.txt` ausente | Bloqueado critico | Criar CMake raiz reprodutivel |
| Estrutura Linux | Nao aplicavel | `Perceptrum/linux` e `linux-desktop` ausentes | Bloqueado critico | Restaurar/criar fontes Linux |
| Web UI | WebView2 e/ou paginas WinUI nativas | `DrakonSite` fonte presente, `out/build/ui` artefato | Parcial | Empacotar build de `DrakonSite` a partir da fonte |
| Backend local | `desktop-local-server.mjs` iniciado por AppHost | Fonte presente, host Linux ausente | Parcial | LinuxHost deve iniciar Node com env equivalente |
| Healthcheck | WinHTTP para `/api/runtime/health` | Endpoint Node reaproveitavel | Parcial | Implementar probe Linux via libsoup/curl ou helper HTTP |
| Auth/OAuth | WebView2 intercepta navegacao e bridge JS | Sem WebKit host fonte | Parcial bloqueado | Reproduzir bridge e callback em WebKitGTK |
| Runtime/agente | C++ comum iniciado por AppHost | Fontes comuns presentes; CMake Linux ausente | Parcial | Criar alvo `perceptrum-agent` e sanear Win32 |
| Camera/RTSP | FFmpeg/OpenCV em C++ | Fontes presentes com acoplamentos Win32 | Parcial | Usar `platform_process` e paths POSIX |
| Jobs | C++/backend comum | Fontes presentes com acoplamentos Win32 | Parcial | Isolar invocacoes FFmpeg/OS |
| Secrets | DPAPI no Windows | Fallback plaintext no codigo atual | Risco critico | Definir libsecret/Secret Service ou fallback aprovado |
| Tray | `Shell_NotifyIconW` | Sem fonte Linux | Ausente | AppIndicator/StatusNotifier opcional, fallback sem tray |
| Packaging | MSBuild/Inno/PowerShell | `.deb` historico em `out`, fonte ausente | Bloqueado | Recriar CPack/Debian canonicamente |
| Systemd | Nao aplicavel | Unit historica no pacote, fonte ausente | Bloqueado | Recriar unit e decidir user/system |
| Branding | `brand.config.json` presente | `dataRootLinux` presente | Parcial | Consolidar layout Linux app/config/dados |

## Prioridade tecnica real

A prioridade tecnica real nao e implementar features de paridade. Antes disso, e necessario restaurar reprodutibilidade Linux.

Ordem correta:

1. Criar uma base CMake Linux versionada que configure em clone limpo.
2. Recriar os alvos minimos `perceptrum_core`, `perceptrum-agent` e um `perceptrum-desktop` inicial.
3. Usar lista fonte explicita para evitar incluir UI Win32 legado e arquivos `_old.cpp`.
4. Sanear o menor conjunto de acoplamentos Win32 que bloqueia build Linux.
5. So depois integrar host GTK/WebKitGTK, backend Node, UI build, secrets e packaging Debian.

## Sequencia nova de fases

### Fase 0 - Reprodutibilidade e inventario fonte

Objetivo: fazer o Linux existir novamente como fonte versionada.

Entregaveis:

- `Perceptrum/CMakeLists.txt`.
- `Perceptrum/CMakePresets.json`, se adotado.
- Estrutura `Perceptrum/linux/`.
- Estrutura `Perceptrum/linux-desktop/`.
- Estrutura `Perceptrum/packaging/linux/`, se os assets Linux ficarem separados.
- Alvo `perceptrum_core` com fontes comuns.
- Alvo `perceptrum-agent` com entrada Linux.
- Alvo `perceptrum-desktop` minimo, inicialmente podendo abrir janela/healthcheck stub antes de paridade.

Criterio de pronto:

- `cmake -S Perceptrum -B Perceptrum/out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug` configura sem depender de arquivos gerados antigos.

### Fase 1 - Build Linux do agente C++ minimo

Objetivo: compilar o runtime headless com uma lista fonte controlada.

Trabalho:

- Excluir do alvo Linux: `Perceptrum.cpp`, `app/TrayIcon.*`, `app/PairingDialog.*`, `_old.cpp` e fontes WinUI/AppHost.
- Incluir `platform_common`, `platform_process`, `platform_shutdown`, `platform_secure_store`, `runtime/HeadlessService`, `runtime/BrandingRuntime` e nucleo necessario.
- Substituir invocacoes diretas de `CreateProcessW` por `platform_process` nos caminhos compilados em Linux.
- Isolar metricas PDH/Win32 e oferecer implementacao POSIX ou no-op temporario.

Criterio de pronto:

- `perceptrum-agent` compila em Linux.
- O binario responde a um modo de ajuda, versao, dry-run ou inicializacao controlada sem sessao.

### Fase 2 - Host Linux GTK/WebKitGTK minimo

Objetivo: recuperar a casca desktop Linux indicada pelos artefatos historicos.

Trabalho:

- Implementar `linux-desktop/main.cpp` com GTK3/WebKitGTK 4.1, conforme a trilha do pacote historico.
- Criar resolucao XDG de dados, estado e cache.
- Escolher porta local livre.
- Iniciar/parar `desktop-local-server.mjs` via processo POSIX.
- Aguardar `/api/runtime/health`.
- Carregar `http://127.0.0.1:<porta>/dashboard`.
- Persistir user data/cache do WebKit em local XDG.

Criterio de pronto:

- App abre janela Linux e renderiza a UI local a partir de `DrakonSite/dist`.

### Fase 3 - Contrato WebView/backend/sessao

Objetivo: reproduzir o contrato funcional do `AppHost` sem portar `AppHost`.

Trabalho:

- Definir envs equivalentes: `PORT`, `APP_BIND_HOST`, `APP_BASE_URL`, `APP_ALLOWED_ORIGINS`, `APP_RUNTIME_ENV`, `ENV_PROFILE`, `APP_STATIC_ROOT`, `STORAGE_ROOT`, `APP_SERVICE_SESSION_DIR`, `APP_DB_BACKEND`.
- Implementar bridge JS equivalente para sessao residente.
- Interceptar callback OAuth e navegacao externa no WebKitGTK.
- Provisionar `exe_token`, `client_id`, `exe_id`, timezone e base URL para o agente.

Criterio de pronto:

- Login local/Google chega em sessao local.
- `/api/runtime/local-session` provisiona dados suficientes para o agente.

### Fase 4 - Secrets Linux e SQLite criptografado

Objetivo: remover regressao de seguranca do fallback plaintext.

Trabalho:

- Implementar backend Linux de `platform_secure_store` com libsecret/Secret Service.
- Definir fallback explicito, se aceito, com diretorios `0700` e arquivos `0600`.
- Proteger `APP_SQLITE_KEY_HEX` e demais tokens.
- Validar `APP_SQLITE_ENCRYPTION=required` em ambiente Linux limpo.

Criterio de pronto:

- Chaves/tokens nao ficam em texto simples por padrao no desktop Ubuntu.

### Fase 5 - Cameras, jobs e FFmpeg

Objetivo: recuperar paridade operacional do runtime.

Trabalho:

- Validar OpenCV/FFmpeg/libcurl no Ubuntu alvo.
- Padronizar localizacao do `ffmpeg`: config/env, depois PATH, ou binario vendorizado se decidido.
- Corrigir usos remanescentes de APIs Windows em `AgentCore`, `CameraSession`, `FrameDiskWriter` e `JobRuntime`.
- Testar discovery, captura RTSP, thumbnail, clip MP4, jobs simples e Chat V2.

Criterio de pronto:

- Uma camera RTSP gera thumbnail/evento.
- Um job simples executa e aparece na UI.

### Fase 6 - Packaging Debian/Ubuntu

Objetivo: recriar o pacote `.deb` a partir de fonte versionada.

Trabalho:

- Recriar scripts Debian (`postinst`, `prerm`, `postrm`, `conffiles`).
- Recriar unit systemd e env.
- Instalar binarios em `/opt/perceptrum/bin`.
- Instalar launchers em `/usr/bin`.
- Instalar desktop entry em `/usr/share/applications`.
- Instalar icones em `/usr/share/icons/hicolor`.
- Instalar config em `/etc/perceptrum`.
- Empacotar UI gerada de `DrakonSite/dist`.
- Definir comportamento de remove/purge sem apagar dados de usuario indevidamente.

Criterio de pronto:

- Um Ubuntu limpo instala o `.deb`, abre o app e remove/purge sem quebrar dados do usuario.

### Fase 7 - CI e validacao de paridade

Objetivo: impedir regressao e dependencias implicitas em artefatos.

Trabalho:

- CI Linux para configure/build/test/package.
- Testes Node/TypeScript relevantes.
- Validacao de SQLite criptografado.
- Validacao de pacote em VM/container.
- Checklist manual de cameras, login, jobs, restart, uninstall.

Criterio de pronto:

- Build Linux reproduzivel e documentado a partir de clone limpo.

## Riscos recalibrados

### Criticos

- Ausencia de `Perceptrum/CMakeLists.txt` impede qualquer build Linux canonico.
- Ausencia de `Perceptrum/linux` e `Perceptrum/linux-desktop` remove a fonte do host/agent Linux historico.
- `Perceptrum/out` pode induzir a erro se tratado como fonte; deve continuar apenas como evidencia.
- Secrets Linux estao inseguros se o fallback plaintext atual for usado.
- Muitos caminhos C++ comuns ainda contem chamadas Win32 diretas.

### Altos

- WebKitGTK pode divergir de WebView2 em OAuth, cookies, user data e interceptacao de navegacao.
- GTK3/WebKitGTK 4.1 pode variar por versao de Ubuntu; e necessario fixar Ubuntu minimo.
- Native modules Node, especialmente SQLite criptografado, precisam ABI compativel.
- systemd system vs systemd user ainda precisa decisao arquitetural.
- Packaging pode remover dados indevidos se scripts Debian forem recriados sem politica clara.

### Medios

- Tray Linux nao e universal em GNOME/Ubuntu; nao deve bloquear MVP.
- FFmpeg/OpenCV podem divergir de Windows em codecs e timeouts.
- Camera discovery depende de rede local, firewall, VPN e interface.
- Billing/Google OAuth podem exigir ajustes de origem local.
- Logs podem expor tokens, paths, cameras ou prompts se nao houver sanitizacao.

## Primeira fase segura de implementacao

A primeira fase segura e exclusivamente estrutural e reprodutivel: restaurar/criar a base CMake Linux minima sem tocar em `AppHost`, `.vcxproj` ou `.sln`.

Escopo recomendado:

- Criar `Perceptrum/CMakeLists.txt` novo.
- Criar `Perceptrum/CMakePresets.json` se o time aceitar presets.
- Criar `Perceptrum/linux/main.cpp` como entrada minima do agente, preferencialmente chamando `runtime/HeadlessService`.
- Criar `Perceptrum/linux-desktop/main.cpp` como host GTK/WebKitGTK minimo ou stub GUI inicial.
- Criar lista fonte explicita para `perceptrum_core`.
- Excluir explicitamente fontes Windows-only e `_old.cpp`.
- Nao recriar packaging completo ainda.
- Nao copiar arquivos de `Perceptrum/out` para fonte sem revisao.

Criterio de sucesso da primeira fase:

- CMake configura em Linux a partir da arvore fonte.
- O build avanca ate revelar erros reais de portabilidade em fontes canonicas, sem depender de `out`.
- Nenhum comportamento Windows e alterado.

## Decisoes pendentes antes de implementar

- Ubuntu alvo minimo.
- GTK3/WebKitGTK 4.1, seguindo artefatos, ou GTK4/WebKitGTK 6.
- Node vendorizado ou dependencia externa.
- Agente como processo filho, `systemd --user` ou system service.
- libsecret obrigatorio ou fallback arquivo `0600`.
- Tray obrigatorio ou opcional.
- Pacote unico Perceptrum/Drakon ou estrategia por marca.

## Comandos de validacao propostos apos a primeira fase

```bash
cmake -S Perceptrum -B Perceptrum/out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build Perceptrum/out/build/linux-debug --target perceptrum-agent perceptrum-desktop -j"$(nproc)"
ctest --test-dir Perceptrum/out/build/linux-debug --output-on-failure
```

Esses comandos so devem ser usados depois que a base CMake Linux for restaurada em fonte canonica.
