# Jobs

Use **Jobs** when you want a scheduled or repeatable workflow instead of a one-off chat request.

## What a job is

A job is the top-level workflow container. It defines when something should run, which targets should be included, and how the workflow is broken into steps.

## What jobs are useful for

- Nightly or hourly reviews of selected cameras.
- Repeating operational checks.
- Multi-camera workflows with separate stages.
- Structured automation that should run without a person typing in chat.

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
5. Add the target cameras.
6. Create one or more steps.
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

## When to choose a job instead of a camera agent

Choose a job when:

- you need a strict schedule
- you want several steps
- you need different logic across multiple cameras
- you want a structured workflow rather than one continuous watcher
