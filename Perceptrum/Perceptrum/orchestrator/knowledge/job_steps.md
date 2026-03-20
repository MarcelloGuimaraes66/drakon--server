# Job Steps

Use **steps** to break a job into clear stages. Each step represents one part of the workflow.

## What a step controls

- which targets are used in that stage
- which agent or prompt logic is applied
- what time window or execution settings are used
- what alert behavior should happen if the condition is met

## Why steps matter

Steps let one job handle different scenarios cleanly instead of putting all logic into one large block.

## Common step patterns

- one step per camera
- one step for entrance monitoring and another for parking
- one step for detection and another for follow-up review

## Practical example

Example: job with two steps.

Job: `Closing shift security review`

Step 1:

- Target: `Front Entrance`
- Purpose: check whether anyone remains near the main door
- Agent logic: person detection after closing time

Step 2:

- Target: `Parking Lot`
- Purpose: check whether vehicles or people are still present
- Agent logic: intrusion or lingering vehicle detection

## What to configure in each step

- **Step name**: short label for the stage
- **Targets**: which camera or cameras the step should inspect
- **Agent or prompt**: what the step should look for
- **Execution settings**: input type, cadence, model choice, and related runtime options
- **Alert condition**: when the step should notify or escalate

## Practical guidance

- Use one step when the workflow is simple and focused.
- Use multiple steps when each stage has a different purpose.
- Keep step names explicit so the workflow is easy to review later.
- Avoid mixing unrelated goals into the same step when separate steps would be clearer.
