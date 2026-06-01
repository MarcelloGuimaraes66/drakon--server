# Anchor - Matriz de Paridade Windows x Linux

Data: 2026-05-03  
Objetivo: mapear paridade funcional para migracao desktop Linux/Ubuntu do Perceptrum.

## Legenda

- OK: implementado/reutilizavel com baixo ajuste.
- Parcial: ha base existente, mas faltam adaptadores, empacotamento ou validacao.
- Ausente: nao ha implementacao fonte atual suficiente.
- Bloqueado: depende de restaurar fonte/build ou decisao arquitetural.

## Matriz macro

| Area | Windows atual | Linux observado | Status Linux | Acao para paridade |
|---|---|---|---|---|
| Shell desktop | `AppHost` WinUI 3 + WebView2 | Artefato `perceptrum-desktop` GTK/WebKitGTK em `out` | Bloqueado | Restaurar/adicionar fonte LinuxHost e CMake canonicamente |
| Web UI | React/Vite servido em WebView2 | `out/build/ui` e `/opt/perceptrum/ui` no manifesto | Parcial | Empacotar `DrakonSite/dist` no pacote Linux e validar SPA |
| Backend local | Node + `desktop-local-server.mjs/cjs` iniciado por AppHost | Reutilizavel em Node Linux | Parcial | Criar host Linux que exporta env equivalente e controla processo |
| Healthcheck | `/api/runtime/health` via WinHTTP | Endpoint e logica Node existem | OK | Probe Linux via libsoup/curl ou HTTP local |
| Porta local | AppHost escolhe porta alta e injeta `APP_BASE_URL` | Conceito reutilizavel | Parcial | Implementar escolha de porta em LinuxHost |
| Auth/local session | Bridge WebView2 chama `/api/runtime/local-session` | API Node reutilizavel | Parcial | Bridge WebKitGTK <-> host nativo equivalente |
| OAuth callback | Reescrita no WebView2 para origem local | Conceito reutilizavel | Parcial | Interceptar navegacao em WebKitGTK |
| Storage local | `%LOCALAPPDATA%/DrakonPerceptrumDesktop/<brand>` | Brand define `~/.local/share/PerceptrumData`; artefato usa `/etc` e `/opt` | Parcial | Definir layout unico: usuario vs sistema |
| SQLite local | Seed, validacao, migracao, criptografia | Backend Node suporta Linux teoricamente | Parcial | Validar native module, key storage e paths Linux |
| Postgres dev | Adaptador `pg-d1.ts` | Reutilizavel | OK | Manter para dev/server |
| R2 local | `LocalR2Bucket` filesystem | Reutilizavel | OK | Validar permissoes de storage Linux |
| Agente headless | Processo interno do AppHost com `--internal-role=service-cpp` | Artefato `perceptrum-agent` e systemd | Parcial | Separar executavel agent Linux e contrato com backend |
| Shutdown runtime | Evento Win32 | `SIGINT`/`SIGTERM` em `platform_shutdown.cpp` | Parcial | Integrar com systemd e host GUI |
| Processos filhos | `CreateProcessW`, Job Objects | `fork/execv/kill/waitpid` em `platform_process.cpp` | Parcial | Substituir chamadas Win32 diretas restantes |
| Tray | `Shell_NotifyIconW` | Nao ha fonte Linux atual | Ausente | Implementar AppIndicator/StatusNotifier ou fallback sem tray |
| Janela/chrome | WinUI AppWindow/Mica/custom titlebar | GTK/WebKitGTK indicado por CPack | Bloqueado | Definir UX Linux com headerbar/menu |
| Camera discovery | Node UDP/TCP/RTSP em `camera-discovery.mjs` | Reutilizavel | OK | Validar permissoes/firewall/rede no Ubuntu |
| Captura RTSP | FFmpeg/OpenCV C++ | Bibliotecas Linux disponiveis em CMake cache | Parcial | Remover Win32 direto de camera/video helper |
| FFmpeg tools | `ffmpeg.exe` copiado no runtime | Dependencia Debian `ffmpeg` | Parcial | Usar `ffmpeg` do PATH ou empacotar binario |
| CPU/disk metrics | PDH/Windows APIs | Nao ha equivalente claro | Ausente | Implementar `/proc`, `statvfs`, `getrusage` ou desativar metricas |
| Secrets sessao | DPAPI via `SecureLocalStore` | Texto normal no fallback POSIX | Parcial critico | Usar libsecret/Secret Service ou arquivo 0600 com keyring |
| SQLite key | DPAPI em `DesktopDatabaseKeyStore` | Nao ha fonte Linux equivalente atual | Ausente | Criar keystore Linux para `APP_SQLITE_KEY_HEX` |
| Local LLM | `llama-server.exe` ou endpoint | `llama-server` ja considerado no manager | Parcial | Empacotar/binario Linux e modelos `.gguf` |
| Jobs | C++ runtime + backend | Codigo comum parcialmente portavel | Parcial | Sanear Win32 em `JobRuntime.cpp` e FFmpeg helpers |
| Reporting/docx | Worker TypeScript | Reutilizavel | OK | Validar dependencias Node |
| Billing | Stripe no worker/frontend | Reutilizavel | OK | Validar OAuth/cookies/origins locais |
| Branding | `brand.config.json`, generated props/assets | Config contem `dataRootLinux` | Parcial | Garantir geracao de assets Linux e desktop icons |
| Packaging | PowerShell/MSBuild/Inno | Artefato `.deb` via CPack, fonte ausente | Bloqueado | Restaurar CPack, debian scripts e pipeline |

## Contrato minimo que LinuxHost deve reproduzir

O host Linux precisa equivaler ao AppHost nos seguintes pontos:

- Escolher porta local, preferencialmente alta e livre.
- Definir `APP_BASE_URL`, `DRAKON_UI_URL`, `APP_ALLOWED_ORIGINS`, `PORT`, `APP_BIND_HOST`.
- Definir `APP_RUNTIME_ENV=local`, `ENV_PROFILE=local`, `APP_STATIC_ROOT`, `STORAGE_ROOT`, `APP_SERVICE_SESSION_DIR`.
- Inicializar `desktop-local-server` e aguardar `/api/runtime/health`.
- Expor WebKitGTK para `http://127.0.0.1:<porta>/dashboard`.
- Interceptar mensagens JS equivalentes a `resident-runtime-session`, `theme-changed` e `account-delete-cleanup`.
- Persistir `exe_token.txt`, `client_id.txt`, `exe_id.txt`, `paired_timezone.txt`, base URL files e key SQLite.
- Iniciar/parar `perceptrum-agent` ou runtime headless com sessao provisionada.
- Controlar lifecycle do backend e agente em close/logout/uninstall.

## Paridade da UI

| Recurso UI | Fonte comum | Windows AppHost | Linux alvo |
|---|---|---|---|
| Login | `DrakonSite/src/react-app/pages/Login.tsx` | WebView2 | WebKitGTK |
| Dashboard | React | WebView2 | WebKitGTK |
| Cameras | React + camera discovery desktop | WebView2 + Node endpoint | WebKitGTK + mesmo endpoint |
| AI Agents | React + agente C++ | WebView2 | WebKitGTK |
| Jobs | React + backend + agente | WebView2 | WebKitGTK |
| Chat | React + worker + AgentCore/LLM | WebView2 | WebKitGTK |
| Billing | React + Stripe | WebView2 | WebKitGTK |
| Settings | React | WebView2 | WebKitGTK |
| Native back/open browser | `SiteHostPage` | Implementado | Implementar GTK actions |

Como a experiencia principal ja e web, a paridade visual deve vir quase toda de `DrakonSite/dist`. O maior risco nao e UI React; e o container nativo, OAuth, cookies, storage e bridge JS.

## Paridade do agente/runtime

| Recurso agente | Estado | Observacao |
|---|---|---|
| Loop headless | Parcial | `HeadlessService` e portavel em estrutura, com signal POSIX |
| Pareamento | Parcial | `PairingClient` e storage dependem de paths/secrets |
| Bootstrap cameras | Parcial | `AgentCore::bootstrapCameras_` reutilizavel, mas fontes tem Win32 direto |
| RTSP | Parcial | FFmpeg/OpenCV sao multiplataforma, mas helpers de processo precisam POSIX |
| Frame writer/clips | Parcial | `FrameDiskWriter.cpp` tem guardas e chamadas Win32; validar fallback |
| Jobs | Parcial | `JobRuntime.cpp` tem guardas e chamadas Win32; validar build Linux |
| Telegram | Provavel OK | Base curl/HTTP; verificar envio de video no Linux |
| Local LLM | Parcial | Manager ja procura `llama-server` sem `.exe` no Linux |
| Logs | Parcial | `Logging.cpp` tem guardas, mas precisa validar paths e rotacao |

## Gaps de paridade prioritarios

1. Reprodutibilidade Linux: fonte CMake/Linux ausente no checkout atual.
2. Host Linux: implementar ou restaurar GTK/WebKitGTK shell.
3. Segredos Linux: substituir fallback plaintext por libsecret ou mecanismo aceito.
4. Processo e FFmpeg: remover chamadas `CreateProcessW` remanescentes dos caminhos compilados no Linux.
5. Tray/autostart: definir AppIndicator/systemd user vs system service.
6. Packaging: restaurar scripts Debian e validar instalacao/upgrade/uninstall.
7. CI: adicionar build Linux limpo sem depender de `out/`.

## Criterio de paridade inicial

Considerar Linux MVP equivalente ao Windows quando:

- `.deb` instala sem erro em Ubuntu alvo limpo.
- `perceptrum-desktop` abre UI React local e conclui login.
- `/api/runtime/health` retorna `ready=true`.
- Sessao local provisiona `perceptrum-agent`.
- Camera discovery encontra cameras na LAN.
- Uma camera RTSP inicia, gera thumbnail e publica evento.
- Um job simples executa e aparece na UI.
- SQLite local e storage sobrevivem restart.
- Desinstalacao para servicos e remove somente arquivos esperados.
