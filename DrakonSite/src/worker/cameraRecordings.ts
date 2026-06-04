import { brand } from "@/shared/brand";
import {
  CAMERA_RECORDING_DEFAULT_POLL_INTERVAL_MS,
  CAMERA_RECORDING_TIMELINE_ORIGIN,
  normalizeCameraRecordingZoom,
  type CameraRecordingCadenceHint,
  type CameraRecordingSegment,
  type CameraRecordingSegmentsResponse,
  type CameraRecordingSummaryBucket,
  type CameraRecordingSummaryResponse,
  type CameraRecordingTimelineZoom,
} from "@/shared/cameraRecordings";

type CameraRecordingEnv = Partial<
  Record<
    | "APP_SERVICE_SESSION_DIR"
    | "APP_RUNTIME_DATA_ROOT"
    | "STORAGE_ROOT"
    | "LOCAL_MEDIA_BASE_DIR"
    | "CAMERA_RECORDINGS_BASE_DIR",
    string | undefined
  >
>;

export type CameraRecordingCameraState = {
  cameraId: number;
  storeFramesEnabled: boolean;
  isServiceRunning: boolean;
  isOnline: boolean;
  retentionDays: number | null;
};

type CameraRecordingRoot = {
  scope: string;
  rootDir: string;
  source: string;
};

type DiskRecordingSegment = {
  id: string;
  scope: string;
  rootDir: string;
  relativePath: string;
  fullPath: string;
  startAtMs: number;
  endAtMs: number;
  durationSeconds: number;
  cadenceSeconds: number;
  fileSizeBytes: number;
  fileModifiedAtMs: number | null;
  isFinalized: boolean;
};

type CachedDaySegments = {
  directoryMtimeMs: number;
  segments: DiskRecordingSegment[];
};

type SummaryWindow = {
  zoom: CameraRecordingTimelineZoom;
  fromMs: number;
  toMs: number;
  focusAtMs: number;
};

type SegmentsWindow = {
  fromMs: number;
  toMs: number;
  focusAtMs: number;
};

type CameraAvailability = {
  hasAnyRecordings: boolean;
  firstSegmentAtMs: number | null;
  lastSegmentAtMs: number | null;
  latestSegmentEndAtMs: number | null;
  latestKnownWriteAtMs: number | null;
  cadenceHint: CameraRecordingCadenceHint;
};

type BucketWindow = {
  key: string;
  startMs: number;
  endMs: number;
};

type NodeModules = {
  fs: typeof import("node:fs");
  pathMod: typeof import("node:path");
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DAY_SEGMENT_CACHE = new Map<string, CachedDaySegments>();

function readEnvString(env: CameraRecordingEnv | undefined, key: keyof CameraRecordingEnv) {
  const fromContext = String(env?.[key] || "").trim();
  if (fromContext) {
    return fromContext;
  }
  if (typeof process !== "undefined" && process.env) {
    return String(process.env[key] || "").trim();
  }
  return "";
}

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function buildStreamPath(scope: string, relativePath: string, download = false) {
  const encodedPath = normalizeRelativePath(relativePath)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const base = `/api/camera-recordings/${encodeURIComponent(scope)}/${encodedPath}`;
  return download ? `${base}?download=1` : base;
}

function buildStorageKey(scope: string, relativePath: string) {
  return `${scope}:${normalizeRelativePath(relativePath)}`;
}

function clampPositiveInteger(value: unknown, fallback = 0) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toIso(valueMs: number | null) {
  if (!Number.isFinite(valueMs ?? NaN)) {
    return null;
  }
  return new Date(valueMs as number).toISOString();
}

function startOfHour(valueMs: number) {
  const date = new Date(valueMs);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    0,
    0,
    0
  ).getTime();
}

function startOfDay(valueMs: number) {
  const date = new Date(valueMs);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime();
}

function startOfMonth(valueMs: number) {
  const date = new Date(valueMs);
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0).getTime();
}

function addHours(valueMs: number, hours: number) {
  return valueMs + hours * HOUR_MS;
}

function addDays(valueMs: number, days: number) {
  return valueMs + days * DAY_MS;
}

function addMonths(valueMs: number, months: number) {
  const date = new Date(valueMs);
  return new Date(
    date.getFullYear(),
    date.getMonth() + months,
    1,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  ).getTime();
}

function resolveSummaryWindow(
  zoom: CameraRecordingTimelineZoom,
  focusAtRaw: unknown,
  fromRaw: unknown,
  toRaw: unknown
): SummaryWindow {
  const focusAtMs = Date.parse(String(focusAtRaw || "")) || Date.now();
  const fromMs = Date.parse(String(fromRaw || ""));
  const toMs = Date.parse(String(toRaw || ""));

  if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs) {
    let normalizedFromMs = fromMs;
    let normalizedToMs = toMs;
    if (zoom === "hour") {
      normalizedFromMs = startOfHour(fromMs);
      normalizedToMs = addHours(startOfHour(toMs), 1);
    } else if (zoom === "day") {
      normalizedFromMs = startOfDay(fromMs);
      normalizedToMs = addDays(startOfDay(toMs), 1);
    } else {
      normalizedFromMs = startOfMonth(fromMs);
      normalizedToMs = addMonths(startOfMonth(toMs), 1);
    }
    return {
      zoom,
      fromMs: normalizedFromMs,
      toMs: Math.max(normalizedToMs, normalizedFromMs + 1),
      focusAtMs,
    };
  }

  if (zoom === "hour") {
    const dayStartMs = startOfDay(focusAtMs);
    return {
      zoom,
      fromMs: dayStartMs,
      toMs: addDays(dayStartMs, 1),
      focusAtMs,
    };
  }

  if (zoom === "day") {
    const monthStartMs = startOfMonth(focusAtMs);
    return {
      zoom,
      fromMs: monthStartMs,
      toMs: addMonths(monthStartMs, 1),
      focusAtMs,
    };
  }

  const monthStartMs = startOfMonth(focusAtMs);
  return {
    zoom,
    fromMs: addMonths(monthStartMs, -11),
    toMs: addMonths(monthStartMs, 1),
    focusAtMs,
  };
}

function resolveSegmentsWindow(
  focusAtRaw: unknown,
  fromRaw: unknown,
  toRaw: unknown
): SegmentsWindow {
  const focusAtMs = Date.parse(String(focusAtRaw || "")) || Date.now();
  const fromMs = Date.parse(String(fromRaw || ""));
  const toMs = Date.parse(String(toRaw || ""));

  if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs) {
    return {
      fromMs,
      toMs,
      focusAtMs,
    };
  }

  const hourStartMs = startOfHour(focusAtMs);
  return {
    fromMs: hourStartMs,
    toMs: addHours(hourStartMs, 1),
    focusAtMs,
  };
}

function parseClipTimestamp(datePart: string, timePart: string) {
  if (!/^\d{8}$/.test(datePart) || !/^\d{6}$/.test(timePart)) {
    return null;
  }
  const year = Number(datePart.slice(0, 4));
  const monthIndex = Number(datePart.slice(4, 6)) - 1;
  const day = Number(datePart.slice(6, 8));
  const hour = Number(timePart.slice(0, 2));
  const minute = Number(timePart.slice(2, 4));
  const second = Number(timePart.slice(4, 6));
  const date = new Date(year, monthIndex, day, hour, minute, second, 0);
  const result = date.getTime();
  return Number.isFinite(result) ? result : null;
}

function parseClipFilename(filename: string, expectedCameraId: number) {
  const normalized = filename.trim();
  if (!normalized.toLowerCase().endsWith(".mp4")) {
    return null;
  }
  if (/_[1-9]s\.mp4$/i.test(normalized)) {
    return null;
  }

  const newPattern =
    /^([^_]+)_(\d{8})_(\d{6})_(\d{8})_(\d{6})_(10|60|300)s\.mp4$/i;
  const legacyPattern = /^([^_]+)_(\d{8})_(\d{6})_(10|60|300)s\.mp4$/i;

  const newMatch = normalized.match(newPattern);
  if (newMatch) {
    const [, cameraToken, startDate, startTime, endDate, endTime, cadenceToken] =
      newMatch;
    if (String(expectedCameraId) !== String(cameraToken)) {
      return null;
    }
    const startAtMs = parseClipTimestamp(startDate, startTime);
    const endAtMs = parseClipTimestamp(endDate, endTime);
    const cadenceSeconds = clampPositiveInteger(cadenceToken, 10);
    if (!Number.isFinite(startAtMs ?? NaN)) {
      return null;
    }
    return {
      startAtMs: startAtMs as number,
      endAtMs:
        Number.isFinite(endAtMs ?? NaN) && (endAtMs as number) > (startAtMs as number)
          ? (endAtMs as number)
          : (startAtMs as number) + cadenceSeconds * 1000,
      cadenceSeconds,
    };
  }

  const legacyMatch = normalized.match(legacyPattern);
  if (!legacyMatch) {
    return null;
  }
  const [, cameraToken, startDate, startTime, cadenceToken] = legacyMatch;
  if (String(expectedCameraId) !== String(cameraToken)) {
    return null;
  }
  const startAtMs = parseClipTimestamp(startDate, startTime);
  const cadenceSeconds = clampPositiveInteger(cadenceToken, 10);
  if (!Number.isFinite(startAtMs ?? NaN)) {
    return null;
  }
  return {
    startAtMs: startAtMs as number,
    endAtMs: (startAtMs as number) + cadenceSeconds * 1000,
    cadenceSeconds,
  };
}

function getCadenceHintFromSegments(segments: DiskRecordingSegment[]): CameraRecordingCadenceHint {
  let has10 = false;
  let has60 = false;
  for (const segment of segments) {
    if (segment.cadenceSeconds <= 10) {
      has10 = true;
    } else if (segment.cadenceSeconds >= 60) {
      has60 = true;
    }
  }
  if (has10 && has60) return "mixed";
  if (has10) return "10s";
  if (has60) return "60s";
  return "unknown";
}

function getRecommendedPollIntervalMs(
  cadenceHint: CameraRecordingCadenceHint,
  options?: { hasAnyRecordings?: boolean; isServiceRunning?: boolean }
) {
  if (cadenceHint === "60s") {
    return CAMERA_RECORDING_DEFAULT_POLL_INTERVAL_MS.slow;
  }
  if (cadenceHint === "10s" || cadenceHint === "mixed") {
    return CAMERA_RECORDING_DEFAULT_POLL_INTERVAL_MS.fast;
  }
  if (options?.isServiceRunning || options?.hasAnyRecordings) {
    return CAMERA_RECORDING_DEFAULT_POLL_INTERVAL_MS.fast;
  }
  return CAMERA_RECORDING_DEFAULT_POLL_INTERVAL_MS.slow;
}

function ensureScopeCandidate(
  candidates: CameraRecordingRoot[],
  seenPaths: Set<string>,
  pathMod: typeof import("node:path"),
  scope: string,
  candidate: string,
  source: string
) {
  const trimmed = String(candidate || "").trim();
  if (!trimmed) {
    return;
  }
  const normalized = pathMod.resolve(trimmed);
  const dedupeKey = normalized.toLowerCase();
  if (seenPaths.has(dedupeKey)) {
    return;
  }
  seenPaths.add(dedupeKey);
  candidates.push({
    scope,
    rootDir: normalized,
    source,
  });
}

function addFramesPathCandidate(
  candidates: CameraRecordingRoot[],
  seenPaths: Set<string>,
  pathMod: typeof import("node:path"),
  scope: string,
  rawBaseDir: string,
  source: string
) {
  const trimmed = String(rawBaseDir || "").trim();
  if (!trimmed) {
    return;
  }
  const directPath = pathMod.resolve(trimmed);
  if (pathMod.basename(directPath).toLowerCase() === "frames") {
    ensureScopeCandidate(candidates, seenPaths, pathMod, scope, directPath, source);
    return;
  }
  ensureScopeCandidate(
    candidates,
    seenPaths,
    pathMod,
    scope,
    pathMod.join(directPath, "frames"),
    source
  );
}

function resolveDevFramesCandidates(pathMod: typeof import("node:path")) {
  if (typeof process === "undefined" || typeof process.cwd !== "function") {
    return [];
  }
  const cwd = process.cwd();
  return [
    pathMod.resolve(cwd, "../Perceptrum/x64/Release/frames"),
    pathMod.resolve(cwd, "../../Perceptrum/x64/Release/frames"),
    pathMod.resolve(cwd, "Perceptrum/x64/Release/frames"),
  ];
}

async function loadNodeModules(): Promise<NodeModules | null> {
  try {
    const fs = await import("node:fs");
    const pathMod = await import("node:path");
    return { fs, pathMod };
  } catch {
    return null;
  }
}

async function resolveRecordingRoots(env: CameraRecordingEnv | undefined) {
  const node = await loadNodeModules();
  if (!node) {
    return null;
  }
  const { pathMod } = node;
  const candidates: CameraRecordingRoot[] = [];
  const seenPaths = new Set<string>();

  addFramesPathCandidate(
    candidates,
    seenPaths,
    pathMod,
    "configured_frames",
    readEnvString(env, "CAMERA_RECORDINGS_BASE_DIR"),
    "CAMERA_RECORDINGS_BASE_DIR"
  );

  const serviceSessionDir = readEnvString(env, "APP_SERVICE_SESSION_DIR");
  if (serviceSessionDir) {
    addFramesPathCandidate(
      candidates,
      seenPaths,
      pathMod,
      "service_session_frames",
      serviceSessionDir,
      "APP_SERVICE_SESSION_DIR"
    );
  }

  addFramesPathCandidate(
    candidates,
    seenPaths,
    pathMod,
    "runtime_data_frames",
    readEnvString(env, "APP_RUNTIME_DATA_ROOT"),
    "APP_RUNTIME_DATA_ROOT"
  );

  const storageRoot = readEnvString(env, "STORAGE_ROOT");
  if (storageRoot) {
    addFramesPathCandidate(
      candidates,
      seenPaths,
      pathMod,
      "storage_parent_frames",
      pathMod.dirname(pathMod.resolve(storageRoot)),
      "dirname(STORAGE_ROOT)"
    );
  }

  addFramesPathCandidate(
    candidates,
    seenPaths,
    pathMod,
    "local_media_frames",
    readEnvString(env, "LOCAL_MEDIA_BASE_DIR"),
    "LOCAL_MEDIA_BASE_DIR"
  );

  brand.dataPaths.mediaBaseDirCandidates.forEach((candidate, index) => {
    addFramesPathCandidate(
      candidates,
      seenPaths,
      pathMod,
      `brand_media_frames_${index}`,
      candidate,
      `brand.dataPaths.mediaBaseDirCandidates[${index}]`
    );
  });

  resolveDevFramesCandidates(pathMod).forEach((candidate, index) => {
    ensureScopeCandidate(
      candidates,
      seenPaths,
      pathMod,
      `dev_perceptrum_release_frames_${index}`,
      candidate,
      "workspace dev fallback"
    );
  });

  return {
    ...node,
    roots: candidates,
  };
}

function buildDayDirectoryPath(
  pathMod: typeof import("node:path"),
  rootDir: string,
  cameraId: number,
  dayStartMs: number
) {
  const date = new Date(dayStartMs);
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return pathMod.join(rootDir, `cam_${cameraId}`, year, month, day);
}

function buildRelativePath(
  pathMod: typeof import("node:path"),
  rootDir: string,
  fullPath: string
) {
  return normalizeRelativePath(pathMod.relative(rootDir, fullPath));
}

function readSegmentsFromDayDirectory(
  fs: typeof import("node:fs"),
  pathMod: typeof import("node:path"),
  root: CameraRecordingRoot,
  dayDirectoryPath: string,
  cameraId: number
) {
  try {
    const stat = fs.statSync(dayDirectoryPath);
    if (!stat.isDirectory()) {
      return [];
    }

    const cacheKey = `${root.scope}:${dayDirectoryPath.toLowerCase()}`;
    const directoryMtimeMs = Number(stat.mtimeMs || 0);
    const cached = DAY_SEGMENT_CACHE.get(cacheKey);
    if (cached && cached.directoryMtimeMs === directoryMtimeMs) {
      return cached.segments;
    }

    const daySegments: DiskRecordingSegment[] = [];
    const entries = fs.readdirSync(dayDirectoryPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const parsed = parseClipFilename(entry.name, cameraId);
      if (!parsed) {
        continue;
      }
      const fullPath = pathMod.join(dayDirectoryPath, entry.name);
      let fileStat: import("node:fs").Stats;
      try {
        fileStat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (!fileStat.isFile()) {
        continue;
      }
      const relativePath = buildRelativePath(pathMod, root.rootDir, fullPath);
      const id = buildStorageKey(root.scope, relativePath);
      daySegments.push({
        id,
        scope: root.scope,
        rootDir: root.rootDir,
        relativePath,
        fullPath,
        startAtMs: parsed.startAtMs,
        endAtMs: parsed.endAtMs,
        durationSeconds: Math.max(
          1,
          Math.round((parsed.endAtMs - parsed.startAtMs) / 1000)
        ),
        cadenceSeconds: parsed.cadenceSeconds,
        fileSizeBytes: Number(fileStat.size || 0),
        fileModifiedAtMs: Number(fileStat.mtimeMs || 0) || null,
        isFinalized: true,
      });
    }

    daySegments.sort((left, right) => left.startAtMs - right.startAtMs);
    DAY_SEGMENT_CACHE.set(cacheKey, {
      directoryMtimeMs,
      segments: daySegments,
    });
    return daySegments;
  } catch {
    return [];
  }
}

function listWindowDays(fromMs: number, toMs: number) {
  const days: number[] = [];
  const endExclusive = Math.max(toMs, fromMs + 1);
  for (
    let cursor = startOfDay(fromMs);
    cursor < endExclusive;
    cursor = addDays(cursor, 1)
  ) {
    days.push(cursor);
  }
  return days;
}

async function collectSegmentsInWindow(
  env: CameraRecordingEnv | undefined,
  cameraId: number,
  fromMs: number,
  toMs: number
) {
  const resolved = await resolveRecordingRoots(env);
  if (!resolved) {
    return [] as DiskRecordingSegment[];
  }
  const { fs, pathMod, roots } = resolved;
  const dedupe = new Set<string>();
  const segments: DiskRecordingSegment[] = [];
  const days = listWindowDays(fromMs, toMs);

  for (const root of roots) {
    for (const dayStartMs of days) {
      const dayDirectoryPath = buildDayDirectoryPath(
        pathMod,
        root.rootDir,
        cameraId,
        dayStartMs
      );
      const daySegments = readSegmentsFromDayDirectory(
        fs,
        pathMod,
        root,
        dayDirectoryPath,
        cameraId
      );
      for (const segment of daySegments) {
        if (segment.endAtMs <= fromMs || segment.startAtMs >= toMs) {
          continue;
        }
        if (dedupe.has(segment.id)) {
          continue;
        }
        dedupe.add(segment.id);
        segments.push(segment);
      }
    }
  }

  segments.sort((left, right) => {
    if (left.startAtMs !== right.startAtMs) {
      return left.startAtMs - right.startAtMs;
    }
    return left.id.localeCompare(right.id);
  });
  return segments;
}

function findEdgeDayDirectory(
  fs: typeof import("node:fs"),
  pathMod: typeof import("node:path"),
  cameraRoot: string,
  direction: "first" | "last"
) {
  try {
    const yearEntries = fs
      .readdirSync(cameraRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
      .sort((left, right) =>
        direction === "first"
          ? left.name.localeCompare(right.name)
          : right.name.localeCompare(left.name)
      );

    for (const yearEntry of yearEntries) {
      const yearPath = pathMod.join(cameraRoot, yearEntry.name);
      const monthEntries = fs
        .readdirSync(yearPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d{2}$/.test(entry.name))
        .sort((left, right) =>
          direction === "first"
            ? left.name.localeCompare(right.name)
            : right.name.localeCompare(left.name)
        );

      for (const monthEntry of monthEntries) {
        const monthPath = pathMod.join(yearPath, monthEntry.name);
        const dayEntries = fs
          .readdirSync(monthPath, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && /^\d{2}$/.test(entry.name))
          .sort((left, right) =>
            direction === "first"
              ? left.name.localeCompare(right.name)
              : right.name.localeCompare(left.name)
          );

        if (dayEntries.length > 0) {
          return pathMod.join(monthPath, dayEntries[0].name);
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function collectCameraAvailability(
  env: CameraRecordingEnv | undefined,
  cameraId: number
): Promise<CameraAvailability> {
  const resolved = await resolveRecordingRoots(env);
  if (!resolved) {
    return {
      hasAnyRecordings: false,
      firstSegmentAtMs: null,
      lastSegmentAtMs: null,
      latestSegmentEndAtMs: null,
      latestKnownWriteAtMs: null,
      cadenceHint: "unknown",
    };
  }
  const { fs, pathMod, roots } = resolved;
  let firstSegmentAtMs: number | null = null;
  let lastSegmentAtMs: number | null = null;
  let latestSegmentEndAtMs: number | null = null;
  let latestKnownWriteAtMs: number | null = null;
  const cadenceSeedSegments: DiskRecordingSegment[] = [];

  for (const root of roots) {
    const cameraRoot = pathMod.join(root.rootDir, `cam_${cameraId}`);
    try {
      const cameraRootStat = fs.statSync(cameraRoot);
      if (!cameraRootStat.isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    const firstDayDirectory = findEdgeDayDirectory(fs, pathMod, cameraRoot, "first");
    const lastDayDirectory = findEdgeDayDirectory(fs, pathMod, cameraRoot, "last");

    if (firstDayDirectory) {
      const firstDaySegments = readSegmentsFromDayDirectory(
        fs,
        pathMod,
        root,
        firstDayDirectory,
        cameraId
      );
      if (firstDaySegments.length > 0) {
        const firstSegment = firstDaySegments[0];
        firstSegmentAtMs =
          firstSegmentAtMs === null
            ? firstSegment.startAtMs
            : Math.min(firstSegmentAtMs, firstSegment.startAtMs);
        cadenceSeedSegments.push(...firstDaySegments.slice(0, 8));
      }
    }

    if (lastDayDirectory) {
      const lastDaySegments = readSegmentsFromDayDirectory(
        fs,
        pathMod,
        root,
        lastDayDirectory,
        cameraId
      );
      if (lastDaySegments.length > 0) {
        const lastSegment = lastDaySegments[lastDaySegments.length - 1];
        lastSegmentAtMs =
          lastSegmentAtMs === null
            ? lastSegment.startAtMs
            : Math.max(lastSegmentAtMs, lastSegment.startAtMs);
        latestSegmentEndAtMs =
          latestSegmentEndAtMs === null
            ? lastSegment.endAtMs
            : Math.max(latestSegmentEndAtMs, lastSegment.endAtMs);
        const maxWriteAt = Math.max(
          ...lastDaySegments.map((segment) => Number(segment.fileModifiedAtMs || 0))
        );
        latestKnownWriteAtMs =
          latestKnownWriteAtMs === null
            ? maxWriteAt
            : Math.max(latestKnownWriteAtMs, maxWriteAt);
        cadenceSeedSegments.push(...lastDaySegments.slice(-16));
      }
    }
  }

  return {
    hasAnyRecordings: firstSegmentAtMs !== null || latestSegmentEndAtMs !== null,
    firstSegmentAtMs,
    lastSegmentAtMs,
    latestSegmentEndAtMs,
    latestKnownWriteAtMs,
    cadenceHint: getCadenceHintFromSegments(cadenceSeedSegments),
  };
}

function buildBucketWindows(window: SummaryWindow): BucketWindow[] {
  const buckets: BucketWindow[] = [];
  if (window.zoom === "hour") {
    for (let cursor = window.fromMs; cursor < window.toMs; cursor = addHours(cursor, 1)) {
      const endMs = addHours(cursor, 1);
      buckets.push({
        key: new Date(cursor).toISOString(),
        startMs: cursor,
        endMs: Math.min(endMs, window.toMs),
      });
    }
    return buckets;
  }

  if (window.zoom === "day") {
    for (let cursor = window.fromMs; cursor < window.toMs; cursor = addDays(cursor, 1)) {
      const endMs = addDays(cursor, 1);
      buckets.push({
        key: new Date(cursor).toISOString(),
        startMs: cursor,
        endMs: Math.min(endMs, window.toMs),
      });
    }
    return buckets;
  }

  for (let cursor = window.fromMs; cursor < window.toMs; cursor = addMonths(cursor, 1)) {
    const endMs = addMonths(cursor, 1);
    buckets.push({
      key: new Date(cursor).toISOString(),
      startMs: cursor,
      endMs: Math.min(endMs, window.toMs),
    });
  }
  return buckets;
}

function calculateSegmentOverlapSeconds(
  segment: DiskRecordingSegment,
  bucketStartMs: number,
  bucketEndMs: number
) {
  const overlapStart = Math.max(segment.startAtMs, bucketStartMs);
  const overlapEnd = Math.min(segment.endAtMs, bucketEndMs);
  if (overlapEnd <= overlapStart) {
    return 0;
  }
  return Math.max(0, Math.round((overlapEnd - overlapStart) / 1000));
}

function buildSummaryBuckets(
  window: SummaryWindow,
  segments: DiskRecordingSegment[],
  latestSegmentEndAtMs: number | null
) {
  const buckets = buildBucketWindows(window);
  return buckets.map((bucket): CameraRecordingSummaryBucket => {
    const overlappingSegments = segments.filter(
      (segment) =>
        segment.endAtMs > bucket.startMs && segment.startAtMs < bucket.endMs
    );

    let recordedSeconds = 0;
    const segmentCountsByDuration: Record<string, number> = {};
    for (const segment of overlappingSegments) {
      recordedSeconds += calculateSegmentOverlapSeconds(
        segment,
        bucket.startMs,
        bucket.endMs
      );
      const durationKey = String(segment.cadenceSeconds);
      segmentCountsByDuration[durationKey] =
        (segmentCountsByDuration[durationKey] || 0) + 1;
    }

    let dominantSegmentSeconds: number | null = null;
    let dominantCount = 0;
    Object.entries(segmentCountsByDuration).forEach(([secondsKey, count]) => {
      const seconds = clampPositiveInteger(secondsKey);
      if (count > dominantCount) {
        dominantCount = count;
        dominantSegmentSeconds = seconds;
      }
    });

    const bucketDurationSeconds = Math.max(
      1,
      Math.round((bucket.endMs - bucket.startMs) / 1000)
    );

    return {
      key: bucket.key,
      zoom: window.zoom,
      start_at: new Date(bucket.startMs).toISOString(),
      end_at: new Date(bucket.endMs).toISOString(),
      clip_count: overlappingSegments.length,
      recorded_seconds: recordedSeconds,
      coverage_ratio: Math.max(
        0,
        Math.min(1, recordedSeconds / bucketDurationSeconds)
      ),
      dominant_segment_seconds: dominantSegmentSeconds,
      segment_counts_by_duration: segmentCountsByDuration,
      contains_live_edge:
        latestSegmentEndAtMs !== null &&
        latestSegmentEndAtMs > bucket.startMs &&
        latestSegmentEndAtMs <= bucket.endMs,
      has_video: overlappingSegments.length > 0,
    };
  });
}

function selectFocusBucketKey(
  buckets: CameraRecordingSummaryBucket[],
  focusAtMs: number
) {
  const focusBucket =
    buckets.find((bucket) => {
      const startMs = Date.parse(bucket.start_at);
      const endMs = Date.parse(bucket.end_at);
      return startMs <= focusAtMs && focusAtMs < endMs;
    }) ||
    [...buckets].reverse().find((bucket) => bucket.has_video) ||
    buckets[buckets.length - 1] ||
    null;

  return focusBucket?.key || null;
}

function buildSegmentResponse(
  segment: DiskRecordingSegment
): CameraRecordingSegment {
  return {
    id: segment.id,
    storage_key: buildStorageKey(segment.scope, segment.relativePath),
    relative_path: normalizeRelativePath(segment.relativePath),
    stream_url: buildStreamPath(segment.scope, segment.relativePath),
    download_url: buildStreamPath(segment.scope, segment.relativePath, true),
    start_at: new Date(segment.startAtMs).toISOString(),
    end_at: new Date(segment.endAtMs).toISOString(),
    duration_seconds: segment.durationSeconds,
    cadence_seconds: segment.cadenceSeconds,
    file_size_bytes: segment.fileSizeBytes,
    file_modified_at: toIso(segment.fileModifiedAtMs),
    is_finalized: segment.isFinalized,
  };
}

function countGapTransitions(segments: DiskRecordingSegment[]) {
  if (segments.length <= 1) {
    return 0;
  }
  let gapCount = 0;
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    if (current.startAtMs > previous.endAtMs + 1_500) {
      gapCount += 1;
    }
  }
  return gapCount;
}

function selectFocusSegmentId(
  segments: DiskRecordingSegment[],
  focusAtMs: number
) {
  if (segments.length === 0) {
    return null;
  }
  const exact = segments.find(
    (segment) => segment.startAtMs <= focusAtMs && focusAtMs < segment.endAtMs
  );
  if (exact) {
    return exact.id;
  }

  let nearest = segments[segments.length - 1];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    const distance = Math.abs(segment.startAtMs - focusAtMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = segment;
    }
  }
  return nearest.id;
}

export async function buildCameraRecordingSummary(options: {
  env?: CameraRecordingEnv;
  camera: CameraRecordingCameraState;
  query?: {
    zoom?: unknown;
    from?: unknown;
    to?: unknown;
    focusAt?: unknown;
    timezone?: unknown;
  };
}): Promise<CameraRecordingSummaryResponse> {
  const zoom = normalizeCameraRecordingZoom(options.query?.zoom, "hour");
  const window = resolveSummaryWindow(
    zoom,
    options.query?.focusAt,
    options.query?.from,
    options.query?.to
  );
  const timezone = String(options.query?.timezone || "").trim() || "UTC";
  const [availability, windowSegments] = await Promise.all([
    collectCameraAvailability(options.env, options.camera.cameraId),
    collectSegmentsInWindow(options.env, options.camera.cameraId, window.fromMs, window.toMs),
  ]);

  const effectiveCadenceHint =
    availability.cadenceHint !== "unknown"
      ? availability.cadenceHint
      : getCadenceHintFromSegments(windowSegments);
  const latestKnownWriteAtMs =
    availability.latestKnownWriteAtMs ??
    (windowSegments.length > 0
      ? Math.max(...windowSegments.map((segment) => Number(segment.fileModifiedAtMs || 0)))
      : null);
  const buckets = buildSummaryBuckets(
    window,
    windowSegments,
    availability.latestSegmentEndAtMs
  );

  return {
    camera_id: options.camera.cameraId,
    timeline_origin: CAMERA_RECORDING_TIMELINE_ORIGIN,
    timezone,
    window: {
      zoom,
      from: new Date(window.fromMs).toISOString(),
      to: new Date(window.toMs).toISOString(),
      normalized_from: new Date(window.fromMs).toISOString(),
      normalized_to: new Date(window.toMs).toISOString(),
      focus_at: new Date(window.focusAtMs).toISOString(),
    },
    availability: {
      has_any_recordings: availability.hasAnyRecordings,
      first_segment_at: toIso(availability.firstSegmentAtMs),
      last_segment_at: toIso(availability.lastSegmentAtMs),
      latest_segment_end_at: toIso(availability.latestSegmentEndAtMs),
      retention_days:
        Number.isInteger(options.camera.retentionDays) && (options.camera.retentionDays as number) > 0
          ? (options.camera.retentionDays as number)
          : null,
    },
    capture_state: {
      store_frames_enabled: options.camera.storeFramesEnabled,
      is_service_running: options.camera.isServiceRunning,
      is_online: options.camera.isOnline,
      cadence_hint: effectiveCadenceHint,
    },
    refresh_policy: {
      recommended_poll_interval_ms: getRecommendedPollIntervalMs(
        effectiveCadenceHint,
        {
          hasAnyRecordings: availability.hasAnyRecordings,
          isServiceRunning: options.camera.isServiceRunning,
        }
      ),
      latest_known_write_at: toIso(latestKnownWriteAtMs),
    },
    focus_bucket_key: selectFocusBucketKey(buckets, window.focusAtMs),
    buckets,
  };
}

export async function buildCameraRecordingSegments(options: {
  env?: CameraRecordingEnv;
  camera: CameraRecordingCameraState;
  query?: {
    from?: unknown;
    to?: unknown;
    focusAt?: unknown;
  };
}): Promise<CameraRecordingSegmentsResponse> {
  const window = resolveSegmentsWindow(
    options.query?.focusAt,
    options.query?.from,
    options.query?.to
  );
  const segments = await collectSegmentsInWindow(
    options.env,
    options.camera.cameraId,
    window.fromMs,
    window.toMs
  );
  const cadenceHint = getCadenceHintFromSegments(segments);
  const latestKnownWriteAtMs =
    segments.length > 0
      ? Math.max(...segments.map((segment) => Number(segment.fileModifiedAtMs || 0)))
      : null;

  return {
    camera_id: options.camera.cameraId,
    timeline_origin: CAMERA_RECORDING_TIMELINE_ORIGIN,
    window: {
      from: new Date(window.fromMs).toISOString(),
      to: new Date(window.toMs).toISOString(),
      focus_at: new Date(window.focusAtMs).toISOString(),
    },
    summary: {
      clip_count: segments.length,
      recorded_seconds: segments.reduce(
        (total, segment) => total + segment.durationSeconds,
        0
      ),
      gap_count: countGapTransitions(segments),
      first_segment_at: toIso(segments[0]?.startAtMs ?? null),
      last_segment_at: toIso(segments[segments.length - 1]?.startAtMs ?? null),
    },
    refresh_policy: {
      recommended_poll_interval_ms: getRecommendedPollIntervalMs(cadenceHint, {
        hasAnyRecordings: segments.length > 0,
        isServiceRunning: options.camera.isServiceRunning,
      }),
      latest_known_write_at: toIso(latestKnownWriteAtMs),
    },
    focus_segment_id: selectFocusSegmentId(segments, window.focusAtMs),
    segments: segments.map(buildSegmentResponse),
  };
}

export async function resolveCameraRecordingStreamTarget(
  env: CameraRecordingEnv | undefined,
  scopedRelativePath: string
) {
  const resolved = await resolveRecordingRoots(env);
  if (!resolved) {
    return null;
  }
  const { fs, pathMod, roots } = resolved;
  const normalizedPath = normalizeRelativePath(scopedRelativePath);
  if (!normalizedPath || normalizedPath.includes("..")) {
    return null;
  }

  const [scope, ...pathParts] = normalizedPath.split("/");
  if (!scope || pathParts.length === 0) {
    return null;
  }

  const root = roots.find((candidate) => candidate.scope === scope);
  if (!root) {
    return null;
  }

  const relativePath = normalizeRelativePath(pathParts.join("/"));
  if (!relativePath) {
    return null;
  }

  if (pathMod.isAbsolute(relativePath)) {
    return null;
  }

  const fullPath = pathMod.resolve(root.rootDir, relativePath);
  const baseResolved = pathMod.resolve(root.rootDir);
  const normalizedBase = `${baseResolved.toLowerCase()}${pathMod.sep.toLowerCase()}`;
  const normalizedFullPath = fullPath.toLowerCase();
  if (
    normalizedFullPath !== baseResolved.toLowerCase() &&
    !normalizedFullPath.startsWith(normalizedBase)
  ) {
    return null;
  }

  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      return null;
    }
    return {
      fs,
      pathMod,
      root,
      relativePath,
      fullPath,
      stat,
    };
  } catch {
    return null;
  }
}
