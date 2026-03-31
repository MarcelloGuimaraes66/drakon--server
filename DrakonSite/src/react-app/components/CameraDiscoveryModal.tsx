import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Wifi,
  X,
} from "lucide-react";
import type { DiscoveredCameraDevice } from "@/shared/cameraDiscovery";
import {
  scanNetworkForCameras,
  type CameraDiscoveryImportRequest,
} from "@/react-app/utils/cameraDiscovery";

type CameraDiscoveryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onImport: (request: CameraDiscoveryImportRequest) => Promise<void> | void;
};

type DiscoveryStage = "idle" | "scanning" | "ready" | "error";

type DiscoveryGroup = {
  key: string;
  root: DiscoveredCameraDevice;
  parent: DiscoveredCameraDevice | null;
  children: DiscoveredCameraDevice[];
  importableDevices: DiscoveredCameraDevice[];
};

type PreviewEntry = {
  device: DiscoveredCameraDevice;
  group: DiscoveryGroup;
  isGroupRoot: boolean;
};

type SelectionCheckboxProps = {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

function isRecorderDeviceKind(value: unknown) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "DVR" || normalized === "NVR" || normalized === "RECORDER";
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

function formatConfidence(value: number) {
  const normalized = Number.isFinite(value) ? Math.round(value * 100) : 0;
  return `${normalized}% confidence`;
}

function formatProtocols(device: DiscoveredCameraDevice) {
  return Array.isArray(device.discovery_protocols) && device.discovery_protocols.length > 0
    ? device.discovery_protocols.join(" / ")
    : "WS discovery";
}

function looksLikeGenericCameraName(device: DiscoveredCameraDevice) {
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

function formatModel(
  device: DiscoveredCameraDevice,
  options?: { recorderGroup?: boolean }
) {
  const manufacturer = String(device.manufacturer_guess || "").trim();
  const model = String(device.model_guess || "").trim();
  if (manufacturer && model) {
    return `${manufacturer} / ${model}`;
  }
  if (manufacturer || model) {
    return manufacturer || model;
  }
  return options?.recorderGroup
    ? "Recorder channel group inferred from network scan"
    : "Manufacturer not identified yet";
}

function formatDeviceKind(
  device: DiscoveredCameraDevice,
  options?: { recorderGroup?: boolean }
) {
  const kind = String(device.device_kind_guess || "").trim().toUpperCase();
  if (options?.recorderGroup) {
    if (kind === "DVR" || kind === "NVR") {
      return kind;
    }
    return "Recorder";
  }

  if (!kind || kind === "UNKNOWN") {
    return "";
  }

  if (kind === "CAMERA") {
    return "Camera";
  }
  if (kind === "RECORDER") {
    return "Recorder";
  }
  return kind;
}

function formatChannelHint(device: DiscoveredCameraDevice) {
  const channelLabel = String(device.channel_label || "").trim();
  const channelGuess = String(device.channel_guess || "").trim();

  if (channelLabel && channelGuess && channelGuess !== channelLabel) {
    return `${channelLabel} (${channelGuess})`;
  }

  return channelLabel || channelGuess;
}

function formatDeviceTitle(
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

function channelSortValue(device: DiscoveredCameraDevice) {
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

  const parentKind = String(parent?.device_kind_guess || "").trim().toUpperCase();
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
      ? representative.device_kind_guess
      : "RECORDER",
  };
}

function groupDiscoveredDevices(devices: DiscoveredCameraDevice[]): DiscoveryGroup[] {
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
      return { key: ip, root, parent, children: [], importableDevices: [root] };
    }

    const root = parent || createSyntheticRecorderGroup(children, ip);
    return { key: ip, root, parent, children, importableDevices: children };
  });
}

function SelectionCheckbox({
  checked,
  indeterminate = false,
  label,
  onChange,
}: SelectionCheckboxProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={checked}
      aria-label={label}
      onChange={onChange}
      onClick={(event) => event.stopPropagation()}
      className="h-4 w-4 cursor-pointer rounded border border-gray-600 bg-gray-950 accent-cyan-400"
    />
  );
}

export default function CameraDiscoveryModal({
  isOpen,
  onClose,
  onImport,
}: CameraDiscoveryModalProps) {
  const [stage, setStage] = useState<DiscoveryStage>("idle");
  const [devices, setDevices] = useState<DiscoveredCameraDevice[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [previewId, setPreviewId] = useState<string>("");
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [sharedUsername, setSharedUsername] = useState("");
  const [sharedPassword, setSharedPassword] = useState("");
  const groupedDevices = useMemo(() => groupDiscoveredDevices(devices), [devices]);
  const importableDevices = useMemo(
    () => groupedDevices.flatMap((group) => group.importableDevices),
    [groupedDevices]
  );
  const recorderGroupCount = useMemo(
    () => groupedDevices.filter((group) => group.children.length > 0).length,
    [groupedDevices]
  );
  const selectedDevices = useMemo(
    () => importableDevices.filter((device) => selectedIds.has(device.id)),
    [importableDevices, selectedIds]
  );
  const previewLookup = useMemo(() => {
    const lookup = new Map<string, PreviewEntry>();

    for (const group of groupedDevices) {
      lookup.set(group.root.id, {
        device: group.root,
        group,
        isGroupRoot: true,
      });

      for (const child of group.children) {
        lookup.set(child.id, {
          device: child,
          group,
          isGroupRoot: false,
        });
      }
    }

    return lookup;
  }, [groupedDevices]);
  const previewEntry = previewLookup.get(previewId) || null;
  const previewDevice = previewEntry?.device || null;
  const previewGroup = previewEntry?.group || null;
  const previewDeviceKind =
    previewDevice && previewGroup
      ? formatDeviceKind(previewDevice, {
          recorderGroup:
            Boolean(previewEntry?.isGroupRoot) && previewGroup.children.length > 0,
        })
      : "";
  const previewChannelHint = previewDevice ? formatChannelHint(previewDevice) : "";

  const performScan = async () => {
    setStage("scanning");
    setDevices([]);
    setSelectedIds(new Set());
    setPreviewId("");
    setElapsedMs(null);
    setScanError(null);
    setImportError(null);

    try {
      const payload = await scanNetworkForCameras();
      const nextGroups = groupDiscoveredDevices(payload.devices);
      const nextImportableIds = nextGroups.flatMap((group) =>
        group.importableDevices.map((device) => device.id)
      );

      setDevices(payload.devices);
      setElapsedMs(payload.elapsed_ms);
      setSelectedIds(new Set(nextImportableIds));
      setPreviewId(nextGroups[0]?.root.id || nextImportableIds[0] || "");
      setStage("ready");
    } catch (error) {
      setScanError(
        error instanceof Error
          ? error.message
          : "Failed to scan the local network for cameras."
      );
      setStage("error");
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setStage("idle");
      setDevices([]);
      setSelectedIds(new Set());
      setPreviewId("");
      setElapsedMs(null);
      setScanError(null);
      setImportError(null);
      setIsImporting(false);
      setSharedUsername("");
      setSharedPassword("");
      return;
    }

    void performScan();
  }, [isOpen]);

  const handleGroupToggle = (group: DiscoveryGroup, checked: boolean) => {
    setImportError(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const device of group.importableDevices) {
        if (checked) {
          next.add(device.id);
        } else {
          next.delete(device.id);
        }
      }
      return next;
    });
  };

  const handleDeviceToggle = (device: DiscoveredCameraDevice, checked: boolean) => {
    setImportError(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(device.id);
      } else {
        next.delete(device.id);
      }
      return next;
    });
  };

  const handleImport = async () => {
    if (selectedDevices.length === 0 || isImporting) {
      return;
    }

    if (!sharedUsername.trim() || !sharedPassword.trim()) {
      setImportError("Username and password are required to create the selected cameras.");
      return;
    }

    setImportError(null);
    setIsImporting(true);

    try {
      await onImport({
        devices: selectedDevices,
        username: sharedUsername.trim(),
        password: sharedPassword,
      });
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : "Failed to import the selected cameras."
      );
    } finally {
      setIsImporting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/75 p-4 backdrop-blur-sm">
      <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-center">
        <div className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-3xl border border-gray-800 bg-gray-950 shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-gray-800 px-6 py-5">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-200">
                <Wifi className="h-3.5 w-3.5" />
                Local network discovery
              </div>
              <h2 className="text-2xl font-semibold text-gray-100">Scan network for cameras</h2>
              <p className="mt-2 max-w-3xl text-sm text-gray-400">
                The desktop runtime scans the local network and now keeps DVR/NVR
                recorders as umbrella devices with their inferred channel cameras
                nested underneath. Select one or many endpoints, apply shared
                credentials once, and import everything in one pass.
              </p>
            </div>

            <button
              onClick={onClose}
              className="rounded-xl border border-gray-800 bg-gray-900 p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
              aria-label="Close camera discovery modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="mb-5 rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                  {stage === "scanning" ? (
                    <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-cyan-300" />
                  ) : stage === "error" ? (
                    <AlertCircle className="mt-0.5 h-5 w-5 text-rose-400" />
                  ) : importableDevices.length > 0 ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-400" />
                  ) : (
                    <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-400" />
                  )}

                  <div>
                    <p className="text-sm font-medium text-gray-100">
                      {stage === "scanning"
                        ? "Scanning your local network..."
                        : stage === "error"
                        ? "Scan failed"
                        : importableDevices.length > 0
                        ? `${importableDevices.length} importable camera endpoint(s) discovered`
                        : "No camera-like devices answered the scan"}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {stage === "scanning"
                        ? "This usually takes about 6 to 12 seconds."
                        : stage === "error"
                        ? scanError
                        : elapsedMs !== null
                        ? `Completed in ${(elapsedMs / 1000).toFixed(1)}s. ${
                            recorderGroupCount > 0
                              ? `${recorderGroupCount} recorder group(s) expanded into channel cameras.`
                              : "Cameras on isolated VLANs or with multicast disabled may stay hidden."
                          }`
                        : "The scan uses local discovery only and does not create cameras automatically."}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => void performScan()}
                  disabled={stage === "scanning"}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-gray-700 bg-gray-950 px-4 py-2.5 text-sm font-medium text-gray-200 transition-colors hover:border-cyan-500/40 hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {stage === "scanning" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Rescan
                </button>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <Camera className="h-4 w-4 text-gray-400" />
                  <h3 className="text-sm font-semibold text-gray-100">Discovered devices</h3>
                </div>

                <div className="space-y-3">
                  {stage === "scanning" && (
                    <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-950/70 px-4 py-8 text-center text-sm text-gray-400">
                      Waiting for devices to answer the probe...
                    </div>
                  )}

                  {stage !== "scanning" && groupedDevices.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-950/70 px-4 py-8 text-center">
                      <Camera className="mx-auto mb-3 h-10 w-10 text-gray-600" />
                      <p className="text-sm font-medium text-gray-200">No cameras found yet</p>
                      <p className="mt-2 text-xs text-gray-500">
                        Try again while the cameras are on the same LAN and multicast is allowed.
                      </p>
                    </div>
                  )}

                  {groupedDevices.map((group) => {
                    const isRecorderGroup = group.children.length > 0;
                    const groupChecked = group.importableDevices.every((device) =>
                      selectedIds.has(device.id)
                    );
                    const groupPartiallyChecked =
                      !groupChecked &&
                      group.importableDevices.some((device) => selectedIds.has(device.id));
                    const isPreviewed = previewId === group.root.id;
                    const groupKind = formatDeviceKind(group.root, {
                      recorderGroup: isRecorderGroup,
                    });

                    return (
                      <div
                        key={group.key}
                        className={`overflow-hidden rounded-2xl border ${
                          isPreviewed
                            ? "border-cyan-400/70 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.25)]"
                            : "border-gray-800 bg-gray-950/70"
                        }`}
                      >
                        <div className="flex gap-3 px-4 py-4">
                          <button
                            type="button"
                            onClick={() => setPreviewId(group.root.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-gray-100">
                                  {formatDeviceTitle(group.root, {
                                    recorderGroup: isRecorderGroup,
                                  })}
                                </p>
                                <p className="mt-1 text-xs text-gray-400">{group.root.ip}</p>
                                <p className="mt-2 text-xs text-gray-300">
                                  {formatModel(group.root, { recorderGroup: isRecorderGroup })}
                                </p>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-gray-200">
                                  {formatConfidence(group.root.confidence)}
                                </span>
                                {groupKind && (
                                  <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-200">
                                    {groupKind}
                                  </span>
                                )}
                                {isRecorderGroup && (
                                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
                                    {group.children.length} channel camera(s)
                                  </span>
                                )}
                                {group.root.discovery_protocols.map((protocol) => (
                                  <span
                                    key={`${group.root.id}-${protocol}`}
                                    className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-200"
                                  >
                                    {protocol}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </button>

                          <div className="flex items-start pt-1">
                            <SelectionCheckbox
                              checked={groupChecked}
                              indeterminate={groupPartiallyChecked}
                              label={`Select ${formatDeviceTitle(group.root, {
                                recorderGroup: isRecorderGroup,
                              })}`}
                              onChange={(event) =>
                                handleGroupToggle(group, event.target.checked)
                              }
                            />
                          </div>
                        </div>

                        {isRecorderGroup && (
                          <div className="border-t border-gray-800/80 px-4 pb-4 pt-3">
                            <div className="ml-3 space-y-2.5 border-l border-cyan-500/20 pl-4">
                              {group.children.map((child) => {
                                const childSelected = selectedIds.has(child.id);
                                const childPreviewed = previewId === child.id;
                                const channelHint = formatChannelHint(child);

                                return (
                                  <div
                                    key={child.id}
                                    className={`rounded-xl border ${
                                      childPreviewed
                                        ? "border-cyan-400/50 bg-cyan-500/10"
                                        : "border-gray-800 bg-gray-950/80"
                                    }`}
                                  >
                                    <div className="flex gap-3 px-3.5 py-3">
                                      <button
                                        type="button"
                                        onClick={() => setPreviewId(child.id)}
                                        className="min-w-0 flex-1 text-left"
                                      >
                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                          <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-gray-100">
                                              {formatDeviceTitle(child)}
                                            </p>
                                            <p className="mt-1 text-xs text-gray-400">
                                              {child.ip}
                                              {channelHint ? ` • ${channelHint}` : ""}
                                            </p>
                                            <p className="mt-2 text-xs text-gray-300">
                                              {formatModel(child)}
                                            </p>
                                          </div>

                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-gray-200">
                                              {formatConfidence(child.confidence)}
                                            </span>
                                            {channelHint && (
                                              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
                                                {channelHint}
                                              </span>
                                            )}
                                            {child.discovery_protocols.map((protocol) => (
                                              <span
                                                key={`${child.id}-${protocol}`}
                                                className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-200"
                                              >
                                                {protocol}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      </button>

                                      <div className="flex items-start pt-1">
                                        <SelectionCheckbox
                                          checked={childSelected}
                                          label={`Select ${formatDeviceTitle(child)}`}
                                          onChange={(event) =>
                                            handleDeviceToggle(child, event.target.checked)
                                          }
                                        />
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-gray-400" />
                  <h3 className="text-sm font-semibold text-gray-100">Import preview</h3>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                      Selected endpoints
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-gray-100">
                      {selectedDevices.length}
                    </p>
                    <p className="mt-1 text-sm text-gray-400">
                      camera endpoint(s) will be created with the shared credentials below.
                    </p>

                    {selectedDevices.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {selectedDevices.slice(0, 6).map((device) => (
                          <p
                            key={device.id}
                            className="truncate rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-xs text-gray-300"
                          >
                            {formatDeviceTitle(device)}
                          </p>
                        ))}
                        {selectedDevices.length > 6 && (
                          <p className="text-xs text-gray-500">
                            +{selectedDevices.length - 6} more selected camera(s)
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {previewDevice && previewGroup ? (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                          {previewEntry?.isGroupRoot && previewGroup.children.length > 0
                            ? "Recorder group"
                            : "Suggested camera"}
                        </p>
                        <p className="mt-2 text-base font-semibold text-gray-100">
                          {formatDeviceTitle(previewDevice, {
                            recorderGroup:
                              Boolean(previewEntry?.isGroupRoot) &&
                              previewGroup.children.length > 0,
                          })}
                        </p>
                        <p className="mt-1 text-sm text-gray-400">{previewDevice.ip}</p>

                        {previewEntry?.isGroupRoot && previewGroup.children.length > 0 ? (
                          <>
                            <p className="mt-2 text-xs font-medium text-emerald-200">
                              {previewGroup.children.length} separate channel camera(s) discovered
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                              {
                                previewGroup.importableDevices.filter((device) =>
                                  selectedIds.has(device.id)
                                ).length
                              }{" "}
                              currently selected in this recorder group
                            </p>
                          </>
                        ) : (
                          previewChannelHint && (
                            <p className="mt-2 text-xs font-medium text-emerald-200">
                              Separate recorder channel: {previewChannelHint}
                            </p>
                          )
                        )}

                        {previewDeviceKind && (
                          <p className="mt-1 text-xs text-gray-500">
                            Device type: {previewDeviceKind}
                          </p>
                        )}
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                          <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                            Manufacturer
                          </p>
                          <p className="mt-2 text-sm text-gray-100">
                            {previewDevice.manufacturer_guess || "Other / unknown"}
                          </p>
                        </div>

                        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                          <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                            Suggested port
                          </p>
                          <p className="mt-2 text-sm text-gray-100">
                            {previewDevice.rtsp_port_guess || 554}
                          </p>
                        </div>

                        {previewChannelHint && (
                          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                            <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                              Suggested channel
                            </p>
                            <p className="mt-2 text-sm text-gray-100">{previewChannelHint}</p>
                          </div>
                        )}

                        {previewGroup.children.length > 0 && previewEntry?.isGroupRoot && (
                          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                            <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                              Channel cameras
                            </p>
                            <p className="mt-2 text-sm text-gray-100">
                              {previewGroup.children.length}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                          Protocols
                        </p>
                        <p className="mt-2 text-sm text-gray-100">
                          {formatProtocols(previewDevice)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-950/70 px-4 py-10 text-center">
                      <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-gray-600" />
                      <p className="text-sm font-medium text-gray-200">
                        Select a discovered device
                      </p>
                      <p className="mt-2 text-xs text-gray-500">
                        The preview will show the recorder group or camera details we will use.
                      </p>
                    </div>
                  )}

                  <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                      Shared credentials
                    </p>
                    <p className="mt-2 text-sm text-gray-400">
                      These credentials will be applied to every checked camera endpoint.
                    </p>

                    <div className="mt-4 grid gap-3">
                      <label className="block">
                        <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-gray-500">
                          Username
                        </span>
                        <input
                          type="text"
                          value={sharedUsername}
                          onChange={(event) => {
                            setSharedUsername(event.target.value);
                            setImportError(null);
                          }}
                          className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-gray-100 outline-none transition-colors focus:border-cyan-500/60"
                          placeholder="admin"
                          autoComplete="username"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-gray-500">
                          Password
                        </span>
                        <input
                          type="password"
                          value={sharedPassword}
                          onChange={(event) => {
                            setSharedPassword(event.target.value);
                            setImportError(null);
                          }}
                          className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-gray-100 outline-none transition-colors focus:border-cyan-500/60"
                          placeholder="Required for RTSP camera creation"
                          autoComplete="current-password"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                    <p className="flex items-start gap-2 text-sm text-amber-100">
                      <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
                      Import creates the checked camera records with shared credentials and any
                      inferred recorder channel details. You can still edit names, addresses, and
                      final stream settings later.
                    </p>
                  </div>

                  {importError && (
                    <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4">
                      <p className="flex items-start gap-2 text-sm text-rose-100">
                        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-300" />
                        {importError}
                      </p>
                    </div>
                  )}

                  {previewDevice?.onvif_xaddrs.length ? (
                    <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                        ONVIF endpoints
                      </p>
                      <div className="mt-2 space-y-2">
                        {previewDevice.onvif_xaddrs.map((xaddr) => (
                          <p
                            key={xaddr}
                            className="break-all rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-xs text-gray-300"
                          >
                            {xaddr}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-gray-800 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-gray-500">
              Recorder groups stay visible as umbrellas in discovery, but only the checked camera
              endpoints underneath them are created.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={onClose}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800"
              >
                Close
              </button>

              <button
                onClick={() => void handleImport()}
                disabled={
                  selectedDevices.length === 0 ||
                  stage === "scanning" ||
                  isImporting ||
                  !sharedUsername.trim() ||
                  !sharedPassword.trim()
                }
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
              >
                {isImporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {selectedDevices.length > 0
                  ? `Import ${selectedDevices.length} selected`
                  : "Import selected"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
