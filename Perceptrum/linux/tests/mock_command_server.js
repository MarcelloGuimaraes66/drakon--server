const fs = require("fs");
const http = require("http");

const portFile = process.argv[2];
const resultFile = process.argv[3];
if (!portFile || !resultFile) {
  console.error("usage: mock_command_server.js <port-file> <result-file>");
  process.exit(64);
}

const commands = [
  {
    id: 100,
    command_type: "start_camera",
    camera_id: 20,
    payload: {
      camera_id: 20,
      name: "Linux webcam command test",
      manufacturer: "Webcam",
      connection_method: "WEBCAM",
      webcam_index: 0,
      store_frames: true,
      retention_days: 1
    }
  },
  {
    id: 101,
    command_type: "job_start",
    camera_id: null,
    job_run_id: "linux-job-run-101",
    payload: {
      job_run_id: "linux-job-run-101",
      job: { id: 23, name: "Linux fake inference job" },
      model: "ultra",
      all_camera_ids: [22],
      steps: [
        {
          step_run_id: "linux-step-run-101",
          step: { id: 2301, step_order: 1, name: "Inspect synthetic camera" },
          targets: [{ id: 2201, camera_id: 22, camera_name: "Linux synthetic camera" }],
          agents: [
            {
              id: 3301,
              agent_run_id: "linux-agent-run-101",
              agent_key: "question",
              prompt_template: "Describe what is visible in the latest camera artifact.",
              input_type: "image",
              inference_model: "ultra"
            }
          ]
        }
      ],
      start_camera_payloads: {
        "22": {
          camera: {
            id: 22,
            name: "Linux synthetic camera",
            rtsp_url: "lavfi:testsrc=size=96x54:rate=1"
          }
        }
      }
    }
  },
  {
    id: 102,
    command_type: "job_stop",
    camera_id: null,
    job_run_id: "linux-job-run-101",
    payload: {
      job: { id: 23, name: "Linux fake inference job" }
    }
  }
];
let delivered = false;
const results = [];
const thumbnailUploads = [];
const events = [];

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    if (!req.headers.authorization || req.headers.authorization !== "Bearer TEST_TOKEN") {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/agent/commands") {
      if (url.searchParams.get("client_id") !== "test-client") {
        sendJson(res, 400, { error: "bad_client" });
        return;
      }
      if (delivered) {
        sendJson(res, 200, []);
        return;
      }
      delivered = true;
      sendJson(res, 200, commands);
      return;
    }

    const match = url.pathname.match(/^\/api\/agent\/commands\/(\d+)\/result$/);
    if (req.method === "POST" && match) {
      const parsed = JSON.parse(body || "{}");
      results.push({
        id: Number(match[1]),
        status: parsed.status,
        result: parsed.result,
        error: parsed.error || null
      });
      fs.writeFileSync(resultFile, JSON.stringify({ results, thumbnailUploads, events }, null, 2));
      sendJson(res, 200, { success: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/agent/events") {
      const parsed = JSON.parse(body || "{}");
      const details = parsed.details && typeof parsed.details === "object" ? { ...parsed.details } : {};
      if (typeof details.frame_jpeg_base64 === "string") details.frame_jpeg_base64 = "__redacted__";
      if (typeof details.image_jpeg_b64 === "string") details.image_jpeg_b64 = "__redacted__";
      events.push({
        event_type: parsed.event_type,
        camera_id: parsed.camera_id ?? null,
        job_run_id: parsed.job_run_id ?? details.job_run_id ?? null,
        step_run_id: parsed.step_run_id ?? details.step_run_id ?? null,
        agent_run_id: parsed.agent_run_id ?? details.agent_run_id ?? null,
        details
      });
      fs.writeFileSync(resultFile, JSON.stringify({ results, thumbnailUploads, events }, null, 2));
      sendJson(res, 200, { success: true, event_id: events.length });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/agent/thumbnails") {
      const parsed = JSON.parse(body || "{}");
      thumbnailUploads.push({
        camera_id: Number(parsed.camera_id || url.searchParams.get("camera_id") || 0),
        has_jpeg: typeof parsed.jpeg_base64 === "string" && parsed.jpeg_base64.length > 32
      });
      fs.writeFileSync(resultFile, JSON.stringify({ results, thumbnailUploads, events }, null, 2));
      sendJson(res, 200, { ok: true, filename: `mock-camera-${parsed.camera_id || "unknown"}.jpg` });
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  });
});

server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(portFile, String(server.address().port));
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
