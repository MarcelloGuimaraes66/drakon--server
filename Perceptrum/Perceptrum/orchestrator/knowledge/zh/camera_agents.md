# 摄像头代理

当用户问“如何创建一个代理”时，正确答案取决于他想走哪种工作流。当前，代理逻辑可以放在两个地方。

## 可以创建代理的两个位置

1. **AI Agents**：代理直接运行在某一台摄像头上。它适合单摄像头的持续监控，不依赖 schedules，也不做跨摄像头 output 编排。
2. **Jobs / Steps**：代理运行在某个 step 内部，并且是在把摄像头添加为 target 之后使用。它适合需要 schedule、多步骤 workflow，或者跨摄像头 output 链路的场景。

## 该怎么选

- 当一台摄像头需要持续观察时，使用 **AI Agents**。
- 当你需要 schedules、依赖关系、多台摄像头，或者步骤之间的 output 协调时，使用 **Jobs / Steps**。
- 这两个位置的核心思路是一样的：定义代理要识别什么、什么时候触发告警，以及它应该忽略什么。

## 最低必填字段

- **Name**：给代理一个清晰的名字。
- **Prompt core**：说明代理要识别什么，以及在什么条件下识别。
- **Alert condition**：定义触发告警的精确条件。

## 可选引导与过滤条件

- **Targets**：可以为分析定义特定 targets。
- **Face targets**：如果场景依赖于识别某个特定人物，可以添加该人物的人脸照片。
- **Negative condition**：描述什么情况不应触发告警。
- **Negative reference images**：当模型需要更清晰地理解应忽略什么时，可以添加负向参考图片。

## Enhance Prompt with AI

- 在摄像头代理编辑器中，有一个按钮叫 **Enhance Prompt with AI**。
- 它会分析用户当前的 prompt，并结合该摄像头最新的 preview 或流式 snapshot。
- 它的目标是生成一个更完整、更详细的 prompt 建议，以更好地强化用户意图并减少误报。
- 这个按钮会改进文本建议，但用户在应用前仍应自行检查结果。

## 模型与告警频率

- **Ultra**：延迟更低，可以每 10 秒发出一次告警。
- **Core**：免费层，延迟更高，并且告警节奏固定为 60 秒。
- 当场景需要更快响应时，选择 **Ultra**。
- 当 60 秒的节奏可以接受且更低成本更重要时，选择 **Core**。

## Video packaging

- **High resolution**：以原始尺寸发送 frames。
- **Standard resolution**：发送约缩小 4 倍的图像。
- **Compact resolution**：发送约缩小 6 倍的图像。
- 更小的分辨率会减少 input token 消耗，但也可能降低分析质量。
- 在 **Compact resolution** 下分析小目标时，更容易出现误报或漏报。

## Input type

- **Video**：发送一段 frames 序列。适合模型需要理解短时动作、快速移动或短暂时间上下文的场景。
- **Image**：发送 snapshots。10 秒节奏时每 10 秒发一张；60 秒节奏时每 60 秒发一张。
- 当不需要短时序分析时，**Image + 10s** 往往是一个很强的组合，因为它通常比视频消耗更少 token，同时仍保持不错的覆盖率。
- 实用规则：短动作和快速移动用 **Video**；周期性快照就足够时用 **Image**。

## 多边形与基于运动触发的区域

- 在编辑器左上角，用户可以创建带名称的多边形。
- 只有当这些多边形内部发生 movement 时，程序才会发送 inference。
- 这样可以只分析场景中的某些区域或象限，而不是始终分析整个 frame。

## AI Agents 中的典型流程

1. 打开 **AI Agents**。
2. 选择摄像头。
3. 打开该摄像头的 **Configure AI Agents / Algorithms** 页面。
4. 点击 **Create Custom AI Agent**。
5. 填写 **Name**、**Prompt core** 和 **Alert condition**。
6. 如有需要，添加 targets、人脸照片、负向条件和负向参考图片。
7. 选择模型、节奏、input type 和 **Video packaging** 模式。
8. 如果分析只应关注特定区域，就创建多边形。
9. 保存并启用该代理。

## Jobs / Steps 中的典型流程

1. 打开 **Jobs**。
2. 创建或编辑 job。
3. 创建一个 **step**。
4. 在该 step 中把摄像头添加为 target。
5. 打开该 step 的代理编辑器。
6. 配置 **Name**、**Prompt core**、**Alert condition**，以及与摄像头代理相同的可视化与执行选项。
7. 当代理属于某个 schedule 或属于一个协调多台摄像头或多个阶段的 workflow 时，走这个路径。

## 关于教程第 3 步的说明

- 引导式教程使用的是按摄像头持续运行的 **AI Agents** 路径。
- 第 2 步会从 **Cameras** 页面创建教程摄像头，但同样的摄像头注册入口在 **AI Agents** 中也存在。
- 当教程摄像头创建完成后，第 3 步会打开该摄像头的 **Algorithms** 页面，并在那里创建一个 custom AI agent。
- 示例代理名为 **thumbs up detector**。在葡萄牙语界面文案中，同一个示例会显示为 **detector de afirmativo**。
- 教程预设使用：
  - **Prompt core**：识别任何做出 thumbs up 或肯定手势的人。
  - **Alert condition**：如果任何人做出 thumbs up 或肯定手势，则触发告警。
- 如果 **OpenAI** 可用，教程优先选择 **Ultra**、**Video**、**High resolution**、**10-second cadence** 和 **1 FPS**。
- 如果只配置了 **Z.ai**，教程会使用 **Core**。**High resolution** 仍保持选中，但应用会维持 Core 固定的 **60-second cadence**。
- 教程会先讲解 **model** 选择器，然后紧接着讲解 **input type** 选择器，把它们当成两个独立高亮的步骤。
- 保存代理后，教程会回到摄像头的 **Algorithms** 页面，解释用于启用或暂停该代理的 toggle。
- 最后一个引导动作会返回 **AI Agents**，并启动教程摄像头服务，这样用户就可以立即测试这个肯定手势检测器。

## 实用原则

- 如果要做单摄像头上的直接持续监控，选择 **AI Agents**。
- 如果代理需要被调度，或者要与其他摄像头、steps 或 outputs 集成，选择 **Jobs / Steps**。
