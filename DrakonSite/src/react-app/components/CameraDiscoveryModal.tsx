import { useEffect, useMemo, useState } from "react";
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
import { scanNetworkForCameras } from "@/react-app/utils/cameraDiscovery";

type CameraDiscoveryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onImport: (device: DiscoveredCameraDevice) => Promise<void> | void;
};

type DiscoveryStage = "idle" | "scanning" | "ready" | "error";

function formatConfidence(value: number) {
  const normalized = Number.isFinite(value) ? Math.round(value * 100) : 0;
  return `${normalized}% confidence`;
}

function formatProtocols(device: DiscoveredCameraDevice) {
  return Array.isArray(device.discovery_protocols) && device.discovery_protocols.length > 0
    ? device.discovery_protocols.join(" / ")
    : "WS discovery";
}

function formatModel(device: DiscoveredCameraDevice) {
  const manufacturer = String(device.manufacturer_guess || "").trim();
  const model = String(device.model_guess || "").trim();
  if (manufacturer && model) {
    return `${manufacturer} / ${model}`;
  }
  return manufacturer || model || "Manufacturer not identified yet";
}

export default function CameraDiscoveryModal({
  isOpen,
  onClose,
  onImport,
}: CameraDiscoveryModalProps) {
  const [stage, setStage] = useState<DiscoveryStage>("idle");
  const [devices, setDevices] = useState<DiscoveredCameraDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedId) || null,
    [devices, selectedId]
  );

  const performScan = async () => {
    setStage("scanning");
    setDevices([]);
    setSelectedId("");
    setElapsedMs(null);
    setError(null);

    try {
      const payload = await scanNetworkForCameras();
      setDevices(payload.devices);
      setElapsedMs(payload.elapsed_ms);
      setSelectedId(payload.devices[0]?.id || "");
      setStage("ready");
    } catch (scanError) {
      setError(
        scanError instanceof Error
          ? scanError.message
          : "Failed to scan the local network for cameras."
      );
      setStage("error");
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setStage("idle");
      setDevices([]);
      setSelectedId("");
      setElapsedMs(null);
      setError(null);
      setIsImporting(false);
      return;
    }

    void performScan();
  }, [isOpen]);

  const handleImport = async () => {
    if (!selectedDevice || isImporting) {
      return;
    }

    setIsImporting(true);
    try {
      await onImport(selectedDevice);
    } finally {
      setIsImporting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm p-4">
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
                The desktop runtime sends local discovery probes and also performs a safe scan
                of common camera ports on your current subnets. Import fills the camera form
                with IP and manufacturer guesses, then you finish credentials and address
                details safely.
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
                  ) : devices.length > 0 ? (
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
                        : devices.length > 0
                        ? `${devices.length} camera-like device(s) discovered`
                        : "No camera-like devices answered the scan"}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {stage === "scanning"
                        ? "This usually takes about 6 to 12 seconds."
                        : stage === "error"
                        ? error
                        : elapsedMs !== null
                        ? `Completed in ${(elapsedMs / 1000).toFixed(1)}s. Cameras on isolated VLANs or with multicast disabled may stay hidden.`
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

                  {stage !== "scanning" && devices.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-950/70 px-4 py-8 text-center">
                      <Camera className="mx-auto mb-3 h-10 w-10 text-gray-600" />
                      <p className="text-sm font-medium text-gray-200">No cameras found yet</p>
                      <p className="mt-2 text-xs text-gray-500">
                        Try again while the cameras are on the same LAN and multicast is allowed.
                      </p>
                    </div>
                  )}

                  {devices.map((device) => {
                    const isSelected = device.id === selectedId;
                    return (
                      <button
                        key={device.id}
                        type="button"
                        onClick={() => setSelectedId(device.id)}
                        className={`w-full rounded-2xl border px-4 py-4 text-left transition-all ${
                          isSelected
                            ? "border-cyan-400/70 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.35)]"
                            : "border-gray-800 bg-gray-950/70 hover:border-gray-700 hover:bg-gray-900"
                        }`}
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-gray-100">
                              {device.friendly_name || `Camera ${device.ip}`}
                            </p>
                            <p className="mt-1 text-xs text-gray-400">{device.ip}</p>
                            <p className="mt-2 text-xs text-gray-300">{formatModel(device)}</p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-gray-200">
                              {formatConfidence(device.confidence)}
                            </span>
                            {device.discovery_protocols.map((protocol) => (
                              <span
                                key={`${device.id}-${protocol}`}
                                className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-200"
                              >
                                {protocol}
                              </span>
                            ))}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-gray-400" />
                  <h3 className="text-sm font-semibold text-gray-100">Import preview</h3>
                </div>

                {selectedDevice ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                        Suggested camera
                      </p>
                      <p className="mt-2 text-base font-semibold text-gray-100">
                        {selectedDevice.friendly_name || `Camera ${selectedDevice.ip}`}
                      </p>
                      <p className="mt-1 text-sm text-gray-400">{selectedDevice.ip}</p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                          Manufacturer
                        </p>
                        <p className="mt-2 text-sm text-gray-100">
                          {selectedDevice.manufacturer_guess || "Other / unknown"}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                          Suggested port
                        </p>
                        <p className="mt-2 text-sm text-gray-100">
                          {selectedDevice.rtsp_port_guess || 554}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                        Protocols
                      </p>
                      <p className="mt-2 text-sm text-gray-100">
                        {formatProtocols(selectedDevice)}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                      <p className="flex items-start gap-2 text-sm text-amber-100">
                        <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
                        Import opens the regular camera form with IP and manufacturer prefilled.
                        You still review credentials, address, and any channel details before
                        saving.
                      </p>
                    </div>

                    {selectedDevice.onvif_xaddrs.length > 0 && (
                      <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                          ONVIF endpoints
                        </p>
                        <div className="mt-2 space-y-2">
                          {selectedDevice.onvif_xaddrs.map((xaddr) => (
                            <p
                              key={xaddr}
                              className="break-all rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-xs text-gray-300"
                            >
                              {xaddr}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-950/70 px-4 py-10 text-center">
                    <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-gray-600" />
                    <p className="text-sm font-medium text-gray-200">
                      Select a discovered device
                    </p>
                    <p className="mt-2 text-xs text-gray-500">
                      The import preview will show the values we prefill in the camera form.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-gray-800 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-gray-500">
              Nothing is created automatically during discovery. Import only opens the existing
              camera form with suggested defaults.
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
                disabled={!selectedDevice || stage === "scanning" || isImporting}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
              >
                {isImporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Import selected
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
