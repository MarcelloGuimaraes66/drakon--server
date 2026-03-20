import { z } from "zod";

// Camera schemas
export const CreateCameraSchema = z.object({
  name: z.string().min(1),
  ip_address: z.string().optional(),
  rtsp_port: z.string().optional(),
  manufacturer: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  channel: z.string().optional(),
  subtype: z.string().optional(),
  connection_method: z.enum(["RTSP", "WEBCAM", "HTTP", "ONVIF"]).optional(),
  description: z.string().optional(),
  street: z.string().optional(),
  number: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip_code: z.string().optional(),
  country: z.string().optional(),
  retention_days: z.number().optional(),
  webcam_index: z.number().optional(),
  allowpublicaccess: z.boolean().optional(),
});

export const UpdateCameraSchema = z.object({
  name: z.string().optional(),
  ip_address: z.string().optional(),
  rtsp_port: z.string().optional(),
  manufacturer: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  channel: z.string().optional(),
  subtype: z.string().optional(),
  connection_method: z.enum(["RTSP", "WEBCAM", "HTTP", "ONVIF"]).optional(),
  description: z.string().optional(),
  street: z.string().optional(),
  number: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip_code: z.string().optional(),
  country: z.string().optional(),
  retention_days: z.number().optional(),
  webcam_index: z.number().int().nonnegative().nullable().optional(),
  allowpublicaccess: z.boolean().optional(),
  is_service_running: z.number().min(0).max(1).optional(),
});

// Algorithm schema
export const CreateAlgorithmSchema = z.object({
  algorithm_type: z.string(),
  is_enabled: z.number().min(0).max(1),
  llm_prompt: z.string().optional(),
  image_region: z.string().optional(),
  config_json: z.string().optional(),
  display_name: z.string().optional(),
  prompt_template: z.string().optional(),
  alert_condition: z.string().optional(),
  negative_condition: z.string().optional(),
  analysis_regions: z.array(z.unknown()).optional(),
  input_type: z.string().optional(),
  inference_model: z.string().optional(),
  model_fps: z.number().optional(),
  run_every: z.number().optional(),
  running_resolution: z.number().optional(),
  only_capture_on_motion: z.union([z.boolean(), z.number(), z.string()]).optional(),
  face_target_ids: z.array(z.number()).optional(),
});

// ReID Target schema
export const CreateReIDTargetSchema = z.object({
  camera_id: z.number(),
  person_name: z.string().min(1),
  person_description: z.string().min(1),
});

export const CreateDrakonFindTargetSchema = z.object({
  entity_type: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  traits: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
});

export const CreateDrakonFindSearchSchema = z.object({
  target_id: z.number().int().positive(),
  selected_states: z.array(z.string().trim().min(2).max(32)).min(1).max(27),
  country_code: z.string().trim().min(2).max(3).optional(),
  duration_seconds: z.number().int().min(1800).max(2_592_000).optional(),
  excluded_camera_ids: z.array(z.number().int().positive()).max(20000).optional(),
});

export const ResolveDrakonFindScopeSchema = z.object({
  selected_states: z.array(z.string().trim().min(2).max(32)).min(1).max(27),
  country_code: z.string().trim().min(2).max(3).optional(),
});

export const UpdateDrakonFindSearchStatusSchema = z.object({
  status: z.enum([
    "queued",
    "dispatching",
    "running",
    "paused",
    "completed",
    "cancelled",
    "failed",
  ]),
});

// Chat schema
export const SendChatMessageSchema = z.object({
  content: z.string().min(1),
  camera_id: z.number().optional(),
});

// Preferences schema
export const UpdatePreferencesSchema = z.object({
  theme: z.enum(["light", "dark"]).optional(),
  language: z.string().optional(),
});

// Billing schema
export const CreateCheckoutSessionSchema = z.object({
  type: z.enum(["subscription", "credits"]),
  camera_id: z.number().optional(),
  credits_amount: z.number().optional(),
  plan_tier: z.string().optional(),
  metadata: z.any().optional(),
});

// Pairing schema
export const ClaimPairingSchema = z.object({
  pair_code: z.string().length(6),
  exe_id: z.string(),
  timezone_iana: z.string().min(1),
});

// Type definitions
export interface Camera {
  id: number;
  user_id: string;
  name: string;
  ip_address: string;
  rtsp_port?: string;
  manufacturer?: string;
  username?: string;
  password?: string;
  channel?: string;
  subtype?: string;
  connection_method?: string;
  is_online: number;
  is_service_running: number;
  thumbnail_url?: string;
  last_thumbnail_update?: string;
  created_at: string;
  updated_at: string;
  store_frames: number;
  retention_days?: number;
  description?: string;
  street?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  state_code?: string;
  zip_code?: string;
  complement?: string;
  country?: string;
  country_code?: string;
  timezone?: string;
  utc_offset_seconds?: number;
  webcam_index?: number;
  allowpublicaccess?: number;
  analysis_speed?: number;
  model_tier?: string;
}

export interface DrakonFindTarget {
  id: number;
  user_id: string;
  entity_type: string;
  name: string;
  description: string;
  traits: string[];
  images: DrakonFindTargetImage[];
  image_count: number;
  created_at: string;
  updated_at: string;
  search_count: number;
  queued_search_count: number;
  running_search_count: number;
  last_search_at?: string | null;
}

export interface DrakonFindTargetImage {
  id: number;
  target_id: number;
  image_url: string;
  content_type?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DrakonFindScopeStateSummary {
  state_code: string;
  state_name: string;
  camera_count: number;
}

export interface DrakonFindScopeCameraPreview {
  id: number;
  user_id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  state_code?: string | null;
  country?: string | null;
  country_code?: string | null;
  allowpublicaccess: number;
}

export interface DrakonFindScopeResolution {
  country_code: string;
  selected_states: string[];
  eligible_camera_count: number;
  eligible_owner_count: number;
  excluded_camera_ids?: number[];
  states: DrakonFindScopeStateSummary[];
  cameras: DrakonFindScopeCameraPreview[];
  preview_updated_at: string;
}

export interface DrakonFindSearch {
  id: number;
  user_id: string;
  target_id: number;
  target_name: string;
  target_entity_type: string;
  target_description: string;
  status: string;
  runtime_mode: string;
  input_type: string;
  window_seconds: number;
  duration_seconds: number;
  run_until?: string | null;
  country_code: string;
  selected_states: string[];
  selected_state_count: number;
  eligible_camera_count: number;
  eligible_owner_count: number;
  attempt_count: number;
  dispatched_command_count: number;
  completed_camera_count: number;
  matched_camera_count: number;
  pending_camera_count: number;
  hit_count: number;
  active_client_count: number;
  last_event_at?: string | null;
  last_error?: string | null;
  clients: DrakonFindSearchClientSummary[];
  scope_snapshot: DrakonFindScopeResolution | null;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DrakonFindSearchClientSummary {
  client_id: string;
  exe_id: string;
  camera_count: number;
  completed_camera_count: number;
  matched_camera_count: number;
}

export interface DrakonFindHit {
  id: number;
  search_id: number;
  target_id: number;
  camera_id: number;
  camera_name?: string | null;
  camera_owner_user_id: string;
  client_id?: string | null;
  exe_id?: string | null;
  camera_city?: string | null;
  camera_state_code?: string | null;
  summary: string;
  confidence: number;
  image_url?: string | null;
  video_url?: string | null;
  details: Record<string, unknown>;
  matched_at: string;
  created_at: string;
}

export interface DrakonFindAuditLog {
  id: number;
  actor_user_id: string;
  actor_email?: string | null;
  action_type: string;
  target_id?: number | null;
  search_id?: number | null;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Algorithm {
  id: number;
  camera_id: number;
  algorithm_type: string;
  is_enabled: number;
  llm_prompt?: string;
  image_region?: string;
  config_json?: string;
  prompt_template?: string;
  alert_condition?: string;
  negative_condition?: string;
  analysis_regions?: any;
  input_type?: string;
  inference_model?: string;
  run_every?: number;
  running_resolution?: number | null;
  only_capture_on_motion?: number;
  created_at: string;
  updated_at: string;
}

export interface ReIDTarget {
  id: number;
  camera_id: number;
  person_name: string;
  person_description: string;
  created_at: string;
  updated_at: string;
}

export interface Event {
  id: number;
  user_id: string;
  camera_id?: number;
  event_type: string;
  description?: string;
  metadata?: string;
  created_at: string;
  updated_at: string;
  message?: string;
  details_json?: string;
  details?: any;
  is_unread: number;
}

export interface ChatMessage {
  id: number;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  camera_ids?: string;
  tokens_used: number;
  created_at: string;
  updated_at: string;
  session_id?: number;
  message_type?: string;
  is_pending?: number;
  model_prompt_tokens?: number;
  model_output_tokens?: number;
  model_total_tokens?: number;
  camera_selection_json?: string;
  progress_json?: string | null;
  uploaded_image_base64?: string;
}

export interface ChatSession {
  id: number;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface TokenBalance {
  id: number;
  user_id: string;
  balance: number;
  input_balance: number;
  output_balance: number;
  total_spent: number;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: number;
  user_id: string;
  stripe_payment_id: string;
  amount: number;
  currency: string;
  payment_type: string;
  status: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

