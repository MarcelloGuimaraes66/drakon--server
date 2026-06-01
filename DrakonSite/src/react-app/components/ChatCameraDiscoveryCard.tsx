import { Camera, HardDrive, TimerReset, Wifi } from "lucide-react";
import type { CameraNetworkScanMessageMetadata } from "@/react-app/utils/chatUtils";

type Props = {
  metadata: CameraNetworkScanMessageMetadata;
};

function languageIsPt(language: string | undefined) {
  return String(language || "").trim().toLowerCase().startsWith("pt");
}

function formatElapsedMs(elapsedMs: number | undefined, isPt: boolean) {
  if (!Number.isFinite(elapsedMs) || !elapsedMs || elapsedMs <= 0) {
    return isPt ? "agora" : "just now";
  }

  const seconds = elapsedMs / 1000;
  return `${seconds.toFixed(1)}s`;
}

function summaryCopy(language: string | undefined) {
  const isPt = languageIsPt(language);

  return {
    isPt,
    title: isPt ? "Resultado do scan da rede" : "Network scan result",
    subtitle: isPt
      ? "O chat executou o Scan Network no runtime local e resumiu os dispositivos encontrados."
      : "Chat ran Scan Network on the local runtime and summarized the discovered devices.",
    recorders: isPt ? "Gravadores" : "Recorders",
    channelCameras: isPt ? "Canais detectados" : "Detected channels",
    standaloneCameras: isPt ? "Cameras avulsas" : "Standalone cameras",
    elapsed: isPt ? "Tempo do scan" : "Scan time",
    recorderSection: isPt ? "Gravadores encontrados" : "Detected recorders",
    standaloneCameraSection: isPt
      ? "Cameras fora de gravadores"
      : "Standalone cameras outside recorders",
    standaloneRecorderSection: isPt
      ? "Gravadores sem canais confirmados ainda"
      : "Recorders without confirmed channels yet",
    emptyState: isPt
      ? "Nenhum dispositivo acessivel foi encontrado neste scan."
      : "No reachable devices were found in this scan.",
    channelsDetected: isPt ? "canais detectados" : "detected channels",
  };
}

export default function ChatCameraDiscoveryCard({ metadata }: Props) {
  const copy = summaryCopy(metadata.language);
  const stats = metadata.summary.stats;
  const recorderGroups = metadata.summary.recorder_groups || [];
  const standaloneCameras = metadata.summary.standalone_cameras || [];
  const standaloneRecorders = metadata.summary.standalone_recorders || [];
  const hasAnyDevices =
    Number(stats?.total_device_count || 0) > 0 ||
    recorderGroups.length > 0 ||
    standaloneCameras.length > 0 ||
    standaloneRecorders.length > 0;

  return (
    <div className="rounded-[28px] border border-white/[0.08] bg-white/[0.04] p-5 shadow-[0_18px_60px_-42px_rgba(0,0,0,0.85)] backdrop-blur-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-white">{copy.title}</p>
          <p className="mt-1 text-sm text-gray-400">{copy.subtitle}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-200">
          <Wifi className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-gray-500">
            <HardDrive className="h-3.5 w-3.5" />
            <span>{copy.recorders}</span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-white">{stats?.recorder_count || 0}</p>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-gray-500">
            <Camera className="h-3.5 w-3.5" />
            <span>{copy.channelCameras}</span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-white">
            {stats?.recorder_channel_camera_count || 0}
          </p>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-gray-500">
            <Camera className="h-3.5 w-3.5" />
            <span>{copy.standaloneCameras}</span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-white">
            {stats?.standalone_camera_count || 0}
          </p>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-gray-500">
            <TimerReset className="h-3.5 w-3.5" />
            <span>{copy.elapsed}</span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-white">
            {formatElapsedMs(metadata.elapsed_ms, copy.isPt)}
          </p>
        </div>
      </div>

      {!hasAnyDevices ? (
        <div className="mt-4 rounded-2xl border border-dashed border-white/[0.08] bg-black/10 px-4 py-5 text-sm text-gray-400">
          {copy.emptyState}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {recorderGroups.length > 0 && (
            <section className="rounded-2xl border border-white/[0.06] bg-black/10 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                {copy.recorderSection}
              </p>
              <div className="mt-3 space-y-3">
                {recorderGroups.map((group) => (
                  <div
                    key={group.key}
                    className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{group.title}</p>
                        <p className="mt-1 text-xs text-gray-400">{group.ip}</p>
                      </div>
                      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
                        {group.detected_channel_camera_count} {copy.channelsDetected}
                      </span>
                    </div>
                    {Array.isArray(group.detected_channel_labels) &&
                    group.detected_channel_labels.length > 0 ? (
                      <p className="mt-3 text-xs text-gray-300">
                        {group.detected_channel_labels.join(", ")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          )}

          {standaloneCameras.length > 0 && (
            <section className="rounded-2xl border border-white/[0.06] bg-black/10 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                {copy.standaloneCameraSection}
              </p>
              <div className="mt-3 space-y-2.5">
                {standaloneCameras.map((device) => (
                  <div
                    key={device.id}
                    className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3"
                  >
                    <p className="text-sm font-semibold text-white">{device.title}</p>
                    <p className="mt-1 text-xs text-gray-400">{device.ip}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {standaloneRecorders.length > 0 && (
            <section className="rounded-2xl border border-white/[0.06] bg-black/10 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                {copy.standaloneRecorderSection}
              </p>
              <div className="mt-3 space-y-2.5">
                {standaloneRecorders.map((device) => (
                  <div
                    key={device.id}
                    className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3"
                  >
                    <p className="text-sm font-semibold text-white">{device.title}</p>
                    <p className="mt-1 text-xs text-gray-400">{device.ip}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
