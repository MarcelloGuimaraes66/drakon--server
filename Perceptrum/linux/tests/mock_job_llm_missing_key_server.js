const fs = require("fs");
const http = require("http");

const portFile = process.argv[2];
const resultFile = process.argv[3];
if (!portFile || !resultFile) {
  console.error("usage: mock_job_llm_missing_key_server.js <port-file> <result-file>");
  process.exit(64);
}

const commands = [
  {
    id: 300,
    command_type: "job_start",
    camera_id: null,
    job_run_id: "linux-job-run-missing-key",
    payload: {
      job_run_id: "linux-job-run-missing-key",
      job: { id: 24, name: "Linux real provider missing key job" },
      model: "ultra",
      all_camera_ids: [24],
      steps: [
        {
          step_run_id: "linux-step-run-missing-key",
          step: { id: 2401, step_order: 1, name: "Needs real OpenAI" },
          targets: [{ id: 24001, camera_id: 24, camera_name: "Missing key synthetic camera" }],
          agents: [
            {
              id: 3401,
              agent_run_id: "linux-agent-run-missing-key",
              agent_key: "question",
              prompt_template: "Answer from the latest camera frame.",
              input_type: "image",
              inference_model: "ultra"
            }
          ]
        }
      ]
    }
  }
];

let delivered = false;
const results = [];

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
      fs.writeFileSync(resultFile, JSON.stringify({ results }, null, 2));
      sendJson(res, 200, { success: true });
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
