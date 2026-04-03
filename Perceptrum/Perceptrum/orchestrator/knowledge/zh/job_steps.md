# Job 步骤

step 是 job 真正进入执行的地方。如果用户问的是如何在一个计划工作流里创建 agent，正确答案是：先创建 step，再把摄像头加入为 target，然后在这个 step 里配置 agent。

## 什么时候用 step agent，而不是 AI Agents

- 当分析必须遵循计划执行时，使用 step agent。
- 当多台摄像头或多个阶段需要协同工作时，使用 step agent。
- 当某个阶段依赖另一个阶段、`timeout`，或者共享 output 时，使用 step agent。
- 当单台摄像头只需要在 workflow 之外持续监看时，使用 **AI Agents**。

## step agent 编辑器中的最低必填字段

- **Name**: step agent 的清晰名称。
- **Prompt core**: 说明这个 step agent 需要识别什么，以及在什么情况下识别。
- **Alert condition**: 定义这个阶段应该在什么条件下触发告警。

## 与 camera agents 共享的高级选项

- **Targets**: step 必须已经包含目标摄像头，agent 可以按 target 使用专属逻辑。
- **Face targets**: 当特定人物很重要时，可用人脸照片辅助识别。
- **Negative condition**: 定义什么情况不应触发告警。
- **Negative reference images**: 为模型提供更明确的视觉反例，让它知道该忽略什么。
- **Model**: **Ultra** 支持更低延迟和每 10 秒一次的告警节奏；**Core** 更慢，并固定为 60 秒。
- **Video packaging**: **High resolution**、**Standard resolution** 和 **Compact resolution** 在 token 消耗与分析质量之间做权衡。
- **Input type**: **Video** 更适合短动作和运动场景；**Image** 更适合周期性快照。
- **Polygons**: 命名 polygons 可以把推理限制在指定区域内的运动范围。

## 典型流程

1. 打开 **Jobs**。
2. 创建或编辑 job。
3. 创建 **step**。
4. 在该 step 中加入一个或多个摄像头作为 targets。
5. 打开这个 target 或阶段对应的 step-level agent 编辑器。
6. 填写 **Name**、**Prompt core** 和 **Alert condition**。
7. 按需要配置视觉引导、模型、频率、**Video packaging**、**Input type** 和 `polygons`。
8. 保存 step 并启用 job。

## 实用判断规则

- 如果 agent 属于计划、顺序链路或多摄像头 workflow，请使用 step agent。
- 如果同一套逻辑只需要在单台摄像头上持续独立运行，请在 **AI Agents** 中使用 camera agent。
