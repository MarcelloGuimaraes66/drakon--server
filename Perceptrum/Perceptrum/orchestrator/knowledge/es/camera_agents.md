# Agentes de Camara

Cuando un usuario pregunta como crear un agente, la respuesta correcta depende del flujo deseado. Hoy existen dos lugares donde puede vivir la logica del agente.

## Los dos lugares donde se puede crear un agente

1. **AI Agents**: el agente se ejecuta directamente sobre una camara. Este es el lugar correcto para monitoreo continuo por camara sin schedules ni orquestacion de output entre camaras.
2. **Jobs / Steps**: el agente se ejecuta dentro de un step despues de agregar una camara como target. Este es el lugar correcto cuando el agente debe formar parte de un schedule, de un workflow de varias etapas o de una cadena de output entre camaras.

## Cual elegir

- Usa **AI Agents** cuando una camara deba vigilar continuamente.
- Usa **Jobs / Steps** cuando necesites schedules, dependencias, varias camaras u orquestacion de output entre etapas.
- Ambos lugares usan la misma idea base: definir que debe reconocer el agente, cuando debe alertar y que debe ignorar.

## Campos minimos obligatorios

- **Name**: un nombre claro para el agente.
- **Prompt core**: explica que debe reconocer el agente y en que circunstancias.
- **Alert condition**: define la condicion exacta que debe disparar una alerta.

## Guias y filtros opcionales

- **Targets**: puedes definir targets especificos para el analisis.
- **Face targets**: puedes agregar fotos de rostros cuando el escenario depende de reconocer a una persona especifica.
- **Negative condition**: describe que no debe disparar una alerta.
- **Negative reference images**: agrega referencias negativas cuando el modelo necesita ejemplos mas claros de lo que debe ignorar.

## Enhance Prompt with AI

- En el editor del agente de camara existe un boton llamado **Enhance Prompt with AI**.
- Analiza el prompt actual del usuario junto con la preview mas reciente o el snapshot transmitido de esa camara.
- El objetivo es construir una sugerencia de prompt mas completa y detallada que refuerce mejor la intencion del usuario y reduzca falsos positivos.
- El boton mejora la sugerencia de texto, pero el usuario aun debe revisar el resultado antes de aplicarlo.

## Modelo y cadencia de alertas

- **Ultra**: menor latencia y puede emitir alertas cada 10 segundos.
- **Core**: capa gratuita, mayor latencia y cadencia fija de alertas de 60 segundos.
- Elige **Ultra** cuando el escenario necesite reaccion mas rapida.
- Elige **Core** cuando 60 segundos sean aceptables y el menor costo importe mas.

## Video packaging

- **High resolution**: envia los frames en su tamano original.
- **Standard resolution**: envia la imagen alrededor de 4x mas pequena.
- **Compact resolution**: envia la imagen alrededor de 6x mas pequena.
- Los modos mas pequenos reducen el uso de input tokens, pero tambien pueden reducir la calidad del analisis.
- Los objetos pequenos analizados en **Compact resolution** pueden generar mas falsos positivos o falsos negativos.

## Input type

- **Video**: envia una secuencia de frames. Usalo cuando el modelo deba entender acciones cortas, movimientos rapidos o contexto temporal breve.
- **Image**: envia snapshots. Con cadencia de 10 segundos, envia un snapshot cada 10 segundos; con 60 segundos, envia uno cada 60 segundos.
- **Image + 10s** suele ser una combinacion fuerte cuando el analisis temporal corto no es necesario, porque normalmente cuesta menos tokens que video y aun mantiene buena cobertura.
- Regla practica: usa **Video** para movimiento corto y acciones rapidas; usa **Image** cuando snapshots periodicos sean suficientes.

## Poligonos y regiones con movimiento como gatillo

- En la esquina superior izquierda del editor, el usuario puede crear poligonos con nombre.
- El programa envia inferencia solo cuando ocurre movimiento dentro de uno de esos poligonos.
- Esto permite analizar solo cuadrantes o regiones especificas de la escena en lugar del frame completo todo el tiempo.

## Flujo tipico en AI Agents

1. Abre **AI Agents**.
2. Elige la camara.
3. Abre la pagina **Configure AI Agents / Algorithms** de esa camara.
4. Haz clic en **Create Custom AI Agent**.
5. Completa **Name**, **Prompt core** y **Alert condition**.
6. Si hace falta, agrega targets, fotos de rostro, condiciones negativas e imagenes negativas.
7. Elige el modelo, la cadencia, el input type y el modo de **Video packaging**.
8. Crea poligonos si el analisis debe observar solo regiones especificas.
9. Guarda y habilita el agente.

## Flujo tipico en Jobs / Steps

1. Abre **Jobs**.
2. Crea o edita el job.
3. Crea un **step**.
4. Agrega la camara como target dentro de ese step.
5. Abre el editor del agente del step.
6. Configura **Name**, **Prompt core**, **Alert condition** y las mismas opciones visuales y de ejecucion usadas por los agentes de camara.
7. Usa este camino cuando el agente pertenezca a un schedule o a un workflow que coordine varias camaras o etapas.

## Nota sobre la Etapa 3 del tutorial

- El tutorial guiado usa el camino continuo por camara de **AI Agents**.
- La Etapa 2 crea la camara del tutorial desde la pagina **Cameras**, pero los mismos puntos de entrada de registro tambien existen en **AI Agents**.
- Despues de que existe la camara del tutorial, la Etapa 3 abre la pagina **Algorithms** de esa camara y crea ahi un custom AI agent.
- El agente de ejemplo se llama **thumbs up detector**. En la copy de la interfaz en portugues, el mismo ejemplo aparece como **detector de afirmativo**.
- El preset del tutorial usa:
  - **Prompt core**: reconocer a cualquier persona haciendo el gesto de afirmativo o thumbs up con la mano.
  - **Alert condition**: alertar si cualquier persona esta haciendo el gesto de afirmativo o thumbs up con la mano.
- Si **OpenAI** esta disponible, el tutorial prefiere **Ultra**, **Video**, **High resolution**, **10-second cadence** y **1 FPS**.
- Si solo **Z.ai** esta configurado, el tutorial usa **Core**. **High resolution** sigue seleccionada, pero la app mantiene la **60-second cadence** fija de Core.
- El tutorial explica primero el selector de **model** y justo despues el selector de **input type** como dos pasos destacados separados.
- Despues de guardar el agente, el tutorial vuelve a la pagina **Algorithms** de la camara para explicar el toggle que habilita o pausa ese agente en esa camara.
- La ultima accion guiada vuelve a **AI Agents** e inicia el servicio de la camara del tutorial para que el usuario pueda probar de inmediato el detector de afirmativo.

## Regla practica

- Elige **AI Agents** para un vigilante continuo y directo sobre una sola camara.
- Elige **Jobs / Steps** cuando el agente deba estar agendado o integrado con otras camaras, steps u outputs.
