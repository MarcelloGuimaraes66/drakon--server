import { buildCameraRecordingSegments } from "../../../DrakonSite/src/worker/cameraRecordings.ts";

const dataRoot = process.argv[2];
const cameraId = Number(process.argv[3] || 0);

if (!dataRoot || !Number.isInteger(cameraId) || cameraId <= 0) {
  throw new Error("usage: verify_camera_recordings_endpoint.mjs <dataRoot> <cameraId>");
}

const now = Date.now();
const payload = await buildCameraRecordingSegments({
  env: {
    APP_RUNTIME_DATA_ROOT: dataRoot,
  },
  camera: {
    cameraId,
    storeFramesEnabled: true,
    isServiceRunning: true,
    isOnline: true,
    retentionDays: null,
  },
  query: {
    from: new Date(now - 60 * 60 * 1000).toISOString(),
    to: new Date(now + 60 * 60 * 1000).toISOString(),
    focusAt: new Date(now).toISOString(),
  },
});

const segments = Array.isArray(payload?.segments) ? payload.segments : [];
if (segments.length === 0) {
  throw new Error("recordings endpoint helper returned no segments");
}

const cadences = new Set(segments.map((segment) => Number(segment.cadence_seconds || 0)));
for (const expected of [10, 60, 300]) {
  if (!cadences.has(expected)) {
    throw new Error(`missing ${expected}s segment`);
  }
}

console.log(JSON.stringify({
  ok: true,
  segment_count: segments.length,
  cadences: [...cadences].sort((a, b) => a - b),
}));
