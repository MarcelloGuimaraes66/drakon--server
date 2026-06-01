const fs = require("fs");
const http = require("http");

const portFile = process.argv[2];
if (!portFile) {
  console.error("missing port file argument");
  process.exit(64);
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    if (req.method !== "POST" || req.url !== "/api/pairing/pair") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    try {
      const parsed = JSON.parse(body || "{}");
      if (!parsed.pair_code || !parsed.exe_id || !parsed.timezone_iana) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_pairing_payload" }));
        return;
      }
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_json" }));
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      exe_token: "TEST_TOKEN",
      client_id: "test-client",
    }));
  });
});

server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(portFile, String(server.address().port));
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
