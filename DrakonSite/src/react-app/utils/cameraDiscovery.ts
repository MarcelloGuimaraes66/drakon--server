import type { CameraEditorDraft } from "@/react-app/components/CameraEditorModal";
import type {
  CameraDiscoveryResponse,
  DiscoveredCameraDevice,
} from "@/shared/cameraDiscovery";

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
    devices: Array.isArray(payload.devices) ? payload.devices : [],
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
