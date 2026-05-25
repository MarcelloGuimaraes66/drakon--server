export const CAMERA_IMPORT_REQUIRED_FIELDS = [
  "ip_address",
  "username",
  "password",
  "manufacturer",
] as const;

export type CameraImportRequiredField =
  (typeof CAMERA_IMPORT_REQUIRED_FIELDS)[number];

export interface CameraImportSourceRow {
  source_index: number;
  source_sheet_name?: string | null;
  source_row_number?: number | null;
  source_reference: string;
  values: Record<string, string>;
}

export interface CameraImportCandidate {
  source_index: number;
  source_reference: string;
  source_sheet_name?: string | null;
  source_row_number?: number | null;
  source_values: Record<string, string>;
  name: string;
  ip_address: string;
  rtsp_port: string;
  manufacturer: string;
  username: string;
  password: string;
  channel?: string | null;
  subtype?: string | null;
  connection_method: "RTSP" | "HTTP" | "ONVIF";
  description?: string | null;
  street: string;
  number: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  missing_fields: CameraImportRequiredField[];
  defaulted_fields: string[];
  warnings: string[];
  can_create: boolean;
  address_was_defaulted: boolean;
}

export interface CameraImportSharedDefaults {
  manufacturer?: string;
  username?: string;
  password?: string;
  rtsp_port?: string;
  connection_method?: "RTSP" | "HTTP" | "ONVIF";
  channel?: string;
  subtype?: string;
}

export type CameraImportGpuBatchStatus =
  | "queued"
  | "waiting_for_exe"
  | "probing"
  | "completed"
  | "failed";

export interface CameraImportGpuBatchSummary {
  job_id?: number;
  status: CameraImportGpuBatchStatus;
  requested_mode: "cpu" | "nvidia";
  total_count: number;
  processed_count: number;
  enabled_gpu_count: number;
  kept_cpu_count: number;
  failed_count: number;
  active_camera_id?: number | null;
  waiting_for_exe: boolean;
  last_error?: string | null;
  message: string;
}

export interface CameraImportPreview {
  file_name: string;
  file_extension: string;
  source_format:
    | "spreadsheet"
    | "csv"
    | "tsv"
    | "json"
    | "text"
    | "unknown";
  total_rows_detected: number;
  rows_sent_to_llm: number;
  ready_count: number;
  incomplete_count: number;
  defaulted_address_count: number;
  skipped_count: number;
  global_warnings: string[];
  missing_field_summary: Record<string, number>;
  candidates: CameraImportCandidate[];
}

export interface CameraImportApplyResult {
  command_id: number;
  applied_at: string;
  created_count: number;
  skipped_count: number;
  created_camera_ids: number[];
  duplicate_source_indexes: number[];
  gpu_batch?: CameraImportGpuBatchSummary | null;
  failed_candidates?: Array<{
    source_index: number;
    source_reference: string;
    reason: string;
  }>;
}
