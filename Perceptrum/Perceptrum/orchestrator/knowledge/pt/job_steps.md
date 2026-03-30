# Etapas de Job

Um step é o lugar onde o job vira execução real. Se o usuário perguntar como criar um agente dentro de um fluxo agendado, a resposta correta é: criar o step primeiro, adicionar a câmera como target e depois configurar o agente dentro desse step.

## Quando usar um agente de step em vez de AI Agents

- Use um agente de step quando a análise precisa seguir um schedule.
- Use um agente de step quando várias câmeras ou etapas precisam trabalhar juntas.
- Use um agente de step quando uma etapa depende de outra etapa, de timeout ou de output compartilhado.
- Use **AI Agents** quando uma única câmera só precisa de um observador contínuo fora de um workflow.

## Campos mínimos obrigatórios dentro do editor do agente do step

- **Name**: um nome claro para o agente do step.
- **Prompt core**: explique o que o agente do step deve reconhecer e em quais circunstâncias.
- **Alert condition**: defina a condição que deve disparar o alerta daquela etapa.

## Opções avançadas compartilhadas com agentes de câmera

- **Targets**: o step já precisa ter câmeras alvo, e o agente pode usar lógica específica por target.
- **Face targets**: fotos do rosto podem guiar o reconhecimento quando uma pessoa específica importa.
- **Negative condition**: define o que não deve gerar alerta.
- **Negative reference images**: dão ao modelo exemplos visuais mais claros do que deve ser ignorado.
- **Model**: **Ultra** suporta menor latência e alertas a cada 10 segundos; **Core** é mais lento e fixo em 60 segundos.
- **Video packaging**: **High resolution**, **Standard resolution** e **Compact resolution** trocam consumo de tokens por qualidade de análise.
- **Input type**: **Video** é melhor para ação curta e movimento; **Image** é melhor para snapshots periódicos.
- **Polygons**: polígonos nomeados podem limitar a inferência a movimento dentro de regiões específicas.

## Fluxo típico

1. Abra **Jobs**.
2. Crie ou edite o job.
3. Crie o **step**.
4. Adicione uma ou mais câmeras como targets dentro desse step.
5. Abra o editor do agente daquela etapa ou target.
6. Preencha **Name**, **Prompt core** e **Alert condition**.
7. Configure guias visuais, modelo, cadência, **Video packaging**, **Input type** e polígonos quando necessário.
8. Salve o step e ative o job.

## Regra prática

- Use um agente de step quando o agente faz parte de um schedule, de uma sequência ou de um workflow com várias câmeras.
- Use um agente em **AI Agents** quando a mesma lógica deve rodar continuamente sozinha em uma única câmera.
