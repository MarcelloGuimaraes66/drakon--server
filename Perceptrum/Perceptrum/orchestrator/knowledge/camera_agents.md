# Camera Agents

Use **AI Agents** when you want continuous or recurring analysis on a specific camera without manually asking the chat each time.

## What a camera agent does

- Watches one camera continuously or on a recurring cadence.
- Uses a prompt that defines what should be detected, summarized, or supervised.
- Can generate alerts when the configured condition is met.
- Can include negative logic so the monitoring does not trigger on the wrong situation.
- Can use visual guidance such as analysis regions, face targets, and negative reference images.
- Is best for ongoing monitoring of a known scenario on one camera.

Camera agents are not only useful on their own. They are also a fundamental building block for the broader workflow model used by cameras, jobs, steps, and agents. If you understand how to define a good camera agent, you already understand most of what a job step agent needs.

## Good use cases

- Detect intrusions after business hours.
- Watch a loading dock for trucks or people entering a restricted area.
- Track whether a queue is forming at a reception desk.
- Detect safety issues such as a fallen person or a crowd.
- Supervise whether a receiving dock is active during the expected window.
- Monitor whether a route, area, or station is being used correctly.
- Keep continuous watch over an operational stage that may later become one part of a bigger job workflow.

## Typical flow

1. Open **AI Agents**.
2. Choose the camera you want to monitor.
3. Define the display name and prompt core.
4. Define the alert condition and, if needed, a negative condition.
5. Configure visual guidance such as full frame or analysis regions, face targets, and negative reference images.
6. Choose the model or execution settings that fit the scenario.
7. Save the agent.
8. Enable the agent and verify that it is running.

## Practical example

Example: supervised receiving dock monitoring.

- Camera: `Receiving Dock`
- Prompt core: monitor whether trucks, pallets, or unloading activity are present during the expected receiving window
- Alert condition: send an alert when the expected unloading activity is missing, delayed, or happening in the wrong way
- Negative condition: do not alert when the area is simply empty outside the scheduled receiving window
- Result: the agent keeps watching the camera without requiring a manual chat request

## How camera agents differ from chat

- Chat is best for ad hoc questions such as `what happened in the parking lot today?`
- Camera agents are best when the same type of monitoring should keep running automatically
- Chat asks after the fact; camera agents stay ready before, during, and after the event window

## How camera agents differ from jobs

- Camera agents focus on one camera and one continuous monitoring setup.
- Jobs are better when you need a scheduled workflow, multiple steps, dependencies, or coordination across multiple targets.
- Camera agents define monitoring behavior at the camera level; jobs orchestrate behavior across stages.
- A camera agent can be a strong starting pattern for a future job step, because the same kinds of prompt, alert, region, and execution choices appear again inside job-step agents.
