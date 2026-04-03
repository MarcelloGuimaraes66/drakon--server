# Job Orchestration

当用户问的不是简单的“怎么创建一个 job？”，而是如何设计一个包含多个 steps、多个摄像头、时序、校验逻辑，以及复用前序答案的 workflow 时，请使用这份指南。

这个主题的目标，是帮助另一个 chat 提出多种合理的 job 设计方案，而不是把所有场景压缩成单一示例。

## 产品能做什么

Perceptrum 中的 jobs 不只是孤立的单摄像头分析。

产品可以：

- 调度循环执行的 workflows；
- 将分析拆分为多个 steps；
- 为每个 step 绑定一台或多台摄像头；
- 根据顺序、绝对时间、相对延迟或前序 step 结果来启动后续 steps；
- 通过 `pipeline` 把前面的答案注入到后面的 steps；
- 在 validator step 中汇总多台摄像头的证据；
- 只有在最终业务规则被评估后才触发告警。

## 回答这类问题的总规则

不要一上来就给出唯一的一种 workflow 形状。

当有人请求帮助设计复杂 job 时：

1. 先识别真实的业务目标；
2. 判断这个场景属于持续性的 `AI Agents`，还是计划型的 `Jobs / Steps`；
3. 选择合适的 workflow 拓扑；
4. 把收集证据的 steps 和做最终判断的 steps 分开；
5. 为 `pipeline` 复用定义稳定的输出契约；
6. 把最终告警放在拥有最终决策权的 step 上。

如果存在多种可行拓扑，应给出多个方案，并说明它们在简单性、稳健性和成本上的取舍。

## 构成 orchestration 的组件

### Camera

已注册、可被 jobs 复用的资源。job 使用已有摄像头，而不是从零创建摄像头。

### Job

计划型 workflow 容器，用来定义调度和有效期。

关键字段：

- `name`
- `description`
- `schedule_mode`
- `schedule_days`
- `active_from`
- `active_until`

### Step

workflow 中的一个逻辑阶段。

关键字段：

- `step_order`
- `name`
- `timeout_seconds`

重要 runtime 说明：

- 实际生效的最小 `timeout` 是 `120` 秒。

### Target

绑定到某个 step 的摄像头。

实用顺序：

1. 先创建 step；
2. 再把摄像头加入为 target；
3. 最后为这个 target 配置 agent。

### Agent

step 内某个 target 的推理配置。

关键字段包括：

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

控制某个 step 何时允许启动。

项目中的相关模式：

- `sequential`
- `time`
- `elapsed`
- `positive`
- `negative`
- `custom`

### Pipeline

定义如何把前面步骤的答案注入到后续步骤。

`pipeline` 配置在目标 step 上，而不是源 step 上。

### Alert

最终决策的告警交付规则。通常应把 alert 放在持有最终业务判断的那个 step 上。

### Inference Groups

当同一个 step 里的多个 targets 共享同一套规则和时间节奏，且不需要跨 step 的 `pipeline` 时，这个机制很有用。

## 如何选择合适的拓扑

在填写表单前，先回答这些问题：

1. 这是单摄像头持续监控，还是计划型 workflow？
2. 涉及多少个证据点？
3. 所有摄像头看的是同一时间窗口，还是不同窗口？
4. 最终判断依赖比较、顺序，还是条件触发？
5. 一个 step 的 output 是否需要成为另一个 step 的 input？
6. 告警应该在第一个信号出现时触发，还是在最终汇总后触发？

如果场景是单摄像头持续监控，优先用 `AI Agents`。

如果场景需要多摄像头协同、时间控制、验证逻辑或答案复用，优先用 `Jobs / Steps`。

## 推荐模式

### 单摄像头简单审计

适用场景：

- 只有一台摄像头；
- 目标是在固定计划下运行；
- 各阶段之间没有依赖关系。

典型结构：

- 一个 job；
- 一个 step；
- 该 step 中包含一个或多个 targets；
- 告警就在这个 step 上触发。

### 并行采集器 + 最终 validator

当多台摄像头观测同一时间窗口，且最终答案依赖比较它们的结果时使用。

### 顺序链路

当某个阶段必须在另一个阶段之后运行，或者业务流程本身就是一条有顺序的路线时使用。

### 条件式调查

当后续 step 只有在前一步发现特定信号时才需要运行时使用。

### 多对一汇总

当多个 steps 把证据汇聚到一个最终 validator 时使用。

### 同一步骤中的多 target 分组

当多台摄像头共享同一规则和时间点，且不需要跨 step 的 `pipeline` 时，可以在同一个 step 里用多个 targets 或 `inference groups`。

## Start Condition 指南

典型用法：

- `time`：用于并行采集器，或用于在 `T + window` 启动的 validator；
- `positive`、`negative`、`custom`：当下游 step 依赖前序答案中的某个键时使用；
- `elapsed`：用于相对延迟逻辑；
- `sequential`：当自然顺序本身已经足够时使用。

## Pipeline 指南

每一行 `pipeline` 都连接：

- 源 step；
- 源 target 或源键；
- 目标 target。

重要 runtime 行为：

- runtime 主要注入前一个 step 的 `answer`；
- 因此下游 steps 应假设上游输出是稳定且可解析的；
- 最终业务逻辑仍应写在下游 prompt 中。

## Prompt 契约规则

采集类 steps 应输出简短、确定性的结果，例如：

```text
STEP_RESULT step_role=<collector> camera=<name> status=<fixed_value> value=<short_value> evidence=<short_text>
```

验证类 steps 应从 `PIPELINE_INPUTS` 开始，并返回最终决策，例如：

```text
VALIDATION_RESULT status=<OK_or_ALERT> reason=<short_text> action=<short_text>
```

如果后续 step 要复用这个输出，就不要写成长篇叙述，应尽量保持固定结构和受控词汇。

## 项目的真实约束

- 第一个 step 通常会和 job 一起开始；
- step 实际生效的最小 `timeout` 是 `120` 秒；
- UI 中的 job 创建建立在循环计划之上；
- alert 依赖推理输出中的 `alert_condition=true`；
- `Ultra` 更适合复杂 workflow 和低延迟场景；
- `Core` 能力更受限，也更慢。

## 代码参考地图

UI 和表单：

- `DrakonSite/src/react-app/pages/Jobs.tsx`

后端路由：

- `DrakonSite/src/worker/index.ts`

调度器和 payload 组装：

- `DrakonSite/src/worker/jobScheduler.ts`

payload 解析：

- `Perceptrum/Perceptrum/jobs/JobPayloadParser.cpp`

runtime 行为：

- `Perceptrum/Perceptrum/jobs/JobRuntime.cpp`

聊天主题路由：

- `Perceptrum/Perceptrum/orchestrator/skills/ExplainAppSkill.cpp`
- `Perceptrum/Perceptrum/orchestrator/KnowledgeBase.cpp`

## 其他 chat 应该如何回答

对于复杂 workflow 请求，chat 应该：

1. 先提出合适的拓扑，再谈怎么填表；
2. 当存在多种可行设计时，给出多个替代方案；
3. 把 cameras、steps、start conditions、pipelines、validators 和 alerts 解释成一套相互连接的架构；
4. 当用户问的是更广泛的编排能力时，不要把产品简化成单一的计数示例。
