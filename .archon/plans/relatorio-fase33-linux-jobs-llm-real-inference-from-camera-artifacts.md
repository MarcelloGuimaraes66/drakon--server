# Relatorio fase 33 - Linux jobs LLM real com artefatos de camera

Data: 2026-05-27
Repositorio: `/home/marcello-guimaraes/dev/perceptrum_desktop_aspp`
Executor: Codex/gpt-5.5
Commit/push: nao realizado

## Objetivo

Conectar `job_start` no Linux aos artefatos reais produzidos por sessoes de camera e permitir chamada LLM real quando houver chave configurada, mantendo provider fake apenas para testes/solicitacao explicita.

## Referencias lidas

- Relatorios das fases 29, 30, 31 e 32.
- `Perceptrum/Perceptrum/jobs/JobRuntime.cpp`
- `Perceptrum/Perceptrum/core/AgentCore.cpp`
- `Perceptrum/Perceptrum/orchestrator/LocalLlmClient.cpp`
- `Perceptrum/Perceptrum/orchestrator/ChatModelConfig.cpp`
- `Perceptrum/linux/LinuxJobRuntime.cpp`
- `Perceptrum/linux/LinuxCameraSessionManager.*`
- `Perceptrum/linux/LinuxFrameDiskWriter.cpp`
- `DrakonSite/src/worker/index.ts`

## Implementacao

- `LinuxJobRuntime` agora coleta, por camera do `job_start`:
  - ultimo thumbnail em `cache/agentcore/camera-thumbnails/<camera_id>-latest.jpg`;
  - ultimos clips `10s`, `60s` e `300s` em `data/frames/cam_<camera_id>/...`;
  - root de `jobs-inference-temp`.
- O resultado fake passa a registrar `input_artifacts` e grava JSON em `jobs-inference-temp`, consumindo os artefatos sinteticos reais dos testes.
- Provider real:
  - `PERCEPTRUM_LINUX_LLM_PROVIDER=openai` usa OpenAI e exige `OPENAI_API_KEY` ou chave no payload.
  - `PERCEPTRUM_LINUX_LLM_PROVIDER=zai` usa Z.ai e exige `ZAI_API_KEY` ou chave no payload.
  - sem provider explicito, o runtime escolhe OpenAI/Z.ai quando chaves estiverem disponiveis.
  - `PERCEPTRUM_LINUX_LLM_PROVIDER=fake` preserva o caminho local sem rede.
- A chamada real envia o thumbnail recente como imagem para o endpoint chat-completions compativel e inclui metadados dos clips no prompt. Base64 de imagem nao e gravado em logs.
- A inferencia concluida e publicada ao backend como evento `job_agent_completed`, com `job_run_id`, `step_run_id`, `agent_run_id`, provider/model, resposta, decisao e `input_artifacts`, permitindo persistencia estruturada via contrato operacional existente.
- `RUNBOOK-LINUX.md` agora documenta configuracao OpenAI/Z.ai, como perguntar para camera e onde ver artefatos/logs.

## Testes adicionados/ajustados

- `linux_job_runtime_polls_commands_and_posts_fake_inference`
  - valida fake provider;
  - valida `input_artifacts`;
  - valida `latest_thumbnail`;
  - valida evento `job_agent_completed`;
  - valida clips sinteticos gerados pela sessao de camera.
- `linux_job_runtime_real_provider_without_key_fails`
  - roda com `PERCEPTRUM_LINUX_LLM_PROVIDER=openai`;
  - remove `OPENAI_API_KEY`/`ZAI_API_KEY` do ambiente;
  - espera falha `missing_openai_api_key`;
  - nao faz chamada de rede LLM.
- `linux_job_runtime_real_provider_openai_manual`
  - teste CTest desabilitado por padrao;
  - so deve ser habilitado manualmente com `OPENAI_API_KEY`;
  - pode gastar credito LLM real.

## Validacao executada

```bash
(cd Perceptrum && cmake --build out/build/linux-debug -j$(nproc))
(cd Perceptrum && ctest --test-dir out/build/linux-debug -R 'job|llm|inference|camera' --output-on-failure)
(cd DrakonSite && npm run build)
```

Resultados:

- `cmake --build`: passou.
- `ctest -R 'job|llm|inference|camera'`: passou, 5/5 executados; 1 teste manual real ficou `Disabled`.
- `npm run build`: passou.

## O que foi testado com fake

- Captura sintetica `lavfi` para thumbnail e clips.
- `job_start` localizando artefatos reais em disco.
- Resultado fake persistido em `jobs-inference-temp`.
- Publicacao de evento `job_agent_completed` para o backend/mock.

## O que exige chave real

- Inferencia OpenAI real com imagem recente da camera.
- Inferencia Z.ai real.
- Teste manual `linux_job_runtime_real_provider_openai_manual`, que permanece fora da suite automatica padrao para evitar gasto acidental.

## Observacoes

- Nenhuma OpenAI API key, Z.ai API key, token ou imagem base64 foi registrada neste relatorio.
- Nenhum commit foi feito.
- Nenhum push foi feito.
