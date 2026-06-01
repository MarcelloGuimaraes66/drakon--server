export type CameraBatchEditConnectionMethod = "RTSP" | "WEBCAM" | "HTTP" | "ONVIF";

export interface CameraBatchEditChange {
  field: string;
  mode: "set" | "clear";
  value?: string | number | boolean | null;
}

export interface CameraBatchEditPreviewTarget {
  camera_id: number;
  camera_name: string;
  ip_address?: string | null;
  description?: string | null;
  manufacturer?: string | null;
  connection_method?: CameraBatchEditConnectionMethod | null;
  status: "ready" | "blocked" | "no_change";
  changed_fields: string[];
  warnings: string[];
}

export interface CameraBatchEditPreview {
  total_matched: number;
  ready_count: number;
  blocked_count: number;
  unchanged_count: number;
  changes: CameraBatchEditChange[];
  global_warnings: string[];
  targets: CameraBatchEditPreviewTarget[];
}

export interface CameraBatchEditApplyResult {
  applied_at: string;
  updated_count: number;
  skipped_count: number;
  updated_camera_ids: number[];
  failed_targets?: Array<{
    camera_id: number;
    camera_name?: string | null;
    reason: string;
  }>;
}
