# 摄像头注册

用户既可以在 **Cameras** 页面注册摄像头，也可以在 **AI Agents** 页面注册摄像头。

在做说明或讲解引导式教程时，请优先用 **Cameras** 作为主要示例页面，但要明确说明：同样的发现、导入和手动注册入口在 **AI Agents** 中也存在。

## 可以在哪里注册摄像头

- **Cameras**
- **AI Agents**

这两个页面都提供相同的三个入口：

1. **Scan Network**
2. **Import Cameras**
3. 手动使用 **Register Camera**

## 最快的摄像头接入方式

### Scan Network

- **Scan Network** 会在本地网络中搜索摄像头以及 **NVR/DVR** 设备。
- 当这些设备已经在同一网络中可达时，这通常是最简单的方式。
- 如果用户问最省事的路径，优先推荐这个。

### Import Cameras

- **Import Cameras** 支持 **Excel**、**CSV**、**JSON**、**TSV** 和 **plain text**。
- 本地 AI 会读取表格列或自由格式字段，并自动完成摄像头注册。
- 当用户已经有导出的清单、电子表格、安装交接表，或来自其他系统的摄像头列表时，优先推荐这个入口。

## 手动注册摄像头

如果用户想完全掌控每个字段，可以在 **Cameras** 或 **AI Agents** 中点击手动注册按钮。

手动表单允许用户在以下两种类型之间选择：

1. **IP / RTSP camera**
2. **Webcam**

## IP / RTSP 摄像头流程

这个流程适用于 **Hikvision**、**Dahua**、**Intelbras** 等摄像头。

表单包含：

- **Camera name**
- **IP address**
- **RTSP port**
- **Manufacturer**
- **Connection method**，例如 RTSP、HTTP 或 ONVIF
- **Username**
- **Password**
- **Channel**
- **Subtype**

按厂商区分的重要说明：

- 对于 **Hikvision**，修改 **Channel** 可以切换到其他通道。
- 对于 **Intelbras**，使用 **Subtype** 可以切换到其他通道。

## 地址部分

连接字段之后，表单还会继续填写摄像头地址。

- 地址流程从 **ZIP code / CEP** 开始。
- 用户输入 CEP 之后，应用可以自动填充 **street**、**city** 和 **state**。
- 通常仍然需要人工确认的字段是 **street number**。

## Retention

- **Retention** 用来定义该摄像头生成的 frames 会在磁盘上保留多久。
- 这会直接影响之后可用于回看和搜索的历史时长。

## 协作者共享

- **协作者共享** 允许用户把摄像头分享给通过 `@handle` 或邮箱邀请的特定协作者，让他们从自己的账号访问同一台摄像头。
- 应该把它解释为与协作者进行的主动共享，而不是公开暴露。

## Webcam 流程

**Webcam** 是更简单的手动路径。

Webcam 仍然会使用以下共享字段：

- **Camera name**
- **Address**
- **Retention**
- **协作者共享**

Webcam 最主要的专属字段是：

- **Webcam index**，通常是 `0`

与 IP / RTSP 摄像头不同，Webcam 不需要：

- IP address
- port
- manufacturer
- username
- password
- channel
- subtype

## 两种手动流程的共同点

**IP / RTSP** 和 **Webcam** 都共享以下内容：

- camera name
- address
- retention
- 协作者共享

区别在于，**IP / RTSP** 需要传输和厂商相关字段，而 **Webcam** 通常只需要 webcam index。

## 引导式教程中的摄像头注册行为

当用户询问教程中的摄像头步骤时：

- 用 **Cameras** 页面作为视觉示例来说明。
- 同时提到相同的操作在 **AI Agents** 中也可以完成。
- 教程首先会高亮顶部快捷入口：
  - **Scan Network**
  - **Import Cameras**
  - **Register Camera**
- 然后它会打开手动表单，并清楚讲解 **IP / RTSP** 标签页：
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
  - 协作者共享
- 在讲完 RTSP/IP 之后，教程会自动切换到 **Webcam**。
- 在这个示例流程中，教程会填写：
  - webcam index `0`
  - camera name `tutorial webcam`
- 然后它会保存这个 webcam 示例，并继续进入教程的下一阶段。

## 实用建议

请按以下顺序推荐路径：

1. 当设备已经在网络中时，优先 **Scan Network**
2. 当用户已经有文件时，优先 **Import Cameras**
3. 当用户希望逐字段控制时，选择 **Manual registration**
