# Camera Creation

Use the **Cameras** area when you want to register a new camera, review connection details, or start the local capture service.

## What this area is for

- Register RTSP/IP cameras or local devices.
- Name and describe each camera so the rest of the app can reference it clearly.
- Validate that the local EXE can connect to the stream.
- Start or stop the local service that keeps the stream available for chat, agents, and jobs.

## Typical flow

1. Open **Cameras**.
2. Create a new camera entry.
3. Fill in the camera name and a short description.
4. Enter the connection details such as IP, port, username, password, channel, and subtype when needed.
5. Save the camera.
6. Start the local camera service.
7. Confirm that the camera appears online and that thumbnails or recent frames are updating.

## Practical example

Example: adding a front entrance camera.

1. Create a camera named `Front Entrance`.
2. Add a description such as `Main door and sidewalk`.
3. Enter the RTSP/IP connection settings from the camera vendor.
4. Save the camera.
5. Start the service.
6. Confirm that the feed is live before creating agents or jobs for that camera.

## When to use this first

Create the camera before:

- creating camera agents
- building jobs that target that camera
- asking the chat to inspect recent footage from that camera

## Troubleshooting checklist

- If the camera does not connect, verify IP, port, username, password, channel, and subtype.
- If the camera is saved but the service is not running, start the local service before using AI features.
- If thumbnails do not update, confirm that the EXE is paired and the camera stream is reachable from the local machine.
