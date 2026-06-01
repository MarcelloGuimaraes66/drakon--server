# Prompt 41 - Validacao final Linux com webcam, RTSP, LLM e packaging

Objetivo:
Validar a refatoracao completa depois da integracao das novidades do GitHub: o sistema deve rodar hoje no Ubuntu, preservar compatibilidade Windows/Mac, iniciar o agente residente, conectar webcam local, suportar RTSP, gravar artefatos, chamar LLM quando a chave estiver configurada e gerar pacote Linux testavel.

Contexto obrigatorio:
- Leia os relatorios das fases 36 a 40.
- Leia `RUNBOOK-LINUX.md`.
- Leia os scripts de dev/release Linux:
  - `Perceptrum/linux-desktop/run-linux-dev.sh`
  - `Perceptrum/CMakeLists.txt`
  - arquivos de packaging em `Perceptrum`
- Leia os contratos de camera/jobs:
  - `DrakonSite/src/shared/linuxCameraStartContract.ts`
  - `DrakonSite/src/shared/cameraStartDiagnostics.ts`
  - `DrakonSite/src/worker/cameraRecordings.ts`
  - arquivos `Perceptrum/linux/*Camera*`, `*Frame*`, `*Job*`, `*Rtsp*`.

Restricoes:
- Nao fazer commit.
- Nao fazer push.
- Nao usar reset/clean/restore destrutivo.
- Nao apagar banco, logs, frames, clips, thumbnails ou secrets do usuario.
- Nao imprimir API keys ou tokens.
- Nao declarar camera/LLM prontos sem evidencia real ou sem marcar dependencia externa.
- Se nao houver camera/RTSP/chave OpenAI, registrar exatamente a dependencia ausente.

Tarefas:
1. Rodar suite web:
   - platform boundaries;
   - sqlite bootstrap;
   - testes de identidade central/brand;
   - testes de camera start contract;
   - build.
2. Rodar CMake Debug e Release com gates ligados:
   - AgentCore;
   - Camera Capture;
   - RTSP Capture;
   - Frame Writer;
   - Job Runtime.
3. Rodar CTest Debug e Release.
4. Validar webcam real se `/dev/video0` existir:
   - permissao do device;
   - captura direta com `ffmpeg`;
   - start pela UI ou pelo backend/agente;
   - status online ou erro diagnostico claro;
   - thumbnail gerada;
   - clip/frame gravado em diretorio correto.
5. Validar RTSP se houver URL configurada:
   - candidato RTSP;
   - reconnect/backoff;
   - thumbnail/frame;
   - erro claro se a stream estiver indisponivel.
6. Validar LLM:
   - confirmar que a chave OpenAI existe no secure store/config sem imprimi-la;
   - fazer uma pergunta para camera com artefato real;
   - registrar se chamou LLM real ou se bloqueou por credencial/provider.
7. Gerar pacote Linux:
   - `.deb`;
   - `.tar.gz` se configurado.
8. Validar conteudo do pacote:
   - launcher desktop;
   - agente;
   - backend local;
   - build web;
   - assets necessarios;
   - scripts instalados.
9. Atualizar `RUNBOOK-LINUX.md`:
   - rodar dev;
   - instalar pacote;
   - testar webcam;
   - testar RTSP;
   - configurar OpenAI;
   - diagnosticar `reconnecting`;
   - localizar banco/logs/thumbnails/clips/frames.
10. Produzir matriz final Windows/Mac/Linux:
   - o que foi validado neste Ubuntu;
   - o que precisa ser validado em Windows;
   - o que precisa ser validado em Mac;
   - riscos conhecidos.

Validacao obrigatoria:
```bash
git status --short --branch
(cd DrakonSite && npm run test:platform-boundaries)
(cd DrakonSite && npm run test:local-sqlite-bootstrap)
(cd DrakonSite && npm test -- centralIdentityBrandHint)
(cd DrakonSite && npm test -- linuxCameraStartContract)
(cd DrakonSite && npm run build)
(cd Perceptrum && cmake -S . -B out/build/linux-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug -DPERCEPTRUM_ENABLE_AGENT_CORE=ON -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON)
(cd Perceptrum && cmake --build out/build/linux-debug -j$(nproc) && ctest --test-dir out/build/linux-debug --output-on-failure)
(cd Perceptrum && cmake -S . -B out/build/linux-release -G Ninja -DCMAKE_BUILD_TYPE=Release -DPERCEPTRUM_ENABLE_AGENT_CORE=ON -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON)
(cd Perceptrum && cmake --build out/build/linux-release -j$(nproc) && ctest --test-dir out/build/linux-release --output-on-failure)
(cd Perceptrum && cpack --config out/build/linux-release/CPackConfig.cmake)
```

Validacao real de webcam, se `/dev/video0` existir:
```bash
ffmpeg -y -hide_banner -f v4l2 -framerate 15 -i /dev/video0 -frames:v 1 /tmp/perceptrum-final-webcam.jpg
APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 ./Perceptrum/linux-desktop/run-linux-dev.sh
```

Consultas finais sugeridas:
```bash
find ~/.cache/Perceptrum/agentcore/camera-thumbnails -type f -printf '%TY-%Tm-%Td %TH:%TM:%TS %s %p\n' | sort | tail
find ~/.local/share/PerceptrumData/frames -type f -printf '%TY-%Tm-%Td %TH:%TM:%TS %s %p\n' | sort | tail
tail -200 ~/.local/state/Perceptrum/logs/perceptrum-agent.log
tail -200 ~/.local/state/Perceptrum/logs/perceptrum-desktop.log
```

Saida esperada:
- Criar `.archon/plans/relatorio-fase41-validacao-final-linux-webcam-rtsp-llm-packaging.md`.
- Atualizar `RUNBOOK-LINUX.md`.
- O relatorio final deve responder objetivamente:
  - o app abre no Ubuntu?
  - o agente residente sobe?
  - webcam local conecta?
  - RTSP foi validado ou depende de URL real?
  - thumbnails/clips/frames foram gravados?
  - pergunta para camera chamou LLM real?
  - pacote `.deb` foi gerado?
  - quais comandos o usuario deve rodar agora?
  - quais validacoes ainda dependem de Windows/Mac?

