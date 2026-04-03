# Job Orchestration

Use this guide when the user is not asking only "how do I create a job?", but how to design a workflow with multiple steps, cameras, timing, validation logic, and downstream reuse of previous answers.

This topic should help another chat propose several valid job designs instead of collapsing everything into a single counting example.

## What the product can do

Jobs in Perceptrum are not limited to isolated per-camera analysis.

The product can:

- schedule recurring workflows;
- split analysis across multiple steps;
- attach one or many cameras to each step;
- start steps by sequence, absolute time, relative delay, or previous-step result;
- inject previous answers into later steps through pipeline;
- consolidate evidence from multiple cameras in a validator step;
- fire alerts only after a final business rule is evaluated.

## Master rule for answering

Do not jump straight to one workflow shape.

When someone asks for help with a complex job:

1. identify the real business objective;
2. decide whether the case belongs to continuous `AI Agents` or scheduled `Jobs / Steps`;
3. choose the workflow topology;
4. separate collector steps from decision steps;
5. define a stable answer contract for pipeline reuse;
6. place the final alert on the step that owns the final decision.

When more than one topology is valid, offer alternatives and explain the tradeoffs in simplicity, robustness, and cost.

## Components that form the orchestration

### Camera

Registered resource reused by jobs. A job consumes existing cameras instead of creating them from scratch.

### Job

The scheduled workflow container. It defines the schedule and active period.

Important fields:

- `name`
- `description`
- `schedule_mode`
- `schedule_days`
- `active_from`
- `active_until`

### Step

One logical stage in the workflow.

Important fields:

- `step_order`
- `name`
- `timeout_seconds`

Important runtime note:

- the effective minimum timeout is `120` seconds.

### Target

The camera attached to a step.

Practical order:

1. create the step;
2. add the camera as a target;
3. configure the agent for that target.

### Agent

The inference configuration for a target inside a step.

Important fields include:

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

Controls when a step is allowed to start.

Relevant modes in the project:

- `sequential`
- `time`
- `elapsed`
- `positive`
- `negative`
- `custom`

### Pipeline

Defines how previous answers are injected into later steps.

Pipeline is configured on the destination step, not on the source step.

### Alert

Delivery rule for the final decision. The alert should usually be attached to the step that owns the final business decision.

### Inference Groups

Useful when several targets in the same step share the same rule and timing, and you do not need cross-step pipeline.

## How to choose the right topology

Before filling forms, answer these questions:

1. Is this continuous single-camera monitoring, or a scheduled workflow?
2. How many evidence points are involved?
3. Do all cameras observe the same time window or different windows?
4. Does the final answer depend on comparison, sequence, or a condition?
5. Does the output of one step need to become input for another?
6. Should the alert fire on the first signal, or only after final consolidation?

If the case is continuous monitoring for one camera, prefer `AI Agents`.

If the case requires coordination across cameras, timing, validation, or answer reuse, prefer `Jobs / Steps`.

## Recommended patterns

### Simple single-camera audit

Use when:

- there is one camera;
- the goal is to run on a schedule;
- there is no dependency between stages.

Typical shape:

- one job;
- one step;
- one or more targets in that step;
- alert on that same step.

### Parallel collectors plus final validator

Use when multiple cameras watch the same time window and the final answer depends on comparing their outputs.

Typical shape:

- collector step for camera A;
- collector step for camera B;
- final validator step that starts after the collection window.

### Sequential chain

Use when one stage should only run after another, or when the process represents a route or ordered sequence.

### Conditional investigation

Use when a later step should run only if an earlier step finds a specific signal.

### Many-to-one consolidation

Use when several steps feed evidence into one final downstream validator.

### Same-step multi-target grouping

Use one step with multiple targets or inference groups when several cameras share the same rule and timing, and you do not need cross-step pipeline.

## Start Condition guidance

Typical usage:

- `time` for parallel collectors or a validator that starts at `T + window`;
- `positive`, `negative`, or `custom` when the downstream step depends on a previous answer key;
- `elapsed` for relative delay logic;
- `sequential` when the natural order is enough by itself.

## Pipeline guidance

Each pipeline row links:

- source step;
- source target or key;
- destination target.

Important runtime behavior:

- the runtime mainly injects the previous `answer`;
- downstream steps should therefore expect stable, parseable upstream outputs;
- the final business logic still belongs in the downstream prompt.

## Prompt contract rule

Collector steps should produce short deterministic outputs, for example:

```text
STEP_RESULT step_role=<collector> camera=<name> status=<fixed_value> value=<short_value> evidence=<short_text>
```

Validator steps should start from `PIPELINE_INPUTS` and return a final decision, for example:

```text
VALIDATION_RESULT status=<OK_or_ALERT> reason=<short_text> action=<short_text>
```

If another step will reuse the output, avoid long narrative answers and prefer a stable structure with controlled vocabulary.

## Real project constraints

- first step usually starts with the job;
- effective minimum step timeout is `120` seconds;
- UI job creation is based on recurring schedule;
- alerts depend on `alert_condition=true` in the inference output;
- `Ultra` is safer for complex workflows and lower latency;
- `Core` is more limited and slower.

## Code reference map

UI and forms:

- `DrakonSite/src/react-app/pages/Jobs.tsx`

Backend routes:

- `DrakonSite/src/worker/index.ts`

Scheduler and payload shaping:

- `DrakonSite/src/worker/jobScheduler.ts`

Payload parsing:

- `Perceptrum/Perceptrum/jobs/JobPayloadParser.cpp`

Runtime behavior:

- `Perceptrum/Perceptrum/jobs/JobRuntime.cpp`

Chat topic routing:

- `Perceptrum/Perceptrum/orchestrator/skills/ExplainAppSkill.cpp`
- `Perceptrum/Perceptrum/orchestrator/KnowledgeBase.cpp`

## How another chat should answer

For complex workflow requests, the chat should:

1. propose the right topology before filling forms;
2. offer multiple alternatives when more than one design is viable;
3. explain cameras, steps, start conditions, pipelines, validators, and alerts as one connected architecture;
4. avoid reducing the product to a single counting example when the request is broader than that.
