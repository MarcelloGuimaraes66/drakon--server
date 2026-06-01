# Job Steps

A step is where a job becomes operational. If a user asks how to create an agent inside a scheduled workflow, the right answer is: create the step first, add the camera as a target, and then configure the agent inside that step.

## When to use a step agent instead of AI Agents

- Use a step agent when the analysis must follow a schedule.
- Use a step agent when multiple cameras or stages must work together.
- Use a step agent when one stage depends on another stage, on a timeout, or on shared output.
- Use **AI Agents** instead when one camera only needs a direct continuous watcher outside a workflow.

## Minimum required fields inside the step agent editor

- **Name**: a clear name for the step agent.
- **Prompt core**: explain what the step agent must recognize and under which circumstances.
- **Alert condition**: define the condition that should trigger the alert for that stage.

## Advanced options shared with camera agents

- **Targets**: the step must already contain target cameras, and the agent can use target-specific logic.
- **Face targets**: face photos can guide recognition when a specific person matters.
- **Negative condition**: define what should not trigger the alert.
- **Negative reference images**: give the model clearer visual examples of what to ignore.
- **Model**: **Ultra** supports lower latency and 10-second alert cadence; **Core** is slower and fixed at 60 seconds.
- **Video packaging**: **High resolution**, **Standard resolution**, and **Compact resolution** trade token usage against analysis quality.
- **Input type**: **Video** is best for short actions and motion; **Image** is best for periodic snapshots.
- **Polygons**: named polygons can limit inference to motion inside specific regions.

## Typical flow

1. Open **Jobs**.
2. Create or edit the job.
3. Create the **step**.
4. Add one or more cameras as targets inside the step.
5. Open the step-level agent editor for that target or stage.
6. Fill in **Name**, **Prompt core**, and **Alert condition**.
7. Configure visual guidance, model, cadence, **Video packaging**, **Input type**, and polygons when needed.
8. Save the step and activate the job.

## Practical rule of thumb

- Use a step agent when the agent belongs to a schedule, a sequence, or a multi-camera workflow.
- Use a camera agent in **AI Agents** when the same logic should run continuously on one camera by itself.
