# Relatorio fase 26 - Secure store, logging e packaging final Linux/Windows

Data: 2026-05-25 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Branch local: `archon/linux-port-origin-main-sync`
Push: nao realizado

## Objetivo

Fechar secure store, redacao de logs/health, interfaces runtime e empacotamento Linux/Windows depois da integracao completa.

## Contexto lido

- `.archon/plans/relatorio-fase25-fluent-ui-parity-pos-github-sync.md`
- `Perceptrum/Perceptrum/platform/platform_secure_store.cpp`
- `Perceptrum/Perceptrum/logging/Logging.cpp`
- `Perceptrum/linux`
- `Perceptrum/linux-desktop`
- `Perceptrum/CMakeLists.txt`
- `AppHost/Packaging`
- `AppHost/Runtime/desktop-local-server.mjs`

## Secure store Linux/Windows

- Linux continua usando Secret Service via `secret-tool` quando disponivel.
- O fallback plaintext continua fechado por padrao e so e aceito com `APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1` ou `PERCEPTRUM_ALLOW_PLAINTEXT_SECRET_RECOVERY=1`.
- O fallback plaintext escreve arquivo `0600`; a suite mantem teste cobrindo esse modo.
- DPAPI/Windows nao foi alterado.

## Logging e health

- `Logging.cpp` teve a lista de campos sensiveis ampliada para exe-token, access/refresh/session/grant tokens, workspace/relay tokens, cookies, authorization e OAuth client secret.
- `LinuxRuntimeLogger` agora redige mensagens antes de gravar `perceptrum-agent.log`.
- `agent_health.json` redige `base_url`, erros runtime, erros RTSP/job e campos de camera que possam carregar URL/segredo.
- Novo teste `agent_health_redacts_sensitive_urls` cobre userinfo de URL e `access_token` em health.

## Packaging Linux

- `.deb` agora declara:
  - `libcurl4`
  - `ffmpeg`
  - `nodejs`
  - `xdg-utils`
  - `libsecret-tools`
  - `dbus-user-session`
  - `libgtk-3-0` e `libwebkit2gtk-4.1-0` quando WebKitGTK esta compilado.
- `.deb` recomenda `gnome-keyring | kwalletmanager` para provider Secret Service.
- `CPACK_PACKAGE_DIRECTORY` foi fixado em `out/build/linux-release`, alinhando com os comandos de validacao.
- Permissoes instaladas foram endurecidas para evitar diretorios/arquivos group-writable em `/usr/share/perceptrum-desktop`; binarios, launcher, backend launcher e `.node` seguem executaveis.
- Payload validado inclui:
  - `/usr/bin/perceptrum-agent`
  - `/usr/bin/perceptrum-desktop`
  - `/usr/bin/perceptrum-desktop-launcher.sh`
  - `/usr/share/applications/perceptrum.desktop`
  - `/usr/share/perceptrum-desktop/web/index.html`
  - `/usr/share/perceptrum-desktop/backend/perceptrum-local-backend.sh`
  - runtime backend Node/SQLite empacotado.

## Windows AppHost

- AppHost packaging Windows foi inspecionado em `AppHost/Packaging/AppHost.iss`, `build.ps1` e `stage-runtime.mjs`.
- Nao foi adicionada dependencia Linux ao AppHost.
- O teste `linux_desktop_host_has_no_apphost_dependency` segue cobrindo que o host Linux nao referencia AppHost/WebView2/WinUI.

## Runbook

- `RUNBOOK-LINUX.md` foi atualizado com:
  - dependencias build/runtime;
  - fluxo `npm/cmake/ctest/cpack`;
  - inspecao do `.deb`;
  - install/run/remove;
  - contrato de secure store Secret Service;
  - fallback dev `APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1` e permissao `0600`;
  - orientacao para nao coletar segredos em logs/health.

## Validacao executada

Passou:

```bash
cd DrakonSite && npm run build
cd Perceptrum
cmake -S . -B out/build/linux-release -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build out/build/linux-release -j$(nproc)
ctest --test-dir out/build/linux-release --output-on-failure
cpack --config out/build/linux-release/CPackConfig.cmake
dpkg-deb --info out/build/linux-release/perceptrum-desktop_*.deb
dpkg-deb --contents out/build/linux-release/perceptrum-desktop_*.deb | grep -E 'perceptrum-(desktop|agent)|perceptrum-local-backend|index.html'
```

Resultados:

- `npm run build`: passou; Vite gerou `dist/assets/index-DGa4B93z.css` e `dist/assets/index-1bTrwAOP.js`.
- `cmake`: passou.
- `cmake --build`: passou; avisos conhecidos de `import.meta` no bundle CJS, `chdir` ignored result, `secret-tool` pipe write ignored result e API WebKitGTK deprecated.
- `ctest`: passou, 52/52.
- `cpack`: passou; gerou `out/build/linux-release/perceptrum-desktop_1.0.0_x86_64.deb` e `.tar.gz`.
- `dpkg-deb --info`: passou; `Depends` e `Recommends` conferidos.
- `dpkg-deb --contents ... | grep`: passou; binarios, backend launcher e `index.html` presentes.

Observacao: a primeira execucao de `ctest` expôs dois testes RTSP/recordings registrados mesmo com gates de compile desligados. Eles foram condicionados a `PERCEPTRUM_ENABLE_CAMERA_CAPTURE`, `PERCEPTRUM_ENABLE_RTSP_CAPTURE` e `PERCEPTRUM_ENABLE_FRAME_WRITER`, e a suite padrao passou em seguida.
