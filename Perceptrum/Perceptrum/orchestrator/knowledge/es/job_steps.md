# Etapas de Job

Un step es donde un job se vuelve operativo. Si un usuario pregunta como crear un agente dentro de un workflow programado, la respuesta correcta es: primero crear el step, luego agregar la camara como target y despues configurar el agente dentro de ese step.

## Cuando usar un agente de step en lugar de AI Agents

- Usa un agente de step cuando el analisis debe seguir una agenda.
- Usa un agente de step cuando varias camaras o etapas deben trabajar juntas.
- Usa un agente de step cuando una etapa depende de otra etapa, de un timeout o de output compartido.
- Usa **AI Agents** cuando una sola camara solo necesita un observador continuo fuera de un workflow.

## Campos minimos obligatorios dentro del editor del agente del step

- **Name**: un nombre claro para el agente del step.
- **Prompt core**: explica que debe reconocer el agente del step y en que circunstancias.
- **Alert condition**: define la condicion que debe disparar la alerta para esa etapa.

## Opciones avanzadas compartidas con agentes de camara

- **Targets**: el step ya debe contener camaras target, y el agente puede usar logica especifica por target.
- **Face targets**: las fotos de rostros pueden guiar el reconocimiento cuando importa una persona especifica.
- **Negative condition**: define que no debe disparar la alerta.
- **Negative reference images**: le dan al modelo ejemplos visuales mas claros de lo que debe ignorar.
- **Model**: **Ultra** soporta menor latencia y alertas cada 10 segundos; **Core** es mas lento y fijo en 60 segundos.
- **Video packaging**: **High resolution**, **Standard resolution** y **Compact resolution** intercambian uso de tokens por calidad de analisis.
- **Input type**: **Video** es mejor para accion corta y movimiento; **Image** es mejor para snapshots periodicos.
- **Polygons**: los poligonos con nombre pueden limitar la inferencia al movimiento dentro de regiones especificas.

## Flujo tipico

1. Abre **Jobs**.
2. Crea o edita el job.
3. Crea el **step**.
4. Agrega una o mas camaras como targets dentro del step.
5. Abre el editor del agente a nivel de step para ese target o etapa.
6. Completa **Name**, **Prompt core** y **Alert condition**.
7. Configura guias visuales, modelo, cadencia, **Video packaging**, **Input type** y poligonos cuando haga falta.
8. Guarda el step y activa el job.

## Regla practica

- Usa un agente de step cuando el agente forme parte de una agenda, una secuencia o un workflow de varias camaras.
- Usa un agente en **AI Agents** cuando esa misma logica deba ejecutarse continuamente por si sola en una sola camara.
