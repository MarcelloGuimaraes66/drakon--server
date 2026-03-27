# Job Steps

Use **steps** to break a job into clear stages. Each step represents one part of the workflow and is the main execution unit inside the job.

## What a step controls

- which stage of the workflow is being executed
- the step order and timeout for that stage
- which targets are used in that stage
- which agent or prompt logic is applied
- which execution settings are used
- which start condition or dependency controls when the step can begin
- which pipeline input, grouped inference, or shared context is used
- what alert behavior should happen if the condition is met

## Why steps matter

Steps let one job handle different scenarios cleanly instead of putting all logic into one large block.

A job without well-defined steps is only a schedule. The step is where the workflow becomes operational: cameras are attached, agents are applied, timing is enforced, dependencies are evaluated, and alerts are decided.

## Common step patterns

- one step per camera
- one step for entrance monitoring and another for parking
- one step for detection and another for follow-up review
- one step for receiving, another for transfer, and another for destination confirmation
- one step for normal execution and another for exception handling
- one step that starts only after a previous step produced the expected result

## Practical example

Example: job with four steps.

Job: `Receiving to destination verification`

Step 1:

- Stage: `Receiving confirmation`
- Target: `Receiving Dock`
- Purpose: confirm that the expected load arrived and was unloaded
- Agent logic: detect unloading activity and confirm that the receiving event really happened

Step 2:

- Stage: `Transfer path review`
- Target: `Internal Corridor`
- Purpose: confirm that the same process continued through the expected path
- Agent logic: review movement through the transfer area
- Start condition: begin only after the receiving step produced the expected positive result

Step 3:

- Stage: `Destination confirmation`
- Target: `Storage Area B`
- Purpose: confirm that the load reached the correct destination
- Agent logic: check whether the delivery ended in the expected area instead of a wrong zone

Step 4:

- Stage: `Exception review`
- Target: one or more exception cameras
- Purpose: review delay, wrong routing, or missing completion
- Agent logic: escalate when the expected handoff, route, or destination did not happen in time

## What to configure in each step

- **Step name**: short label for the stage.
- **Step order**: where this stage belongs in the workflow sequence.
- **Timeout**: how long the stage can run before timing out.
- **Targets**: which camera or cameras the step should inspect. In the current workflow model, targets are added after the step exists.
- **Agent or prompt**: what the step should look for.
- **Prompt behavior**: prompt core, alert condition, and optional negative condition.
- **Execution settings**: input type, video packaging mode, inference model, cadence, running resolution, motion-only behavior, and temporal context behavior.
- **Visual guidance**: analysis regions, face targets, and negative reference images when the scenario needs them.
- **Start condition**: whether the step should start by sequence, by time, or from the result of a previous step.
- **Pipeline input**: whether the step should receive input or named keys from a previous step.
- **Missing-input handling**: what should happen when the expected upstream input does not exist.
- **Grouped execution**: whether multiple targets inside the step should be handled as an inference group with a source target and optional region bindings.
- **Alerts**: which notifications or escalations should be sent when the step condition is met.

## Practical guidance

- Use one step when the workflow is simple and focused.
- Use multiple steps when each stage has a different purpose, timing rule, or camera set.
- Keep step names explicit so the workflow is easy to review later.
- Add targets only after the step is created, because targets belong to the step.
- Treat the step as the place where schedule becomes action: order, timeout, targets, agent behavior, and alerts all come together here.
- Use start conditions when one stage should wait for another stage or for a specific time.
- Use pipeline inputs when one step should consume named output from an earlier step.
- Use grouped inference only when multiple targets really need to act as one combined stage.
- Keep unrelated goals in separate steps when that makes the workflow easier to understand, maintain, and audit.
