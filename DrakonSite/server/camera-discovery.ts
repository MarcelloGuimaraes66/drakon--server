import dgram from "node:dgram";
import net from "node:net";
import os from "node:os";
import { randomUUID } from "node:crypto";
import {
  buildCameraDiscoverySummary,
  type CameraDiscoveryDeviceKind,
  type CameraDiscoveryProtocol,
  type CameraDiscoveryResponse,
  type DiscoveredCameraDevice,
} from "../src/shared/cameraDiscovery";

type LocalIpv4Interface = {
  address: string;
};

type DeviceDraft = {
  ip: string;
  friendlyName: string;
  manufacturerGuess: string;
  modelGuess: string;
  discoveryProtocols: Set<CameraDiscoveryProtocol>;
  onvifXaddrs: Set<string>;
  rtspPortGuess: number | null;
  channelGuess: string | null;
  subtypeGuess: string | null;
  connectionMethodSuggested: "RTSP" | "HTTP" | "ONVIF";
  requiresCredentials: boolean;
  confidence: number;
  deviceKindGuess: CameraDiscoveryDeviceKind;
  channelLabel: string | null;
};

const WS_DISCOVERY_ADDRESS = "239.255.255.250";
const WS_DISCOVERY_PORT = 3702;
const RTSP_PROBE_PORTS = [554, 8554, 10554];

const CAMERA_VENDOR_PATTERNS: Array<[RegExp, string]> = [
  [/hikvision/i, "Hikvision"],
  [/dahua/i, "Dahua"],
  [/intelbras/i, "Intelbras"],
  [/\baxis\b/i, "Axis"],
  [/uniview|\bunv\b/i, "Uniview"],
  [/amcrest/i, "Amcrest"],
  [/reolink/i, "Reolink"],
  [/hanwha|wisenet/i, "Hanwha"],
];

function clampDiscoveryTimeout(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 5000;
  return Math.min(15000, Math.max(1000, Math.trunc(numeric)));
}

function getLocalIpv4Interfaces(): LocalIpv4Interface[] {
  const out: LocalIpv4Interface[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal || !entry.address) {
        continue;
      }
      out.push({ address: entry.address });
    }
  }
  return out;
}

function makeWsDiscoveryProbe(): string {
  const messageId = `uuid:${randomUUID()}`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"',
    ' xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"',
    ' xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"',
    ' xmlns:dn="http://www.onvif.org/ver10/network/wsdl">',
    "<e:Header>",
    "<w:MessageID>",
    messageId,
    "</w:MessageID>",
    "<w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>",
    "<w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>",
    "</e:Header>",
    "<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body>",
    "</e:Envelope>",
  ].join("");
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTagText(xml: string, tagName: string): string {
  const pattern = new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${tagName}[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${tagName}>`,
    "i"
  );
  const match = xml.match(pattern);
  return match ? decodeXmlEntities(match[1] || "").trim() : "";
}

function splitScopes(scopesText: string): string[] {
  return scopesText
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      try {
        return decodeURIComponent(item);
      } catch {
        return item;
      }
    });
}

function guessManufacturer(text: string): string {
  for (const [pattern, label] of CAMERA_VENDOR_PATTERNS) {
    if (pattern.test(text)) {
      return label;
    }
  }
  return "";
}

function extractScopeSuffix(scopes: string[], key: string): string {
  const needle = `/${key}/`;
  for (const scope of scopes) {
    const index = scope.toLowerCase().indexOf(needle);
    if (index === -1) {
      continue;
    }
    return scope.slice(index + needle.length).replace(/[_-]+/g, " ").trim();
  }
  return "";
}

function extractHostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^\[|\]$/g, "");
  } catch {
    const match = value.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    return match ? match[0] : "";
  }
}

function getOrCreateDraft(drafts: Map<string, DeviceDraft>, ip: string): DeviceDraft {
  const normalizedIp = ip.trim();
  const existing = drafts.get(normalizedIp);
  if (existing) {
    return existing;
  }

  const draft: DeviceDraft = {
    ip: normalizedIp,
    friendlyName: `Camera ${normalizedIp}`,
    manufacturerGuess: "",
    modelGuess: "",
    discoveryProtocols: new Set(),
    onvifXaddrs: new Set(),
    rtspPortGuess: null,
    channelGuess: null,
    subtypeGuess: null,
    connectionMethodSuggested: "RTSP",
    requiresCredentials: true,
    confidence: 0.35,
    deviceKindGuess: "UNKNOWN",
    channelLabel: null,
  };
  drafts.set(normalizedIp, draft);
  return draft;
}

async function runWsDiscovery(
  interfaces: LocalIpv4Interface[],
  timeoutMs: number,
  drafts: Map<string, DeviceDraft>
) {
  await Promise.all(
    interfaces.map(
      (networkInterface) =>
        new Promise<void>((resolve) => {
          const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
          const probe = Buffer.from(makeWsDiscoveryProbe(), "utf8");
          const timer = setTimeout(() => {
            socket.close();
            resolve();
          }, timeoutMs);

          socket.on("message", (message, remote) => {
            const xml = message.toString("utf8");
            const xaddrs = extractTagText(xml, "XAddrs")
              .split(/\s+/)
              .map((item) => item.trim())
              .filter(Boolean);
            const scopes = splitScopes(extractTagText(xml, "Scopes"));
            const textForGuess = `${xml} ${scopes.join(" ")}`;
            const discoveredIp =
              xaddrs.map(extractHostname).find(Boolean) || remote.address;
            if (!discoveredIp) {
              return;
            }

            const draft = getOrCreateDraft(drafts, discoveredIp);
            draft.discoveryProtocols.add("WS_DISCOVERY");
            draft.discoveryProtocols.add("ONVIF");
            draft.connectionMethodSuggested = "RTSP";
            draft.confidence = Math.max(draft.confidence, 0.9);
            draft.deviceKindGuess = "CAMERA";
            for (const xaddr of xaddrs) {
              draft.onvifXaddrs.add(xaddr);
            }

            const manufacturer = guessManufacturer(textForGuess);
            if (manufacturer) {
              draft.manufacturerGuess = manufacturer;
            }
            const scopeName = extractScopeSuffix(scopes, "name");
            const scopeHardware = extractScopeSuffix(scopes, "hardware");
            if (scopeName) {
              draft.friendlyName = scopeName;
            }
            if (scopeHardware) {
              draft.modelGuess = scopeHardware;
            }
          });

          socket.on("error", () => {
            clearTimeout(timer);
            socket.close();
            resolve();
          });

          socket.bind(0, networkInterface.address, () => {
            try {
              socket.setMulticastTTL(2);
              socket.setMulticastInterface(networkInterface.address);
              socket.send(probe, WS_DISCOVERY_PORT, WS_DISCOVERY_ADDRESS);
              socket.send(probe, WS_DISCOVERY_PORT, WS_DISCOVERY_ADDRESS);
            } catch {
              clearTimeout(timer);
              socket.close();
              resolve();
            }
          });

          socket.on("close", () => clearTimeout(timer));
        })
    )
  );
}

function buildLocalSubnetTargets(interfaces: LocalIpv4Interface[]): string[] {
  const targets = new Set<string>();
  for (const networkInterface of interfaces) {
    const parts = networkInterface.address.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
      continue;
    }

    const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
    for (let host = 1; host <= 254; host += 1) {
      const candidate = `${prefix}.${host}`;
      if (candidate !== networkInterface.address) {
        targets.add(candidate);
      }
    }
  }
  return Array.from(targets).slice(0, 1024);
}

function probeTcpPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

async function runRtspProbe(
  interfaces: LocalIpv4Interface[],
  timeoutMs: number,
  drafts: Map<string, DeviceDraft>
) {
  const targets = buildLocalSubnetTargets(interfaces);
  const jobs = targets.flatMap((host) => RTSP_PROBE_PORTS.map((port) => ({ host, port })));
  const concurrency = 96;
  const waves = Math.max(1, Math.ceil(jobs.length / concurrency));
  const portTimeoutMs = Math.min(900, Math.max(120, Math.trunc(timeoutMs / waves)));

  await runWithConcurrency(jobs, concurrency, async ({ host, port }) => {
    const open = await probeTcpPort(host, port, portTimeoutMs);
    if (!open) {
      return;
    }

    const draft = getOrCreateDraft(drafts, host);
    draft.discoveryProtocols.add("RTSP_PROBE");
    draft.rtspPortGuess = draft.rtspPortGuess || port;
    draft.connectionMethodSuggested = "RTSP";
    draft.confidence = Math.max(draft.confidence, port === 554 ? 0.72 : 0.62);
    draft.deviceKindGuess = draft.deviceKindGuess === "UNKNOWN" ? "CAMERA" : draft.deviceKindGuess;
  });
}

function toDiscoveredDevice(draft: DeviceDraft): DiscoveredCameraDevice {
  const manufacturer = draft.manufacturerGuess || "";
  const friendlyName =
    draft.friendlyName && draft.friendlyName !== `Camera ${draft.ip}`
      ? draft.friendlyName
      : manufacturer
      ? `${manufacturer} Camera`
      : `Camera ${draft.ip}`;

  return {
    id: `local:${draft.ip}:${draft.channelGuess || "default"}`,
    ip: draft.ip,
    friendly_name: friendlyName,
    manufacturer_guess: manufacturer,
    model_guess: draft.modelGuess,
    discovery_protocols: Array.from(draft.discoveryProtocols),
    onvif_xaddrs: Array.from(draft.onvifXaddrs),
    rtsp_port_guess: draft.rtspPortGuess || 554,
    channel_guess: draft.channelGuess,
    subtype_guess: draft.subtypeGuess,
    connection_method_suggested: draft.connectionMethodSuggested,
    requires_credentials: draft.requiresCredentials,
    confidence: Math.min(0.99, Math.max(0, draft.confidence)),
    device_kind_guess: draft.deviceKindGuess,
    channel_label: draft.channelLabel,
  };
}

export async function runLocalCameraDiscovery(rawTimeoutMs: unknown): Promise<CameraDiscoveryResponse> {
  const timeoutMs = clampDiscoveryTimeout(rawTimeoutMs);
  const startedAt = Date.now();
  const interfaces = getLocalIpv4Interfaces();
  const drafts = new Map<string, DeviceDraft>();

  if (interfaces.length > 0) {
    const wsTimeoutMs = Math.max(800, Math.trunc(timeoutMs * 0.6));
    await Promise.all([
      runWsDiscovery(interfaces, wsTimeoutMs, drafts),
      runRtspProbe(interfaces, timeoutMs, drafts),
    ]);
  }

  const devices = Array.from(drafts.values())
    .filter((draft) => draft.ip)
    .map(toDiscoveredDevice)
    .sort((left, right) => left.ip.localeCompare(right.ip, undefined, { numeric: true }));

  return {
    elapsed_ms: Date.now() - startedAt,
    timeout_ms: timeoutMs,
    devices,
    summary: buildCameraDiscoverySummary(devices),
  };
}
