# Chat Capabilities

Chat is the fastest place to ask what the app can do, inspect current operational state, search footage, and start guided actions without hunting through pages first.

## What chat is for

- Explain how the product works, where a feature lives, and which page or flow to use.
- Continue multi-step work in natural language instead of making the user restart from scratch.
- Bridge product help, live operational reads, and guided actions in one place.

## Specialized capability paths

Behind the scenes, the chat routes the request into specialized capability paths. The user does not need to know internal names, but the assistant does change behavior based on the type of request.

- Product help and onboarding: explain pairing, API keys, billing, camera setup, AI Agents, Jobs, Steps, orchestration, overall app behavior, and the chat itself.
- Current-state reading: list cameras, jobs, agents, balances, configs, recent runs, operational history, and persisted identity cards when those records exist.
- Video and image inspection: search one or more cameras, inspect uploaded images or videos, and answer questions about footage or detections through the existing media-search pipeline.
- Local network discovery: run Scan Network from chat to discover cameras, DVRs, and NVRs, then summarize what was found.
- Camera operations: register one camera, prepare batch registration for many cameras, edit one camera, batch-edit many cameras, and start or stop one camera runtime.
- Job operations: create scheduled jobs and multi-step workflows, edit one existing job, and start, stop, pause, or resume a job runtime.
- Agent operations: create or edit agents on a camera or inside a job step, including destination selection, cadence, prompt changes, enable or disable, negative conditions, and region-based flows that need visual context.
- Reports: generate downloadable reports about current state, history, detections, alerts, jobs, agents, logs, comparisons, and relevant chat context.
- Direct answers: when no specialized action is the right fit, chat can still answer directly in a normal conversational way.

## How chat handles multi-turn work

- It can keep an active task open across several messages instead of treating every message as a brand-new request.
- It asks for missing fields when a request is actionable but incomplete.
- It prefers confirmation over guessing when the target is ambiguous.
- It supports follow-ups such as `use the same for all 5`, `that camera`, `the same address`, or `now do the step version`.
- For batch camera work, it can keep collecting rows, shared defaults, and edit rules across turns.

## Memory and coherence

- Chat keeps two main kinds of conversational memory:
  1. Recent turns for immediate continuity.
  2. A compact long-lived summary for older context.
- The compact memory keeps durable facts such as summary, user goals, constraints, preferences, selected entities, decisions, and open loops.
- It also keeps task memory for the current operation, including active task, phase, goal, collected fields, missing fields, and recent completed tasks.
- It remembers key session entities such as the last relevant name or id so short follow-ups are easier to resolve.
- When the conversation gets long, older turns are compacted and only the most recent turns stay verbatim.
- The current user message always wins if it clearly changes topic.
- Compact memory is not supposed to keep secrets such as passwords, API keys, tokens, RTSP URLs, or other private credentials.

## Language behavior

- Chat is built around the supported UI languages: English, Portuguese, Spanish, French, Chinese, and Arabic.
- It tries to answer in the user's language.
- If the user's language is unsupported, it falls back to English instead of guessing a nearby language.
- Product knowledge can fall back to English internally while the final answer is still rewritten into the user's reply language.

## Guardrails and limits

- Chat should not invent live state. If the answer depends on inspection, it should read the actual state first.
- Chat should not invent camera credentials, IPs, ports, usernames, passwords, or addresses that the user did not provide.
- Some actions depend on connected local runtime, valid chat session context, available account data, or enabled product permissions.
- Product explanations are grounded in the local knowledge documents whenever that is the safest path.
- User-facing answers are polished to stay concise, product-focused, and free from implementation details.

## Best ways to ask

- `What can chat do for me?`
- `What are you able to do in this app?`
- `List the kinds of things chat can help with.`
- `Can you inspect my cameras and jobs from here?`
- `Can you create or edit cameras, agents, or jobs for me?`
- `How do you keep context between messages?`
- `What are your limits?`

## Practical rule of thumb

- Use chat when the user wants one of three things:
  1. A grounded explanation of the product.
  2. A read or search across current state, history, or footage.
  3. A guided action that can continue across multiple turns until it is confirmed or completed.
