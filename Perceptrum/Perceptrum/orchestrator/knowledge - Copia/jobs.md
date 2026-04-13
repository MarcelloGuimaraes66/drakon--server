# Jobs

Use **Jobs** when you want a scheduled or repeatable workflow instead of a one-off chat request.

## What a job is

A job is the top-level workflow container. It defines when something should run, which targets should be included, and how the workflow is broken into steps.

## What jobs are useful for

- Nightly or hourly reviews of selected cameras.
- Repeating operational checks.
- Multi-camera workflows with separate stages.
- Structured automation that should run without a person typing in chat.
- Supervised process execution across receiving, transfer, storage, and dispatch areas.
- Verifying that an item, vehicle, or team moved through the expected stages in the correct order.
- Management-focused control workflows such as route compliance, delivery confirmation, queue checks, and destination validation.

## Main parts of a job

- **Name**: identifies the workflow clearly.
- **Schedule**: controls when the workflow runs.
- **Targets**: define which cameras or sources the workflow can use.
- **Steps**: define the actual stages of work inside the job.

## Typical flow

1. Open **Jobs**.
2. Create a new job.
3. Give it a clear name.
4. Configure the schedule or run mode.
5. Create one or more steps.
6. For each step, add the target cameras.
7. For each step, attach the right agent or prompt behavior.
8. Save and activate the job.

## Practical examples

Example 1: nightly perimeter review.

- Job name: `Nightly perimeter review`
- Schedule: every day at 11:00 PM
- Targets: `Gate`, `Parking Lot`, `Back Entrance`
- Goal: check for people or vehicles after hours

Example 2: hourly reception check.

- Job name: `Reception occupancy check`
- Schedule: every hour
- Target: `Reception`
- Goal: identify queues, crowding, or blocked access

Example 3: supervised cargo routing check.

- Job name: `Receiving to destination verification`
- Schedule: every time a receiving window starts, or at fixed supervision intervals
- Targets: `Receiving Dock`, `Internal Corridor`, `Storage Area B`
- Goal: confirm that a received load was unloaded, moved through the expected path, and delivered to the correct destination

Example 4: operational handoff supervision.

- Job name: `Shift handoff execution review`
- Schedule: at the end of each shift
- Targets: `Production Entrance`, `Packing Area`, `Dispatch Zone`
- Goal: verify whether the expected handoff steps were completed in sequence and whether any delay, wrong routing, or unattended material needs review

## When to choose a job instead of a camera agent

Choose a job when:

- you need a strict schedule
- you want several steps
- you need different logic across multiple cameras
- you want a structured workflow rather than one continuous watcher
- you need to supervise a business or operational process instead of only detecting a security event
- you want to confirm that something started in one place and finished in the correct destination
- you need visual evidence for compliance, execution quality, or exception handling in a repeatable workflow
