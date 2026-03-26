import dgram from "node:dgram";
import net from "node:net";
import os from "node:os";
import { randomUUID } from "node:crypto";

const WS_DISCOVERY_HOST = "239.255.255.250";
const WS_DISCOVERY_PORT = 3702;
const DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 1500;
const MAX_TIMEOUT_MS = 12000;
const HTTP_PROBE_TIMEOUT_MS = 1200;
const TCP_PROBE_TIMEOUT_MS = 350;
const RTSP_PROBE_TIMEOUT_MS = 650;
const ACTIVE_SCAN_CONCURRENCY = 24;
const MAX_SWEEP_TARGETS = 512;
const HTTP_SCAN_PORTS = [80, 8080];
const AUXILIARY_TCP_PORTS = [8000, 37777];
const RTSP_PORT = 554;

const MANUFACTURER_PATTERNS = [
  { label: "Hikvision", pattern: /hikvision|hik[-\s]?connect|ds-\d/i },
  { label: "Dahua", pattern: /dahua|imou/i },
  { label: "Intelbras", pattern: /intelbras|mibo/i },
  { label: "Axis", pattern: /\baxis\b|axis-media/i },
  { label: "Hanwha", pattern: /hanwha|wisenet|samsung techwin/i },
  { label: "Uniview", pattern: /uniview|unv\b/i },
  { label: "Ubiquiti", pattern: /ubiquiti|unifi/i },
];

const DEVICE_KIND_PATTERNS = [
  { label: "DVR", pattern: /\bdvr\b|digital video recorder/i },
  { label: "NVR", pattern: /\bnvr\b|network video recorder/i },
  {
    label: "Camera",
    pattern:
      /\bcamera\b|\bipc\b|ipcam|network video|networkvideotransmitter|networkvideosource|onvif|rtsp|mibo/i,
  },
];

const STRONG_CAMERA_KEYWORDS =
  /\bonvif\b|\brtsp\b|\bnvr\b|\bdvr\b|\bipc\b|ipcam|network video|networkvideotransmitter|networkvideosource|mibo|intelbras|hikvision|dahua|imou|axis|wisenet|unifi/i;

const GENERIC_RESPONSE_PATTERNS = [
  /^\d{3}\s+[a-z][a-z\s-]*$/i,
  /^rtsp\/\d+\.\d+\s+\d{3}\s+[a-z][a-z\s-]*$/i,
  /^redirect/i,
  /^login$/i,
  /^home$/i,
  /^index$/i,
  /^not found$/i,
  /^forbidden$/i,
  /^unauthorized$/i,
];

function clampNumber(value, min, max, fallback) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
      ? Number.parseInt(value.trim(), 10)
      : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function buildWsDiscoveryProbe() {
  const messageId = `uuid:${randomUUID()}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
  xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
  xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>${messageId}</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </e:Body>
</e:Envelope>`;
}

function getDiscoveryInterfaceDetails() {
  const seen = new Set();
  const details = [];

  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (
        !entry ||
        entry.family !== "IPv4" ||
        entry.internal ||
        !entry.address ||
        !entry.netmask
      ) {
        continue;
      }

      if (seen.has(entry.address)) {
        continue;
      }

      seen.add(entry.address);
      details.push({
        name,
        address: entry.address,
        netmask: entry.netmask,
        cidr: entry.cidr || "",
      });
    }
  }

  return details;
}

function getDiscoveryInterfaces() {
  return getDiscoveryInterfaceDetails().map((entry) => entry.address);
}

function sendWsDiscoveryProbe(localAddress, payload, timeoutMs) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const messages = [];
    let settled = false;
    let timeoutId = null;
    let retryId = null;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;

      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      if (retryId !== null) {
        clearTimeout(retryId);
      }

      try {
        socket.close();
      } catch {
      }

      resolve(messages);
    };

    socket.on("message", (buffer, rinfo) => {
      messages.push({
        local_address: localAddress || "0.0.0.0",
        source_ip: rinfo.address,
        source_port: rinfo.port,
        xml: buffer.toString("utf8"),
      });
    });

    socket.on("error", () => {
      finish();
    });

    socket.bind(0, localAddress || "0.0.0.0", () => {
      try {
        socket.setBroadcast(true);
      } catch {
      }

      try {
        socket.setMulticastTTL(1);
      } catch {
      }

      try {
        if (localAddress) {
          socket.setMulticastInterface(localAddress);
        }
      } catch {
      }

      const encodedPayload = Buffer.from(payload, "utf8");
      socket.send(encodedPayload, WS_DISCOVERY_PORT, WS_DISCOVERY_HOST, () => {});

      retryId = setTimeout(() => {
        try {
          socket.send(encodedPayload, WS_DISCOVERY_PORT, WS_DISCOVERY_HOST, () => {});
        } catch {
        }
      }, Math.min(500, Math.max(180, Math.floor(timeoutMs / 4))));

      timeoutId = setTimeout(finish, timeoutMs);
    });
  });
}

async function runWsDiscoveryProbe(timeoutMs) {
  const interfaces = getDiscoveryInterfaces();
  const probePayload = buildWsDiscoveryProbe();
  const targets = interfaces.length > 0 ? interfaces : [null];
  const responses = await Promise.all(
    targets.map((address) => sendWsDiscoveryProbe(address, probePayload, timeoutMs))
  );
  return responses.flat();
}

function parseIpv4Address(value) {
  const parts = String(value || "")
    .trim()
    .split(".")
    .map((part) => Number.parseInt(part, 10));

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return (
    ((parts[0] << 24) >>> 0) |
    ((parts[1] << 16) >>> 0) |
    ((parts[2] << 8) >>> 0) |
    (parts[3] >>> 0)
  );
}

function formatIpv4Address(value) {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");
}

function netmaskToPrefix(netmask) {
  const maskInt = parseIpv4Address(netmask);
  if (maskInt === null) {
    return null;
  }

  let prefix = 0;
  let zeroSeen = false;

  for (let bit = 31; bit >= 0; bit -= 1) {
    const isSet = ((maskInt >>> bit) & 1) === 1;
    if (isSet) {
      if (zeroSeen) {
        return null;
      }
      prefix += 1;
    } else {
      zeroSeen = true;
    }
  }

  return prefix;
}

function prefixToNetmask(prefix) {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return null;
  }

  if (prefix === 0) {
    return 0;
  }

  return ((0xffffffff << (32 - prefix)) >>> 0);
}

function buildSweepTargets() {
  const targets = new Set();
  const localIps = new Set();

  for (const detail of getDiscoveryInterfaceDetails()) {
    const ipInt = parseIpv4Address(detail.address);
    const prefix = netmaskToPrefix(detail.netmask);
    if (ipInt === null || prefix === null) {
      continue;
    }

    localIps.add(detail.address);

    const effectivePrefix = prefix >= 24 ? prefix : 24;
    if (effectivePrefix > 30) {
      continue;
    }

    const effectiveMask = prefixToNetmask(effectivePrefix);
    if (effectiveMask === null) {
      continue;
    }

    const network = ipInt & effectiveMask;
    const broadcast = network | (~effectiveMask >>> 0);
    const firstHost = network + 1;
    const lastHost = broadcast - 1;

    for (let current = firstHost; current <= lastHost; current += 1) {
      if (targets.size >= MAX_SWEEP_TARGETS) {
        return {
          targets: Array.from(targets),
          localIps,
        };
      }

      if (current === ipInt) {
        continue;
      }

      targets.add(formatIpv4Address(current >>> 0));
    }
  }

  return {
    targets: Array.from(targets),
    localIps,
  };
}

function extractXmlTagValue(xml, tagName) {
  const matcher = new RegExp(
    `<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`,
    "i"
  );
  const match = xml.match(matcher);
  return match && typeof match[1] === "string" ? match[1].trim() : "";
}

function splitXmlWhitespaceList(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    )
  );
}

function extractIpFromUrl(candidate) {
  try {
    const url = new URL(candidate);
    return url.hostname || "";
  } catch {
    return "";
  }
}

function safeDecode(value) {
  if (!value) {
    return "";
  }

  try {
    return decodeURIComponent(value.replace(/\+/g, "%20")).trim();
  } catch {
    return value.trim();
  }
}

function isCameraLike(types, scopes, xaddrs) {
  const haystack = `${types.join(" ")} ${scopes.join(" ")} ${xaddrs.join(" ")}`.toLowerCase();
  return (
    haystack.includes("networkvideotransmitter") ||
    haystack.includes("networkvideosource") ||
    haystack.includes("videoencoder") ||
    haystack.includes("www.onvif.org") ||
    haystack.includes("/onvif/")
  );
}

function mergeCandidate(existing, next) {
  if (!existing) {
    return {
      ip: next.ip,
      xaddrs: [...next.xaddrs],
      types: [...next.types],
      scopes: [...next.scopes],
      endpoint_address: next.endpoint_address,
      source_ips: [next.source_ip].filter(Boolean),
    };
  }

  existing.xaddrs = uniqueStrings([...existing.xaddrs, ...next.xaddrs]);
  existing.types = uniqueStrings([...existing.types, ...next.types]);
  existing.scopes = uniqueStrings([...existing.scopes, ...next.scopes]);
  existing.source_ips = uniqueStrings([...existing.source_ips, next.source_ip]);

  if (!existing.endpoint_address && next.endpoint_address) {
    existing.endpoint_address = next.endpoint_address;
  }

  return existing;
}

function parseWsDiscoveryResponses(messages) {
  const mergedByIp = new Map();

  for (const message of messages) {
    if (!message || typeof message.xml !== "string" || !message.xml.trim()) {
      continue;
    }

    const xaddrs = uniqueStrings(splitXmlWhitespaceList(extractXmlTagValue(message.xml, "XAddrs")));
    const types = uniqueStrings(splitXmlWhitespaceList(extractXmlTagValue(message.xml, "Types")));
    const scopes = uniqueStrings(splitXmlWhitespaceList(extractXmlTagValue(message.xml, "Scopes")));
    const endpointAddress = extractXmlTagValue(message.xml, "Address");
    const ip = extractIpFromUrl(xaddrs[0]) || message.source_ip || "";

    if (!ip || !isCameraLike(types, scopes, xaddrs)) {
      continue;
    }

    const next = {
      ip,
      xaddrs,
      types,
      scopes,
      endpoint_address: endpointAddress,
      source_ip: message.source_ip || "",
    };

    mergedByIp.set(ip, mergeCandidate(mergedByIp.get(ip), next));
  }

  return Array.from(mergedByIp.values());
}

function extractScopeSuffix(scopes, marker) {
  const normalizedMarker = marker.toLowerCase();

  for (const scope of scopes) {
    const lowerScope = scope.toLowerCase();
    const index = lowerScope.indexOf(normalizedMarker);
    if (index === -1) {
      continue;
    }

    const value = scope.slice(index + marker.length);
    if (!value) {
      continue;
    }

    const slashIndex = value.indexOf("/");
    return safeDecode(slashIndex >= 0 ? value.slice(0, slashIndex) : value);
  }

  return "";
}

function extractHtmlTitle(body) {
  const match = String(body || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match && typeof match[1] === "string"
    ? match[1].replace(/\s+/g, " ").trim()
    : "";
}

function extractAuthRealm(value) {
  const match = String(value || "").match(/realm="?([^",]+)"?/i);
  return match && typeof match[1] === "string" ? match[1].trim() : "";
}

function detectManufacturer(...sources) {
  const haystack = sources
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ");

  for (const { label, pattern } of MANUFACTURER_PATTERNS) {
    if (pattern.test(haystack)) {
      return label;
    }
  }

  return "";
}

function detectDeviceKind(...sources) {
  const haystack = sources
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ");

  for (const { label, pattern } of DEVICE_KIND_PATTERNS) {
    if (pattern.test(haystack)) {
      return label;
    }
  }

  return "";
}

function sanitizeModelGuess(value) {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[^\w\s.\-/#]/g, " ")
    .trim();

  if (cleaned.length <= 1) {
    return "";
  }

  if (GENERIC_RESPONSE_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return "";
  }

  return cleaned;
}

function buildHttpProbeCandidates(ip, xaddrs) {
  const candidates = [];

  for (const candidate of xaddrs) {
    try {
      const url = new URL(candidate);
      if (url.protocol !== "http:") {
        continue;
      }

      candidates.push(url.toString());
      candidates.push(`${url.origin}/`);
    } catch {
    }
  }

  candidates.push(`http://${ip}/`);
  candidates.push(`http://${ip}/onvif/device_service`);

  return uniqueStrings(candidates).slice(0, 4);
}

function buildActiveHttpCandidates(ip, port) {
  const base = port === 80 ? `http://${ip}` : `http://${ip}:${port}`;
  return [`${base}/`, `${base}/onvif/device_service`];
}

async function probeHttpCandidate(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HTTP_PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": "DrakonDesktopCameraDiscovery/1.0",
      },
    });

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const shouldReadBody =
      contentType.includes("text/html") ||
      contentType.includes("application/xml") ||
      response.status === 200 ||
      response.status === 400 ||
      response.status === 401 ||
      response.status === 405;

    let bodySnippet = "";
    if (shouldReadBody) {
      bodySnippet = String(await response.text().catch(() => "")).slice(0, 4096);
    }

    return {
      url,
      status: response.status,
      server: String(response.headers.get("server") || "").trim(),
      www_authenticate: String(response.headers.get("www-authenticate") || "").trim(),
      title: extractHtmlTitle(bodySnippet),
      body_snippet: bodySnippet,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function probeHttpMetadata(ip, xaddrs) {
  const candidates = buildHttpProbeCandidates(ip, xaddrs);
  let best = null;

  for (const candidate of candidates) {
    const result = await probeHttpCandidate(candidate);
    if (!result) {
      continue;
    }

    if (!best) {
      best = result;
    }

    if (result.server || result.www_authenticate || result.title) {
      return result;
    }
  }

  return best;
}

function probeTcpOpen(ip, port, timeoutMs = TCP_PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    let timeoutId = null;

    const finish = (isOpen) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }

      try {
        socket.destroy();
      } catch {
      }

      resolve(isOpen);
    };

    timeoutId = setTimeout(() => finish(false), timeoutMs);
    socket.once("error", () => finish(false));
    socket.connect(port, ip, () => finish(true));
  });
}

function probeTcpBanner(ip, port, payload, timeoutMs = RTSP_PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const chunks = [];
    let didConnect = false;
    let settled = false;
    let timeoutId = null;
    let inactivityId = null;

    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      if (inactivityId !== null) {
        clearTimeout(inactivityId);
      }

      try {
        socket.destroy();
      } catch {
      }
    };

    const finish = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(result);
    };

    const armInactivityTimeout = () => {
      if (inactivityId !== null) {
        clearTimeout(inactivityId);
      }

      inactivityId = setTimeout(() => {
        finish({
          connected: true,
          data: Buffer.concat(chunks).toString("utf8"),
        });
      }, 120);
    };

    timeoutId = setTimeout(() => {
      finish({
        connected: didConnect,
        data: Buffer.concat(chunks).toString("utf8"),
      });
    }, timeoutMs);

    socket.once("error", () => finish(null));
    socket.connect(port, ip, () => {
      didConnect = true;
      armInactivityTimeout();

      try {
        socket.write(payload);
      } catch {
        finish({
          connected: true,
          data: Buffer.concat(chunks).toString("utf8"),
        });
      }
    });

    socket.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length >= 768) {
        finish({
          connected: true,
          data: Buffer.concat(chunks).toString("utf8"),
        });
        return;
      }

      armInactivityTimeout();
    });

    socket.on("end", () => {
      finish({
        connected: true,
        data: Buffer.concat(chunks).toString("utf8"),
      });
    });
  });
}

async function probeRtsp(ip) {
  const payload = `OPTIONS rtsp://${ip}/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: DrakonDesktopCameraDiscovery/1.0\r\n\r\n`;
  const result = await probeTcpBanner(ip, RTSP_PORT, payload, RTSP_PROBE_TIMEOUT_MS);
  if (!result || !result.connected) {
    return null;
  }

  const banner = String(result.data || "").slice(0, 1024);
  const statusLine = banner.split(/\r?\n/, 1)[0] || "";

  return {
    port: RTSP_PORT,
    status_line: statusLine,
    banner,
  };
}

async function probeHttpPorts(ip, openHttpPorts) {
  const probes = [];

  for (const port of openHttpPorts) {
    for (const candidate of buildActiveHttpCandidates(ip, port)) {
      const result = await probeHttpCandidate(candidate);
      if (!result) {
        continue;
      }

      probes.push({
        ...result,
        port,
      });
    }
  }

  return probes;
}

function collectProbeStrings(httpProbes, rtspProbe, openPorts) {
  const values = [];

  for (const probe of httpProbes) {
    values.push(
      probe.server,
      probe.www_authenticate,
      extractAuthRealm(probe.www_authenticate),
      probe.title,
      probe.body_snippet
    );
  }

  if (rtspProbe) {
    values.push(rtspProbe.status_line, rtspProbe.banner);
  }

  values.push(openPorts.map((port) => `port:${port}`).join(" "));
  return values.filter(Boolean);
}

function looksLikeCameraFromActiveProbe(httpProbes, rtspProbe, openPorts, manufacturerGuess, deviceKind) {
  const onvifHttpProbe = httpProbes.find(
    (probe) =>
      /\/onvif\/device_service$/i.test(probe.url) &&
      [200, 400, 401, 405].includes(Number(probe.status || 0))
  );

  if (onvifHttpProbe) {
    return true;
  }

  if (rtspProbe) {
    return true;
  }

  const keywordHaystack = [
    ...httpProbes.flatMap((probe) => [
      probe.server,
      extractAuthRealm(probe.www_authenticate),
      probe.title,
    ]),
    rtspProbe?.status_line || "",
    rtspProbe?.banner || "",
  ]
    .filter(Boolean)
    .join(" ");

  if (deviceKind === "NVR" || deviceKind === "DVR") {
    return true;
  }

  if (STRONG_CAMERA_KEYWORDS.test(keywordHaystack)) {
    return true;
  }

  if (
    manufacturerGuess &&
    /(camera|ipc|video|monitor)/i.test(keywordHaystack)
  ) {
    return true;
  }

  return openPorts.includes(RTSP_PORT) && openPorts.some((port) => port !== RTSP_PORT);
}

function computeActiveConfidenceScore(httpProbes, rtspProbe, openPorts, manufacturerGuess, deviceKind) {
  let score = 0.46;

  if (
    httpProbes.some(
      (probe) =>
        /\/onvif\/device_service$/i.test(probe.url) &&
        [200, 400, 401, 405].includes(Number(probe.status || 0))
    )
  ) {
    score += 0.18;
  }

  if (rtspProbe) {
    score += 0.18;
  }

  if (openPorts.includes(80) || openPorts.includes(8080)) {
    score += 0.04;
  }

  if (openPorts.includes(8000) || openPorts.includes(37777)) {
    score += 0.04;
  }

  if (manufacturerGuess) {
    score += 0.07;
  }

  if (deviceKind === "NVR" || deviceKind === "DVR") {
    score += 0.07;
  } else if (deviceKind === "Camera") {
    score += 0.05;
  }

  if (httpProbes.some((probe) => probe.title || probe.server || probe.www_authenticate)) {
    score += 0.05;
  }

  return Math.min(0.95, Math.max(0.52, Number(score.toFixed(2))));
}

async function scanActiveHost(ip) {
  const portsToCheck = [...HTTP_SCAN_PORTS, RTSP_PORT, ...AUXILIARY_TCP_PORTS];
  const portStates = await Promise.all(
    portsToCheck.map(async (port) => ({
      port,
      isOpen: await probeTcpOpen(ip, port),
    }))
  );

  const openPorts = portStates.filter((entry) => entry.isOpen).map((entry) => entry.port);
  if (openPorts.length === 0) {
    return null;
  }

  const [httpProbes, rtspProbe] = await Promise.all([
    probeHttpPorts(
      ip,
      openPorts.filter((port) => HTTP_SCAN_PORTS.includes(port))
    ),
    openPorts.includes(RTSP_PORT) ? probeRtsp(ip) : Promise.resolve(null),
  ]);

  const onvifXaddrs = uniqueStrings(
    httpProbes
      .filter(
        (probe) =>
          /\/onvif\/device_service$/i.test(probe.url) &&
          [200, 400, 401, 405].includes(Number(probe.status || 0))
      )
      .map((probe) => probe.url)
  );

  const evidenceStrings = collectProbeStrings(httpProbes, rtspProbe, openPorts);
  const manufacturerGuess = detectManufacturer(...evidenceStrings);
  const deviceKind = detectDeviceKind(
    ...httpProbes.flatMap((probe) => [
      probe.server,
      extractAuthRealm(probe.www_authenticate),
      probe.title,
    ]),
    rtspProbe?.status_line || "",
    rtspProbe?.banner || ""
  );
  if (
    !looksLikeCameraFromActiveProbe(
      httpProbes,
      rtspProbe,
      openPorts,
      manufacturerGuess,
      deviceKind
    )
  ) {
    return null;
  }

  const realmGuess = uniqueStrings(httpProbes.map((probe) => extractAuthRealm(probe.www_authenticate)))[0] || "";
  const titleGuess = uniqueStrings(httpProbes.map((probe) => probe.title))[0] || "";
  const modelGuess =
    sanitizeModelGuess(titleGuess) ||
    sanitizeModelGuess(realmGuess) ||
    sanitizeModelGuess(rtspProbe?.status_line || "");

  const friendlyName =
    sanitizeModelGuess(titleGuess) ||
    sanitizeModelGuess(realmGuess) ||
    (manufacturerGuess
      ? [manufacturerGuess, deviceKind].filter(Boolean).join(" ").trim()
      : "") ||
    `Camera ${ip}`;

  const discoveryProtocols = [];
  if (onvifXaddrs.length > 0) {
    discoveryProtocols.push("ONVIF");
  }
  if (httpProbes.length > 0) {
    discoveryProtocols.push("HTTP_PROBE");
  }
  if (rtspProbe || openPorts.includes(RTSP_PORT)) {
    discoveryProtocols.push("RTSP_PROBE");
  }

  return {
    id: `${ip}|active-probe`,
    ip,
    friendly_name: friendlyName,
    manufacturer_guess: manufacturerGuess,
    model_guess: modelGuess,
    discovery_protocols: uniqueStrings(discoveryProtocols),
    onvif_xaddrs: onvifXaddrs,
    rtsp_port_guess: openPorts.includes(RTSP_PORT) ? RTSP_PORT : 554,
    channel_guess: null,
    subtype_guess: null,
    connection_method_suggested: "RTSP",
    requires_credentials: true,
    confidence: computeActiveConfidenceScore(
      httpProbes,
      rtspProbe,
      openPorts,
      manufacturerGuess,
      deviceKind
    ),
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }

      try {
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      } catch {
        results[currentIndex] = null;
      }
    }
  });

  await Promise.all(runners);
  return results;
}

async function runActiveSubnetSweep() {
  const { targets } = buildSweepTargets();
  if (targets.length === 0) {
    return [];
  }

  const results = await mapWithConcurrency(
    targets,
    ACTIVE_SCAN_CONCURRENCY,
    async (ip) => scanActiveHost(ip)
  );

  return results.filter(Boolean);
}

function computeConfidenceScore(candidate, httpProbe, manufacturerGuess, friendlyName, modelGuess) {
  let score = 0.55;
  const typesText = candidate.types.join(" ").toLowerCase();

  if (typesText.includes("networkvideotransmitter") || typesText.includes("networkvideosource")) {
    score += 0.18;
  }

  if (candidate.xaddrs.length > 0) {
    score += 0.08;
  }

  if (manufacturerGuess) {
    score += 0.08;
  }

  if (friendlyName) {
    score += 0.05;
  }

  if (modelGuess) {
    score += 0.04;
  }

  if (httpProbe?.server || httpProbe?.www_authenticate || httpProbe?.title) {
    score += 0.04;
  }

  return Math.min(0.98, Math.max(0.5, Number(score.toFixed(2))));
}

function buildDiscoveryProtocols(candidate) {
  const protocols = ["WS_DISCOVERY"];
  const haystack = `${candidate.types.join(" ")} ${candidate.scopes.join(" ")} ${candidate.xaddrs.join(" ")}`.toLowerCase();
  if (haystack.includes("onvif")) {
    protocols.push("ONVIF");
  }
  return protocols;
}

async function enrichCandidate(candidate) {
  const httpProbe = await probeHttpMetadata(candidate.ip, candidate.xaddrs);
  const scopeName = extractScopeSuffix(candidate.scopes, "/name/");
  const scopeHardware = extractScopeSuffix(candidate.scopes, "/hardware/");
  const manufacturerGuess =
    detectManufacturer(
      candidate.scopes.join(" "),
      candidate.xaddrs.join(" "),
      candidate.types.join(" "),
      httpProbe?.server || "",
      httpProbe?.www_authenticate || "",
      httpProbe?.title || "",
      httpProbe?.body_snippet || ""
    ) || "";

  const modelGuess =
    sanitizeModelGuess(scopeHardware) ||
    sanitizeModelGuess(httpProbe?.title || "") ||
    sanitizeModelGuess(httpProbe?.server || "");

  const friendlyName =
    sanitizeModelGuess(scopeName) ||
    sanitizeModelGuess(httpProbe?.title || "") ||
    (modelGuess ? `${manufacturerGuess || "Camera"} ${modelGuess}`.trim() : `Camera ${candidate.ip}`);

  return {
    id: `${candidate.ip}|${(candidate.endpoint_address || candidate.xaddrs[0] || "device").trim()}`,
    ip: candidate.ip,
    friendly_name: friendlyName,
    manufacturer_guess: manufacturerGuess,
    model_guess: modelGuess,
    discovery_protocols: buildDiscoveryProtocols(candidate),
    onvif_xaddrs: candidate.xaddrs,
    rtsp_port_guess: 554,
    channel_guess: null,
    subtype_guess: null,
    connection_method_suggested: "RTSP",
    requires_credentials: true,
    confidence: computeConfidenceScore(
      candidate,
      httpProbe,
      manufacturerGuess,
      friendlyName,
      modelGuess
    ),
  };
}

function choosePreferredText(currentValue, nextValue, ip) {
  const score = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized) {
      return 0;
    }
    if (normalized === ip || normalized === `Camera ${ip}`) {
      return 1;
    }
    if (/^camera\s+\d+\.\d+\.\d+\.\d+$/i.test(normalized)) {
      return 1;
    }
    return 2 + Math.min(3, Math.floor(normalized.length / 12));
  };

  return score(nextValue) > score(currentValue) ? nextValue : currentValue;
}

function mergeDiscoveredDevice(existing, next) {
  if (!existing) {
    return {
      ...next,
      discovery_protocols: uniqueStrings(next.discovery_protocols),
      onvif_xaddrs: uniqueStrings(next.onvif_xaddrs),
    };
  }

  const preferred = next.confidence > existing.confidence ? next : existing;

  return {
    ...preferred,
    id: preferred.id,
    ip: existing.ip || next.ip,
    friendly_name: choosePreferredText(existing.friendly_name, next.friendly_name, existing.ip || next.ip),
    manufacturer_guess: choosePreferredText(
      existing.manufacturer_guess,
      next.manufacturer_guess,
      existing.ip || next.ip
    ),
    model_guess: choosePreferredText(existing.model_guess, next.model_guess, existing.ip || next.ip),
    discovery_protocols: uniqueStrings([
      ...existing.discovery_protocols,
      ...next.discovery_protocols,
    ]),
    onvif_xaddrs: uniqueStrings([...existing.onvif_xaddrs, ...next.onvif_xaddrs]),
    rtsp_port_guess: existing.rtsp_port_guess || next.rtsp_port_guess || RTSP_PORT,
    channel_guess: existing.channel_guess || next.channel_guess || null,
    subtype_guess: existing.subtype_guess || next.subtype_guess || null,
    requires_credentials: existing.requires_credentials || next.requires_credentials,
    confidence: Math.max(existing.confidence, next.confidence),
  };
}

export async function discoverCameraDevices(options = {}) {
  const startedAt = Date.now();
  const timeoutMs = clampNumber(
    options.timeout_ms ?? options.timeoutMs,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
  );

  const [responses, activeDevices] = await Promise.all([
    runWsDiscoveryProbe(timeoutMs),
    runActiveSubnetSweep(),
  ]);

  const parsedCandidates = parseWsDiscoveryResponses(responses);
  const wsDevices = await Promise.all(parsedCandidates.map((candidate) => enrichCandidate(candidate)));
  const mergedByIp = new Map();

  for (const device of [...wsDevices, ...activeDevices]) {
    mergedByIp.set(device.ip, mergeDiscoveredDevice(mergedByIp.get(device.ip), device));
  }

  const devices = Array.from(mergedByIp.values());

  devices.sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }
    return left.ip.localeCompare(right.ip);
  });

  return {
    elapsed_ms: Date.now() - startedAt,
    timeout_ms: timeoutMs,
    devices,
  };
}
