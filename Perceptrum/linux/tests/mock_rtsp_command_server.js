const fs = require("fs");
const http = require("http");

const portFile = process.argv[2];
const resultFile = process.argv[3];
const fileSource = process.env.PERCEPTRUM_TEST_FILE_SOURCE || "";
if (!portFile || !resultFile || !fileSource) {
  console.error("usage: mock_rtsp_command_server.js <port-file> <result-file>");
  process.exit(64);
}

const commands = [
  {
    id: 200,
    command_type: "start_camera",
    camera_id: 30,
    payload: {
      camera_id: 30,
      name: "Linux RTSP lavfi command test",
      connection_method: "RTSP",
      rtsp_url: "lavfi:testsrc=size=96x54:rate=1",
      store_frames: true,
      retention_days: 1
    }
  },
  {
    id: 201,
    command_type: "start_camera",
    camera_id: 31,
    payload: {
      camera_id: 31,
      name: "Linux RTSP file command test",
      connection_method: "RTSP",
      stream_url: `file:${fileSource}`,
      store_frames: true,
      retention_days: 1
    }
  },
  {
    id: 202,
    command_type: "start_camera",
    camera_id: 32,
    payload: {
      camera_id: 32,
      name: "Linux RTSP invalid fields command test",
      connection_method: "RTSP",
      ip: "127.0.0.1",
      port: "1",
      manufacturer: "Hikvision",
      username: "admin",
      password: "secretpass",
      channel: "101",
      store_frames: true,
      retention_days: 1
    }
  }
];

let delivered = false;
const results = [];
const thumbnailUploads = [];

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
      fs.writeFileSync(resultFile, JSON.stringify({ results, thumbnailUploads }, null, 2));
      sendJson(res, 200, { success: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/agent/thumbnails") {
      const parsed = JSON.parse(body || "{}");
      thumbnailUploads.push({
        camera_id: Number(parsed.camera_id || url.searchParams.get("camera_id") || 0),
        has_jpeg: typeof parsed.jpeg_base64 === "string" && parsed.jpeg_base64.length > 32
      });
      fs.writeFileSync(resultFile, JSON.stringify({ results, thumbnailUploads }, null, 2));
      sendJson(res, 200, { ok: true });
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
