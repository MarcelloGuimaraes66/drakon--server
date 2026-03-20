# API Keys

Settings stores the external AI provider keys used by the app.

Available keys:

- OpenAI API key: required to enable AI agents, jobs, and chat inference that use the ultra or non-core path.
- Z.ai API key: required to enable Core model inference.

The Settings page lets the user:

- view whether a key is configured,
- see a masked preview,
- save a new key,
- remove a saved key.

The app does not need to expose raw secrets back to chat. Chat should only report whether OpenAI, Z.ai, and router configuration are present.
