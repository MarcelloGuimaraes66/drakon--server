# Camera Agents

Use **AI Agents** when you want continuous analysis on a specific camera without manually asking the chat each time.

## What a camera agent does

- Watches one camera continuously or on a recurring cadence.
- Uses a prompt that defines what should be detected or summarized.
- Can generate alerts when the configured condition is met.
- Is best for ongoing monitoring of a known scenario.

## Good use cases

- Detect intrusions after business hours.
- Watch a loading dock for trucks or people entering a restricted area.
- Track whether a queue is forming at a reception desk.
- Detect safety issues such as a fallen person or a crowd.

## Typical flow

1. Open **AI Agents**.
2. Choose the camera you want to monitor.
3. Define the prompt core.
4. Define the alert condition.
5. Choose the model or execution settings that fit the scenario.
6. Save the agent.
7. Enable the agent and verify that it is running.

## Practical example

Example: intrusion monitoring on the parking lot camera.

- Camera: `Parking Lot`
- Prompt core: detect people or vehicles entering the lot after closing time
- Alert condition: send an alert when a person is visible between 10:00 PM and 5:00 AM
- Result: the agent keeps watching the camera without requiring a manual chat request

## How camera agents differ from chat

- Chat is best for ad hoc questions such as `what happened in the parking lot today?`
- Camera agents are best when the same type of monitoring should keep running automatically

## How camera agents differ from jobs

- Camera agents focus on one camera and one continuous monitoring setup.
- Jobs are better when you need a scheduled workflow, multiple steps, or coordination across multiple targets.
