# Registro de Camara

Los usuarios pueden registrar camaras tanto desde **Cameras** como desde **AI Agents**.

Para explicaciones y para el tutorial guiado, usa **Cameras** como pagina principal de ejemplo, pero deja claro que las mismas opciones de descubrimiento, importacion y registro manual tambien estan disponibles en **AI Agents**.

## Donde se pueden registrar las camaras

- **Cameras**
- **AI Agents**

Ambas paginas exponen los mismos tres caminos de entrada:

1. **Scan Network**
2. **Import Cameras**
3. **Register Camera** manualmente

## Formas mas rapidas de registrar camaras

### Scan Network

- **Scan Network** busca camaras y dispositivos **NVR/DVR** en la red local.
- Normalmente es la opcion mas facil cuando los dispositivos ya estan accesibles en la misma red.
- Si el usuario pregunta cual es el camino mas simple, recomienda este primero.

### Import Cameras

- **Import Cameras** acepta **Excel**, **CSV**, **JSON**, **TSV** y **plain text**.
- La IA local lee las columnas o los campos libres y registra las camaras automaticamente.
- Recomiendalo cuando el usuario ya tiene un inventario exportado, una hoja de calculo, una entrega del instalador o una lista de camaras de otro sistema.

## Registro manual de camara

Si el usuario quiere control total, puede hacer clic en el boton de registro manual en **Cameras** o en **AI Agents**.

El formulario manual permite elegir entre:

1. **IP / RTSP camera**
2. **Webcam**

## Flujo de camara IP / RTSP

Usa este flujo para camaras como **Hikvision**, **Dahua** e **Intelbras**.

El formulario cubre:

- **Camera name**
- **IP address**
- **RTSP port**
- **Manufacturer**
- **Connection method** como RTSP, HTTP u ONVIF
- **Username**
- **Password**
- **Channel**
- **Subtype**

Notas importantes por fabricante:

- En **Hikvision**, cambia **Channel** para acceder a otros canales.
- En **Intelbras**, usa **Subtype** para acceder a otros canales.

## Seccion de direccion

Despues de los campos de conexion, el formulario continua con la direccion de la camara.

- El flujo de direccion comienza con **ZIP code / CEP**.
- Despues de que el usuario ingresa el CEP, la app puede completar automaticamente **street**, **city** y **state**.
- El campo que normalmente aun necesita confirmacion manual es el **street number**.

## Retention

- **Retention** define durante cuanto tiempo los frames generados por esa camara permanecen almacenados en disco.
- Esto controla cuanto historial queda disponible para revisiones y busquedas posteriores.

## Uso compartido con colaboradores

- **Uso compartido con colaboradores** permite compartir la camara con colaboradores especificos invitados por `@handle` o email para que accedan a esa misma camara desde su propia cuenta.
- Explicalo como un uso compartido intencional con colaboradores, no como exposicion publica.

## Flujo de webcam

**Webcam** es el camino manual mas simple.

La webcam sigue usando los campos operativos compartidos:

- **Camera name**
- **Address**
- **Retention**
- **Uso compartido con colaboradores**

El principal campo especifico de la webcam es:

- **Webcam index**, que normalmente es `0`

A diferencia de las camaras IP / RTSP, las webcams no requieren:

- IP address
- port
- manufacturer
- username
- password
- channel
- subtype

## Lo que comparten ambos flujos manuales

Tanto **IP / RTSP** como **Webcam** comparten:

- camera name
- address
- retention
- uso compartido con colaboradores

La diferencia es que **IP / RTSP** necesita campos de transporte y del fabricante, mientras que **Webcam** normalmente solo necesita el indice de la webcam.

## Comportamiento del tutorial guiado para el registro de camara

Cuando el usuario pregunte sobre la etapa de camara del tutorial guiado:

- Explicalo usando la pagina **Cameras** como ejemplo visual.
- Tambien menciona que las mismas acciones estan disponibles en **AI Agents**.
- El tutorial primero resalta los accesos rapidos superiores:
  - **Scan Network**
  - **Import Cameras**
  - **Register Camera**
- Luego abre el formulario manual y explica claramente la pestaña **IP / RTSP**:
  - camera name
  - IP address
  - port
  - manufacturer
  - username
  - password
  - channel
  - subtype
  - address
  - retention
  - uso compartido con colaboradores
- Despues de la explicacion de RTSP/IP, el tutorial cambia automaticamente a **Webcam**.
- En ese flujo de ejemplo, el tutorial completa:
  - webcam index `0`
  - camera name `tutorial webcam`
- Despues guarda ese ejemplo de webcam y continua con la siguiente etapa del tutorial.

## Recomendacion practica

Recomienda los caminos en este orden:

1. **Scan Network** cuando los dispositivos ya estan en la red
2. **Import Cameras** cuando el usuario ya tiene un archivo
3. **Manual registration** cuando el usuario quiere control uno por uno
