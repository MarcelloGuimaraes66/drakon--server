# Jobs

Usa **Jobs** cuando quieras un workflow programado o repetible en lugar de una solicitud puntual en el chat.

## Que es un job

Un job es el contenedor principal del workflow. Define cuando debe ejecutarse el flujo, durante cuanto tiempo la agenda permanece activa y como se divide el trabajo en steps.

Un job no realiza por si solo el analisis detallado de camaras. En el modelo actual del producto, la ejecucion real sucede dentro de los steps. Las camaras se agregan a los steps como targets, y la logica del agente se configura dentro del contexto de cada step.

## Para que sirven los jobs

- Revisiones nocturnas u horarias de areas seleccionadas.
- Chequeos repetitivos de seguridad que deben ejecutarse automaticamente.
- Workflows con varias camaras y varias etapas.
- Automatizaciones estructuradas que no dependen de que una persona escriba en el chat.
- Flujos supervisados de recepcion, transferencia, almacenamiento, produccion y despacho.
- Verificacion de que un item, vehiculo o equipo paso por las etapas esperadas en el orden correcto.
- Workflows de control gerencial, como cumplimiento de ruta, confirmacion de entrega, revision de filas, validacion de destino, tiempo de ejecucion y revision de excepciones.
- Casos donde el resultado importante no es solo detectar algo, sino confirmar secuencia, destino, demora o falta de handoff.

## Partes principales de un job

- **Name**: identifica el workflow con claridad.
- **Description**: explica el objetivo operativo o de negocio.
- **Schedule**: controla cuando se ejecuta el workflow. En el flujo actual del producto, los jobs recurrentes usan modos como `weekly`, `monthly` o `yearly`, con ventanas horarias.
- **Active range**: controla desde que fecha la agenda recurrente es valida y hasta cuando permanece activa.
- **Steps**: definen las etapas reales del trabajo dentro del job.
- **Step targets**: definen que camaras o fuentes se inspeccionan en cada step.
- **Step agents and alerts**: definen como cada step analiza evidencia y que debe pasar cuando se cumple una condicion.

## Flujo tipico

1. Abre **Jobs**.
2. Crea un nuevo job.
3. Dale un nombre claro y, si hace falta, una descripcion corta.
4. Configura el schedule mode, los dias, las ventanas horarias y el rango activo.
5. Crea uno o mas steps.
6. Para cada step, define orden y timeout.
7. Para cada step, agrega las camaras target.
8. Para cada step o target, adjunta el agente o el comportamiento de prompt adecuado.
9. Si hace falta, agrega start conditions, pipeline inputs, logica agrupada de varias camaras o alerts.
10. Guarda y activa el job.

## Ejemplos practicos

Ejemplo 1: revision nocturna de perimetro.

- Nombre del job: `Revision nocturna de perimetro`
- Agenda: todos los dias a las 11:00 PM, dentro de las ventanas recurrentes configuradas
- Steps: revision de entrada del perimetro, barrido del estacionamiento, revision del acceso trasero
- Objetivo: revisar personas o vehiculos fuera de horario y generar alertas solo cuando se cumpla la condicion configurada

Ejemplo 2: chequeo horario de recepcion.

- Nombre del job: `Chequeo de ocupacion de recepcion`
- Agenda: cada hora durante las ventanas de supervision comercial
- Steps: revision de ocupacion, revision de severidad de fila, seguimiento de acceso bloqueado
- Objetivo: identificar filas, saturacion o acceso bloqueado y crear evidencia operativa repetible

Ejemplo 3: verificacion supervisada de ruta de carga.

- Nombre del job: `Verificacion de recepcion a destino`
- Agenda: cada vez que empiece una ventana de recepcion, o en intervalos fijos de supervision
- Steps: confirmacion de recepcion, revision de ruta de transferencia, confirmacion de destino, revision de excepciones
- Targets: `Muelle de Recepcion`, `Corredor Interno`, `Area de Almacenamiento B`
- Objetivo: confirmar que una carga recibida fue descargada, paso por la ruta esperada y llego al destino correcto

Ejemplo 4: supervision de handoff operativo.

- Nombre del job: `Revision de cambio de turno`
- Agenda: al final de cada turno
- Steps: finalizacion del equipo saliente, revision de zona de handoff, toma del equipo entrante, revision de excepciones
- Targets: `Entrada de Produccion`, `Area de Empaque`, `Zona de Despacho`
- Objetivo: verificar si los pasos esperados del cambio de turno se completaron en secuencia y si alguna demora, desvio o material sin atencion requiere revision

## Cuando elegir un job en lugar de un camera agent

Elige un job cuando:

- necesitas una agenda estricta
- quieres varios steps
- necesitas logica diferente en varias camaras
- quieres un workflow estructurado en lugar de un observador continuo
- necesitas orden, tiempo, dependencias o validacion de destino
- quieres supervisar un proceso operativo o de negocio, no solo detectar un evento aislado
- quieres confirmar que algo comenzo en un punto y termino en el destino correcto
- necesitas evidencia visual para cumplimiento, calidad de ejecucion o manejo de excepciones en un flujo repetible
- quieres que una etapa dependa de otra, ya sea por secuencia, start condition o resultado compartido
