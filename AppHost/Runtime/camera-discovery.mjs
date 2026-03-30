import dgram from "node:dgram";
import net from "node:net";
import os from "node:os";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

const WS_DISCOVERY_HOST = "239.255.255.250";
const WS_DISCOVERY_PORT = 3702;
const DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 1500;
const MAX_TIMEOUT_MS = 12000;
const HTTP_PROBE_TIMEOUT_MS = 1200;
const TCP_PROBE_TIMEOUT_MS = 350;
const RTSP_PROBE_TIMEOUT_MS = 650;
const RECORDER_CHANNEL_PROBE_TIMEOUT_MS = 520;
const ACTIVE_SCAN_CONCURRENCY = 24;
const MAX_SWEEP_TARGETS = 512;
const RECORDER_CHANNEL_SCAN_LIMIT = 32;
const RECORDER_CHANNEL_CANARY_LIMIT = 4;
const RECORDER_CHANNEL_SCAN_CONCURRENCY = 8;
const HTTP_SCAN_PORTS = [80, 8080];
const AUXILIARY_TCP_PORTS = [8000, 37777];
const RTSP_PORT = 554;
const RTSP_SCAN_PORTS = [RTSP_PORT, 5544];
const NEIGHBOR_TABLE_TIMEOUT_MS = 1500;

const MANUFACTURER_PATTERNS = [
  { label: "Hikvision", pattern: /hikvision|hik[-\s]?connect|ds-\d/i },
  { label: "Intelbras", pattern: /intelbras|mibo/i },
  { label: "Dahua", pattern: /dahua|imou/i },
  { label: "Axis", pattern: /\baxis\b|axis-media/i },
  { label: "Hanwha", pattern: /hanwha|wisenet|samsung techwin/i },
  { label: "Uniview", pattern: /uniview|unv\b/i },
  { label: "Ubiquiti", pattern: /ubiquiti|unifi/i },
];

const DEVICE_KIND_PATTERNS = [
  { label: "DVR", pattern: /\bdvr\b|digital video recorder/i },
  { label: "NVR", pattern: /\bnvr\b|network video recorder/i },
  {
    label: "CAMERA",
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

const MAC_OUI_PREFIXES_BY_MANUFACTURER = {
  Hikvision: [
    "0C75D2",
    "240F9B",
    "2428FD",
    "2432AE",
    "244845",
    "548C81",
    "8CE748",
    "ACB92F",
    "C06DED",
    "D4E853",
    "ECC89C",
  ],
  Dahua: [
    "08EDED",
    "14A78B",
    "24526A",
    "38AF29",
    "3CE36B",
    "3CEF8C",
    "4C11BF",
    "5CF51A",
    "64FD29",
    "6C1C71",
    "74C929",
    "8CE9B4",
    "9002A9",
    "98F9CC",
    "9C1463",
    "A0BD1D",
    "B44C3B",
    "BC325F",
    "C0395A",
    "C4AAC4",
    "D4430E",
    "E02EFE",
    "E0508B",
    "E4246C",
    "F4B1C2",
    "FC5F49",
    "FCB69D",
  ],
  Intelbras: [
    "001A3F",
    "180D2C",
    "24FD0D",
    "30E1F1",
    "443B32",
    "4851CF",
    "546CAC",
    "54BAD9",
    "58108C",
    "808544",
    "808FE8",
    "982A0A",
    "98E55B",
    "AC1EA9",
    "B87EE5",
    "D8365F",
    "D8778B",
  ],
  Axis: ["00408C", "ACCC8E", "B8A44F", "E82725"],
  Uniview: ["48EA63", "6CF17E", "88263F", "C47905"],
};

const MAC_OUI_MANUFACTURER_LOOKUP = new Map(
  Object.entries(MAC_OUI_PREFIXES_BY_MANUFACTURER).flatMap(
    ([manufacturer, prefixes]) =>
      prefixes.map((prefix) => [String(prefix || "").trim().toUpperCase(), manufacturer])
  )
);

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

function normalizeMacAddress(value) {
  const compact = String(value || "")
    .replace(/[^a-fA-F0-9]/g, "")
    .trim()
    .toUpperCase();

  if (compact.length !== 12 || !/^[0-9A-F]{12}$/.test(compact)) {
    return "";
  }

  return compact.match(/.{2}/g)?.join(":") || "";
}

function extractMacOuiPrefix(value) {
  return normalizeMacAddress(value)
    .split(":")
    .slice(0, 3)
    .join("");
}

function isUsableNeighborMacAddress(value) {
  const normalized = normalizeMacAddress(value);
  if (!normalized) {
    return false;
  }

  const octets = normalized
    .split(":")
    .map((entry) => Number.parseInt(entry, 16))
    .filter((entry) => Number.isInteger(entry));

  if (octets.length !== 6) {
    return false;
  }

  if (octets.every((entry) => entry === 0) || octets.every((entry) => entry === 255)) {
    return false;
  }

  return (octets[0] & 1) === 0;
}

function detectManufacturerFromMacAddress(value) {
  const ouiPrefix = extractMacOuiPrefix(value);
  return ouiPrefix ? MAC_OUI_MANUFACTURER_LOOKUP.get(ouiPrefix) || "" : "";
}

function execFileText(file, args, timeoutMs = NEIGHBOR_TABLE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: "utf8",
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout = "", stderr = "") => {
        if (error) {
          if (typeof stdout === "string" && stdout.trim()) {
            resolve(stdout);
            return;
          }

          reject(stderr || error);
          return;
        }

        resolve(typeof stdout === "string" ? stdout : "");
      }
    );
  });
}

function parseNeighborMacTableLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) {
    return null;
  }

  const windowsMatch = trimmed.match(
    /^(\d{1,3}(?:\.\d{1,3}){3})\s+((?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2})\s+\S+/i
  );
  if (windowsMatch) {
    return {
      ip: windowsMatch[1],
      mac_address: normalizeMacAddress(windowsMatch[2]),
    };
  }

  const arpMatch = trimmed.match(
    /^\?\s+\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+((?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|<incomplete>)/i
  );
  if (arpMatch && !/incomplete/i.test(arpMatch[2])) {
    return {
      ip: arpMatch[1],
      mac_address: normalizeMacAddress(arpMatch[2]),
    };
  }

  const ipNeighMatch = trimmed.match(
    /^(\d{1,3}(?:\.\d{1,3}){3})\s+dev\s+\S+(?:\s+lladdr\s+((?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}))?/i
  );
  if (ipNeighMatch && ipNeighMatch[2]) {
    return {
      ip: ipNeighMatch[1],
      mac_address: normalizeMacAddress(ipNeighMatch[2]),
    };
  }

  return null;
}

function mergeNeighborMetadata(existing, next) {
  if (!existing) {
    return next;
  }

  if (!existing.manufacturer_guess && next.manufacturer_guess) {
    return next;
  }

  if (!existing.mac_address && next.mac_address) {
    return next;
  }

  return existing;
}

function parseNeighborMacTable(output) {
  const metadataByIp = new Map();

  for (const line of String(output || "").split(/\r?\n/)) {
    const parsed = parseNeighborMacTableLine(line);
    if (!parsed?.ip || !isUsableNeighborMacAddress(parsed.mac_address)) {
      continue;
    }

    metadataByIp.set(
      parsed.ip,
      mergeNeighborMetadata(metadataByIp.get(parsed.ip), {
        mac_address: parsed.mac_address,
        manufacturer_guess: detectManufacturerFromMacAddress(parsed.mac_address),
      })
    );
  }

  return metadataByIp;
}

async function readNeighborMacTable() {
  const commands =
    process.platform === "win32"
      ? [{ file: "arp", args: ["-a"] }]
      : [
          { file: "arp", args: ["-an"] },
          { file: "ip", args: ["neigh"] },
        ];
  const metadataByIp = new Map();

  for (const command of commands) {
    try {
      const output = await execFileText(command.file, command.args);
      const parsed = parseNeighborMacTable(output);

      for (const [ip, metadata] of parsed.entries()) {
        metadataByIp.set(ip, mergeNeighborMetadata(metadataByIp.get(ip), metadata));
      }
    } catch {
    }
  }

  return metadataByIp;
}

async function resolveMacMetadataByIp(ips) {
  const requestedIps = uniqueStrings(ips);
  if (requestedIps.length === 0) {
    return new Map();
  }

  const neighborMetadataByIp = await readNeighborMacTable();
  if (neighborMetadataByIp.size === 0) {
    return new Map();
  }

  const resolved = new Map();
  for (const ip of requestedIps) {
    const metadata = neighborMetadataByIp.get(ip);
    if (metadata) {
      resolved.set(ip, metadata);
    }
  }

  return resolved;
}

function applyMacMetadataToDevice(device, macMetadataByIp) {
  const ip = String(device?.ip || "").trim();
  if (!ip) {
    return device;
  }

  const metadata = macMetadataByIp.get(ip);
  const macManufacturer = String(metadata?.manufacturer_guess || "").trim();
  if (!macManufacturer) {
    return device;
  }

  const currentManufacturer = String(device?.manufacturer_guess || "").trim();
  const channelGuess = String(device?.channel_guess || "").trim();
  const friendlyName = String(device?.friendly_name || "").trim();
  const isRecorderDevice = isRecorderKind(normalizeDeviceKind(device?.device_kind_guess));
  const shouldPreferMacManufacturer =
    !currentManufacturer ||
    Boolean(channelGuess) ||
    isRecorderDevice ||
    /^recorder(?:\s+\d+\.\d+\.\d+\.\d+)?$/i.test(friendlyName);
  const nextDevice = { ...device };
  let changed = false;

  if (shouldPreferMacManufacturer && currentManufacturer !== macManufacturer) {
    nextDevice.manufacturer_guess = macManufacturer;
    changed = true;
  }

  if (channelGuess) {
    const channelLabel =
      String(device?.channel_label || "").trim() || `Channel ${channelGuess}`;
    const nextFriendlyName = buildRecorderChannelFriendlyName(
      {
        ...nextDevice,
        friendly_name: "",
      },
      channelLabel,
      channelGuess,
      nextDevice.subtype_guess
    );

    if (nextFriendlyName !== friendlyName) {
      nextDevice.friendly_name = nextFriendlyName;
      changed = true;
    }
  } else if (
    nextDevice.manufacturer_guess &&
    (isRecorderDevice || looksLikeGenericRecorderName(friendlyName, ip))
  ) {
    const nextFriendlyName = buildRecorderFriendlyName(nextDevice);
    if (nextFriendlyName !== friendlyName) {
      nextDevice.friendly_name = nextFriendlyName;
      changed = true;
    }
  }

  return changed ? nextDevice : device;
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

function normalizeDeviceKind(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "CAMERA" || normalized === "DVR" || normalized === "NVR") {
    return normalized;
  }
  return "UNKNOWN";
}

function isRecorderKind(value) {
  return value === "DVR" || value === "NVR";
}

function isRecorderChannelFamilyManufacturer(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return (
    normalized === "hikvision" ||
    normalized === "dahua" ||
    normalized === "intelbras"
  );
}

function displayDeviceKind(value) {
  const normalized = normalizeDeviceKind(value);
  if (normalized === "UNKNOWN") {
    return "";
  }
  return normalized === "CAMERA" ? "Camera" : normalized;
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

function looksLikeGenericCameraName(value, ip = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return true;
  }

  const normalizedIp = String(ip || "").trim();
  if (normalizedIp && normalized.toLowerCase() === `camera ${normalizedIp}`.toLowerCase()) {
    return true;
  }

  return /^camera\s+\d+\.\d+\.\d+\.\d+$/i.test(normalized);
}

function looksLikeGenericRecorderName(value, ip = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return true;
  }

  const normalizedIp = String(ip || "").trim();
  if (normalizedIp && normalized.toLowerCase() === `recorder ${normalizedIp}`.toLowerCase()) {
    return true;
  }

  return /^recorder(?:\s+\d+\.\d+\.\d+\.\d+)?$/i.test(normalized);
}

function hasRtspPortOpen(openPorts) {
  return openPorts.some((port) => RTSP_SCAN_PORTS.includes(port));
}

function getPreferredRtspPort(openPorts, manufacturerGuess = "") {
  const normalizedManufacturer = String(manufacturerGuess || "")
    .trim()
    .toLowerCase();

  if (
    (normalizedManufacturer === "dahua" || normalizedManufacturer === "intelbras") &&
    openPorts.includes(5544)
  ) {
    return 5544;
  }

  return RTSP_SCAN_PORTS.find((port) => openPorts.includes(port)) || null;
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

function extractMessageHeaderValue(message, headerName) {
  const normalizedHeader = String(headerName || "")
    .trim()
    .toLowerCase();
  if (!normalizedHeader) {
    return "";
  }

  for (const line of String(message || "").split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 0) {
      continue;
    }

    const currentHeader = line.slice(0, separatorIndex).trim().toLowerCase();
    if (currentHeader !== normalizedHeader) {
      continue;
    }

    return line.slice(separatorIndex + 1).trim();
  }

  return "";
}

function parseRtspStatusCode(statusLine) {
  const match = String(statusLine || "").match(/^RTSP\/\d+\.\d+\s+(\d{3})\b/i);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) ? parsed : null;
}

async function probeRtsp(ip, port = RTSP_PORT) {
  const payload = `OPTIONS rtsp://${ip}:${port}/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: DrakonDesktopCameraDiscovery/1.0\r\n\r\n`;
  const result = await probeTcpBanner(ip, port, payload, RTSP_PROBE_TIMEOUT_MS);
  if (!result || !result.connected) {
    return null;
  }

  const banner = String(result.data || "").slice(0, 1024);
  const statusLine = banner.split(/\r?\n/, 1)[0] || "";

  return {
    port,
    status_line: statusLine,
    status_code: parseRtspStatusCode(statusLine),
    banner,
  };
}

async function probeRtspResource(ip, port, path) {
  const normalizedPath = String(path || "").trim().startsWith("/")
    ? String(path || "").trim()
    : `/${String(path || "").trim()}`;
  const payload =
    `DESCRIBE rtsp://${ip}:${port}${normalizedPath} RTSP/1.0\r\n` +
    `CSeq: 1\r\n` +
    `Accept: application/sdp\r\n` +
    `User-Agent: DrakonDesktopCameraDiscovery/1.0\r\n\r\n`;
  const result = await probeTcpBanner(
    ip,
    port,
    payload,
    RECORDER_CHANNEL_PROBE_TIMEOUT_MS
  );
  if (!result || !result.connected) {
    return null;
  }

  const banner = String(result.data || "").slice(0, 1400);
  const statusLine = banner.split(/\r?\n/, 1)[0] || "";

  return {
    port,
    path: normalizedPath,
    status_line: statusLine,
    status_code: parseRtspStatusCode(statusLine),
    banner,
    www_authenticate: extractMessageHeaderValue(banner, "WWW-Authenticate"),
    content_base: extractMessageHeaderValue(banner, "Content-Base"),
  };
}

function buildInvalidRtspDiscoveryPath() {
  return `/drakon-discovery-invalid-${randomUUID()}`;
}

function normalizeRtspAuthSignature(probe) {
  if (!probe) {
    return "";
  }

  return JSON.stringify({
    status_code: Number(probe.status_code || 0),
    status_line: String(probe.status_line || "").replace(/\s+/g, " ").trim(),
    realm: extractAuthRealm(probe.www_authenticate || ""),
    www_authenticate: String(probe.www_authenticate || "")
      .replace(/nonce="[^"]*"/gi, 'nonce="*"')
      .replace(/opaque="[^"]*"/gi, 'opaque="*"')
      .replace(/\s+/g, " ")
      .trim(),
    content_base: String(probe.content_base || "").replace(/\s+/g, " ").trim(),
  });
}

function isGenericProtectedRtspResponse(probe, invalidProbe) {
  if (!probe?.www_authenticate) {
    return false;
  }

  if (!invalidProbe?.www_authenticate) {
    return true;
  }

  return normalizeRtspAuthSignature(probe) === normalizeRtspAuthSignature(invalidProbe);
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

function buildRecorderChannelStrategies(manufacturerGuess, openPorts) {
  const strategies = [];
  const normalizedManufacturer = String(manufacturerGuess || "")
    .trim()
    .toLowerCase();

  const pushStrategy = (strategy) => {
    if (!strategies.some((current) => current.key === strategy.key)) {
      strategies.push(strategy);
    }
  };

  const hikvisionStrategy = {
    key: "hikvision",
    manufacturer_label: "Hikvision",
    buildVariants(channelIndex) {
      const channelToken = `${channelIndex}01`;
      return [
        {
          channel_index: channelIndex,
          channel_label: `Channel ${channelIndex}`,
          channel_guess: channelToken,
          subtype_guess: null,
          path: `/Streaming/Channels/${channelToken}`,
        },
      ];
    },
  };

  const dahuaFamilyStrategy = (manufacturerLabel) => ({
    key: "dahua-family",
    manufacturer_label: manufacturerLabel,
    buildVariants(channelIndex) {
      const channelToken = String(channelIndex);
      return [
        {
          channel_index: channelIndex,
          channel_label: `Channel ${channelIndex}`,
          channel_guess: channelToken,
          subtype_guess: "0",
          path: `/cam/realmonitor?channel=${channelToken}&subtype=0`,
        },
        {
          channel_index: channelIndex,
          channel_label: `Channel ${channelIndex}`,
          channel_guess: channelToken,
          subtype_guess: "1",
          path: `/cam/realmonitor?channel=${channelToken}&subtype=1`,
        },
      ];
    },
  });

  if (normalizedManufacturer === "hikvision") {
    pushStrategy(hikvisionStrategy);
  }
  if (normalizedManufacturer === "intelbras") {
    pushStrategy(dahuaFamilyStrategy("Intelbras"));
  }
  if (normalizedManufacturer === "dahua") {
    pushStrategy(dahuaFamilyStrategy("Dahua"));
  }

  if (strategies.length === 0) {
    if (openPorts.includes(8000)) {
      pushStrategy(hikvisionStrategy);
    }
    if (openPorts.includes(37777)) {
      pushStrategy(
        dahuaFamilyStrategy(
          normalizedManufacturer === "intelbras" ? "Intelbras" : "Dahua"
        )
      );
    }
  }

  if (strategies.length === 0) {
    pushStrategy(hikvisionStrategy);
    pushStrategy(
      dahuaFamilyStrategy(
        normalizedManufacturer === "intelbras" ? "Intelbras" : "Dahua"
      )
    );
  }

  return strategies;
}

function looksLikeExistingRtspResource(probe, invalidProbe = null) {
  if (!probe) {
    return false;
  }

  if (probe.status_code === 200) {
    return true;
  }

  if (
    (probe.status_code === 301 || probe.status_code === 302) &&
    probe.content_base
  ) {
    return true;
  }

  if (
    (probe.status_code === 400 || probe.status_code === 405) &&
    probe.www_authenticate &&
    !isGenericProtectedRtspResponse(probe, invalidProbe)
  ) {
    return true;
  }

  if (
    probe.status_code === 401 &&
    probe.www_authenticate &&
    !isGenericProtectedRtspResponse(probe, invalidProbe)
  ) {
    return true;
  }

  return false;
}

function computeRecorderChannelConfidence(baseConfidence, probe) {
  let score = Math.max(0.58, Number(baseConfidence || 0) - 0.08);

  if (probe?.status_code === 200) {
    score = Math.max(score, Math.min(0.93, Number(baseConfidence || 0) + 0.02));
  } else if (probe?.status_code === 401) {
    score = Math.max(score, Math.min(0.88, Number(baseConfidence || 0) - 0.01));
  } else if (probe?.www_authenticate) {
    score = Math.max(score, 0.74);
  }

  return Number(score.toFixed(2));
}

function buildRecorderFriendlyName(baseDevice) {
  const existingName = String(baseDevice?.friendly_name || "").trim();
  if (
    existingName &&
    !looksLikeGenericCameraName(existingName, baseDevice?.ip) &&
    !looksLikeGenericRecorderName(existingName, baseDevice?.ip)
  ) {
    return existingName;
  }

  const manufacturer = String(baseDevice?.manufacturer_guess || "").trim();
  const deviceKind = displayDeviceKind(baseDevice?.device_kind_guess);
  const recorderKind = isRecorderKind(baseDevice?.device_kind_guess)
    ? deviceKind
    : "Recorder";
  const combined = [manufacturer, recorderKind].filter(Boolean).join(" ").trim();
  return combined || `Recorder ${String(baseDevice?.ip || "").trim()}`;
}

function buildRecorderChannelFriendlyName(baseDevice, channelLabel, channelGuess, subtypeGuess) {
  const baseName = buildRecorderFriendlyName(baseDevice);

  let suffix = channelLabel;
  if (channelGuess && channelGuess !== channelLabel) {
    suffix += ` (${channelGuess})`;
  }
  if (subtypeGuess && subtypeGuess !== "0") {
    suffix += ` subtype ${subtypeGuess}`;
  }

  return `${baseName} - ${suffix}`;
}

function buildRecorderCanaryIndexes(baseDevice) {
  const startIndex = isRecorderKind(baseDevice?.device_kind_guess) ? 1 : 2;
  return Array.from(
    { length: RECORDER_CHANNEL_CANARY_LIMIT },
    (_, index) => index + startIndex
  );
}

function inferRecorderChannelIndex(channelGuess) {
  const rawChannel = String(channelGuess || "").trim();
  if (!rawChannel) {
    return null;
  }

  const numericValue = Number.parseInt(rawChannel, 10);
  if (!Number.isInteger(numericValue)) {
    return null;
  }

  if (rawChannel.length >= 3 && rawChannel.endsWith("01")) {
    return Math.floor(numericValue / 100);
  }

  return numericValue;
}

function hasSecondaryRecorderChannel(devices) {
  return devices.some((device) => {
    const channelIndex = inferRecorderChannelIndex(device?.channel_guess);
    return Number.isInteger(channelIndex) && channelIndex > 1;
  });
}

function shouldAttemptRecorderChannelInference(
  baseDevice,
  openPorts,
  httpProbes,
  rtspProbe,
  onvifXaddrs
) {
  if (!hasRtspPortOpen(openPorts) || !rtspProbe) {
    return false;
  }

  if (isRecorderKind(baseDevice?.device_kind_guess)) {
    return true;
  }

  if (isRecorderChannelFamilyManufacturer(baseDevice?.manufacturer_guess)) {
    return true;
  }

  if (
    openPorts.includes(8000) ||
    openPorts.includes(37777) ||
    openPorts.includes(5544)
  ) {
    return true;
  }

  return (
    httpProbes.length > 0 &&
    onvifXaddrs.length === 0 &&
    looksLikeGenericCameraName(baseDevice?.friendly_name, baseDevice?.ip)
  );
}

async function detectRecorderChannelStrategy(baseDevice, openPorts) {
  const rtspPort =
    getPreferredRtspPort(openPorts, baseDevice.manufacturer_guess) ||
    baseDevice.rtsp_port_guess ||
    RTSP_PORT;
  const invalidProbe = await probeRtspResource(
    baseDevice.ip,
    rtspPort,
    buildInvalidRtspDiscoveryPath()
  );
  const strategies = buildRecorderChannelStrategies(
    baseDevice.manufacturer_guess,
    openPorts
  );
  const canaryIndexes = buildRecorderCanaryIndexes(baseDevice);

  for (const strategy of strategies) {
    for (const channelIndex of canaryIndexes) {
      for (const variant of strategy.buildVariants(channelIndex)) {
        const probe = await probeRtspResource(
          baseDevice.ip,
          rtspPort,
          variant.path
        );
        if (!looksLikeExistingRtspResource(probe, invalidProbe)) {
          continue;
        }

        return {
          invalidProbe,
          rtspPort,
          strategy,
        };
      }
    }
  }

  return {
    invalidProbe,
    rtspPort,
    strategy: null,
  };
}

async function enumerateRecorderChannelDevices(baseDevice, openPorts, strategyMatch = null) {
  const rtspPort =
    strategyMatch?.rtspPort ||
    getPreferredRtspPort(openPorts, baseDevice.manufacturer_guess) ||
    baseDevice.rtsp_port_guess ||
    RTSP_PORT;
  const invalidProbe =
    strategyMatch?.invalidProbe ||
    (await probeRtspResource(baseDevice.ip, rtspPort, buildInvalidRtspDiscoveryPath()));
  const strategies = strategyMatch?.strategy
    ? [strategyMatch.strategy]
    : buildRecorderChannelStrategies(baseDevice.manufacturer_guess, openPorts);
  const channelIndexes = Array.from(
    { length: RECORDER_CHANNEL_SCAN_LIMIT },
    (_, index) => index + 1
  );

  for (const strategy of strategies) {
    const results = await mapWithConcurrency(
      channelIndexes,
      RECORDER_CHANNEL_SCAN_CONCURRENCY,
      async (channelIndex) => {
        for (const variant of strategy.buildVariants(channelIndex)) {
          const probe = await probeRtspResource(
            baseDevice.ip,
            rtspPort,
            variant.path
          );
          if (!looksLikeExistingRtspResource(probe, invalidProbe)) {
            continue;
          }

          return {
            id: `${baseDevice.ip}|channel:${variant.channel_guess}|subtype:${
              variant.subtype_guess || "main"
            }`,
            ip: baseDevice.ip,
            friendly_name: buildRecorderChannelFriendlyName(
              baseDevice,
              variant.channel_label,
              variant.channel_guess,
              variant.subtype_guess
            ),
            manufacturer_guess:
              String(baseDevice.manufacturer_guess || "").trim() ||
              strategy.manufacturer_label,
            model_guess: baseDevice.model_guess,
            discovery_protocols: uniqueStrings([
              ...baseDevice.discovery_protocols,
              "RTSP_PROBE",
            ]),
            onvif_xaddrs: [...baseDevice.onvif_xaddrs],
            rtsp_port_guess: rtspPort,
            channel_guess: variant.channel_guess,
            subtype_guess: variant.subtype_guess,
            connection_method_suggested: "RTSP",
            requires_credentials: true,
            confidence: computeRecorderChannelConfidence(
              baseDevice.confidence,
              probe
            ),
            device_kind_guess: "CAMERA",
            channel_label: variant.channel_label,
          };
        }

        return null;
      }
    );

    const channelDevices = results.filter(Boolean);
    if (channelDevices.length > 0) {
      if (
        !isRecorderKind(baseDevice?.device_kind_guess) &&
        !hasSecondaryRecorderChannel(channelDevices)
      ) {
        continue;
      }

      return channelDevices;
    }
  }

  return [];
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

  if (isRecorderKind(deviceKind)) {
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

  return hasRtspPortOpen(openPorts) && openPorts.some((port) => !RTSP_SCAN_PORTS.includes(port));
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

  if (isRecorderKind(deviceKind)) {
    score += 0.07;
  } else if (deviceKind === "CAMERA") {
    score += 0.05;
  }

  if (httpProbes.some((probe) => probe.title || probe.server || probe.www_authenticate)) {
    score += 0.05;
  }

  return Math.min(0.95, Math.max(0.52, Number(score.toFixed(2))));
}

async function scanActiveHost(ip) {
  const portsToCheck = [...HTTP_SCAN_PORTS, ...RTSP_SCAN_PORTS, ...AUXILIARY_TCP_PORTS];
  const portStates = await Promise.all(
    portsToCheck.map(async (port) => ({
      port,
      isOpen: await probeTcpOpen(ip, port),
    }))
  );

  const openPorts = portStates.filter((entry) => entry.isOpen).map((entry) => entry.port);
  if (openPorts.length === 0) {
    return [];
  }

  const preferredRtspPort = getPreferredRtspPort(openPorts);

  const [httpProbes, rtspProbe] = await Promise.all([
    probeHttpPorts(
      ip,
      openPorts.filter((port) => HTTP_SCAN_PORTS.includes(port))
    ),
    preferredRtspPort ? probeRtsp(ip, preferredRtspPort) : Promise.resolve(null),
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
  const deviceKind = normalizeDeviceKind(
    detectDeviceKind(
      ...httpProbes.flatMap((probe) => [
        probe.server,
        extractAuthRealm(probe.www_authenticate),
        probe.title,
      ]),
      rtspProbe?.status_line || "",
      rtspProbe?.banner || ""
    )
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
  const deviceKindLabel = displayDeviceKind(deviceKind);
  const recorderAwareRtspPort =
    getPreferredRtspPort(openPorts, manufacturerGuess) ||
    preferredRtspPort ||
    RTSP_PORT;

  const friendlyName =
    sanitizeModelGuess(titleGuess) ||
    sanitizeModelGuess(realmGuess) ||
    (manufacturerGuess
      ? [manufacturerGuess, deviceKindLabel].filter(Boolean).join(" ").trim()
      : "") ||
    `Camera ${ip}`;

  const discoveryProtocols = [];
  if (onvifXaddrs.length > 0) {
    discoveryProtocols.push("ONVIF");
  }
  if (httpProbes.length > 0) {
    discoveryProtocols.push("HTTP_PROBE");
  }
  if (rtspProbe || hasRtspPortOpen(openPorts)) {
    discoveryProtocols.push("RTSP_PROBE");
  }

  const baseDevice = {
    id: `${ip}|active-probe`,
    ip,
    friendly_name: friendlyName,
    manufacturer_guess: manufacturerGuess,
    model_guess: modelGuess,
    discovery_protocols: uniqueStrings(discoveryProtocols),
    onvif_xaddrs: onvifXaddrs,
    rtsp_port_guess: recorderAwareRtspPort,
    channel_guess: null,
    subtype_guess: null,
    connection_method_suggested: "RTSP",
    requires_credentials: true,
    device_kind_guess: deviceKind,
    channel_label: null,
    confidence: computeActiveConfidenceScore(
      httpProbes,
      rtspProbe,
      openPorts,
      manufacturerGuess,
      deviceKind
    ),
  };

  if (
    !shouldAttemptRecorderChannelInference(
      baseDevice,
      openPorts,
      httpProbes,
      rtspProbe,
      onvifXaddrs
    )
  ) {
    return [baseDevice];
  }

  const strategyMatch = isRecorderKind(deviceKind)
    ? null
    : await detectRecorderChannelStrategy(baseDevice, openPorts);
  if (!isRecorderKind(deviceKind) && !strategyMatch?.strategy) {
    return [baseDevice];
  }

  const channelDevices = await enumerateRecorderChannelDevices(
    baseDevice,
    openPorts,
    strategyMatch
  );
  if (channelDevices.length === 0) {
    return [baseDevice];
  }

  return [
    {
      ...baseDevice,
      friendly_name: buildRecorderFriendlyName(baseDevice),
    },
    ...channelDevices,
  ];
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

  return results.flat().filter(Boolean);
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
  const deviceKind = normalizeDeviceKind(
    detectDeviceKind(
      candidate.scopes.join(" "),
      candidate.xaddrs.join(" "),
      candidate.types.join(" "),
      httpProbe?.server || "",
      httpProbe?.www_authenticate || "",
      httpProbe?.title || "",
      httpProbe?.body_snippet || ""
    )
  );
  const deviceKindLabel = displayDeviceKind(deviceKind);

  const modelGuess =
    sanitizeModelGuess(scopeHardware) ||
    sanitizeModelGuess(httpProbe?.title || "") ||
    sanitizeModelGuess(httpProbe?.server || "");

  const friendlyName =
    sanitizeModelGuess(scopeName) ||
    sanitizeModelGuess(httpProbe?.title || "") ||
    (modelGuess
      ? `${manufacturerGuess || deviceKindLabel || "Camera"} ${modelGuess}`.trim()
      : [manufacturerGuess, deviceKindLabel].filter(Boolean).join(" ").trim()) ||
    `Camera ${candidate.ip}`;

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
    device_kind_guess: deviceKind,
    channel_label: null,
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

function choosePreferredDeviceKind(currentValue, nextValue) {
  const current = normalizeDeviceKind(currentValue);
  const next = normalizeDeviceKind(nextValue);

  if (current === next) {
    return current;
  }
  if (current === "UNKNOWN") {
    return next;
  }
  if (next === "UNKNOWN") {
    return current;
  }
  if (isRecorderKind(next) && current === "CAMERA") {
    return next;
  }
  if (isRecorderKind(current) && next === "CAMERA") {
    return current;
  }
  return current;
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
    rtsp_port_guess:
      preferred.rtsp_port_guess ||
      existing.rtsp_port_guess ||
      next.rtsp_port_guess ||
      RTSP_PORT,
    channel_guess: existing.channel_guess || next.channel_guess || null,
    subtype_guess: existing.subtype_guess || next.subtype_guess || null,
    device_kind_guess: choosePreferredDeviceKind(
      existing.device_kind_guess,
      next.device_kind_guess
    ),
    channel_label: existing.channel_label || next.channel_label || null,
    requires_credentials: existing.requires_credentials || next.requires_credentials,
    confidence: Math.max(existing.confidence, next.confidence),
  };
}

function buildDiscoveryMergeKey(device) {
  const channelGuess = String(device?.channel_guess || "").trim();
  if (!channelGuess) {
    return String(device?.ip || "").trim();
  }

  const subtypeGuess = String(device?.subtype_guess || "").trim() || "main";
  return `${String(device?.ip || "").trim()}|channel:${channelGuess}|subtype:${subtypeGuess}`;
}

function discoveryChannelSortValue(device) {
  const rawChannel = String(device?.channel_guess || "").trim();
  if (!rawChannel) {
    return 0;
  }

  const numericValue = Number.parseInt(rawChannel, 10);
  if (!Number.isInteger(numericValue)) {
    return 1;
  }

  if (rawChannel.length >= 3 && rawChannel.endsWith("01")) {
    return Math.floor(numericValue / 100) + 1;
  }

  return numericValue + 1;
}

function compareDiscoveredDevices(left, right) {
  if (left.ip === right.ip) {
    const leftChannel = discoveryChannelSortValue(left);
    const rightChannel = discoveryChannelSortValue(right);
    if (leftChannel !== rightChannel) {
      return leftChannel - rightChannel;
    }
  }

  if (right.confidence !== left.confidence) {
    return right.confidence - left.confidence;
  }

  const ipCompare = String(left.ip || "").localeCompare(String(right.ip || ""), undefined, {
    numeric: true,
  });
  if (ipCompare !== 0) {
    return ipCompare;
  }

  return String(left.friendly_name || "").localeCompare(String(right.friendly_name || ""));
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
  const mergedByKey = new Map();

  for (const device of [...wsDevices, ...activeDevices]) {
    const mergeKey = buildDiscoveryMergeKey(device);
    mergedByKey.set(
      mergeKey,
      mergeDiscoveredDevice(mergedByKey.get(mergeKey), device)
    );
  }

  const devices = Array.from(mergedByKey.values());
  const macMetadataByIp = await resolveMacMetadataByIp(devices.map((device) => device.ip));
  const enrichedDevices = devices.map((device) => applyMacMetadataToDevice(device, macMetadataByIp));
  enrichedDevices.sort(compareDiscoveredDevices);

  return {
    elapsed_ms: Date.now() - startedAt,
    timeout_ms: timeoutMs,
    devices: enrichedDevices,
  };
}
