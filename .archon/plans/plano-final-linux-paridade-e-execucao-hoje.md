# Plano final - Linux com paridade visual e execucao hoje

Data: 2026-05-24 (America/Manaus)
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`

## 1. Estado atual confirmado

Ja existe uma base Linux funcional no repositorio:

- `perceptrum-agent` compila e passa CTest.
- `perceptrum-desktop` compila com WebKitGTK quando `webkit2gtk-4.1` esta instalado.
- `DrakonSite/node_modules` existe.
- `DrakonSite/dist/index.html` existe.
- Node disponivel: `node v22.22.2`.
- npm disponivel: `10.9.7`.
- WebKitGTK disponivel: `webkit2gtk-4.1 2.52.3`.
- CTest atual passou com `46/46`.
- AppHost, `.vcxproj` e `.sln` continuam fora da refatoracao Linux.

Conclusao: neste Ubuntu, a entrega "rodar hoje" deve focar em abrir o mesmo build React dentro do host WebKitGTK local, com backend Node local e runtime minimo. A entrega "paridade completa" ainda exige fases posteriores para bridge nativa, empacotamento, camera/RTSP/jobs e AgentCore completo.

## 2. Definicao honesta de "rodar hoje"

Hoje deve ser possivel entregar:

- janela desktop Linux nativa via WebKitGTK;
- mesma UI React usada no Windows;
- backend local Node iniciado pelo host;
- SQLite local/bootstrap funcionando;
- pareamento/provisionamento local usando `RuntimePaths`;
- agente Linux minimo com health/status/logs;
- bateria visual browser/Linux para tema claro/escuro;
- comando unico ou runbook para o usuario abrir o app.

Hoje nao e realista prometer sem risco:

- AgentCore completo Linux;
- captura RTSP real;
- OpenCV/CameraSession completos;
- FrameDiskWriter completo;
- JobRuntime completo;
- paridade total de tray/autostart/installer final.

Esses pontos dependem de desacoplar fontes grandes com Win32/OpenCV/RTSP/jobs e entram nas fases 13 a 16.

## 3. Estrategia

Prioridade A - executar hoje:

1. Prompt 9: hardening do caminho de execucao local WebKitGTK.
2. Prompt 10: bridge nativa WebKitGTK/local session minima.
3. Prompt 11: paridade visual Fluent nas paginas internas e bateria visual.

Prioridade B - instalavel:

4. Prompt 12: empacotamento Linux dev/prod com dist, backend e launcher.

Prioridade C - runtime operacional:

5. Prompt 13: runtime local session + agente minimo integrado ao host.
6. Prompt 14: camera discovery e endpoints desktop locais.
7. Prompt 15: AgentCore/camera/RTSP/frame writer por gates.
8. Prompt 16: jobs/chat/validacao final e pacote instalavel.

## 4. Prompts criados

- `.archon/prompts/prompt-9-linux-run-today-webkit-local.txt`
- `.archon/prompts/prompt-10-linux-webkit-bridge-local-session.txt`
- `.archon/prompts/prompt-11-fluent-visual-parity-internal-pages.txt`
- `.archon/prompts/prompt-12-linux-packaging-dev-and-deb.txt`
- `.archon/prompts/prompt-13-linux-host-agent-session-integration.txt`
- `.archon/prompts/prompt-14-linux-camera-discovery-runtime.txt`
- `.archon/prompts/prompt-15-linux-agentcore-camera-rtsp-gates.txt`
- `.archon/prompts/prompt-16-linux-final-acceptance-and-release.md`

## 5. Como executar a partir daqui

Executar primeiro:

```bash
archon workflow run archon-assist --cwd "$PWD" --no-worktree \
"Leia e execute exatamente o prompt salvo em .archon/prompts/prompt-9-linux-run-today-webkit-local.txt. Use somente Codex/gpt-5.5. Nao faca commit. Nao faca push."
```

Se o prompt 9 passar, o objetivo do dia e abrir o app:

```bash
cd /home/marcello-guimaraes/dev/perceptrum_desktop_aspp
cd DrakonSite
npm run build
cd ../Perceptrum
cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build out/build/linux-debug -j$(nproc)
APP_STATIC_ROOT="$PWD/../DrakonSite/dist" \
PERCEPTRUM_WEB_SOURCE_DIR="$PWD/../DrakonSite" \
PERCEPTRUM_LINUX_WINDOW_MODE=webkit \
./out/build/linux-debug/perceptrum-desktop --webkit
```

## 6. Criterio de sucesso de hoje

- A janela WebKitGTK abre sem navegador externo.
- A URL carregada e `http://127.0.0.1:<porta>/dashboard`.
- O backend responde `200` em `/__perceptrum/health`.
- O React renderiza o dashboard com o mesmo build web do Windows.
- `perceptrum-agent status` funciona com roots em XDG ou `/tmp` quando configurado.
- Nenhum token aparece em logs, health, `data` ou `state`.
- `ctest` passa.

## 7. Criterio de conclusao completa

Sistema concluido quando:

- `.deb` instala em Ubuntu limpo.
- App abre pelo launcher desktop.
- UI visual em Linux corresponde ao Windows WebView2 no mesmo build React.
- Login/local session funciona.
- Pareamento/provisionamento do agente funciona.
- Camera discovery funciona.
- RTSP gera thumbnail.
- Jobs simples executam.
- Chat operacional consulta estado.
- Estado sobrevive restart.
- `apt remove`/`apt purge` tem comportamento definido.
- AppHost Windows continua intocado.
- React comum nao importa WinUI/WebView2/GTK.

## 8. Observacao sobre visual identico

A interface visual identica ao Windows deve vir do mesmo `DrakonSite/dist`, com os mesmos tokens Fluent e a mesma matriz de rotas/temas. O que nao deve ser "identico" e a moldura nativa do sistema operacional: Windows continua com AppHost/Mica/WebView2; Linux deve usar WebKitGTK com janela nativa propria.
