# Capacidades del Chat

El chat es el lugar más rápido para entender el producto, consultar el estado actual de la cuenta, buscar en video e iniciar acciones guiadas sin tener que saltar entre páginas.

## Para qué sirve el chat

- Explicar cómo funciona el producto, en qué página vive cada recurso y qué flujo conviene usar.
- Continuar trabajos en varias vueltas de conversación sin obligar al usuario a empezar de nuevo.
- Unir ayuda del producto, lectura de estado en vivo y acciones guiadas en un mismo lugar.

## Caminos especializados de capacidad

Detrás del comportamiento conversacional, el chat enruta la solicitud hacia capacidades especializadas. El usuario no necesita memorizar nombres internos, pero el comportamiento sí cambia según el tipo de pedido.

- Ayuda y onboarding del producto: explicar pairing, API keys, billing, registro de cámaras, AI Agents, Jobs, Steps, orchestration, visión general de la app y el propio chat.
- Lectura del estado actual: listar cámaras, jobs, agentes, saldos, configuraciones, ejecuciones recientes, historial operativo e identity cards persistidas cuando esos datos existen.
- Inspección de video e imagen: buscar en una o más cámaras, analizar una imagen o un video enviado y responder sobre grabaciones, eventos o detecciones usando la pipeline existente de búsqueda en video.
- Descubrimiento en la red local: ejecutar Scan Network desde el chat para encontrar cámaras, DVRs y NVRs, y resumir el resultado.
- Operaciones con cámaras: registrar una cámara, preparar un registro por lotes, editar una cámara, aplicar la misma edición a varias cámaras e iniciar o detener el runtime de una cámara existente.
- Operaciones con jobs: crear jobs programados y workflows de varios steps, editar un job existente e iniciar, detener, pausar o reanudar el runtime de un job.
- Operaciones con agentes: crear o editar agentes en una cámara o dentro de un step de job, incluyendo destino, cadencia, cambios de prompt, habilitar o deshabilitar, negative conditions y flujos con región visual cuando haga falta.
- Reportes: generar documentos descargables sobre estado actual, historial, detecciones, alertas, jobs, agentes, logs, comparaciones y contexto relevante del chat.
- Respuesta directa: cuando no hay una capacidad especializada mejor, el chat todavía puede responder de forma normal.

## Cómo maneja el chat el trabajo en varias vueltas

- Puede mantener una tarea activa a lo largo de varios mensajes en lugar de tratar cada mensaje como una solicitud nueva.
- Pide campos faltantes cuando la solicitud es accionable pero todavía está incompleta.
- Prefiere confirmar en vez de adivinar cuando el objetivo es ambiguo.
- Entiende continuaciones como `usa lo mismo para las 5`, `esa cámara`, `la misma dirección` o `ahora haz la versión del step`.
- En trabajos por lotes de cámaras, puede seguir reuniendo filas, valores compartidos y reglas de edición a lo largo de la conversación.

## Memoria y coherencia

- El chat usa dos tipos principales de memoria conversacional:
  1. turns recientes para continuidad inmediata.
  2. un contexto compacto para información más antigua y duradera.
- La memoria compacta guarda hechos duraderos como resumen, objetivos del usuario, restricciones, preferencias, entidades seleccionadas, decisiones y pendientes abiertos.
- Además, guarda memoria de tarea para la operación actual, incluyendo tarea activa, fase, objetivo, campos recogidos, campos faltantes y tareas recientes completadas.
- También conserva entidades de sesión importantes, como el último nombre o id relevante, para ayudar con follow-ups cortos.
- Cuando la conversación crece demasiado, los mensajes antiguos se compactan y solo los turns más recientes permanecen literales.
- Si el mensaje actual cambia claramente de tema, el mensaje actual prevalece sobre el contexto anterior.
- La memoria compacta no debe guardar secretos como contraseñas, API keys, tokens, RTSP URLs u otras credenciales privadas.

## Comportamiento de idioma

- El chat está estructurado para los idiomas de UI soportados: English, Portuguese, Spanish, French, Chinese y Arabic.
- Intenta responder en el idioma del usuario.
- Si el idioma del usuario no está soportado, hace fallback a English en vez de adivinar un idioma parecido.
- El knowledge puede caer internamente a English, pero la respuesta final todavía puede reescribirse en el idioma de respuesta del usuario.

## Guardrails y límites importantes

- El chat no debe inventar estado en vivo. Si la respuesta depende de inspección, debe consultar primero el estado real.
- El chat no debe inventar credenciales, IP, puerto, usuario, contraseña o dirección de cámara que el usuario no haya proporcionado.
- Algunas acciones dependen del runtime local conectado, de una sesión de chat válida, de datos existentes en la cuenta y de los permisos activos del producto.
- Las explicaciones del producto deben apoyarse en los documentos locales de knowledge cuando ese sea el camino más seguro.
- Las respuestas finales se pulen para seguir siendo concisas, enfocadas en el producto y sin detalles de implementación.

## Buenos ejemplos de pregunta

- `que puede hacer el chat?`
- `de que eres capaz aqui?`
- `lista los tipos de cosas en las que me ayuda el chat`
- `puedes inspeccionar mis camaras y jobs desde aqui?`
- `puedes crear o editar camaras, agentes y jobs?`
- `como mantienes el contexto entre mensajes?`
- `cuales son tus limites?`

## Regla práctica

- Usa el chat cuando el usuario quiera una de estas tres cosas:
  1. una explicación confiable sobre el producto.
  2. una lectura o búsqueda sobre estado actual, historial o video.
  3. una acción guiada que pueda continuar a lo largo de varios mensajes hasta ser confirmada o completada.
