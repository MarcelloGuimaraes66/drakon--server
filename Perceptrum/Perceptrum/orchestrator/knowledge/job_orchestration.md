# Job Orchestration

Use this guide when the user is not asking for a simple "how do I create a job?" answer, but for a multi-step workflow that coordinates cameras, timing, validation logic, and downstream reuse of previous answers.

The goal of this topic is to help another chat propose several valid job designs instead of collapsing everything into a single example.

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

## Core mental model

Think in layers:

1. `Camera`: registered resource reused by jobs.
2. `Job`: scheduled workflow container.
3. `Step`: one logical stage in the workflow.
4. `Target`: camera attached to a step.
5. `Agent`: inference configuration for that step target.
6. `Start Condition`: when the step is allowed to start.
7. `Pipeline`: how previous answers are injected downstream.
8. `Alert`: delivery rule for the final decision.

## Design rule

Do not jump straight to a single workflow shape.

When asked to create a complex job:

1. identify the real business objective;
2. decide whether the case belongs to continuous `AI Agents` or scheduled `Jobs / Steps`;
3. choose the workflow topology;
4. separate collector steps from decision steps;
5. define a stable answer contract for pipeline reuse;
6. place the final alert on the step that owns the final decision.

## Recommended patterns

### Parallel collectors plus final validator

Use when multiple cameras watch the same time window and the final answer depends on comparing their outputs.

### Sequential chain

Use when one stage should only run after another or when the process represents a route or ordered sequence.

### Conditional investigation

Use when a later step should run only if an earlier step finds a specific signal.

### Many-to-one consolidation

Use when several steps feed evidence into one final downstream validator.

### Same-step multi-target grouping

Use one step with multiple targets or inference groups when several cameras share the same rule and timing, and you do not need cross-step pipeline.

## Start Condition guidance

Relevant modes in the project:

- `sequential`
- `time`
- `elapsed`
- `positive`
- `negative`
- `custom`

Typical usage:

- `time` for parallel collectors or a validator that starts at `T + window`;
- `positive`, `negative`, or `custom` when the downstream step depends on a previous answer key;
- `elapsed` for relative delay logic.

## Pipeline guidance

Pipeline is defined on the destination step, not the source step.

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
