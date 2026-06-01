# Anchor - Plano de Migracao Desktop Linux/Ubuntu

Data: 2026-05-03  
Objetivo: plano pratico para levar Perceptrum Desktop a Linux/Ubuntu mantendo paridade operacional com Windows.

## Principios

- Preservar `DrakonSite` como UI/backend comum.
- Preservar `Perceptrum/Perceptrum` como runtime/agente comum.
- Tratar `AppHost` como host Windows, nao como base direta de Linux.
- Criar/restaurar um host Linux pequeno, responsavel por lifecycle, WebView, bridge JS, storage e processos.
- Fazer o build Linux ser reprodutivel a partir de fontes versionados, sem depender de `Perceptrum/out`.
- Isolar dependencias de OS atras de `platform_*` ou equivalentes.

## Arquitetura alvo

```
perceptrum-desktop
  LinuxHost GTK/WebKitGTK
    - escolhe porta local
    - inicia desktop-local-server
    - abre WebKitGTK em /dashboard
    - intercepta OAuth/callback e mensagens JS
    - provisiona sessao do agente
    - gerencia tray/autostart conforme decisao

desktop-local-server
  Node 22 + AppHost/Runtime/desktop-local-server.mjs/cjs
    - serve DrakonSite/dist
    - proxy worker.fetch
    - /api/runtime/health
    - /api/runtime/local-session
    - /api/runtime/camera-discovery
    - /media/*
    - SQLite/Postgres + local R2

perceptrum-agent
  C++ headless runtime
    - carrega sessao local
    - AgentCore
    - cameras/RTSP/OpenCV/FFmpeg
    - jobs/chat/temporal/local LLM
```

## Fase 0 - Recuperar base Linux versionada

Objetivo: eliminar dependencia de artefatos em `out/`.

Entregaveis:

- `Perceptrum/CMakeLists.txt` canonicamente presente.
- Diretorio `Perceptrum/linux/` com desktop entry, systemd, debian scripts e assets.
- Presets CMake/Ninja para Debug/Release Linux.
- Alvos minimos:
  - `perceptrum_core` ou equivalente comum.
  - `perceptrum-agent`.
  - `perceptrum-desktop`.
  - pacote `.deb` via CPack.

Observacao: o `CPackConfig.cmake` em `out/build/linux-debug` indica que esses itens existiram ou foram gerados, mas nao estao no checkout atual.

Saida esperada:

- Um clone limpo consegue rodar configure/build/package sem copiar nada de `out/`.

## Fase 1 - Build Linux do runtime comum

Objetivo: compilar o nucleo C++ sem Win32 nos caminhos Linux.

Trabalho:

- Definir lista fonte Linux explicita, excluindo UI Win32 legado (`Perceptrum.cpp`, `app/TrayIcon.*`, `app/PairingDialog.*`).
- Consolidar `platform_common`, `platform_process`, `platform_shutdown`, `platform_secure_store`.
- Auditar e corrigir chamadas diretas:
  - `CreateProcessW` em `AgentCore.cpp`, `CameraSession.cpp`, `FrameDiskWriter.cpp`, `JobRuntime.cpp`.
  - includes Win32 nao guardados em arquivos de camera/core.
  - PDH/TlHelp32/Psapi e metricas de disco/CPU.
- Substituir helpers de FFmpeg para chamar `perceptrum::platform::RunProcessAndCaptureOutput` ou equivalente.
- Padronizar path do `ffmpeg`: primeiro env/config, depois PATH.

Saida esperada:

- `perceptrum-agent` compila e executa `--help`/modo dry-run.
- Teste de processo POSIX e shutdown por `SIGTERM`.

## Fase 2 - Host Linux GTK/WebKitGTK

Objetivo: implementar casca desktop equivalente ao AppHost.

Trabalho:

- Criar `LinuxHost` em C++ ou C com GTK3/WebKitGTK 4.1, seguindo o artefato observado.
- Inicializar janela principal e carregar `http://127.0.0.1:<porta>/dashboard`.
- Implementar:
  - escolha de porta livre;
  - inicio/parada do backend Node;
  - healthcheck HTTP;
  - user data/cache do WebKit;
  - interceptacao de navegacao `/auth/callback`;
  - bridge JS para `resident-runtime-session`;
  - mensagem `theme-changed` se ainda necessaria;
  - acao abrir no navegador.
- Definir UX de tray:
  - preferencial: AppIndicator/StatusNotifier quando disponivel;
  - fallback: janela normal sem tray, com autostart opcional.

Saida esperada:

- UI local abre, navega, faz login e chama `/api/runtime/local-session`.

## Fase 3 - Backend desktop Linux

Objetivo: empacotar e validar o servidor local Node no Linux.

Trabalho:

- Empacotar Node Linux ou declarar dependencia clara.
- Bundlar `desktop-local-server.cjs` com esbuild para Linux.
- Empacotar native modules Linux, especialmente `better-sqlite3-multiple-ciphers`.
- Empacotar `DrakonSite/dist`.
- Empacotar seed SQLite schema-only em `runtime/bootstrap`.
- Ajustar paths:
  - config sistema: `/etc/perceptrum`.
  - binarios/app: `/opt/perceptrum`.
  - dados usuario: `~/.local/share/PerceptrumData` ou `XDG_DATA_HOME`.
  - logs usuario: `~/.local/state/perceptrum` ou dentro do session dir.
- Validar `APP_SQLITE_ENCRYPTION=required` com key Linux.

Saida esperada:

- `/api/runtime/health` retorna `ready=true` com SQLite criptografado.
- SPA e media local funcionam sem servidor externo.

## Fase 4 - Segredos e storage Linux

Objetivo: evitar regressao de seguranca versus DPAPI.

Trabalho:

- Implementar keystore Linux para:
  - `exe_token.txt`;
  - `client_id.txt`;
  - `exe_id.txt`;
  - `paired_timezone.txt`;
  - `sqlite_key_v1.txt`.
- Opcoes:
  - libsecret/Secret Service como padrao desktop.
  - fallback arquivo 0600 + chave derivada do usuario apenas se aprovado.
- Garantir permissao 0700 nos diretorios de sessao/storage.
- Migrar plaintext antigo com quarentena e regravacao protegida.

Saida esperada:

- Tokens e SQLite key nao ficam em texto simples por padrao em ambiente desktop Ubuntu.

## Fase 5 - Agente e systemd

Objetivo: definir lifecycle robusto do agente no Linux.

Decisao a tomar:

- `systemd --user`: melhor para app desktop por usuario, herda sessao e storage do usuario.
- `system` service: util para captura continua sem login, mas exige modelo claro de usuario, permissoes e storage.

Recomendacao inicial:

- MVP desktop: `systemd --user` ou processo filho gerenciado pelo LinuxHost.
- Servico sempre-on: opcional em pacote separado ou modo avancado.

Trabalho:

- Criar unit `perceptrum-agent.service`.
- Exportar `APP_BASE_URL`, `APP_SERVICE_SESSION_DIR`, `SYSTEM_ACTIVITY_LOG_PATH`.
- Integrar restart policy, logs journal e graceful shutdown.
- Validar pareamento depois de login e restart do agente.

Saida esperada:

- Agente reinicia apos crash e respeita logout/uninstall.

## Fase 6 - Empacotamento Debian/Ubuntu

Objetivo: produzir `.deb` instalavel e atualizavel.

Trabalho:

- Restaurar `linux/debian/postinst`, `prerm`, `postrm`, `conffiles`.
- Instalar:
  - `/opt/perceptrum/bin/perceptrum-desktop`;
  - `/opt/perceptrum/bin/perceptrum-agent`;
  - `/opt/perceptrum/ui`;
  - `/opt/perceptrum/bin/runtime`;
  - `/usr/bin/perceptrum-desktop` launcher;
  - `/usr/share/applications/perceptrum.desktop`;
  - `/usr/share/icons/hicolor/...`;
  - `/etc/perceptrum/brand.config.json`.
- Declarar dependencias:
  - `ffmpeg`;
  - `libgtk-3-0`;
  - `libwebkit2gtk-4.1-0`;
  - `libsoup-3.0-0`;
  - `systemd`;
  - libs Node/native necessarias se nao forem vendorizadas.
- Definir upgrade sem destruir dados usuario.

Saida esperada:

- `apt install ./perceptrum-desktop_1.0.0_amd64.deb` instala e inicia.
- `apt remove` remove servicos/binarios sem apagar dados usuario por padrao.
- `apt purge` remove configuracao de sistema, nao dados usuario sem confirmacao explicita.

## Fase 7 - Validacao funcional

Cenarios obrigatorios:

1. Instalar pacote em Ubuntu limpo.
2. Abrir app pelo launcher.
3. Healthcheck pronto.
4. Login Google/local.
5. Provisionar agente.
6. Descobrir cameras.
7. Cadastrar camera RTSP.
8. Gerar thumbnail.
9. Criar agente de camera.
10. Executar job simples.
11. Rodar chat com consulta operacional.
12. Reiniciar maquina/sessao e preservar estado.
13. Desinstalar e validar cleanup.

## Cronograma sugerido por milestones

### M0 - Reprodutibilidade

- Restaurar CMake/Linux.
- Build limpo em Ubuntu dev.
- Pacote `.deb` basico.

### M1 - Shell e backend

- LinuxHost abre UI.
- Backend local inicia e healthcheck passa.
- Static assets e media servidos.

### M2 - Sessao e agente

- Local session bridge funciona.
- Agente headless sobe e conecta ao backend.
- Shutdown/restart validado.

### M3 - Cameras/jobs

- Camera discovery.
- Captura RTSP.
- Thumbnails/eventos.
- Jobs simples e alertas.

### M4 - Seguranca e packaging

- Secrets Linux protegidos.
- SQLite criptografado.
- systemd e Debian scripts robustos.
- Upgrade/uninstall.

### M5 - Hardening

- CI Linux.
- Testes automatizados.
- Matriz Ubuntu.
- Documentacao operacional.

## Decisoes pendentes

- Ubuntu alvo minimo.
- GTK3/WebKitGTK 4.1 mantido ou migrar para GTK4/WebKitGTK 6.
- Node vendorizado no pacote ou dependencia externa.
- Modo agente: processo filho, systemd user ou systemd system.
- Keyring obrigatorio ou fallback arquivo 0600.
- Tray obrigatorio ou opcional.
- Manter Drakon e Perceptrum no mesmo pacote Linux ou pacote por marca.

## Criterio de pronto para iniciar implementacao

- Confirmar que arquivos Linux ausentes podem ser restaurados/criados.
- Congelar contrato host-backend-agente.
- Definir layout de dados/config/logs.
- Definir politica de secrets.
- Definir alvo Ubuntu e pipeline CI.
