# App Overview

The app connects a paired desktop EXE to the web dashboard so the account can run camera streams, AI agents, jobs, and chat requests.

Main areas:

- Cameras: register cameras, start or stop the local service, and keep thumbnails and descriptions updated.
- AI Agents: create custom camera agents that analyze video or images on a specific camera.
- Jobs: configure scheduled or one-shot workflows with steps, targets, and agents.
- Chat: ask for video search, tutorial help, billing guidance, and state summaries.
- Settings: pairing, API keys, Telegram, and user preferences.
- Billing: subscriptions, chat tokens, cards, and payment history.

The local EXE is the bridge between live camera access and the cloud worker. Pairing links the account to one desktop client_id. Once paired, the worker can enqueue commands and the EXE can report results back.
