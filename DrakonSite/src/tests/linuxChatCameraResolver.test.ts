import test from "node:test";
import assert from "node:assert/strict";

import { resolveChatCameraReferenceFromRows } from "../worker/chatCameraResolver";

test("resolves a Linux webcam by name mention in chat text", () => {
  const resolution = resolveChatCameraReferenceFromRows(
    [
      { id: 1, name: "webcam-ubuntu", connection_method: "WEBCAM", webcam_index: 0 },
      { id: 2, name: "front-door", connection_method: "RTSP" },
    ],
    "tem alguem em frente a webcam-ubuntu?",
    null
  );

  assert.equal(resolution.cameraId, 1);
  assert.deepEqual(resolution.cameraIds, [1]);
  assert.equal(resolution.cameraName, "webcam-ubuntu");
  assert.equal(resolution.cameraSelection.source, "name_mention");
});

test("keeps an explicit camera id when the UI sends one", () => {
  const resolution = resolveChatCameraReferenceFromRows(
    [
      { id: 1, name: "webcam-ubuntu", connection_method: "WEBCAM", webcam_index: 0 },
      { id: 2, name: "front-door", connection_method: "RTSP" },
    ],
    "pergunta generica",
    2
  );

  assert.equal(resolution.cameraId, 2);
  assert.deepEqual(resolution.cameraIds, [2]);
  assert.equal(resolution.cameraSelection.source, "explicit");
});
