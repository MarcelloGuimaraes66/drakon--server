# Orquestacion de Jobs

Usa esta guia cuando el usuario no este preguntando solo "como creo un job?", sino como disenar un workflow con varios steps, camaras, tiempos, validacion y reutilizacion de respuestas anteriores.

Este tema debe ayudar a otro chat a proponer varios disenos validos de job en lugar de reducir todo a un unico ejemplo de conteo.

## Lo que el producto puede hacer

Los jobs en Perceptrum no se limitan a analisis aislados por camara.

El producto puede:

- programar workflows recurrentes;
- dividir el analisis en varios steps;
- asociar una o varias camaras a cada step;
- iniciar steps por secuencia, hora absoluta, demora relativa o resultado de un step anterior;
- inyectar respuestas previas en steps posteriores mediante pipeline;
- consolidar evidencia de varias camaras en un step validador;
- disparar alertas solo despues de que se evalua una regla final de negocio.

## Regla maestra para responder

No saltes directo a una unica forma de workflow.

Cuando alguien pida ayuda con un job complejo:

1. identifica el objetivo real de negocio;
2. decide si el caso corresponde a `AI Agents` continuos o a `Jobs / Steps` programados;
3. elige la topologia del workflow;
4. separa los steps colectores de los steps de decision;
5. define un contrato de respuesta estable para reutilizar en pipeline;
6. coloca la alerta final en el step que toma la decision final.

Cuando haya mas de una topologia valida, ofrece alternativas y explica el tradeoff entre simplicidad, robustez y costo.

## Componentes que forman la orquestacion

### Camera

Recurso registrado que luego reutilizan los jobs. Un job consume camaras existentes en lugar de crearlas desde cero.

### Job

Contenedor del workflow programado. Define la agenda y el periodo activo.

Campos importantes:

- `name`
- `description`
- `schedule_mode`
- `schedule_days`
- `active_from`
- `active_until`

### Step

Una etapa logica dentro del workflow.

Campos importantes:

- `step_order`
- `name`
- `timeout_seconds`

Nota importante del runtime:

- el timeout minimo efectivo es `120` segundos.

### Target

La camara asociada a un step.

Orden practico:

1. crea el step;
2. agrega la camara como target;
3. configura el agente de ese target.

### Agent

La configuracion de inferencia para un target dentro de un step.

Campos importantes:

- `agent_key`
- `prompt_template`
- `alert_condition`
- `negative_condition`
- `input_type`
- `video_packaging_mode`
- `inference_model`
- `run_every`
- `only_capture_on_motion`
- `use_temporal_context`
- `analysis_regions`

### Start Condition

Controla cuando se permite iniciar un step.

Modos relevantes en el proyecto:

- `sequential`
- `time`
- `elapsed`
- `positive`
- `negative`
- `custom`

### Pipeline

Define como las respuestas previas se inyectan en steps posteriores.

El pipeline se configura en el step de destino, no en el de origen.

### Alert

Regla de entrega de la decision final. El alerta normalmente debe quedar en el step que toma la decision final de negocio.

### Inference Groups

Son utiles cuando varios targets del mismo step comparten la misma regla y el mismo tiempo, y no hace falta pipeline entre steps.

## Como elegir la topologia correcta

Antes de llenar formularios, responde estas preguntas:

1. Es monitoreo continuo de una sola camara o un workflow programado?
2. Cuantos puntos de evidencia participan?
3. Todas las camaras observan la misma ventana o ventanas distintas?
4. La respuesta final depende de comparacion, secuencia o condicion?
5. El output de un step debe convertirse en input de otro?
6. El alerta debe salir en la primera senal o solo despues de la consolidacion final?

Si el caso es monitoreo continuo para una sola camara, prefiere `AI Agents`.

Si el caso requiere coordinacion entre camaras, tiempos, validacion o reutilizacion de respuestas, prefiere `Jobs / Steps`.

## Patrones recomendados

### Auditoria simple en una sola camara

Usalo cuando:

- hay una sola camara;
- el objetivo es correr en una agenda;
- no hay dependencia entre etapas.

Forma tipica:

- un job;
- un step;
- uno o mas targets en ese mismo step;
- alerta en ese mismo step.

### Colectores paralelos mas validador final

Usalo cuando varias camaras observan la misma ventana de tiempo y la respuesta final depende de comparar sus resultados.

Forma tipica:

- step colector para camara A;
- step colector para camara B;
- step validador final que empieza despues de la ventana de recoleccion.

### Cadena secuencial

Usala cuando una etapa solo debe correr despues de otra, o cuando el proceso representa una ruta o una secuencia ordenada.

### Investigacion condicional

Usala cuando una etapa posterior solo debe ejecutarse si una etapa anterior encuentra una senal especifica.

### Consolidacion muchos a uno

Usala cuando varios steps alimentan evidencia hacia un solo validador final.

### Agrupacion multi-target en el mismo step

Usa un solo step con varios targets o inference groups cuando varias camaras compartan la misma regla y el mismo tiempo, y no necesites pipeline entre steps.

## Guia de Start Condition

Uso tipico:

- `time` para colectores paralelos o para un validador que empieza en `T + ventana`;
- `positive`, `negative` o `custom` cuando el step siguiente depende de una clave de respuesta previa;
- `elapsed` para logica de demora relativa;
- `sequential` cuando el orden natural ya basta.

## Guia de Pipeline

Cada fila de pipeline conecta:

- step de origen;
- target o clave de origen;
- target de destino.

Comportamiento importante del runtime:

- el runtime inyecta principalmente el `answer` anterior;
- por eso los steps downstream deben esperar salidas upstream estables y faciles de parsear;
- la logica final de negocio sigue perteneciendo al prompt downstream.

## Regla del contrato de prompt

Los steps colectores deben producir respuestas cortas y deterministicas, por ejemplo:

```text
STEP_RESULT step_role=<collector> camera=<name> status=<fixed_value> value=<short_value> evidence=<short_text>
```

Los steps validadores deben empezar desde `PIPELINE_INPUTS` y devolver una decision final, por ejemplo:

```text
VALIDATION_RESULT status=<OK_or_ALERT> reason=<short_text> action=<short_text>
```

Si otro step va a reutilizar el output, evita respuestas narrativas largas y prefiere una estructura estable con vocabulario controlado.

## Restricciones reales del proyecto

- el primer step normalmente comienza junto con el job;
- el timeout minimo efectivo del step es `120` segundos;
- la creacion de jobs en la UI se basa en agenda recurrente;
- las alertas dependen de `alert_condition=true` en la salida de inferencia;
- `Ultra` es mas seguro para workflows complejos y de menor latencia;
- `Core` es mas limitado y mas lento.

## Mapa de referencias del codigo

UI y formularios:

- `DrakonSite/src/react-app/pages/Jobs.tsx`

Rutas del backend:

- `DrakonSite/src/worker/index.ts`

Scheduler y armado del payload:

- `DrakonSite/src/worker/jobScheduler.ts`

Parse del payload:

- `Perceptrum/Perceptrum/jobs/JobPayloadParser.cpp`

Comportamiento del runtime:

- `Perceptrum/Perceptrum/jobs/JobRuntime.cpp`

Ruteo del tema en chat:

- `Perceptrum/Perceptrum/orchestrator/skills/ExplainAppSkill.cpp`
- `Perceptrum/Perceptrum/orchestrator/KnowledgeBase.cpp`

## Como debe responder otro chat

Para pedidos de workflows complejos, el chat debe:

1. proponer la topologia correcta antes de llenar formularios;
2. ofrecer varias alternativas cuando exista mas de un diseno viable;
3. explicar camaras, steps, start conditions, pipelines, validadores y alertas como una arquitectura conectada;
4. evitar reducir el producto a un unico ejemplo de conteo cuando la solicitud sea mas amplia.
