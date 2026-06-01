# Prompt 40 - Integrar AppHost Windows e packaging sem vazar WinUI

Objetivo:
Incorporar as novidades Windows-only vindas do GitHub em AppHost e packaging, preservando a separacao de plataformas: AppHost continua responsavel por Mica/titlebar/WebView2 no Windows, enquanto a UI React comum e o host Linux continuam sem dependencia WinUI.

Contexto obrigatorio:
- Leia `.archon/plans/relatorio-fase36-preservar-porta-ubuntu-e-inventariar-novidades-github.md`.
- Leia os relatorios das fases 37, 38 e 39.
- Leia antes de editar:
  - `AppHost/App.xaml.cpp`
  - `AppHost/App.xaml.h`
  - `AppHost/Pages/SiteHostPage.xaml.cpp`
  - `AppHost/Packaging/AppHost.iss`
  - `AppHost/Packaging/build.ps1`
  - `Perceptrum/CMakeLists.txt`
  - `Perceptrum/linux-desktop/main.cpp`
  - `Perceptrum/linux-desktop/run-linux-dev.sh`
  - `RUNBOOK-LINUX.md`
- Leia o diff remoto de AppHost/Packaging desde o merge-base da fase 36.

Restricoes:
- Nao fazer commit.
- Nao fazer push.
- Nao usar reset/clean/restore destrutivo.
- Nao alterar codigo Linux para depender de WinUI/WebView2.
- Nao alterar React comum para depender de AppHost.
- Nao quebrar CMake Linux.
- Nao publicar certificados, senhas, tokens ou chaves de assinatura.

Tarefas:
1. Integrar mudancas Windows-only do GitHub:
   - janelas auxiliares;
   - normalizacao de URL/titulo;
   - fluxo de navegacao no AppHost;
   - ajustes em `SiteHostPage`;
   - script `sign-windows-artifacts.ps1`;
   - atualizacoes de `build.ps1` e `AppHost.iss`.
2. Manter todo codigo WinUI dentro de `AppHost`.
3. Garantir que o build Linux ignore scripts Windows-only.
4. Confirmar que `Perceptrum/CMakeLists.txt` e Linux host continuam compilando.
5. Garantir que Windows packaging nao sobrescreva assets Linux ou caminhos XDG.
6. Atualizar documentacao quando necessario:
   - diferenciar comandos Windows/Linux/Mac;
   - registrar que assinatura Windows depende de credenciais externas.
7. Rodar validacoes possiveis no Ubuntu e registrar o que depende de uma maquina Windows.

Validacao obrigatoria no Ubuntu:
```bash
git status --short --branch
cd DrakonSite && npm run test:platform-boundaries
cd DrakonSite && npm run build
cd Perceptrum && cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug -DPERCEPTRUM_ENABLE_AGENT_CORE=ON -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON
cd Perceptrum && cmake --build out/build/linux-debug -j$(nproc)
cd Perceptrum && ctest --test-dir out/build/linux-debug --output-on-failure
```

Validacao documental para Windows:
- Listar os comandos que devem ser rodados em Windows para:
  - build AppHost;
  - WebView2;
  - installer;
  - assinatura, se houver certificado.

Saida esperada:
- Criar `.archon/plans/relatorio-fase40-integrar-apphost-windows-packaging-sem-vazar-winui.md`.
- O relatorio deve listar:
  - arquivos Windows atualizados;
  - garantias de isolamento de plataforma;
  - testes Linux executados;
  - validacoes Windows pendentes por ambiente;
  - riscos restantes para release final.

