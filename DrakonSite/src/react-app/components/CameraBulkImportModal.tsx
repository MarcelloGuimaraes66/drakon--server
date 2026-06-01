import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  FileUp,
  Loader2,
  MapPin,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import type {
  CameraImportApplyResult,
  CameraImportCandidate,
  CameraImportGpuBatchSummary,
  CameraImportPreview,
  CameraImportRequiredField,
  CameraImportSharedDefaults,
} from "@/shared/cameraImport";

type CameraBulkImportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onImported?: (
    applyResult: CameraImportApplyResult,
    preview: CameraImportPreview | null
  ) => Promise<void> | void;
};

type ImportStage =
  | "idle"
  | "uploading"
  | "polling"
  | "ready"
  | "applying"
  | "applied"
  | "error";

type PreviewCommandStatusResponse = {
  command_id?: number | null;
  status: string;
  file_name?: string | null;
  source_format?: string | null;
  total_rows_detected?: number | null;
  rows_sent_to_llm?: number | null;
  preview?: CameraImportPreview | null;
  apply?: CameraImportApplyResult | null;
  error?: string | null;
};

type UploadPreviewResponse = {
  command_id?: number | null;
  status: string;
  file_name?: string | null;
  source_format?: string | null;
  total_rows_detected?: number | null;
  rows_sent_to_llm?: number | null;
  global_warnings?: string[];
  preview?: CameraImportPreview | null;
  error?: string | null;
};

type UploadMeta = {
  file_name: string;
  source_format: string | null;
  total_rows_detected: number | null;
  rows_sent_to_llm: number | null;
  global_warnings: string[];
};

type SharedDefaultsFormState = {
  manufacturer: string;
  username: string;
  password: string;
  rtsp_port: string;
};

const REQUIRED_FIELD_LABELS: Record<CameraImportRequiredField, string> = {
  ip_address: "IP address",
  username: "Username",
  password: "Password",
  manufacturer: "Manufacturer",
};

const CAMERA_IMPORT_POLL_INTERVAL_MS = 1800;
const CAMERA_IMPORT_POLL_TIMEOUT_MS = 90_000;
const CAMERA_IMPORT_GPU_BATCH_POLL_INTERVAL_MS = 2500;

function humanizeFieldLabel(field: string) {
  if (field in REQUIRED_FIELD_LABELS) {
    return REQUIRED_FIELD_LABELS[field as CameraImportRequiredField];
  }

  return field
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatSourceFormat(value: string | null | undefined) {
  if (!value) return "file";
  if (value === "csv") return "CSV";
  if (value === "tsv") return "TSV";
  if (value === "json") return "JSON";
  if (value === "text") return "text";
  if (value === "spreadsheet") return "spreadsheet";
  return value;
}

function formatCandidateAddress(candidate: CameraImportCandidate) {
  return [
    candidate.street,
    candidate.number,
    candidate.city,
    candidate.state,
    candidate.zip_code,
    candidate.country,
  ]
    .filter((part) => typeof part === "string" && part.trim().length > 0)
    .join(", ");
}

function normalizeCommandId(value: unknown) {
  const numericValue =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
}

function isTerminalGpuBatchStatus(
  status: CameraImportGpuBatchSummary["status"] | null | undefined
) {
  return status === "completed" || status === "failed";
}

function formatGpuBatchStatusLabel(status: CameraImportGpuBatchSummary["status"]) {
  if (status === "queued") return "Queued";
  if (status === "waiting_for_exe") return "Waiting for desktop runtime";
  if (status === "probing") return "Validating camera by camera";
  if (status === "completed") return "Finished";
  return "Stopped";
}

function getGpuBatchStatusPanelClasses(status: CameraImportGpuBatchSummary["status"]) {
  if (status === "completed") {
    return "border-emerald-400/20 bg-emerald-500/10 text-emerald-50";
  }
  if (status === "failed") {
    return "border-red-400/20 bg-red-500/10 text-red-50";
  }
  if (status === "waiting_for_exe") {
    return "border-amber-400/20 bg-amber-500/10 text-amber-50";
  }
  if (status === "probing") {
    return "border-sky-400/20 bg-sky-500/10 text-sky-50";
  }
  return "border-cyan-400/20 bg-cyan-500/10 text-cyan-50";
}

async function parseApiError(response: Response, fallback: string) {
  const responseText = await response.text();

  try {
    const parsed = JSON.parse(responseText);
    if (typeof parsed.error === "string") {
      return parsed.error;
    }
    if (typeof parsed.message === "string") {
      return parsed.message;
    }
  } catch {
    if (responseText.trim().length > 0) {
      return responseText;
    }
  }

  return fallback;
}

function buildSharedDefaultsPayload(
  state: SharedDefaultsFormState
): CameraImportSharedDefaults | null {
  const payload: CameraImportSharedDefaults = {};

  if (state.manufacturer.trim()) {
    payload.manufacturer = state.manufacturer.trim();
  }
  if (state.username.trim()) {
    payload.username = state.username.trim();
  }
  if (state.password.trim()) {
    payload.password = state.password.trim();
  }
  if (state.rtsp_port.trim()) {
    payload.rtsp_port = state.rtsp_port.trim();
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

function hasSharedDefaultForField(
  field: CameraImportRequiredField,
  sharedDefaults: CameraImportSharedDefaults | null
) {
  if (!sharedDefaults) {
    return false;
  }

  if (field === "manufacturer") {
    return Boolean(sharedDefaults.manufacturer);
  }
  if (field === "username") {
    return Boolean(sharedDefaults.username);
  }
  if (field === "password") {
    return Boolean(sharedDefaults.password);
  }

  return false;
}

function getRemainingMissingFields(
  candidate: CameraImportCandidate,
  sharedDefaults: CameraImportSharedDefaults | null
) {
  return candidate.missing_fields.filter(
    (field) => !hasSharedDefaultForField(field, sharedDefaults)
  );
}

function getSharedDefaultAppliedFields(
  candidate: CameraImportCandidate,
  sharedDefaults: CameraImportSharedDefaults | null
) {
  return candidate.missing_fields.filter((field) =>
    hasSharedDefaultForField(field, sharedDefaults)
  );
}

export default function CameraBulkImportModal({
  isOpen,
  onClose,
  onImported,
}: CameraBulkImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [stage, setStage] = useState<ImportStage>("idle");
  const [previewCommandId, setPreviewCommandId] = useState<number | null>(null);
  const [uploadMeta, setUploadMeta] = useState<UploadMeta | null>(null);
  const [preview, setPreview] = useState<CameraImportPreview | null>(null);
  const [applyResult, setApplyResult] = useState<CameraImportApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enableGpuBatch, setEnableGpuBatch] = useState(false);
  const [sharedDefaultsForm, setSharedDefaultsForm] = useState<SharedDefaultsFormState>({
    manufacturer: "",
    username: "",
    password: "",
    rtsp_port: "",
  });

  const resetState = () => {
    setSelectedFile(null);
    setStage("idle");
    setPreviewCommandId(null);
    setUploadMeta(null);
    setPreview(null);
    setApplyResult(null);
    setError(null);
    setEnableGpuBatch(false);
    setSharedDefaultsForm({
      manufacturer: "",
      username: "",
      password: "",
      rtsp_port: "",
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (!isOpen) {
      resetState();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !previewCommandId || stage !== "polling") {
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;
    const pollingStartedAt = Date.now();

    const pollCommandStatus = async () => {
      try {
        if (Date.now() - pollingStartedAt >= CAMERA_IMPORT_POLL_TIMEOUT_MS) {
          setError(
            "The local import assistant took too long to finish this preview. Please try again."
          );
          setStage("error");
          return;
        }

        const response = await fetch(`/api/camera-imports/${previewCommandId}`, {
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error(
            await parseApiError(response, "Failed to load the camera import preview.")
          );
        }

        const data = (await response.json()) as PreviewCommandStatusResponse;
        if (cancelled) {
          return;
        }

        if (data.preview) {
          setPreview(data.preview);
        }

        if (data.apply) {
          setApplyResult(data.apply);
        }

        const normalizedStatus = String(data.status || "pending").trim().toLowerCase();
        if (normalizedStatus === "completed") {
          setStage(data.apply ? "applied" : "ready");
          return;
        }

        if (normalizedStatus === "failed" || normalizedStatus === "cancelled") {
          setError(data.error || "The local import assistant could not normalize this file.");
          setStage("error");
          return;
        }

        timeoutId = window.setTimeout(() => {
          void pollCommandStatus();
        }, CAMERA_IMPORT_POLL_INTERVAL_MS);
      } catch (pollError) {
        if (cancelled) {
          return;
        }

        setError(
          pollError instanceof Error
            ? pollError.message
            : "Failed to load the camera import preview."
        );
        setStage("error");
      }
    };

    void pollCommandStatus();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isOpen, previewCommandId, stage]);

  useEffect(() => {
    const gpuBatchStatus = applyResult?.gpu_batch?.status;
    if (
      !isOpen ||
      !previewCommandId ||
      !applyResult?.gpu_batch ||
      isTerminalGpuBatchStatus(gpuBatchStatus)
    ) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    const pollGpuBatchStatus = async () => {
      try {
        const response = await fetch(`/api/camera-imports/${previewCommandId}/gpu-batch`, {
          credentials: "include",
        });

        if (cancelled) {
          return;
        }

        if (response.status === 404) {
          return;
        }

        if (!response.ok) {
          throw new Error(
            await parseApiError(response, "Failed to load the background GPU validation status.")
          );
        }

        const data = (await response.json()) as CameraImportGpuBatchSummary;
        if (cancelled) {
          return;
        }

        setApplyResult((current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,
            gpu_batch: data,
          };
        });

        if (!isTerminalGpuBatchStatus(data.status)) {
          timeoutId = window.setTimeout(() => {
            void pollGpuBatchStatus();
          }, CAMERA_IMPORT_GPU_BATCH_POLL_INTERVAL_MS);
        }
      } catch (gpuBatchError) {
        if (cancelled) {
          return;
        }

        console.error("[CameraBulkImportModal] GPU batch status polling failed:", gpuBatchError);
        timeoutId = window.setTimeout(() => {
          void pollGpuBatchStatus();
        }, CAMERA_IMPORT_GPU_BATCH_POLL_INTERVAL_MS);
      }
    };

    void pollGpuBatchStatus();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    applyResult?.gpu_batch?.job_id,
    applyResult?.gpu_batch?.status,
    isOpen,
    previewCommandId,
  ]);

  const combinedGlobalWarnings = useMemo(() => {
    return Array.from(
      new Set([...(uploadMeta?.global_warnings || []), ...(preview?.global_warnings || [])])
    );
  }, [preview?.global_warnings, uploadMeta?.global_warnings]);

  const sharedDefaults = useMemo(
    () => buildSharedDefaultsPayload(sharedDefaultsForm),
    [sharedDefaultsForm]
  );

  const readyCandidates =
    preview?.candidates.filter(
      (candidate) => getRemainingMissingFields(candidate, sharedDefaults).length === 0
    ) || [];
  const incompleteCandidates =
    preview?.candidates.filter(
      (candidate) => getRemainingMissingFields(candidate, sharedDefaults).length > 0
    ) || [];

  const missingFieldSummaryLines = useMemo(() => {
    if (!preview) {
      return [];
    }

    const summary: Record<string, number> = {};
    preview.candidates.forEach((candidate) => {
      getRemainingMissingFields(candidate, sharedDefaults).forEach((field) => {
        summary[field] = (summary[field] || 0) + 1;
      });
    });

    return Object.entries(summary)
      .sort((left, right) => right[1] - left[1])
      .map(([field, count]) => `${humanizeFieldLabel(field)} missing in ${count} row(s)`);
  }, [preview, sharedDefaults]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] || null;
    setSelectedFile(nextFile);
    setStage("idle");
    setPreviewCommandId(null);
    setUploadMeta(null);
    setPreview(null);
    setApplyResult(null);
    setError(null);
    setEnableGpuBatch(false);
    setSharedDefaultsForm({
      manufacturer: "",
      username: "",
      password: "",
      rtsp_port: "",
    });
  };

  const handlePreviewRequest = async () => {
    if (!selectedFile) {
      setError("Choose a file before starting the import preview.");
      return;
    }

    setStage("uploading");
    setPreviewCommandId(null);
    setPreview(null);
    setApplyResult(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("/api/camera-imports/preview", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(
          await parseApiError(
            response,
            "Failed to upload the file for camera import preview."
          )
        );
      }

      const data = (await response.json()) as UploadPreviewResponse;
      const nextCommandId = normalizeCommandId(data.command_id);
      const normalizedStatus = String(data.status || "pending").trim().toLowerCase();

      setUploadMeta({
        file_name: data.file_name || selectedFile.name,
        source_format: data.source_format || null,
        total_rows_detected:
          typeof data.total_rows_detected === "number" ? data.total_rows_detected : null,
        rows_sent_to_llm:
          typeof data.rows_sent_to_llm === "number" ? data.rows_sent_to_llm : null,
        global_warnings: Array.isArray(data.global_warnings) ? data.global_warnings : [],
      });

      if (data.preview) {
        setPreview(data.preview);
      }

      if (normalizedStatus === "failed") {
        throw new Error(
          data.error || "The local import assistant could not normalize this file."
        );
      }

      if (normalizedStatus === "completed") {
        if (!nextCommandId) {
          throw new Error(
            "The local import assistant completed the preview but did not return a valid import session id."
          );
        }

        setPreviewCommandId(nextCommandId);
        setStage("ready");
        return;
      }

      if (!nextCommandId) {
        throw new Error(
          "The local import assistant did not return a valid import session id."
        );
      }

      setPreviewCommandId(nextCommandId);
      setStage("polling");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to upload the file for camera import preview."
      );
      setStage("error");
    }
  };

  const handleApplyImport = async () => {
    if (!previewCommandId || !preview) {
      return;
    }

    setStage("applying");
    setError(null);

    try {
      const response = await fetch(`/api/camera-imports/${previewCommandId}/apply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shared_defaults: sharedDefaults || undefined,
          gpu_batch: enableGpuBatch
            ? {
                enabled: true,
                requested_mode: "nvidia",
                restart_if_running: true,
              }
            : undefined,
        }),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(
          await parseApiError(response, "Failed to create cameras from this import preview.")
        );
      }

      const data = (await response.json()) as CameraImportApplyResult;
      setApplyResult(data);
      setStage("applied");

      if (onImported) {
        await onImported(data, preview);
      }
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "Failed to create cameras from this import preview."
      );
      setStage("error");
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
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-200">
                <Sparkles className="h-3.5 w-3.5" />
                Local import assistant
              </div>
              <h2 className="text-2xl font-semibold text-gray-100">Import cameras from file</h2>
              <p className="mt-2 max-w-3xl text-sm text-gray-400">
                Upload Excel, CSV, JSON, TSV, or plain text. The local import assistant will try
                to map each row into camera fields, generate a placeholder address when needed,
                and warn you about rows that still need required data before they can be created.
              </p>
            </div>

            <button
              onClick={onClose}
              className="rounded-xl border border-gray-800 bg-gray-900 p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
              aria-label="Close import modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex-1">
                  <label className="mb-2 block text-sm font-medium text-gray-200">
                    Source file
                  </label>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <label className="flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-gray-700 bg-gray-950 px-4 py-3 text-sm text-gray-300 transition-colors hover:border-blue-500/50 hover:text-gray-100">
                      <Upload className="h-4 w-4" />
                      <span>{selectedFile ? "Change file" : "Choose file"}</span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls,.ods,.csv,.tsv,.json,.txt,.log,text/plain,application/json"
                        className="hidden"
                        onChange={handleFileChange}
                        disabled={stage === "uploading" || stage === "polling" || stage === "applying"}
                      />
                    </label>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-gray-200">
                        {selectedFile ? selectedFile.name : "No file selected yet"}
                      </p>
                      <p className="text-xs text-gray-500">
                        Supports arbitrary columns. Extra data is ignored when not needed.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  {(preview || applyResult || error) && (
                    <button
                      onClick={resetState}
                      className="min-h-[48px] rounded-xl border border-gray-700 px-4 py-3 text-sm font-medium text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-800 hover:text-gray-100"
                    >
                      Start over
                    </button>
                  )}
                  <button
                    onClick={handlePreviewRequest}
                    disabled={
                      !selectedFile ||
                      stage === "uploading" ||
                      stage === "polling" ||
                      stage === "applying"
                    }
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-blue-500 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-blue-500/50"
                  >
                    {stage === "uploading" || stage === "polling" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Analyzing
                      </>
                    ) : (
                      <>
                        <FileUp className="h-4 w-4" />
                        Analyze file
                      </>
                    )}
                  </button>
                </div>
              </div>

              {uploadMeta && (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-gray-800 bg-gray-950/80 p-4">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Format</p>
                    <p className="mt-1 text-sm font-medium text-gray-100">
                      {formatSourceFormat(uploadMeta.source_format)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-800 bg-gray-950/80 p-4">
                    <p className="text-xs uppercase tracking-wide text-gray-500">
                      Rows detected
                    </p>
                    <p className="mt-1 text-sm font-medium text-gray-100">
                      {uploadMeta.total_rows_detected ?? "-"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-800 bg-gray-950/80 p-4">
                    <p className="text-xs uppercase tracking-wide text-gray-500">
                      Rows analyzed
                    </p>
                    <p className="mt-1 text-sm font-medium text-gray-100">
                      {uploadMeta.rows_sent_to_llm ?? "-"}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {stage === "polling" && (
              <div className="mt-5 rounded-2xl border border-blue-500/20 bg-blue-500/10 p-5 text-sm text-blue-100">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <div>
                    <p className="font-medium">The local import assistant is normalizing the imported rows.</p>
                    <p className="mt-1 text-blue-200/80">
                      We are matching whatever columns exist in the file to the internal camera
                      fields and checking which rows are ready to create.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-100">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Import preview failed</p>
                    <p className="mt-1 text-red-200/90">{error}</p>
                  </div>
                </div>
              </div>
            )}

            {preview && (
              <div className="mt-5 space-y-5">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                    <p className="text-xs uppercase tracking-wide text-emerald-200/80">Ready</p>
                    <p className="mt-1 text-2xl font-semibold text-emerald-100">
                      {readyCandidates.length}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                    <p className="text-xs uppercase tracking-wide text-amber-200/80">
                      Need review
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-amber-100">
                      {incompleteCandidates.length}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 p-4">
                    <p className="text-xs uppercase tracking-wide text-sky-200/80">
                      Placeholder address
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-sky-100">
                      {preview.defaulted_address_count}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-gray-800 bg-gray-900/80 p-4">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Rows in file</p>
                    <p className="mt-1 text-2xl font-semibold text-gray-100">
                      {preview.total_rows_detected}
                    </p>
                  </div>
                </div>

                {(combinedGlobalWarnings.length > 0 || missingFieldSummaryLines.length > 0) && (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-200" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-amber-100">Review before importing</p>
                        {combinedGlobalWarnings.length > 0 && (
                          <ul className="mt-2 space-y-1 text-sm text-amber-50/90">
                            {combinedGlobalWarnings.map((warning, index) => (
                              <li key={`${warning}-${index}`}>{warning}</li>
                            ))}
                          </ul>
                        )}
                        {missingFieldSummaryLines.length > 0 && (
                          <ul className="mt-2 space-y-1 text-sm text-amber-50/90">
                            {missingFieldSummaryLines.map((line, index) => (
                              <li key={`${line}-${index}`}>{line}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-5">
                  <div className="flex items-start gap-3">
                    <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-200" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-blue-100">
                        Shared defaults for sparse files
                      </p>
                      <p className="mt-1 text-sm text-blue-50/85">
                        If the spreadsheet omits repeated credentials, manufacturer, or RTSP
                        port, enter the shared value once here. It will only be applied to rows
                        where that field is still blank.
                      </p>
                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <label className="space-y-2 text-sm">
                          <span className="text-blue-50/90">Manufacturer</span>
                          <input
                            type="text"
                            value={sharedDefaultsForm.manufacturer}
                            onChange={(event) =>
                              setSharedDefaultsForm((current) => ({
                                ...current,
                                manufacturer: event.target.value,
                              }))
                            }
                            className="w-full rounded-xl border border-blue-400/20 bg-gray-950/70 px-3 py-2.5 text-sm text-gray-100 outline-none transition focus:border-blue-300"
                            placeholder="Example: Hikvision"
                          />
                        </label>
                        <label className="space-y-2 text-sm">
                          <span className="text-blue-50/90">Username</span>
                          <input
                            type="text"
                            value={sharedDefaultsForm.username}
                            onChange={(event) =>
                              setSharedDefaultsForm((current) => ({
                                ...current,
                                username: event.target.value,
                              }))
                            }
                            className="w-full rounded-xl border border-blue-400/20 bg-gray-950/70 px-3 py-2.5 text-sm text-gray-100 outline-none transition focus:border-blue-300"
                            placeholder="Example: admin"
                          />
                        </label>
                        <label className="space-y-2 text-sm">
                          <span className="text-blue-50/90">Password</span>
                          <input
                            type="text"
                            value={sharedDefaultsForm.password}
                            onChange={(event) =>
                              setSharedDefaultsForm((current) => ({
                                ...current,
                                password: event.target.value,
                              }))
                            }
                            className="w-full rounded-xl border border-blue-400/20 bg-gray-950/70 px-3 py-2.5 text-sm text-gray-100 outline-none transition focus:border-blue-300"
                            placeholder="Shared password"
                          />
                        </label>
                        <label className="space-y-2 text-sm">
                          <span className="text-blue-50/90">RTSP port</span>
                          <input
                            type="text"
                            value={sharedDefaultsForm.rtsp_port}
                            onChange={(event) =>
                              setSharedDefaultsForm((current) => ({
                                ...current,
                                rtsp_port: event.target.value,
                              }))
                            }
                            className="w-full rounded-xl border border-blue-400/20 bg-gray-950/70 px-3 py-2.5 text-sm text-gray-100 outline-none transition focus:border-blue-300"
                            placeholder="554"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/8 p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex items-start gap-3">
                      <Cpu className="mt-0.5 h-5 w-5 flex-shrink-0 text-cyan-200" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-cyan-100">
                          Background GPU validation
                        </p>
                        <p className="mt-1 text-sm text-cyan-50/85">
                          Validate and enable GPU for every imported camera. The import finishes
                          first, then the app runs the same compatibility scan used by the CPU/GPU
                          button one camera at a time in the background.
                        </p>
                        <p className="mt-2 text-xs text-cyan-100/70">
                          Cameras that pass switch to GPU automatically. Cameras that do not pass
                          stay on CPU.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setEnableGpuBatch((current) => !current)}
                      aria-pressed={enableGpuBatch}
                      disabled={stage === "applying" || Boolean(applyResult)}
                      className={`inline-flex min-h-[52px] items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        enableGpuBatch
                          ? "border-cyan-300/50 bg-cyan-400/18 text-cyan-50"
                          : "border-gray-700 bg-gray-950/70 text-gray-200 hover:border-cyan-400/30 hover:text-gray-50"
                      }`}
                    >
                      <span>
                        {enableGpuBatch
                          ? "GPU validation enabled for all cameras"
                          : "GPU validation disabled"}
                      </span>
                      <span
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                          enableGpuBatch ? "bg-cyan-200/90" : "bg-gray-700"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 rounded-full bg-gray-950 transition-transform ${
                            enableGpuBatch ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </span>
                    </button>
                  </div>
                </div>

                {incompleteCandidates.length > 0 && (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-100">
                    <p className="font-medium">
                      Rows still missing IP address, username, password, or manufacturer after
                      shared defaults will stay out of the import.
                    </p>
                    <p className="mt-1 text-red-100/80">
                      The preview below shows exactly which field is still missing for each row.
                    </p>
                  </div>
                )}

                {applyResult && (
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5 text-sm text-emerald-100">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium">
                          {applyResult.created_count} camera(s) created from this file.
                        </p>
                        <p className="mt-1 text-emerald-100/80">
                          {applyResult.skipped_count} row(s) were skipped because they were
                          incomplete or failed during creation.
                        </p>
                        {Array.isArray(applyResult.failed_candidates) &&
                          applyResult.failed_candidates.length > 0 && (
                            <ul className="mt-3 space-y-1 text-emerald-50/90">
                              {applyResult.failed_candidates.map((candidate) => (
                                <li
                                  key={`${candidate.source_index}-${candidate.source_reference}`}
                                >
                                  {candidate.source_reference}: {candidate.reason}
                                </li>
                              ))}
                            </ul>
                          )}
                        {applyResult.gpu_batch && (
                          <div
                            className={`mt-4 rounded-2xl border p-4 ${getGpuBatchStatusPanelClasses(
                              applyResult.gpu_batch.status
                            )}`}
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0">
                                <p className="text-xs uppercase tracking-wide text-current/70">
                                  GPU validation
                                </p>
                                <p className="mt-1 text-sm font-semibold text-current">
                                  {formatGpuBatchStatusLabel(applyResult.gpu_batch.status)}
                                </p>
                                <p className="mt-2 text-sm text-current/85">
                                  {applyResult.gpu_batch.message}
                                </p>
                              </div>
                              <div className="rounded-full border border-current/20 px-3 py-1 text-xs font-medium text-current/85">
                                {applyResult.gpu_batch.processed_count}/
                                {applyResult.gpu_batch.total_count} processed
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
                              <div className="rounded-xl border border-current/10 bg-black/10 px-3 py-3">
                                <p className="text-xs uppercase tracking-wide text-current/60">
                                  Enabled on GPU
                                </p>
                                <p className="mt-1 text-lg font-semibold text-current">
                                  {applyResult.gpu_batch.enabled_gpu_count}
                                </p>
                              </div>
                              <div className="rounded-xl border border-current/10 bg-black/10 px-3 py-3">
                                <p className="text-xs uppercase tracking-wide text-current/60">
                                  Stayed on CPU
                                </p>
                                <p className="mt-1 text-lg font-semibold text-current">
                                  {applyResult.gpu_batch.kept_cpu_count}
                                </p>
                              </div>
                              <div className="rounded-xl border border-current/10 bg-black/10 px-3 py-3">
                                <p className="text-xs uppercase tracking-wide text-current/60">
                                  Failed
                                </p>
                                <p className="mt-1 text-lg font-semibold text-current">
                                  {applyResult.gpu_batch.failed_count}
                                </p>
                              </div>
                              <div className="rounded-xl border border-current/10 bg-black/10 px-3 py-3">
                                <p className="text-xs uppercase tracking-wide text-current/60">
                                  Requested mode
                                </p>
                                <p className="mt-1 text-lg font-semibold text-current">
                                  {applyResult.gpu_batch.requested_mode === "nvidia"
                                    ? "GPU"
                                    : "CPU"}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  {preview.candidates.map((candidate) => {
                    const addressText = formatCandidateAddress(candidate);
                    const remainingMissingFields = getRemainingMissingFields(
                      candidate,
                      sharedDefaults
                    );
                    const sharedDefaultAppliedFields = getSharedDefaultAppliedFields(
                      candidate,
                      sharedDefaults
                    );
                    const effectiveCanCreate = remainingMissingFields.length === 0;

                    return (
                      <div
                        key={`${candidate.source_index}-${candidate.source_reference}`}
                        className="rounded-2xl border border-gray-800 bg-gray-900/80 p-4"
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-gray-100">
                                {candidate.source_reference}
                              </p>
                              <span
                                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                  effectiveCanCreate
                                    ? "bg-emerald-500/15 text-emerald-200"
                                    : "bg-red-500/15 text-red-200"
                                }`}
                              >
                                {effectiveCanCreate
                                  ? sharedDefaultAppliedFields.length > 0
                                    ? "Ready with shared defaults"
                                    : "Ready to create"
                                  : "Needs required fields"}
                              </span>
                              {candidate.address_was_defaulted && (
                                <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-200">
                                  Placeholder address used
                                </span>
                              )}
                            </div>
                            <p className="mt-2 text-sm text-gray-400">
                              {candidate.name || `Imported camera ${candidate.source_index + 1}`}
                            </p>
                          </div>

                          <div className="grid gap-2 text-sm text-gray-300 sm:grid-cols-2 lg:min-w-[360px]">
                            <p>
                              <span className="text-gray-500">IP:</span>{" "}
                              {candidate.ip_address || "Missing"}
                            </p>
                            <p>
                              <span className="text-gray-500">Manufacturer:</span>{" "}
                              {candidate.manufacturer || "Missing"}
                            </p>
                            <p>
                              <span className="text-gray-500">Username:</span>{" "}
                              {candidate.username || "Missing"}
                            </p>
                            <p>
                              <span className="text-gray-500">Password:</span>{" "}
                              {candidate.password ? "Provided" : "Missing"}
                            </p>
                          </div>
                        </div>

                        {addressText && (
                          <div className="mt-3 flex items-start gap-2 rounded-xl border border-gray-800 bg-gray-950/70 px-3 py-2 text-sm text-gray-300">
                            <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" />
                            <span>{addressText}</span>
                          </div>
                        )}

                        {remainingMissingFields.length > 0 && (
                          <div className="mt-3">
                            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-red-200/80">
                              Missing required fields
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {remainingMissingFields.map((field) => (
                                <span
                                  key={field}
                                  className="rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-100"
                                >
                                  {humanizeFieldLabel(field)}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {sharedDefaultAppliedFields.length > 0 && (
                          <div className="mt-3">
                            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-blue-200/80">
                              Shared defaults to apply
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {sharedDefaultAppliedFields.map((field) => (
                                <span
                                  key={`${candidate.source_index}-shared-${field}`}
                                  className="rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-medium text-blue-100"
                                >
                                  {humanizeFieldLabel(field)}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {candidate.defaulted_fields.length > 0 && (
                          <div className="mt-3">
                            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-sky-200/80">
                              Auto-filled fields
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {candidate.defaulted_fields.map((field) => (
                                <span
                                  key={`${candidate.source_index}-${field}`}
                                  className="rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-100"
                                >
                                  {humanizeFieldLabel(field)}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {candidate.warnings.length > 0 && (
                          <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-50">
                            {candidate.warnings.map((warning, index) => (
                              <p key={`${candidate.source_index}-${index}`}>{warning}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-gray-800 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-gray-500">
              {preview ? (
                <>
                  {readyCandidates.length} row(s) ready, {incompleteCandidates.length} row(s) still
                  need attention.
                </>
              ) : (
                <>
                  Internal required fields: IP address, username, password, and manufacturer.
                </>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={onClose}
                className="min-h-[48px] rounded-xl border border-gray-700 px-4 py-3 text-sm font-medium text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-800 hover:text-gray-100"
              >
                Close
              </button>

              {preview && (
                <button
                  onClick={handleApplyImport}
                  disabled={
                    readyCandidates.length === 0 || stage === "applying" || stage === "applied"
                  }
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-medium text-gray-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-500/40 disabled:text-gray-200/70"
                >
                  {stage === "applying" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating cameras
                    </>
                  ) : applyResult ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Imported
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Create {readyCandidates.length} camera(s)
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
