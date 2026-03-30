import type { CameraEditorDraft } from "@/react-app/components/CameraEditorModal";
import type {
  CameraDiscoveryDeviceKind,
  CameraDiscoveryResponse,
  DiscoveredCameraDevice,
} from "@/shared/cameraDiscovery";

export type CameraDiscoveryImportRequest = {
  devices: DiscoveredCameraDevice[];
  username: string;
  password: string;
};

export type CameraDiscoveryImportFailure = {
  device: DiscoveredCameraDevice;
  message: string;
};

export type CameraDiscoveryImportResult = {
  created_count: number;
  failures: CameraDiscoveryImportFailure[];
};

const KNOWN_MANUFACTURERS = new Map<string, string>([
  ["hikvision", "Hikvision"],
  ["dahua", "Dahua"],
  ["intelbras", "Intelbras"],
  ["axis", "Axis"],
]);

function normalizeManufacturerGuess(value: string | null | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "Other";
  }

  return KNOWN_MANUFACTURERS.get(normalized) || "Other";
}

function normalizeConnectionMethod(device: DiscoveredCameraDevice): "RTSP" | "HTTP" | "ONVIF" {
  const suggested = String(device.connection_method_suggested || "")
    .trim()
    .toUpperCase();

  if (suggested === "HTTP" || suggested === "ONVIF") {
    return "RTSP";
  }

  return "RTSP";
}

function normalizeDeviceKind(
  value: unknown
): CameraDiscoveryDeviceKind {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();

  if (normalized === "CAMERA" || normalized === "DVR" || normalized === "NVR") {
    return normalized;
  }

  return "UNKNOWN";
}

function normalizeDiscoveredDevice(device: unknown): DiscoveredCameraDevice {
  const record =
    device && typeof device === "object" ? (device as Record<string, unknown>) : {};
  const suggestedConnectionMethod = String(
    record.connection_method_suggested || ""
  )
    .trim()
    .toUpperCase();

  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id : crypto.randomUUID(),
    ip: typeof record.ip === "string" ? record.ip : "",
    friendly_name: typeof record.friendly_name === "string" ? record.friendly_name : "",
    manufacturer_guess:
      typeof record.manufacturer_guess === "string" ? record.manufacturer_guess : "",
    model_guess: typeof record.model_guess === "string" ? record.model_guess : "",
    discovery_protocols: Array.isArray(record.discovery_protocols)
      ? record.discovery_protocols.filter(
          (protocol): protocol is DiscoveredCameraDevice["discovery_protocols"][number] =>
            protocol === "WS_DISCOVERY" ||
            protocol === "ONVIF" ||
            protocol === "HTTP_PROBE" ||
            protocol === "RTSP_PROBE"
        )
      : [],
    onvif_xaddrs: Array.isArray(record.onvif_xaddrs)
      ? record.onvif_xaddrs.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0
        )
      : [],
    rtsp_port_guess:
      typeof record.rtsp_port_guess === "number" && Number.isFinite(record.rtsp_port_guess)
        ? record.rtsp_port_guess
        : null,
    channel_guess:
      typeof record.channel_guess === "string" && record.channel_guess.trim()
        ? record.channel_guess
        : null,
    subtype_guess:
      typeof record.subtype_guess === "string" && record.subtype_guess.trim()
        ? record.subtype_guess
        : null,
    connection_method_suggested:
      suggestedConnectionMethod === "HTTP" || suggestedConnectionMethod === "ONVIF"
        ? (suggestedConnectionMethod as "HTTP" | "ONVIF")
        : "RTSP",
    requires_credentials: record.requires_credentials !== false,
    confidence:
      typeof record.confidence === "number" && Number.isFinite(record.confidence)
        ? record.confidence
        : 0,
    device_kind_guess: normalizeDeviceKind(record.device_kind_guess),
    channel_label:
      typeof record.channel_label === "string" && record.channel_label.trim()
        ? record.channel_label
        : null,
  };
}

function normalizeName(device: DiscoveredCameraDevice): string {
  const friendlyName = String(device.friendly_name || "").trim();
  if (friendlyName) {
    return friendlyName;
  }

  const manufacturer = String(device.manufacturer_guess || "").trim();
  const model = String(device.model_guess || "").trim();
  const base = [manufacturer, model].filter(Boolean).join(" ");
  return base || `Camera ${device.ip}`;
}

function buildDiscoveryImportKey(device: DiscoveredCameraDevice): string {
  const channel = String(device.channel_guess || "").trim();
  const subtype = String(device.subtype_guess || "").trim() || "main";
  if (!channel) {
    return device.id;
  }

  return `${device.ip}|channel:${channel}|subtype:${subtype}`;
}

function dedupeDiscoveryDevices(
  devices: DiscoveredCameraDevice[]
): DiscoveredCameraDevice[] {
  const deduped = new Map<string, DiscoveredCameraDevice>();

  for (const device of devices) {
    deduped.set(buildDiscoveryImportKey(device), device);
  }

  return Array.from(deduped.values());
}

export async function parseDiscoveryApiError(
  response: Response,
  fallback: string
): Promise<string> {
  const responseText = await response.text();

  try {
    const parsed = JSON.parse(responseText);
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error;
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    if (responseText.trim()) {
      return responseText.trim();
    }
  }

  return fallback;
}

export async function scanNetworkForCameras(
  timeoutMs = 5000
): Promise<CameraDiscoveryResponse> {
  const response = await fetch("/api/runtime/camera-discovery", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ timeout_ms: timeoutMs }),
  });

  if (!response.ok) {
    throw new Error(
      await parseDiscoveryApiError(
        response,
        "Failed to scan the local network for cameras."
      )
    );
  }

  const payload = (await response.json()) as CameraDiscoveryResponse;
  return {
    elapsed_ms:
      typeof payload.elapsed_ms === "number" ? payload.elapsed_ms : timeoutMs,
    timeout_ms: typeof payload.timeout_ms === "number" ? payload.timeout_ms : timeoutMs,
    devices: Array.isArray(payload.devices)
      ? payload.devices.map((device) => normalizeDiscoveredDevice(device))
      : [],
  };
}

export function buildDraftCameraFromDiscovery(
  device: DiscoveredCameraDevice
): CameraEditorDraft {
  const rtspPort =
    typeof device.rtsp_port_guess === "number" && Number.isFinite(device.rtsp_port_guess)
      ? String(device.rtsp_port_guess)
      : "554";

  const channelGuess =
    typeof device.channel_guess === "string" ? device.channel_guess.trim() : "";
  const subtypeGuess =
    typeof device.subtype_guess === "string" ? device.subtype_guess.trim() : "";

  return {
    name: normalizeName(device),
    ip_address: device.ip,
    rtsp_port: rtspPort,
    manufacturer: normalizeManufacturerGuess(device.manufacturer_guess),
    username: "",
    password: "",
    channel: channelGuess,
    subtype: subtypeGuess,
    connection_method: normalizeConnectionMethod(device),
    street: "",
    number: "",
    city: "",
    state: "",
    zip_code: "",
    country: "",
    retention_days: 1,
    allowpublicaccess: false,
  };
}

function buildCreateCameraPayloadFromDiscovery(
  device: DiscoveredCameraDevice,
  credentials: Pick<CameraDiscoveryImportRequest, "username" | "password">
): Record<string, unknown> {
  const draft = buildDraftCameraFromDiscovery(device);

  return {
    name: draft.name,
    ip_address: draft.ip_address,
    rtsp_port: draft.rtsp_port,
    manufacturer: draft.manufacturer,
    username: credentials.username.trim(),
    password: credentials.password,
    channel: draft.channel || undefined,
    subtype: draft.subtype || undefined,
    connection_method: draft.connection_method,
    street: draft.street,
    number: draft.number,
    city: draft.city,
    state: draft.state,
    zip_code: draft.zip_code,
    country: draft.country,
    retention_days: draft.retention_days,
    allowpublicaccess: Boolean(draft.allowpublicaccess),
  };
}

export async function createCamerasFromDiscoveryImport(
  request: CameraDiscoveryImportRequest
): Promise<CameraDiscoveryImportResult> {
  const devices = dedupeDiscoveryDevices(request.devices);
  const failures: CameraDiscoveryImportFailure[] = [];
  let createdCount = 0;

  for (const device of devices) {
    const response = await fetch("/api/cameras", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(
        buildCreateCameraPayloadFromDiscovery(device, {
          username: request.username,
          password: request.password,
        })
      ),
    });

    if (!response.ok) {
      failures.push({
        device,
        message: await parseDiscoveryApiError(response, "Failed to create camera."),
      });
      continue;
    }

    createdCount += 1;
  }

  return {
    created_count: createdCount,
    failures,
  };
}

export function formatDiscoveryImportErrorMessage(
  result: CameraDiscoveryImportResult
): string {
  const firstFailure = result.failures[0];
  if (!firstFailure) {
    return "";
  }

  const firstLabel = normalizeName(firstFailure.device);
  if (result.created_count > 0) {
    return `${result.created_count} camera(s) created, ${result.failures.length} failed. ${firstLabel}: ${firstFailure.message}`;
  }

  if (result.failures.length > 1) {
    return `${result.failures.length} camera(s) failed. ${firstLabel}: ${firstFailure.message}`;
  }

  return `${firstLabel}: ${firstFailure.message}`;
}
