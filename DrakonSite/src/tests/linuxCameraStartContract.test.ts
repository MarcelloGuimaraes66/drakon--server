import test from "node:test";
import assert from "node:assert/strict";

import { describeCameraStartFailureDiagnostic } from "../shared/cameraStartDiagnostics";
import { evaluateLinuxCameraStartResult } from "../shared/linuxCameraStartContract";

test("Linux camera start succeeds with quick ack and first frame, without completed clip", () => {
  const result = evaluateLinuxCameraStartResult("completed", {
    started: true,
    first_frame_captured: true,
    recording_session_started: true,
    recording_clip_generated: false,
  });

  assert.equal(result.failed, false);
  assert.equal(result.started, true);
  assert.equal(result.firstFrameCaptured, true);
});

test("Linux camera start failure preserves agent error code", () => {
  const result = evaluateLinuxCameraStartResult("failed", {
    started: false,
    first_frame_captured: false,
    error_code: "webcam_permission_denied",
    error: "webcam_permission_denied: /dev/video0",
  });

  assert.equal(result.failed, true);
  assert.equal(result.errorCode, "webcam_permission_denied");
  assert.equal(result.errorMessage, "webcam_permission_denied: /dev/video0");
});

test("Linux agent absence has a clear UI diagnostic", () => {
  const diagnostic = describeCameraStartFailureDiagnostic({
    errorCode: "linux_agent_not_running",
    cameraName: "Front Door",
  });

  assert.deepEqual(diagnostic, {
    title: "Agent Offline",
    message: "Front Door could not start because the Linux agent is not polling commands.",
  });
});

test("Webcam permission failure has a clear UI diagnostic", () => {
  const diagnostic = describeCameraStartFailureDiagnostic({
    errorCode: "webcam_permission_denied",
    cameraName: "USB Webcam",
  });

  assert.deepEqual(diagnostic, {
    title: "Webcam Permission Denied",
    message: "USB Webcam could not start because the webcam device is not readable by this user.",
  });
});
