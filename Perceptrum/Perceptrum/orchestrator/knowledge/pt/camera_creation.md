# Cadastro de Camera

O usuario pode cadastrar ou registrar cameras tanto na pagina **Cameras** quanto na pagina **AI Agents**.

Para explicacoes e para o tutorial guiado, use a pagina **Cameras** como exemplo principal, mas deixe claro que os mesmos caminhos tambem existem em **AI Agents**.

## Onde as cameras podem ser cadastradas

- **Cameras**
- **AI Agents**

As duas paginas expoem os mesmos tres caminhos:

1. **Scan Network**
2. **Import Cameras**
3. **Register Camera** manualmente

## Jeitos mais rapidos de cadastrar

### Scan Network

- **Scan Network** procura cameras e aparelhos **NVR/DVR** na rede local.
- Esse costuma ser o caminho mais facil quando os dispositivos ja estao acessiveis na mesma rede.
- Se o usuario perguntar qual e o caminho mais simples, recomende esse primeiro.

### Import Cameras

- **Import Cameras** aceita **Excel**, **CSV**, **JSON**, **TSV** e **plain text**.
- A IA local entende os campos e registra as cameras automaticamente.
- Esse caminho e ideal quando o usuario ja tem uma planilha, exportacao, inventario ou lista de instalacao.

## Cadastro manual de camera

Se o usuario quiser controle total, ele pode clicar no botao de cadastro manual em **Cameras** ou em **AI Agents**.

O formulario manual permite escolher entre:

1. **Camera IP / RTSP**
2. **Webcam**

## Fluxo da camera IP / RTSP

Use esse fluxo para cameras como **Hikvision**, **Dahua** e **Intelbras**.

O formulario cobre:

- **Nome da camera**
- **IP**
- **Porta RTSP**
- **Fabricante**
- **Metodo de conexao** como RTSP, HTTP ou ONVIF
- **Usuario**
- **Senha**
- **Channel**
- **Subtype**

Observacoes importantes por fabricante:

- Em **Hikvision**, altere **Channel** para acessar outros canais.
- Em **Intelbras**, use **Subtype** para acessar outros canais.

## Secao de endereco

Depois dos campos de conexao, o formulario continua com o endereco da camera.

- O fluxo de endereco comeca pelo **CEP**.
- Depois que o usuario informa o CEP, o app pode preencher automaticamente **rua**, **cidade** e **estado**.
- O campo que normalmente sobra para confirmacao manual e o **numero**.

## Retencao

- **Retencao** define por quanto tempo os frames gerados por aquela camera ficam armazenados em disco.
- Isso controla o historico disponivel para revisao e busca posterior.

## Compartilhamento com colaboradores

- **Compartilhamento com colaboradores** permite compartilhar a camera com usuarios especificos do Perceptrum convidados por `@handle` ou email para usarem a camera no Drakon Find.
- Explique isso como um compartilhamento intencional com colaboradores, nao como exposicao publica.

## Fluxo da webcam

O caminho de **Webcam** e mais simples.

A webcam continua usando os campos compartilhados:

- **Nome da camera**
- **Endereco**
- **Retencao**
- **Compartilhamento com colaboradores**

O campo especifico da webcam e:

- **Webcam index**, que normalmente e `0`

Diferente da camera IP / RTSP, a webcam nao precisa de:

- IP
- porta
- fabricante
- usuario
- senha
- channel
- subtype

## O que os dois fluxos compartilham

Tanto **IP / RTSP** quanto **Webcam** compartilham:

- nome da camera
- endereco
- retencao
- compartilhamento com colaboradores

A diferenca principal e que **IP / RTSP** precisa dos campos de transporte e fabricante, enquanto **Webcam** normalmente precisa so do indice da webcam.

## Como o tutorial guiado trata o cadastro de camera

Quando o usuario perguntar sobre a etapa de camera do tutorial:

- Explique usando a pagina **Cameras** como exemplo visual.
- Tambem diga que as mesmas acoes existem em **AI Agents**.
- O tutorial primeiro destaca os atalhos do topo:
  - **Scan Network**
  - **Import Cameras**
  - **Register Camera**
- Depois ele abre o formulario manual e explica com clareza a aba **IP / RTSP**:
  - nome da camera
  - IP
  - porta
  - fabricante
  - usuario
  - senha
  - channel
  - subtype
  - endereco
  - retencao
  - compartilhamento com colaboradores
- Depois da explicacao da parte RTSP/IP, o tutorial muda automaticamente para **Webcam**.
- Nesse exemplo guiado, o tutorial preenche:
  - webcam index `0`
  - nome da camera `tutorial webcam`
- Em seguida ele salva essa webcam de exemplo e continua para a proxima etapa do tutorial.

## Recomendacao pratica

Recomende os caminhos nesta ordem:

1. **Scan Network** quando a camera ou o NVR/DVR ja estiver na rede
2. **Import Cameras** quando o usuario ja tiver um arquivo
3. **Cadastro manual** quando ele quiser controle campo por campo
