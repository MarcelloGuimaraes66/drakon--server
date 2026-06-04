import { useEffect, useRef, useState } from "react";
import type { Camera as DashboardCamera, DashboardPayload } from "@/react-app/lib/DashboardSummaryStore";
import { brand } from "@/shared/brand";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpToLine,
  Camera,
  Cpu,
  HardDrive,
  Network,
  Server,
  X,
} from "lucide-react";

interface SystemActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameras: DashboardCamera[];
  dashboard?: DashboardPayload | null;
}

function timeAgo(isoString: string | null): string {
  if (!isoString) return "--";
  const now = new Date().getTime();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return `${Math.floor(diffDays / 7)}w`;
}

type CameraConsumer = {
  key: string;
  jobId: number;
  jobName: string;
  stepId: number;
  stepOrder: number;
  stepName: string;
};

type OpenMonitorSummary = {
  system_status?: string | null;
  dominant_bottleneck?: string | null;
  headroom_percent?: number | null;
  active_jobs?: number | null;
  active_steps?: number | null;
  active_cameras?: number | null;
  unique_streams?: number | null;
  total_consumers?: number | null;
  telemetry_fresh?: boolean | null;
  telemetry_age_ms?: number | null;
  safe_additional_cameras?: number | null;
  eta_to_exhaustion?: number | null;
};

type OpenMonitorHost = {
  cpu_total_percent?: number | null;
  logical_cores?: number | null;
  ram_total_bytes?: number | null;
  ram_used_bytes?: number | null;
  ram_available_bytes?: number | null;
  disk_total_bytes?: number | null;
  disk_free_bytes?: number | null;
  disk_read_bytes_per_sec?: number | null;
  disk_write_bytes_per_sec?: number | null;
  net_rx_bytes_per_sec?: number | null;
  net_tx_bytes_per_sec?: number | null;
  sampled_at?: string | null;
  updated_at?: string | null;
};

type OpenMonitorProcess = {
  process_cpu_percent?: number | null;
  working_set_bytes?: number | null;
  private_bytes?: number | null;
  handle_count?: number | null;
  thread_count?: number | null;
  uptime_seconds?: number | null;
  active_cameras?: number | null;
  unique_streams?: number | null;
  total_consumers?: number | null;
  process_read_bytes_per_sec?: number | null;
  process_write_bytes_per_sec?: number | null;
  process_other_bytes_per_sec?: number | null;
  sampled_at?: string | null;
  updated_at?: string | null;
};

type OpenMonitorCamera = {
  camera_id?: number;
  camera_name?: string | null;
  connection_method?: string | null;
  active_source?: string | null;
  thumbnail_path?: string | null;
  clip_directory?: string | null;
  actual_fps?: number | null;
  expected_fps?: number | null;
  last_frame_age_ms?: number | null;
  queue_depth?: number | null;
  overwritten_frames?: number | null;
  reconnect_count?: number | null;
  consumer_count?: number | null;
  width?: number | null;
  height?: number | null;
  use_gpu?: boolean | null;
  stream_online?: boolean | null;
  input_rate?: number | null;
  processing_rate?: number | null;
  capture_read_latency_ms?: number | null;
  decode_latency_ms?: number | null;
  disk_read_bytes_per_sec?: number | null;
  disk_read_latency_ms?: number | null;
  disk_write_bytes_per_sec?: number | null;
  disk_write_latency_ms?: number | null;
  last_inference_age_ms?: number | null;
  inference_input_rate?: number | null;
  inference_processing_rate?: number | null;
  inference_success_count?: number | null;
  inference_error_count?: number | null;
  sampled_at?: string | null;
  updated_at?: string | null;
};

type OpenMonitorThread = {
  client_id?: string | null;
  exe_id?: string | null;
  camera_id?: number;
  camera_name?: string | null;
  thread_name?: string | null;
  thread_cpu_percent?: number | null;
  queue_depth?: number | null;
  dropped_items?: number | null;
  capture_mem_estimated_bytes?: number | null;
  process_working_set_bytes?: number | null;
  process_private_bytes?: number | null;
  capture_read_latency_ms?: number | null;
  decode_latency_ms?: number | null;
  disk_read_bytes_per_sec?: number | null;
  disk_read_latency_ms?: number | null;
  disk_write_bytes_per_sec?: number | null;
  disk_write_latency_ms?: number | null;
  input_rate?: number | null;
  processing_rate?: number | null;
  last_inference_age_ms?: number | null;
  success_count?: number | null;
  error_count?: number | null;
  sampled_at?: string | null;
  updated_at?: string | null;
};

type OpenMonitorResponse = {
  summary?: OpenMonitorSummary | null;
  host?: OpenMonitorHost | null;
  process?: OpenMonitorProcess | null;
  cameras?: OpenMonitorCamera[] | null;
  threads?: OpenMonitorThread[] | null;
  alerts?: Array<{ severity?: string | null; code?: string | null; message?: string | null }> | null;
};

type TimedMetricSample = {
  sampled_at?: string | null;
  updated_at?: string | null;
};

type CaptureThreadSample = TimedMetricSample & {
  client_id?: string | null;
  exe_id?: string | null;
  camera_id?: number | null;
  camera_name?: string | null;
  thread_name?: string | null;
  cpu_percent?: number | null;
  capture_mem_estimated_bytes?: number | null;
  process_working_set_bytes?: number | null;
  process_private_bytes?: number | null;
  queue_depth?: number | null;
  dropped_items?: number | null;
  capture_read_latency_ms?: number | null;
  decode_latency_ms?: number | null;
  disk_read_bytes_per_sec?: number | null;
  disk_read_latency_ms?: number | null;
  disk_write_bytes_per_sec?: number | null;
  disk_write_latency_ms?: number | null;
  input_rate?: number | null;
  processing_rate?: number | null;
  last_inference_age_ms?: number | null;
  success_count?: number | null;
  error_count?: number | null;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "Unknown telemetry error";
}

export default function SystemActivityModal({
  isOpen,
  onClose,
  cameras,
  dashboard,
}: SystemActivityModalProps) {
  const [openMonitor, setOpenMonitor] = useState<OpenMonitorResponse | null>(null);
  const [openMonitorLoading, setOpenMonitorLoading] = useState(false);
  const [openMonitorError, setOpenMonitorError] = useState<string | null>(null);
  const [openMonitorLastSuccessAt, setOpenMonitorLastSuccessAt] = useState<string | null>(null);
  const openMonitorEtagRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let isDisposed = false;
    let intervalId: number | null = null;
    let activeController: AbortController | null = null;
    let isRequestInFlight = false;

    const loadOpenMonitor = async () => {
      if (isRequestInFlight) return;
      isRequestInFlight = true;
      const controller = new AbortController();
      activeController = controller;
      setOpenMonitorLoading(true);
      try {
        const headers: Record<string, string> = {
          Accept: "application/json",
        };
        if (openMonitorEtagRef.current) {
          headers["If-None-Match"] = openMonitorEtagRef.current;
        }

        const response = await fetch("/api/open-monitor", {
          credentials: "include",
          headers,
          signal: controller.signal,
        });
        if (response.status === 304) {
          if (!isDisposed) {
            setOpenMonitorError(null);
            setOpenMonitorLastSuccessAt(new Date().toISOString());
          }
          return;
        }
        if (!response.ok) {
          const responseText = (await response.text()).trim();
          const details = responseText ? `: ${responseText.slice(0, 160)}` : "";
          throw new Error(`Open Monitor ${response.status}${details}`);
        }
        openMonitorEtagRef.current = response.headers.get("etag");
        const payload = (await response.json()) as OpenMonitorResponse;
        if (!isDisposed) {
          setOpenMonitor(payload);
          setOpenMonitorError(null);
          setOpenMonitorLastSuccessAt(new Date().toISOString());
        }
      } catch (error) {
        if (!isDisposed && !controller.signal.aborted) {
          setOpenMonitorError(getErrorMessage(error));
        }
      } finally {
        if (activeController === controller) {
          activeController = null;
        }
        isRequestInFlight = false;
        if (!isDisposed) {
          setOpenMonitorLoading(false);
        }
      }
    };

    void loadOpenMonitor();
    intervalId = window.setInterval(() => {
      void loadOpenMonitor();
    }, 15_000);

    return () => {
      isDisposed = true;
      if (activeController) {
        activeController.abort();
      }
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const openMonitorCameras = Array.isArray(openMonitor?.cameras) ? openMonitor.cameras : [];
  const openMonitorThreads = Array.isArray(openMonitor?.threads) ? openMonitor.threads : [];
  const hasOpenMonitorData =
    openMonitorCameras.length > 0 ||
    openMonitorThreads.length > 0 ||
    Boolean(openMonitor?.host) ||
    Boolean(openMonitor?.process);
  const telemetrySource = hasOpenMonitorData ? "Open Monitor" : "Legacy dashboard fallback";
  const hasOpenMonitorError = Boolean(openMonitorError);
  const processSectionTitle = brand.id === "perceptrum" ? "Perceptrum Process" : "Drakon Process";

  const captureThreads: CaptureThreadSample[] = hasOpenMonitorData
    ? openMonitorThreads.map((thread) => ({
        ...thread,
        cpu_percent: thread.thread_cpu_percent,
      }))
    : dashboard?.captureThreads || [];
  const runningJobTargets = dashboard?.runningJobTargets || {};
  const runningJobsList = Array.isArray(dashboard?.jobs?.runningJobs) ? dashboard.jobs.runningJobs : [];

  const formatBytes = (bytesRaw: number) => {
    const bytes = Number.isFinite(bytesRaw) ? Math.max(0, bytesRaw) : 0;
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
  };

  const formatThroughput = (bytesPerSecRaw: number | null | undefined) => {
    if (bytesPerSecRaw === null || bytesPerSecRaw === undefined || !Number.isFinite(bytesPerSecRaw)) {
      return "--";
    }
    return `${formatBytes(Number(bytesPerSecRaw))}/s`;
  };

  const formatLatency = (valueMsRaw: number | null | undefined) => {
    if (valueMsRaw === null || valueMsRaw === undefined || !Number.isFinite(valueMsRaw)) {
      return "--";
    }
    const valueMs = Math.max(0, Number(valueMsRaw));
    if (valueMs < 1) return "<1 ms";
    if (valueMs < 1000) return `${valueMs.toFixed(1)} ms`;
    return `${(valueMs / 1000).toFixed(2)} s`;
  };

  const formatRate = (valueRaw: number | null | undefined) => {
    if (valueRaw === null || valueRaw === undefined || !Number.isFinite(valueRaw)) {
      return "--";
    }
    return `${Number(valueRaw).toFixed(2)}/s`;
  };

  const getAgeSeconds = (iso: string | null | undefined) => {
    if (!iso) return Number.POSITIVE_INFINITY;
    const ts = Date.parse(iso);
    if (Number.isNaN(ts)) return Number.POSITIVE_INFINITY;
    return Math.max(0, Math.floor((Date.now() - ts) / 1000));
  };

  const isMetricStale = (sample: TimedMetricSample) => {
    const ageSeconds = getAgeSeconds(sample?.updated_at || sample?.sampled_at);
    return ageSeconds > 90;
  };

  const openMonitorHost = openMonitor?.host || null;
  const openMonitorProcess = openMonitor?.process || null;

  const captureThreadsByCamera: Record<number, CaptureThreadSample[]> = {};
  for (const sample of captureThreads) {
    const cameraId = Number(sample?.camera_id) || 0;
    if (cameraId <= 0) continue;
    if (!captureThreadsByCamera[cameraId]) {
      captureThreadsByCamera[cameraId] = [];
    }
    captureThreadsByCamera[cameraId].push(sample);
  }

  for (const cameraIdRaw of Object.keys(captureThreadsByCamera)) {
    const cameraId = Number(cameraIdRaw);
    captureThreadsByCamera[cameraId].sort((a, b) => {
      const ta = Date.parse(a?.updated_at || a?.sampled_at || "") || 0;
      const tb = Date.parse(b?.updated_at || b?.sampled_at || "") || 0;
      return tb - ta;
    });
  }

  const cameraById = new Map<number, DashboardCamera>();
  for (const camera of cameras) {
    const cameraId = Number(camera?.id) || 0;
    if (cameraId > 0) {
      cameraById.set(cameraId, camera);
    }
  }

  const openMonitorCameraById = new Map<number, OpenMonitorCamera>();
  for (const camera of openMonitorCameras) {
    const cameraId = Number(camera?.camera_id) || 0;
    if (cameraId > 0 && !openMonitorCameraById.has(cameraId)) {
      openMonitorCameraById.set(cameraId, camera);
    }
  }

  const jobNameById = new Map<number, string>();
  for (const job of runningJobsList) {
    const jobId = Number(job?.job_id) || 0;
    if (jobId <= 0) continue;
    const jobName =
      typeof job?.job_name === "string" && job.job_name.trim()
        ? job.job_name.trim()
        : `Job #${jobId}`;
    jobNameById.set(jobId, jobName);
  }

  const cameraConsumersById = new Map<number, CameraConsumer[]>();
  for (const jobIdRaw of Object.keys(runningJobTargets)) {
    const jobId = Number(jobIdRaw) || 0;
    const targetSteps = runningJobTargets[jobId] || [];
    const jobName = jobNameById.get(jobId) || `Job #${jobId}`;

    for (const step of targetSteps) {
      const stepId = Number(step?.step_id) || 0;
      const stepOrder = Number(step?.step_order) || 0;
      const stepName =
        typeof step?.step_name === "string" && step.step_name.trim()
          ? step.step_name.trim()
          : "Unnamed step";
      const camerasForStep = Array.isArray(step?.cameras) ? step.cameras : [];

      for (const target of camerasForStep) {
        const cameraId = Number(target?.camera_id) || 0;
        if (cameraId <= 0) continue;
        const consumer: CameraConsumer = {
          key: `${jobId}:${stepId}`,
          jobId,
          jobName,
          stepId,
          stepOrder,
          stepName,
        };
        const existing = cameraConsumersById.get(cameraId) || [];
        if (!existing.some((entry) => entry.key === consumer.key)) {
          cameraConsumersById.set(cameraId, [...existing, consumer]);
        }
      }
    }
  }

  const relevantCameraIds = new Set<number>();
  for (const camera of cameras) {
    const cameraId = Number(camera?.id) || 0;
    if (cameraId > 0 && Number(camera?.is_service_running || 0) === 1) {
      relevantCameraIds.add(cameraId);
    }
  }
  for (const cameraIdRaw of Object.keys(captureThreadsByCamera)) {
    const cameraId = Number(cameraIdRaw) || 0;
    if (cameraId > 0) {
      relevantCameraIds.add(cameraId);
    }
  }
  for (const camera of openMonitorCameras) {
    const cameraId = Number(camera?.camera_id) || 0;
    if (cameraId > 0) {
      relevantCameraIds.add(cameraId);
    }
  }
  for (const cameraId of cameraConsumersById.keys()) {
    relevantCameraIds.add(cameraId);
  }

  const cameraEntries = Array.from(relevantCameraIds)
    .map((cameraId) => {
      const camera = cameraById.get(cameraId);
      const openMonitorCamera = openMonitorCameraById.get(cameraId);
      const samples = captureThreadsByCamera[cameraId] || [];
      const latestSample = samples[0];
      const latestAgeSeconds = getAgeSeconds(
        latestSample?.updated_at ||
          latestSample?.sampled_at ||
          openMonitorCamera?.updated_at ||
          openMonitorCamera?.sampled_at
      );
      const consumers = cameraConsumersById.get(cameraId) || [];
      const isServiceRunning =
        hasOpenMonitorData && openMonitorCamera?.stream_online !== undefined && openMonitorCamera?.stream_online !== null
          ? Boolean(openMonitorCamera.stream_online)
          : Number(camera?.is_service_running || 0) === 1;

      if (!isServiceRunning && consumers.length === 0 && samples.length > 0 && latestAgeSeconds > 300) {
        return null;
      }

      const preferredName =
        typeof camera?.name === "string" && camera.name.trim()
          ? camera.name.trim()
          : typeof openMonitorCamera?.camera_name === "string" && openMonitorCamera.camera_name.trim()
          ? openMonitorCamera.camera_name.trim()
          : typeof latestSample?.camera_name === "string" && latestSample.camera_name.trim()
          ? latestSample.camera_name.trim()
          : `Camera #${cameraId}`;

      return {
        cameraId,
        cameraName: preferredName,
        isServiceRunning,
        latestAgeSeconds,
        samples,
        consumers,
        openMonitorCamera,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => {
      const aScore =
        (a.isServiceRunning ? 2 : 0) +
        (a.consumers.length > 0 ? 2 : 0) +
        (a.latestAgeSeconds <= 90 ? 1 : 0);
      const bScore =
        (b.isServiceRunning ? 2 : 0) +
        (b.consumers.length > 0 ? 2 : 0) +
        (b.latestAgeSeconds <= 90 ? 1 : 0);
      if (aScore !== bScore) return bScore - aScore;
      return a.cameraId - b.cameraId;
    });

  const freshCameraCount = cameraEntries.filter((entry) => entry.latestAgeSeconds <= 90).length;
  const staleCameraCount = cameraEntries.filter(
    (entry) => entry.samples.length > 0 && entry.latestAgeSeconds > 90
  ).length;
  const activeConsumerCount =
    hasOpenMonitorData && typeof openMonitor?.summary?.total_consumers === "number"
      ? openMonitor.summary.total_consumers
      : cameraEntries.reduce((total, entry) => total + entry.consumers.length, 0);

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center px-4 py-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-md"
        onClick={onClose}
        aria-label="Close system activity"
      />
      <div className="relative flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/95 shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-gray-700 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-white">System Activity</h3>
            <p className="mt-1 text-xs text-gray-400">
              Unified by camera. The modal prefers the parallel open-monitor feed, keeps the last successful snapshot
              on transient failures, and only falls back to the existing dashboard capture metrics when no new telemetry
              is available. Samples older than 90s are marked as stale.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <div className="mb-4 flex flex-wrap gap-2">
            <div className="rounded-full border border-cyan-700/40 bg-cyan-950/20 px-3 py-1 text-xs text-cyan-100">
              Cameras in view:{" "}
              {hasOpenMonitorData && typeof openMonitor?.summary?.active_cameras === "number"
                ? openMonitor.summary.active_cameras
                : cameraEntries.length}
            </div>
            <div className="rounded-full border border-slate-700/50 bg-slate-900/35 px-3 py-1 text-xs text-slate-100">
              Source: {telemetrySource}
            </div>
            <div className="rounded-full border border-emerald-700/40 bg-emerald-950/20 px-3 py-1 text-xs text-emerald-100">
              {hasOpenMonitorData
                ? `Status: ${openMonitor?.summary?.system_status || "unknown"}`
                : `Fresh telemetry: ${freshCameraCount}`}
            </div>
            <div className="rounded-full border border-yellow-700/40 bg-yellow-950/20 px-3 py-1 text-xs text-yellow-100">
              {hasOpenMonitorData
                ? `Bottleneck: ${openMonitor?.summary?.dominant_bottleneck || "Unknown"}`
                : `Stale telemetry: ${staleCameraCount}`}
            </div>
            <div className="rounded-full border border-blue-700/40 bg-blue-950/20 px-3 py-1 text-xs text-blue-100">
              Active consumers: {activeConsumerCount}
            </div>
            {hasOpenMonitorData ? (
              <div className="rounded-full border border-purple-700/40 bg-purple-950/20 px-3 py-1 text-xs text-purple-100">
                Headroom:{" "}
                {typeof openMonitor?.summary?.headroom_percent === "number"
                  ? `${openMonitor.summary.headroom_percent.toFixed(1)}%`
                  : "--"}
              </div>
            ) : null}
            {hasOpenMonitorData && Array.isArray(openMonitor?.alerts) ? (
              <div className="rounded-full border border-rose-700/40 bg-rose-950/20 px-3 py-1 text-xs text-rose-100">
                Alerts: {openMonitor.alerts.length}
              </div>
            ) : null}
            {openMonitorLoading ? (
              <div className="rounded-full border border-gray-700/40 bg-gray-800/50 px-3 py-1 text-xs text-gray-300">
                Refreshing telemetry...
              </div>
            ) : null}
            {hasOpenMonitorData && openMonitorLastSuccessAt ? (
              <div className="rounded-full border border-indigo-700/40 bg-indigo-950/20 px-3 py-1 text-xs text-indigo-100">
                Last Open Monitor success: {timeAgo(openMonitorLastSuccessAt)}
              </div>
            ) : null}
          </div>

          {hasOpenMonitorError ? (
            <div
              className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
                hasOpenMonitorData
                  ? "border-amber-700/60 bg-amber-950/20 text-amber-100"
                  : "border-rose-700/60 bg-rose-950/20 text-rose-100"
              }`}
            >
              {hasOpenMonitorData
                ? `Open Monitor refresh failed: ${openMonitorError}. Showing the last successful snapshot${openMonitorLastSuccessAt ? ` from ${timeAgo(openMonitorLastSuccessAt)}` : ""}.`
                : `Open Monitor is unavailable: ${openMonitorError}. Using legacy dashboard capture metrics until the next successful refresh.`}
            </div>
          ) : null}

          {!hasOpenMonitorData && !openMonitorLoading && openMonitor && !hasOpenMonitorError ? (
            <div className="mb-4 rounded-lg border border-blue-700/50 bg-blue-950/20 px-3 py-2 text-xs text-blue-100">
              Open Monitor responded but did not return host, process, camera, or thread rows yet. Using legacy
              dashboard capture metrics until the new feed is populated.
            </div>
          ) : null}

          {!hasOpenMonitorData && dashboard?.captureThreads?.length ? (
            <div className="mb-4 rounded-lg border border-slate-700/50 bg-slate-900/35 px-3 py-2 text-xs text-slate-200">
              Legacy dashboard fallback is active. This view is showing the older capture-thread feed, not the new
              Open Monitor snapshot.
            </div>
          ) : null}

          {hasOpenMonitorData && (openMonitorHost || openMonitorProcess) ? (
            <div className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
              {openMonitorHost ? (
                <div className="rounded-lg border border-gray-700/70 bg-gray-800/45 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                    <HardDrive className="h-4 w-4 text-cyan-300" />
                    Host I/O
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
                    <div className="rounded border border-gray-700/60 bg-gray-900/45 px-3 py-2 text-gray-200">
                      CPU {Number(openMonitorHost.cpu_total_percent || 0).toFixed(1)}% /{" "}
                      {Number(openMonitorHost.logical_cores || 0)} cores
                    </div>
                    <div className="rounded border border-gray-700/60 bg-gray-900/45 px-3 py-2 text-gray-200">
                      RAM {formatBytes(Number(openMonitorHost.ram_used_bytes || 0))} /{" "}
                      {formatBytes(Number(openMonitorHost.ram_total_bytes || 0))}
                    </div>
                    <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-900/45 px-3 py-2 text-gray-200">
                      <ArrowDownToLine className="h-3.5 w-3.5 text-emerald-300" />
                      Disk Read {formatThroughput(openMonitorHost.disk_read_bytes_per_sec)}
                    </div>
                    <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-900/45 px-3 py-2 text-gray-200">
                      <ArrowUpToLine className="h-3.5 w-3.5 text-yellow-300" />
                      Disk Write {formatThroughput(openMonitorHost.disk_write_bytes_per_sec)}
                    </div>
                    <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-900/45 px-3 py-2 text-gray-200">
                      <Network className="h-3.5 w-3.5 text-blue-300" />
                      Net RX {formatThroughput(openMonitorHost.net_rx_bytes_per_sec)}
                    </div>
                    <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-900/45 px-3 py-2 text-gray-200">
                      <Network className="h-3.5 w-3.5 text-rose-300" />
                      Net TX {formatThroughput(openMonitorHost.net_tx_bytes_per_sec)}
                    </div>
                  </div>
                </div>
              ) : null}

              {openMonitorProcess ? (
                <div className="rounded-lg border border-gray-700/70 bg-gray-800/45 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                    <Server className="h-4 w-4 text-purple-300" />
                    {processSectionTitle}
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
                    <div className="rounded border border-gray-700/60 bg-gray-900/45 px-3 py-2 text-gray-200">
                      CPU {Number(openMonitorProcess.process_cpu_percent || 0).toFixed(1)}%
                    </div>
                    <div className="rounded border border-gray-700/60 bg-gray-900/45 px-3 py-2 text-gray-200">
                      Working Set {formatBytes(Number(openMonitorProcess.working_set_bytes || 0))}
                    </div>
                    <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-900/45 px-3 py-2 text-gray-200">
                      <ArrowDownToLine className="h-3.5 w-3.5 text-emerald-300" />
                      Read I/O {formatThroughput(openMonitorProcess.process_read_bytes_per_sec)}
                    </div>
                    <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-900/45 px-3 py-2 text-gray-200">
                      <ArrowUpToLine className="h-3.5 w-3.5 text-yellow-300" />
                      Write I/O {formatThroughput(openMonitorProcess.process_write_bytes_per_sec)}
                    </div>
                    <div className="rounded border border-gray-700/60 bg-gray-900/45 px-3 py-2 text-gray-200">
                      Handles {Number(openMonitorProcess.handle_count || 0)} / Threads{" "}
                      {Number(openMonitorProcess.thread_count || 0)}
                    </div>
                    <div className="rounded border border-gray-700/60 bg-gray-900/45 px-3 py-2 text-gray-200">
                      Uptime{" "}
                      {openMonitorProcess.uptime_seconds !== null &&
                      openMonitorProcess.uptime_seconds !== undefined
                        ? `${Math.round(Number(openMonitorProcess.uptime_seconds) / 60)}m`
                        : "--"}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {cameraEntries.length === 0 ? (
            <div className="rounded-lg border border-gray-700 bg-gray-800/60 px-4 py-4 text-center text-sm text-gray-400">
              No capture metrics received yet from any connected EXE.
            </div>
          ) : (
            <div className="space-y-3">
              {cameraEntries.map((entry) => {
                const latestSample = entry.samples[0];
                const latestStale = latestSample ? isMetricStale(latestSample) : false;

                return (
                  <div
                    key={`system-activity-camera-${entry.cameraId}`}
                    className={`rounded-lg border p-4 ${
                      latestStale
                        ? "border-yellow-700/60 bg-yellow-950/10"
                        : "border-gray-700/70 bg-gray-800/45"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="inline-flex items-center gap-2 text-sm font-semibold text-white">
                            <Camera className="h-4 w-4 text-cyan-300" />
                            <span className="truncate">{entry.cameraName}</span>
                          </div>
                          <span className="text-xs text-gray-500">#{entry.cameraId}</span>
                          {entry.isServiceRunning ? (
                            <span className="rounded-full border border-emerald-600/40 bg-emerald-900/20 px-2 py-0.5 text-[10px] text-emerald-200">
                              capture active
                            </span>
                          ) : null}
                          {!entry.isServiceRunning && entry.samples.length > 0 ? (
                            <span className="rounded-full border border-gray-600/50 bg-gray-800/60 px-2 py-0.5 text-[10px] text-gray-300">
                              recently sampled
                            </span>
                          ) : null}
                          {latestStale ? (
                            <span className="rounded-full border border-yellow-600/60 bg-yellow-900/20 px-2 py-0.5 text-[10px] text-yellow-200">
                              stale
                            </span>
                          ) : null}
                        </div>

                        {hasOpenMonitorData && entry.openMonitorCamera ? (
                          <div className="mt-2 grid grid-cols-1 gap-2 text-xs md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200">
                              FPS {Number(entry.openMonitorCamera.actual_fps || 0).toFixed(2)} /{" "}
                              {entry.openMonitorCamera.expected_fps ?? "--"}
                            </div>
                            <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200">
                              Frame age{" "}
                              {entry.openMonitorCamera.last_frame_age_ms !== null &&
                              entry.openMonitorCamera.last_frame_age_ms !== undefined
                                ? `${Math.round(Number(entry.openMonitorCamera.last_frame_age_ms) / 1000)}s`
                                : "--"}
                            </div>
                            <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200">
                              Method {entry.openMonitorCamera.connection_method || "--"}
                            </div>
                            <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200">
                              Stream {entry.openMonitorCamera.stream_online === false ? "offline" : "online"}
                            </div>
                            <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200">
                              Overwrites {Number(entry.openMonitorCamera.overwritten_frames || 0)}
                            </div>
                            <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200">
                              Consumers {Number(entry.openMonitorCamera.consumer_count || 0)}
                            </div>
                            {entry.openMonitorCamera.active_source ? (
                              <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200 md:col-span-2 xl:col-span-4">
                                Source{" "}
                                <span className="break-all font-mono text-[11px] text-gray-300">
                                  {entry.openMonitorCamera.active_source}
                                </span>
                              </div>
                            ) : null}
                            {entry.openMonitorCamera.thumbnail_path ? (
                              <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200 md:col-span-2">
                                Thumbnail{" "}
                                <span className="break-all font-mono text-[11px] text-gray-300">
                                  {entry.openMonitorCamera.thumbnail_path}
                                </span>
                              </div>
                            ) : null}
                            {entry.openMonitorCamera.clip_directory ? (
                              <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200 md:col-span-2">
                                Clips{" "}
                                <span className="break-all font-mono text-[11px] text-gray-300">
                                  {entry.openMonitorCamera.clip_directory}
                                </span>
                              </div>
                            ) : null}
                            <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200">
                              Capture Read {formatLatency(entry.openMonitorCamera.capture_read_latency_ms)}
                            </div>
                            <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200">
                              Decode {formatLatency(entry.openMonitorCamera.decode_latency_ms)}
                            </div>
                            <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200">
                              Disk Write {formatThroughput(entry.openMonitorCamera.disk_write_bytes_per_sec)}
                            </div>
                            <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200">
                              Disk Read {formatThroughput(entry.openMonitorCamera.disk_read_bytes_per_sec)}
                            </div>
                            <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200">
                              Write Latency {formatLatency(entry.openMonitorCamera.disk_write_latency_ms)}
                            </div>
                            <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200">
                              Read Latency {formatLatency(entry.openMonitorCamera.disk_read_latency_ms)}
                            </div>
                            <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200">
                              Capture In {formatRate(entry.openMonitorCamera.input_rate)} | Out{" "}
                              {formatRate(entry.openMonitorCamera.processing_rate)}
                            </div>
                            <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200">
                              In Rate {formatRate(entry.openMonitorCamera.inference_input_rate)} | Out Rate{" "}
                              {formatRate(entry.openMonitorCamera.inference_processing_rate)}
                            </div>
                            <div className="rounded border border-gray-700/60 bg-gray-900/45 px-2 py-1.5 text-gray-200">
                              Inference age{" "}
                              {entry.openMonitorCamera.last_inference_age_ms !== null &&
                              entry.openMonitorCamera.last_inference_age_ms !== undefined
                                ? `${Math.round(Number(entry.openMonitorCamera.last_inference_age_ms) / 1000)}s`
                                : "--"}{" "}
                              | OK {Number(entry.openMonitorCamera.inference_success_count || 0)} / Err{" "}
                              {Number(entry.openMonitorCamera.inference_error_count || 0)}
                            </div>
                          </div>
                        ) : null}

                        {hasOpenMonitorData ? (
                          <div className="mt-2 text-xs text-gray-500">
                            Unified by camera. Job and agent consumers are aggregated into a single camera row.
                          </div>
                        ) : entry.consumers.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {entry.consumers.map((consumer) => (
                              <span
                                key={`consumer-${entry.cameraId}-${consumer.key}`}
                                className="rounded-full border border-blue-700/40 bg-blue-950/20 px-2.5 py-1 text-[11px] text-blue-100"
                              >
                                {consumer.jobName} - Step {consumer.stepOrder} - {consumer.stepName}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-gray-500">
                            No active job consumers mapped for this camera right now.
                          </div>
                        )}
                      </div>

                      <div className="text-right text-[11px] text-gray-500">
                        <div>{entry.samples.length} thread sample(s)</div>
                        <div>
                          latest age {Number.isFinite(entry.latestAgeSeconds) ? `${entry.latestAgeSeconds}s` : "--"}
                        </div>
                      </div>
                    </div>

                    {entry.samples.length === 0 ? (
                      <div className="mt-3 rounded border border-gray-700/70 bg-gray-900/45 px-3 py-2 text-xs text-gray-500">
                        No capture metrics for this camera yet.
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {entry.samples.map((sample) => {
                          const stale = isMetricStale(sample);
                          const ageSeconds = getAgeSeconds(sample?.updated_at || sample?.sampled_at);

                          return (
                            <div
                              key={`system-activity-thread-${sample?.client_id || "client"}-${sample?.exe_id || "exe"}-${entry.cameraId}-${sample?.thread_name || "thread"}`}
                              className={`rounded border px-3 py-2 ${
                                stale
                                  ? "border-yellow-700/70 bg-yellow-900/10"
                                  : "border-gray-700/70 bg-gray-900/45"
                              }`}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-xs text-cyan-200">
                                  {sample?.thread_name || "captureLoop"}
                                </span>
                                {stale ? (
                                  <span className="rounded-full border border-yellow-600/70 bg-yellow-700/20 px-2 py-0.5 text-[10px] text-yellow-300">
                                    stale
                                  </span>
                                ) : null}
                                <span className="text-[11px] text-gray-500">
                                  age {Number.isFinite(ageSeconds) ? `${ageSeconds}s` : "--"}
                                </span>
                              </div>

                              <div className="mt-2 grid grid-cols-1 gap-2 text-xs md:grid-cols-2 xl:grid-cols-3">
                                {sample?.cpu_percent !== null && sample?.cpu_percent !== undefined ? (
                                  <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/45 px-2 py-1.5 text-gray-200">
                                    <Cpu className="h-3.5 w-3.5 text-blue-300" />
                                    CPU {Number(sample?.cpu_percent || 0).toFixed(2)}%
                                  </div>
                                ) : null}
                                {sample?.capture_mem_estimated_bytes !== null &&
                                sample?.capture_mem_estimated_bytes !== undefined ? (
                                  <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/45 px-2 py-1.5 text-gray-200">
                                    <Server className="h-3.5 w-3.5 text-purple-300" />
                                    Capture Mem {formatBytes(Number(sample?.capture_mem_estimated_bytes) || 0)}
                                  </div>
                                ) : null}
                                {sample?.process_working_set_bytes !== null &&
                                sample?.process_working_set_bytes !== undefined ? (
                                  <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/45 px-2 py-1.5 text-gray-200">
                                    <Server className="h-3.5 w-3.5 text-green-300" />
                                    Working Set {formatBytes(Number(sample?.process_working_set_bytes) || 0)}
                                  </div>
                                ) : null}
                                {sample?.process_private_bytes !== null &&
                                sample?.process_private_bytes !== undefined ? (
                                  <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/45 px-2 py-1.5 text-gray-200">
                                    <Server className="h-3.5 w-3.5 text-orange-300" />
                                    Private Bytes {formatBytes(Number(sample?.process_private_bytes) || 0)}
                                  </div>
                                ) : null}
                                <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/45 px-2 py-1.5 text-gray-200">
                                  <Activity className="h-3.5 w-3.5 text-cyan-300" />
                                  Queue Depth {Number(sample?.queue_depth) || 0}
                                </div>
                                {hasOpenMonitorData && Number(sample?.dropped_items || 0) > 0 ? (
                                  <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/45 px-2 py-1.5 text-gray-200">
                                    <Activity className="h-3.5 w-3.5 text-rose-300" />
                                    Dropped {Number(sample?.dropped_items) || 0}
                                  </div>
                                ) : null}
                                {sample?.capture_read_latency_ms !== null &&
                                sample?.capture_read_latency_ms !== undefined ? (
                                  <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/45 px-2 py-1.5 text-gray-200">
                                    <Activity className="h-3.5 w-3.5 text-teal-300" />
                                    Capture Read {formatLatency(sample?.capture_read_latency_ms)}
                                  </div>
                                ) : null}
                                {sample?.decode_latency_ms !== null &&
                                sample?.decode_latency_ms !== undefined ? (
                                  <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/45 px-2 py-1.5 text-gray-200">
                                    <Activity className="h-3.5 w-3.5 text-fuchsia-300" />
                                    Decode {formatLatency(sample?.decode_latency_ms)}
                                  </div>
                                ) : null}
                                {sample?.disk_write_bytes_per_sec !== null &&
                                sample?.disk_write_bytes_per_sec !== undefined ? (
                                  <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/45 px-2 py-1.5 text-gray-200">
                                    <ArrowUpToLine className="h-3.5 w-3.5 text-yellow-300" />
                                    Write I/O {formatThroughput(sample?.disk_write_bytes_per_sec)}
                                  </div>
                                ) : null}
                                {sample?.disk_write_latency_ms !== null &&
                                sample?.disk_write_latency_ms !== undefined ? (
                                  <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/45 px-2 py-1.5 text-gray-200">
                                    <HardDrive className="h-3.5 w-3.5 text-yellow-300" />
                                    Write Latency {formatLatency(sample?.disk_write_latency_ms)}
                                  </div>
                                ) : null}
                                {sample?.disk_read_bytes_per_sec !== null &&
                                sample?.disk_read_bytes_per_sec !== undefined ? (
                                  <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/45 px-2 py-1.5 text-gray-200">
                                    <ArrowDownToLine className="h-3.5 w-3.5 text-emerald-300" />
                                    Read I/O {formatThroughput(sample?.disk_read_bytes_per_sec)}
                                  </div>
                                ) : null}
                                {sample?.disk_read_latency_ms !== null &&
                                sample?.disk_read_latency_ms !== undefined ? (
                                  <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/45 px-2 py-1.5 text-gray-200">
                                    <HardDrive className="h-3.5 w-3.5 text-emerald-300" />
                                    Read Latency {formatLatency(sample?.disk_read_latency_ms)}
                                  </div>
                                ) : null}
                                {sample?.input_rate !== null && sample?.input_rate !== undefined ? (
                                  <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/45 px-2 py-1.5 text-gray-200">
                                    <Activity className="h-3.5 w-3.5 text-blue-300" />
                                    Input Rate {formatRate(sample?.input_rate)}
                                  </div>
                                ) : null}
                                {sample?.processing_rate !== null && sample?.processing_rate !== undefined ? (
                                  <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/45 px-2 py-1.5 text-gray-200">
                                    <Activity className="h-3.5 w-3.5 text-green-300" />
                                    Processing Rate {formatRate(sample?.processing_rate)}
                                  </div>
                                ) : null}
                                {sample?.last_inference_age_ms !== null &&
                                sample?.last_inference_age_ms !== undefined ? (
                                  <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/45 px-2 py-1.5 text-gray-200">
                                    <Activity className="h-3.5 w-3.5 text-cyan-300" />
                                    Last Inference {Math.round(Number(sample?.last_inference_age_ms) / 1000)}s ago
                                  </div>
                                ) : null}
                                {sample?.success_count !== null &&
                                sample?.success_count !== undefined ? (
                                  <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/45 px-2 py-1.5 text-gray-200">
                                    <Activity className="h-3.5 w-3.5 text-emerald-300" />
                                    Success {Number(sample?.success_count) || 0}
                                  </div>
                                ) : null}
                                {sample?.error_count !== null && sample?.error_count !== undefined ? (
                                  <div className="inline-flex items-center gap-2 rounded border border-gray-700/60 bg-gray-800/45 px-2 py-1.5 text-gray-200">
                                    <Activity className="h-3.5 w-3.5 text-rose-300" />
                                    Errors {Number(sample?.error_count) || 0}
                                  </div>
                                ) : null}
                              </div>

                              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
                                <span>
                                  exe_id: <span className="font-mono text-gray-200">{sample?.exe_id || "--"}</span>
                                </span>
                                <span>
                                  client_id: <span className="font-mono text-gray-200">{sample?.client_id || "--"}</span>
                                </span>
                                <span>
                                  sampled: <span className="text-gray-200">{timeAgo(sample?.sampled_at || null)}</span>
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
