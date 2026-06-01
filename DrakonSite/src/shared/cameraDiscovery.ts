export type CameraDiscoveryProtocol =
  | "WS_DISCOVERY"
  | "ONVIF"
  | "HTTP_PROBE"
  | "RTSP_PROBE";

export type CameraDiscoveryDeviceKind =
  | "CAMERA"
  | "DVR"
  | "NVR"
  | "RECORDER"
  | "UNKNOWN";

export interface DiscoveredCameraDevice {
  id: string;
  ip: string;
  friendly_name: string;
  manufacturer_guess: string;
  model_guess: string;
  discovery_protocols: CameraDiscoveryProtocol[];
  onvif_xaddrs: string[];
  rtsp_port_guess: number | null;
  channel_guess: string | null;
  subtype_guess: string | null;
  connection_method_suggested: "RTSP" | "HTTP" | "ONVIF";
  requires_credentials: boolean;
  confidence: number;
  device_kind_guess: CameraDiscoveryDeviceKind;
  channel_label: string | null;
}

export interface CameraDiscoveryGroup {
  key: string;
  root: DiscoveredCameraDevice;
  parent: DiscoveredCameraDevice | null;
  children: DiscoveredCameraDevice[];
  importableDevices: DiscoveredCameraDevice[];
  syntheticRoot: boolean;
}

export interface CameraDiscoveryRecorderGroupSummary {
  key: string;
  ip: string;
  title: string;
  kind: CameraDiscoveryDeviceKind;
  manufacturer_guess: string;
  model_guess: string;
  detected_channel_camera_count: number;
  detected_channels: string[];
  detected_channel_labels: string[];
}

export interface CameraDiscoveryStandaloneDeviceSummary {
  id: string;
  ip: string;
  title: string;
  kind: CameraDiscoveryDeviceKind;
  manufacturer_guess: string;
  model_guess: string;
}

export interface CameraDiscoverySummaryStats {
  total_device_count: number;
  total_importable_camera_count: number;
  recorder_count: number;
  recorder_group_count: number;
  recorder_channel_camera_count: number;
  standalone_camera_count: number;
  standalone_recorder_count: number;
}

export interface CameraDiscoverySummary {
  stats: CameraDiscoverySummaryStats;
  recorder_groups: CameraDiscoveryRecorderGroupSummary[];
  standalone_cameras: CameraDiscoveryStandaloneDeviceSummary[];
  standalone_recorders: CameraDiscoveryStandaloneDeviceSummary[];
}

export interface CameraDiscoveryResponse {
  elapsed_ms: number;
  timeout_ms: number;
  devices: DiscoveredCameraDevice[];
  summary?: CameraDiscoverySummary;
}

function looksLikeGenericManufacturerKindName(
  value: string,
  manufacturer: string,
  kindLabel: string
) {
  const normalized = String(value || "").trim();
  const normalizedManufacturer = String(manufacturer || "").trim();
  if (!normalized || !normalizedManufacturer) {
    return false;
  }

  return normalized.toLowerCase() === `${normalizedManufacturer} ${kindLabel}`.toLowerCase();
}

export function normalizeCameraDiscoveryDeviceKind(
  value: unknown
): CameraDiscoveryDeviceKind {
  const normalized = String(value || "").trim().toUpperCase();

  if (
    normalized === "CAMERA" ||
    normalized === "DVR" ||
    normalized === "NVR" ||
    normalized === "RECORDER"
  ) {
    return normalized;
  }

  return "UNKNOWN";
}

export function isRecorderDeviceKind(value: unknown) {
  const normalized = normalizeCameraDiscoveryDeviceKind(value);
  return normalized === "DVR" || normalized === "NVR" || normalized === "RECORDER";
}

export function looksLikeGenericCameraName(device: DiscoveredCameraDevice) {
  const normalizedName = String(device.friendly_name || "").trim();
  const manufacturer = String(device.manufacturer_guess || "").trim();
  if (!normalizedName) {
    return true;
  }

  if (normalizedName.toLowerCase() === `camera ${device.ip}`.toLowerCase()) {
    return true;
  }

  if (looksLikeGenericManufacturerKindName(normalizedName, manufacturer, "camera")) {
    return true;
  }

  return /^camera\s+\d+\.\d+\.\d+\.\d+$/i.test(normalizedName);
}

export function formatCameraDiscoveryChannelHint(device: DiscoveredCameraDevice) {
  const channelLabel = String(device.channel_label || "").trim();
  const channelGuess = String(device.channel_guess || "").trim();

  if (channelLabel && channelGuess && channelGuess !== channelLabel) {
    return `${channelLabel} (${channelGuess})`;
  }

  return channelLabel || channelGuess;
}

export function formatCameraDiscoveryDeviceTitle(
  device: DiscoveredCameraDevice,
  options?: { recorderGroup?: boolean }
) {
  const friendlyName = String(device.friendly_name || "").trim();
  const manufacturer = String(device.manufacturer_guess || "").trim();
  if (friendlyName && !(options?.recorderGroup && looksLikeGenericCameraName(device))) {
    return friendlyName;
  }

  if (options?.recorderGroup || isRecorderDeviceKind(device.device_kind_guess)) {
    return manufacturer ? `${manufacturer} Recorder` : `Recorder ${device.ip}`;
  }

  return friendlyName || `Camera ${device.ip}`;
}

export function channelSortValue(device: DiscoveredCameraDevice) {
  const rawChannel = String(device.channel_guess || "").trim();
  if (!rawChannel) {
    return 0;
  }

  const numericValue = Number.parseInt(rawChannel, 10);
  if (!Number.isInteger(numericValue)) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (rawChannel.length >= 3 && rawChannel.endsWith("01")) {
    return Math.floor(numericValue / 100);
  }

  return numericValue;
}

function sortChannels(left: DiscoveredCameraDevice, right: DiscoveredCameraDevice) {
  const channelDiff = channelSortValue(left) - channelSortValue(right);
  if (channelDiff !== 0) {
    return channelDiff;
  }

  return String(left.friendly_name || "").localeCompare(String(right.friendly_name || ""), undefined, {
    numeric: true,
  });
}

function shouldRenderRecorderGroup(
  parent: DiscoveredCameraDevice | null,
  children: DiscoveredCameraDevice[]
) {
  if (children.length === 0) {
    return false;
  }

  const parentKind = normalizeCameraDiscoveryDeviceKind(parent?.device_kind_guess);
  if (isRecorderDeviceKind(parentKind)) {
    return true;
  }

  return children.some((device) => channelSortValue(device) > 1);
}

function createSyntheticRecorderGroup(
  children: DiscoveredCameraDevice[],
  ip: string
): DiscoveredCameraDevice {
  const representative = children[0];
  const manufacturer = String(representative?.manufacturer_guess || "").trim();

  return {
    ...representative,
    id: `synthetic-recorder:${ip}`,
    friendly_name: manufacturer ? `${manufacturer} Recorder` : `Recorder ${ip}`,
    channel_guess: null,
    subtype_guess: null,
    channel_label: null,
    device_kind_guess: isRecorderDeviceKind(representative.device_kind_guess)
      ? normalizeCameraDiscoveryDeviceKind(representative.device_kind_guess)
      : "RECORDER",
  };
}

export function buildCameraDiscoveryGroups(
  devices: DiscoveredCameraDevice[]
): CameraDiscoveryGroup[] {
  const groupedByIp = new Map<string, DiscoveredCameraDevice[]>();

  for (const device of devices) {
    const ip = String(device.ip || "").trim() || device.id;
    const group = groupedByIp.get(ip) || [];
    group.push(device);
    groupedByIp.set(ip, group);
  }

  return Array.from(groupedByIp.entries()).map(([ip, group]) => {
    const parent = group.find((device) => !String(device.channel_guess || "").trim()) || null;
    const children = group
      .filter((device) => String(device.channel_guess || "").trim())
      .sort(sortChannels);

    if (children.length === 0 || !shouldRenderRecorderGroup(parent, children)) {
      const root = parent || group[0];
      return {
        key: ip,
        root,
        parent,
        children: [],
        importableDevices: [root],
        syntheticRoot: false,
      };
    }

    const syntheticRoot = !parent;
    const root = parent || createSyntheticRecorderGroup(children, ip);
    return {
      key: ip,
      root,
      parent,
      children,
      importableDevices: children,
      syntheticRoot,
    };
  });
}

function buildStandaloneSummary(
  device: DiscoveredCameraDevice
): CameraDiscoveryStandaloneDeviceSummary {
  return {
    id: device.id,
    ip: device.ip,
    title: formatCameraDiscoveryDeviceTitle(device),
    kind: normalizeCameraDiscoveryDeviceKind(device.device_kind_guess),
    manufacturer_guess: String(device.manufacturer_guess || "").trim(),
    model_guess: String(device.model_guess || "").trim(),
  };
}

export function buildCameraDiscoverySummary(
  devices: DiscoveredCameraDevice[]
): CameraDiscoverySummary {
  const groups = buildCameraDiscoveryGroups(devices);
  const recorderGroups = groups.filter((group) => group.children.length > 0);
  const standaloneGroups = groups.filter((group) => group.children.length === 0);
  const standaloneRecorders = standaloneGroups
    .map((group) => group.root)
    .filter((device) => isRecorderDeviceKind(device.device_kind_guess))
    .map(buildStandaloneSummary);
  const standaloneCameras = standaloneGroups
    .map((group) => group.root)
    .filter((device) => !isRecorderDeviceKind(device.device_kind_guess))
    .map(buildStandaloneSummary);

  const recorderGroupSummaries: CameraDiscoveryRecorderGroupSummary[] = recorderGroups.map(
    (group) => ({
      key: group.key,
      ip: group.root.ip,
      title: formatCameraDiscoveryDeviceTitle(group.root, { recorderGroup: true }),
      kind: normalizeCameraDiscoveryDeviceKind(group.root.device_kind_guess),
      manufacturer_guess: String(group.root.manufacturer_guess || "").trim(),
      model_guess: String(group.root.model_guess || "").trim(),
      detected_channel_camera_count: group.children.length,
      detected_channels: group.children
        .map((device) => String(device.channel_guess || "").trim())
        .filter(Boolean),
      detected_channel_labels: group.children
        .map((device) => formatCameraDiscoveryChannelHint(device))
        .filter(Boolean),
    })
  );

  return {
    stats: {
      total_device_count: devices.length,
      total_importable_camera_count: groups.reduce(
        (total, group) => total + group.importableDevices.length,
        0
      ),
      recorder_count: recorderGroupSummaries.length + standaloneRecorders.length,
      recorder_group_count: recorderGroupSummaries.length,
      recorder_channel_camera_count: recorderGroupSummaries.reduce(
        (total, group) => total + group.detected_channel_camera_count,
        0
      ),
      standalone_camera_count: standaloneCameras.length,
      standalone_recorder_count: standaloneRecorders.length,
    },
    recorder_groups: recorderGroupSummaries,
    standalone_cameras: standaloneCameras,
    standalone_recorders: standaloneRecorders,
  };
}
