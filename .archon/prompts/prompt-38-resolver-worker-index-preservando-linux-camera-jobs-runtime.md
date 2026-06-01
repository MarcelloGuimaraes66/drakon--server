# Prompt 38 - Resolver worker/index preservando Linux camera, jobs e runtime

Objetivo:
Resolver manualmente `DrakonSite/src/worker/index.ts`, incorporando as novidades do GitHub sem perder os endpoints e contratos criados para Ubuntu: agente residente, camera local `/dev/videoN`, RTSP, jobs, inferencia, gravacao de thumbnails/clips, gates de runtime e sessao local.

Contexto obrigatorio:
- Leia `.archon/plans/relatorio-fase36-preservar-porta-ubuntu-e-inventariar-novidades-github.md`.
- Leia `.archon/plans/relatorio-fase37-integrar-identidade-central-brand-e-shared-access.md`.
- Leia antes de editar:
  - `DrakonSite/src/worker/index.ts`
  - `DrakonSite/server/index.ts`
  - `AppHost/Runtime/desktop-local-server.mjs`
  - `DrakonSite/src/shared/linuxCameraStartContract.ts`
  - `DrakonSite/src/shared/cameraStartDiagnostics.ts`
  - `DrakonSite/src/worker/cameraRecordings.ts`
  - `DrakonSite/src/worker/env.d.ts`
  - `Perceptrum/linux-desktop/run-linux-dev.sh`
  - `RUNBOOK-LINUX.md`
- Leia o diff remoto de `DrakonSite/src/worker/index.ts` desde o merge-base registrado na fase 36.

Restricoes:
- Nao fazer commit.
- Nao fazer push.
- Nao usar reset/clean/restore destrutivo.
- Nao remover endpoints Linux existentes.
- Nao remover suporte a webcam local `WEBCAM -> /dev/videoN`.
- Nao remover suporte RTSP.
- Nao remover gravacao de thumbnails/clips/frames.
- Nao remover contratos de erro/status usados pela UI para sair de `reconnecting`.
- Nao publicar segredos.

Tarefas:
1. Fazer uma leitura comparativa de 3 fontes:
   - versao local atual de `worker/index.ts`;
   - versao de `origin/main`;
   - diff remoto desde o merge-base.
2. Trazer do GitHub para `worker/index.ts`:
   - header de brand;
   - preservacao de brand no refresh;
   - uso de `centralIdentityBrandHint.ts`;
   - melhorias de erro Google/central identity;
   - novas colunas de schema;
   - novos campos de shared jobs;
   - invalidacao/sincronizacao de sessao central quando aplicavel.
3. Preservar do Ubuntu:
   - endpoints de runtime local;
   - endpoints de agente residente;
   - camera start/stop/status/result;
   - contrato de diagnostico de start de camera;
   - leitura webcam `/dev/videoN`;
   - candidatos RTSP;
   - jobs/inferencia;
   - gravacao de camera;
   - SQLite local;
   - caminho de thumbnails/clips/logs.
4. Atualizar schema bootstrap com as novas colunas sem apagar dados locais.
5. Garantir que o backend local e o worker compartilhem os mesmos contratos.
6. Atualizar/adicionar testes de contrato quando o merge exigir.
7. Rodar testes de worker/backend/camera possiveis.

Validacao obrigatoria:
```bash
git status --short --branch
cd DrakonSite && npm run test:platform-boundaries
cd DrakonSite && npm run test:local-sqlite-bootstrap
cd DrakonSite && npm test -- linuxCameraStartContract
cd DrakonSite && npm test -- centralIdentityBrandHint
cd DrakonSite && npm run build
```

Se houver `/dev/video0` e o ambiente permitir:
```bash
ffmpeg -y -hide_banner -f v4l2 -framerate 15 -i /dev/video0 -frames:v 1 /tmp/perceptrum-worker-index-webcam-check.jpg
```

Saida esperada:
- Criar `.archon/plans/relatorio-fase38-resolver-worker-index-preservando-linux-camera-jobs-runtime.md`.
- O relatorio deve responder:
  - quais trechos do GitHub foram incorporados;
  - quais endpoints Linux foram preservados;
  - quais migrations/schema foram ajustados;
  - se o build web passou;
  - se camera/jobs seguem testaveis;
  - bloqueios restantes para UI/AppHost.

