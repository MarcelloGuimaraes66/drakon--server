# Camera Agents

When a user asks how to create an agent, the correct answer depends on the workflow. Today there are two places where agent logic can live.

## The two places where an agent can be created

1. **AI Agents**: the agent runs directly on one camera. This is the right place for continuous per-camera monitoring without schedules or cross-camera output orchestration.
2. **Jobs / Steps**: the agent runs inside a step after a camera is added as a target. This is the right place when the agent must be part of a schedule, a multi-step workflow, or an output chain across cameras.

## Which one to choose

- Use **AI Agents** when one camera should keep watching continuously.
- Use **Jobs / Steps** when you need schedules, dependencies, multiple cameras, or output coordination across stages.
- Both places use the same base idea: define what the agent must recognize, when it should alert, and what it must ignore.

## Minimum required fields

- **Name**: a clear name for the agent.
- **Prompt core**: explain what the agent must recognize and under which circumstances.
- **Alert condition**: define the exact condition that should trigger an alert.

## Optional guidance and filters

- **Targets**: you can define specific targets for the analysis.
- **Face targets**: you can add face photos when the scenario depends on recognizing a specific person.
- **Negative condition**: describe what should not trigger an alert.
- **Negative reference images**: add negative image references when the model needs clearer examples of what to ignore.

## Enhance Prompt with AI

- In the camera-agent editor there is a button called **Enhance Prompt with AI**.
- It analyzes the user's current prompt together with the latest camera preview or streamed snapshot from that camera feed.
- The goal is to build a more complete and detailed prompt suggestion that better enforces the user's intent and reduces false positives.
- The button improves the text suggestion, but the user should still review the result before applying it.

## Model and alert cadence

- **Ultra**: lower latency and can emit alerts every 10 seconds.
- **Core**: free tier, higher latency, and fixed 60-second alert cadence.
- Choose **Ultra** when the scenario needs faster reaction.
- Choose **Core** when 60-second cadence is acceptable and lower cost matters more.

## Video packaging

- **High resolution**: sends frames at their original size.
- **Standard resolution**: sends the image about 4x smaller.
- **Compact resolution**: sends the image about 6x smaller.
- Smaller packaging reduces input-token usage, but it can also reduce analysis quality.
- Small objects analyzed with **Compact resolution** may cause more false positives or false negatives.

## Input type

- **Video**: sends a sequence of frames. Use it when the model must understand short actions, rapid movements, or brief temporal context.
- **Image**: sends snapshots. With a 10-second cadence it sends one snapshot every 10 seconds; with a 60-second cadence it sends one snapshot every 60 seconds.
- **Image + 10s** is often a strong choice when short temporal analysis is not required, because it usually costs fewer tokens than video while still keeping good coverage.
- Practical rule: use **Video** for short motion and quick actions; use **Image** when periodic snapshots are enough.

## Polygons and motion-gated regions

- In the upper-left corner of the editor, the user can create named polygons.
- The program sends inference only when movement happens inside one of those polygons.
- This lets the user analyze only specific quadrants or regions of the scene instead of the full frame all the time.

## Typical flow in AI Agents

1. Open **AI Agents**.
2. Choose the camera.
3. Open that camera's **Configure AI Agents / Algorithms** page.
4. Click **Create Custom AI Agent**.
5. Fill in **Name**, **Prompt core**, and **Alert condition**.
6. If needed, add targets, face photos, negative conditions, and negative reference images.
7. Choose the model, cadence, input type, and **Video packaging** mode.
8. Create polygons if the analysis should watch only specific regions.
9. Save and enable the agent.

## Typical flow in Jobs / Steps

1. Open **Jobs**.
2. Create or edit the job.
3. Create a **step**.
4. Add the camera as a target inside that step.
5. Open the step-level agent editor.
6. Configure **Name**, **Prompt core**, **Alert condition**, and the same visual and execution settings used by camera agents.
7. Use this path when the agent belongs to a schedule or to a workflow that coordinates several cameras or stages.

## Tutorial Stage 3 note

- The guided tutorial uses the continuous per-camera **AI Agents** path.
- Stage 2 creates the tutorial camera from the **Cameras** page, but the same camera-registration entry points also exist in **AI Agents**.
- After the tutorial camera exists, Stage 3 opens that camera's **Algorithms** page and creates a custom AI agent there.
- The example agent is named **thumbs up detector**. In Portuguese UI copy, the same example is presented as **detector de afirmativo**.
- The tutorial preset uses:
  - **Prompt core**: recognize any person making a thumbs up or affirmative hand gesture.
  - **Alert condition**: alert if any person is making a thumbs up or affirmative hand gesture.
- If **OpenAI** is available, the tutorial prefers **Ultra**, **Video**, **High resolution**, **10-second cadence**, and **1 FPS**.
- If only **Z.ai** is configured, the tutorial uses **Core**. **High resolution** remains selected, but the app keeps Core's fixed **60-second cadence**.
- The tutorial explains the **model** selector first and the **input type** selector right after it as two separate highlighted steps.
- After saving the agent, the tutorial returns to the camera's **Algorithms** page to explain the toggle that enables or pauses that agent on that camera.
- The last guided action goes back to **AI Agents** and starts the tutorial camera service so the user can immediately test the thumbs up detector.

## Practical rule of thumb

- Choose **AI Agents** for a direct continuous watcher on one camera.
- Choose **Jobs / Steps** when the agent must be scheduled or integrated with other cameras, steps, or outputs.
