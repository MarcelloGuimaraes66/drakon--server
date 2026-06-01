# Tutorial

Basic flow:

1. Open Settings and generate a pairing code.
2. Enter the pairing code in the desktop EXE to connect the local machine to the account.
3. Add one or more cameras in the dashboard.
4. Configure API keys in Settings before enabling AI inference.
5. Start camera services and create custom camera agents or jobs if needed.
6. Use Chat to ask for video search, app help, or live state summaries.

Helpful shortcuts:

- Chat is best for asking natural-language questions about camera footage or how the app works.
- AI Agents are for continuous or repeated analysis on a specific camera.
- Jobs are for scheduled workflows with multiple steps and targets.
- Billing manages chat tokens, subscriptions, cards, and payment history.

Camera tutorial note:

- Stage 2 uses the **Cameras** page as the main visual example.
- The same camera actions are also available in **AI Agents**.
- The guided flow highlights **Scan Network**, **Import Cameras**, and **Register Camera** first.
- Then it explains the **IP / RTSP** form, switches to **Webcam**, fills webcam index `0` and the name `tutorial webcam`, saves it, and then continues to Stage 3.
- Stage 3 opens the tutorial camera's **Algorithms** page, creates a custom AI agent named `thumbs up detector`, explains **Enhance Prompt with AI**, and saves the agent on that camera.

If a request needs the current account state, the chat can use read_state. If it needs a product explanation, the chat can use explain_app.
