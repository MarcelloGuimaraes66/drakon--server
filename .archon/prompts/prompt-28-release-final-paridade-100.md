# Prompt 28 - Release final e matriz de paridade 100%

Objetivo:
Fechar a refatoracao completa com matriz de paridade Windows/Linux, runbook final, pacote final e lista zero-surpresa do que ainda depende de ambiente externo.

Contexto obrigatorio:
- Leia `.archon/plans/relatorio-fase27-aceite-real-camera-llm-sistema-completo.md`.
- Leia todos os relatorios das fases 17 a 27.

Restricoes:
- Nao fazer push.
- Nao declarar "100%" se camera real, LLM real ou Windows WebView2 nao foram realmente testados.
- Nao esconder falhas em relatorio.
- Nao apagar backups criados nas fases anteriores.

Tarefas:
1. Rodar a bateria final Linux:
   - tests web;
   - build web;
   - CMake Debug/Release;
   - CTest Debug/Release;
   - visual Linux;
   - package `.deb`;
   - smoke do launcher.
2. Gerar matriz de paridade:
   - UI visual;
   - backend local;
   - secure store;
   - logging;
   - camera discovery;
   - camera capture RTSP/Webcam;
   - frame writer/recordings;
   - jobs;
   - LLM OpenAI/Z.ai;
   - shared camera;
   - workspace/access;
   - packaging Windows/Linux.
3. Atualizar `RUNBOOK-LINUX.md` com:
   - instalar dependencias;
   - rodar dev;
   - instalar `.deb`;
   - configurar secret-tool;
   - configurar camera real;
   - configurar OpenAI/Z.ai;
   - comandos de diagnostico;
   - onde ficam logs, banco, thumbnails, clips e relatorios.
4. Criar comandos Archon/CLI finais para o usuario testar no desktop Ubuntu.
5. Deixar o repo em estado explicavel: branch atual, status git, pacote gerado, testes passados e pendencias reais.

Validacao obrigatoria:
```bash
git status --short --branch
cd DrakonSite && npm run test:platform-boundaries && npm run test:local-sqlite-bootstrap && npm run test:semantic && npm run build && npm run visual:linux
cd Perceptrum && cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug && cmake --build out/build/linux-debug -j$(nproc) && ctest --test-dir out/build/linux-debug --output-on-failure
cd Perceptrum && cmake -S . -B out/build/linux-release -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build out/build/linux-release -j$(nproc) && ctest --test-dir out/build/linux-release --output-on-failure
```

Saida esperada:
- Criar `.archon/plans/relatorio-fase28-release-final-paridade-100.md`.
- Atualizar `RUNBOOK-LINUX.md`.
- Se tudo real tiver sido validado, declarar pronto para teste do usuario. Se nao, declarar exatamente o que falta por ambiente externo.
