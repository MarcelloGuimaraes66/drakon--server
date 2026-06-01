# Jobs

Use **Jobs** when you want a scheduled or repeatable workflow instead of a one-off chat request.

## What a job is

A job is the top-level workflow container. It defines when the workflow should run, how long the schedule stays active, and how the work is broken into steps.

A job does **not** do the detailed camera analysis by itself. In the current workflow model, the real execution happens inside the steps. Cameras are attached to steps as targets, and the agent logic is configured inside the step context.

## What jobs are useful for

- Nightly or hourly reviews of selected areas.
- Repeating security checks that should run automatically.
- Multi-camera workflows with separate stages.
- Structured automation that should run without a person typing in chat.
- Supervised process execution across receiving, transfer, storage, production, and dispatch areas.
- Verifying that an item, vehicle, or team moved through the expected stages in the correct order.
- Management-focused control workflows such as route compliance, delivery confirmation, queue checks, destination validation, execution timing, and exception review.
- Workflows where the important result is not only detection, but also confirmation of sequence, destination, delay, or missed handoff.

## Main parts of a job

- **Name**: identifies the workflow clearly.
- **Description**: explains the business or operational purpose.
- **Schedule**: controls when the workflow runs. In the current product flow, new recurring jobs use `weekly`, `monthly`, or `yearly` schedule modes with time windows.
- **Active range**: controls from which date the recurring schedule becomes valid and until which date it stays active.
- **Steps**: define the actual stages of work inside the job.
- **Step targets**: define which cameras or sources are inspected in each step.
- **Step agents and alerts**: define how each step analyzes evidence and what should happen when a condition is met.

## Typical flow

1. Open **Jobs**.
2. Create a new job.
3. Give it a clear name and, if needed, a short description.
4. Configure the schedule mode, schedule days, time windows, and active date range.
5. Create one or more steps.
6. For each step, define order and timeout.
7. For each step, add the target cameras.
8. For each step or target, attach the right agent or prompt behavior.
9. If needed, add start conditions, pipeline inputs, grouped multi-camera logic, or alerts.
10. Save and activate the job.

## Practical examples

Example 1: nightly perimeter review.

- Job name: `Nightly perimeter review`
- Schedule: every day at 11:00 PM inside the configured recurring windows
- Steps: perimeter entrance review, parking sweep, rear access review
- Goal: check for people or vehicles after hours and raise alerts only when the configured condition is satisfied

Example 2: hourly reception check.

- Job name: `Reception occupancy check`
- Schedule: every hour during business supervision windows
- Steps: occupancy review, queue severity review, blocked-access follow-up
- Goal: identify queues, crowding, or blocked access and create repeatable operational evidence

Example 3: supervised cargo routing check.

- Job name: `Receiving to destination verification`
- Schedule: every time a receiving window starts, or at fixed supervision intervals
- Steps: receiving confirmation, transfer path review, destination confirmation, exception review
- Targets: `Receiving Dock`, `Internal Corridor`, `Storage Area B`
- Goal: confirm that a received load was unloaded, moved through the expected path, and delivered to the correct destination

Example 4: operational handoff supervision.

- Job name: `Shift handoff execution review`
- Schedule: at the end of each shift
- Steps: outgoing team completion, handoff zone review, incoming team takeover, exception review
- Targets: `Production Entrance`, `Packing Area`, `Dispatch Zone`
- Goal: verify whether the expected handoff steps were completed in sequence and whether any delay, wrong routing, or unattended material needs review

## When to choose a job instead of a camera agent

Choose a job when:

- you need a strict schedule
- you want several steps
- you need different logic across multiple cameras
- you want a structured workflow rather than one continuous watcher
- you need a process with order, timing, dependencies, or destination checks
- you need to supervise a business or operational process instead of only detecting a security event
- you want to confirm that something started in one place and finished in the correct destination
- you need visual evidence for compliance, execution quality, or exception handling in a repeatable workflow
- you want one stage to depend on another stage, either by sequence, start condition, or shared results
