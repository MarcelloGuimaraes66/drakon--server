import { ChatMessage } from "@/shared/types";
import type { CameraImportApplyResult, CameraImportPreview } from "@/shared/cameraImport";
import type { CameraBatchEditApplyResult, CameraBatchEditPreview } from "@/shared/cameraBatchEdit";
import type { CameraDiscoverySummary } from "@/shared/cameraDiscovery";

export interface ChatProgressInfo {
  skill?: string;
  phase?: string;
  sequence?: number;
  headline?: string;
  detail?: string;
  step_index?: number;
  step_count?: number;
  updated_at?: string;
}

export interface HitImage {
  url: string;
  time_in_video?: string;
  key?: string;
}

export interface HitMediaItem {
  media_type: "image" | "video";
  url: string;
  time_in_video?: string;
  key?: string;
}

export interface ChatIdentityCardPortrait {
  image_url?: string;
  image_data_url?: string;
  portrait_kind?: string;
  card_role?: string;
  confidence?: number;
  camera_id?: number;
  camera_name?: string;
  frame_timestamp_in_segment?: string;
  timestamp_utc_iso?: string;
  [key: string]: unknown;
}

export interface ChatIdentityCardLastSeen {
  timestamp_utc_iso?: string;
  camera_id?: number;
  camera_name?: string;
  zone?: string;
  [key: string]: unknown;
}

export interface ChatIdentityFeatureCandidate {
  text?: string;
  category?: string;
  relation_to_target?: string;
  confidence?: number;
  [key: string]: unknown;
}

export interface ChatIdentityCardMetadata {
  card_id?: string;
  entity_id?: string;
  entity_type?: string;
  display_name?: string;
  known_name?: string;
  description?: string;
  aliases?: string[];
  stable_attributes?: string[];
  key_traits?: string[];
  identity_signature_traits?: string[];
  identity_context_traits?: string[];
  identity_signature_summary?: string;
  identity_feature_candidates?: ChatIdentityFeatureCandidate[];
  reference_image_urls?: string[];
  portrait_url?: string;
  face_available?: boolean;
  primary_portrait?: ChatIdentityCardPortrait;
  context_portrait?: ChatIdentityCardPortrait;
  last_seen?: ChatIdentityCardLastSeen;
  resolved_identity?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CameraRegistrationDraftMessageMetadata {
  type: "camera_registration_draft";
  status: "awaiting_confirmation" | "registered";
  language?: string;
  draft: Record<string, unknown>;
  target_client_id?: string | null;
  created_camera_id?: number | null;
  created_camera_name?: string | null;
}

export interface CameraNetworkScanMessageMetadata {
  type: "camera_network_scan";
  status: "completed";
  language?: string;
  elapsed_ms?: number;
  timeout_ms?: number;
  summary: CameraDiscoverySummary;
}

export interface CameraBatchRegistrationDraftMessageMetadata {
  type: "camera_batch_registration_draft";
  status: "awaiting_confirmation" | "registered";
  language?: string;
  expected_count?: number | null;
  preview: CameraImportPreview;
  target_client_id?: string | null;
  apply_result?: CameraImportApplyResult | null;
}

export interface CameraBatchEditDraftMessageMetadata {
  type: "camera_batch_edit_draft";
  status: "awaiting_confirmation" | "updated";
  language?: string;
  preview: CameraBatchEditPreview;
  patch_body?: Record<string, unknown>;
  target_client_id?: string | null;
  apply_result?: CameraBatchEditApplyResult | null;
}

export interface CameraEditFormRequestMessageMetadata {
  type: "camera_edit_form_request";
  status: "awaiting_form_open";
  language?: string;
  camera_id: number;
  camera_name?: string | null;
  draft_patch?: Record<string, unknown>;
  clear_fields?: string[];
}

export interface CameraAgentFormEditorTarget {
  type: "camera" | "step_default" | "step_camera";
  camera_id?: number;
  camera_name?: string | null;
  step_id?: number;
  step_title?: string | null;
  job_id?: number;
  job_name?: string | null;
}

export interface CameraAgentFormRequestMessageMetadata {
  type: "camera_agent_form_request";
  status: "awaiting_form_open";
  language?: string;
  camera_id?: number;
  camera_name?: string | null;
  agent_id?: number;
  editor_target?: CameraAgentFormEditorTarget;
  draft_agent?: Record<string, unknown>;
}

export interface CameraAgentCreationDestinationMetadata {
  destination_type: "camera" | "step_default" | "step_camera";
  label: string;
  agent_id?: number;
  camera_id?: number;
  camera_name?: string | null;
  step_id?: number;
  step_title?: string | null;
  job_id?: number;
  job_name?: string | null;
}

export interface CameraAgentCreationResultMessageMetadata {
  type: "camera_agent_creation_result";
  status: "created" | "partially_created";
  language?: string;
  agent_name?: string | null;
  created_destinations: CameraAgentCreationDestinationMetadata[];
}

export interface JobCreationStepMessageMetadata {
  step_index: number;
  step_name?: string | null;
  step_key?: string | null;
  role?: string | null;
  execution_mode?: string | null;
  input_type?: string | null;
  run_every_seconds?: number;
  target_count: number;
  target_preview_labels: string[];
  remaining_target_count?: number;
}

export interface JobCreationResultMessageMetadata {
  type: "job_creation_result";
  status: "created";
  language?: string;
  job_id?: number;
  job_name?: string | null;
  step_count: number;
  target_count: number;
  steps: JobCreationStepMessageMetadata[];
}

export interface ReportDocumentStatMetadata {
  label: string;
  value: string;
}

export interface ReportDocumentRollupStatusMetadata {
  camera_daily_rollups?: "ready" | "empty";
  job_daily_rollups?: "ready" | "empty";
  agent_daily_rollups?: "ready" | "empty";
}

export interface ReportDocumentMessageMetadata {
  type: "report_document";
  status: "generated";
  language?: string;
  report_id?: string;
  report_kind?: string;
  title: string;
  summary?: string;
  generated_at?: string;
  download_path: string;
  download_filename?: string;
  evidence_download_path?: string | null;
  evidence_filename?: string | null;
  stats: ReportDocumentStatMetadata[];
  rollup_status?: ReportDocumentRollupStatusMetadata;
  image_count?: number;
  video_count?: number;
  evidence_file_count?: number;
  phase2_ready?: boolean;
}

export interface CameraAgentEditContextMessageMetadata {
  type: "camera_agent_edit_context";
  status: "awaiting_changes";
  language?: string;
  agent_id?: number;
  agent_name?: string | null;
  agent_summary?: string | null;
  editor_target?: CameraAgentFormEditorTarget;
}

export interface CameraAgentUpdatedFieldMetadata {
  field: string;
  label?: string | null;
  before?: string | null;
  after?: string | null;
}

export interface CameraAgentUpdateResultMessageMetadata {
  type: "camera_agent_update_result";
  status: "updated";
  language?: string;
  agent_id?: number;
  agent_name?: string | null;
  agent_summary?: string | null;
  editor_target?: CameraAgentFormEditorTarget;
  updated_fields: CameraAgentUpdatedFieldMetadata[];
}

function parseMessageCameraSelectionJson(message: ChatMessage): Record<string, unknown> | null {
  const raw = (message as any)?.camera_selection_json;
  if (!raw) {
    return null;
  }

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  return parsed as Record<string, unknown>;
}

function identityCardDedupeKey(card: Record<string, unknown>, fallbackIndex: number): string {
  const rawCardId = typeof card.card_id === "string" ? card.card_id.trim() : "";
  if (rawCardId) {
    return `card:${rawCardId}`;
  }

  const rawEntityId = typeof card.entity_id === "string" ? card.entity_id.trim() : "";
  if (rawEntityId) {
    return `entity:${rawEntityId}`;
  }

  return `fallback:${fallbackIndex}:${JSON.stringify(card)}`;
}

const TEMPORAL_ENGINE_SUFFIX_PATTERN =
  /(?:<br\s*\/?>|\r?\n|\s)*Temporal engine:\s*[\s\S]*$/i;

const LEGACY_VIDEO_SEARCH_SECTION_PATTERN =
  /(?:^|\n{2,})(?:Camera|Camara|C[âa]mera):\s*([^\n]+)\n([^\n|]+?\s-\s[^\n|]+?)\s*\|\s*([\s\S]*?)(?=(?:\n{2,}(?:Camera|Camara|C[âa]mera):\s)|$)/gi;

interface LegacyVideoSearchSection {
  cameraLabel: string;
  timeRange: string;
  body: string;
}

const SENTENCE_BOUNDARY_PATTERN = /(?<=[.!?])\s+/u;
const STRUCTURED_MARKDOWN_LINE_PATTERN =
  /^(?:#{1,6}\s|[-*+]\s|>\s|\d+\.\s|```|~~~|\|)/m;
const PARAGRAPH_CUE_PATTERN =
  /^(?:so|then|therefore|however|also|finally|in practice|important|summary|in short|entao|na pratica|alem disso|por outro lado|por fim|em resumo|resumo|no entanto)\b/i;

const LARGE_PARAGRAPH_MIN_LENGTH = 220;
const TARGET_PARAGRAPH_LENGTH = 210;
const MAX_PARAGRAPH_LENGTH = 320;
const MAX_SENTENCES_PER_PARAGRAPH = 2;
const GENERATED_CUSTOM_AGENT_NAME_PATTERN = /^custom_(?:hub_)?\d+[a-z0-9_-]*$/i;

function parseCameraAgentEditorTarget(
  parsed: Record<string, unknown>
): CameraAgentFormEditorTarget | undefined {
  let editorTarget: CameraAgentFormEditorTarget | undefined;

  if (
    parsed.editor_target &&
    typeof parsed.editor_target === "object" &&
    !Array.isArray(parsed.editor_target)
  ) {
    const rawTarget = parsed.editor_target as Record<string, unknown>;
    const targetType =
      rawTarget.type === "camera" ||
      rawTarget.type === "step_default" ||
      rawTarget.type === "step_camera"
        ? rawTarget.type
        : null;
    if (targetType) {
      const cameraId = Number(rawTarget.camera_id);
      const stepId = Number(rawTarget.step_id);
      const jobId = Number(rawTarget.job_id);
      editorTarget = {
        type: targetType,
        camera_id: Number.isInteger(cameraId) && cameraId > 0 ? cameraId : undefined,
        camera_name:
          typeof rawTarget.camera_name === "string" ? rawTarget.camera_name : undefined,
        step_id: Number.isInteger(stepId) && stepId > 0 ? stepId : undefined,
        step_title:
          typeof rawTarget.step_title === "string" ? rawTarget.step_title : undefined,
        job_id: Number.isInteger(jobId) && jobId > 0 ? jobId : undefined,
        job_name:
          typeof rawTarget.job_name === "string" ? rawTarget.job_name : undefined,
      };
    }
  }

  const legacyCameraId = Number(parsed.camera_id);
  if (!editorTarget && Number.isInteger(legacyCameraId) && legacyCameraId > 0) {
    editorTarget = {
      type: "camera",
      camera_id: legacyCameraId,
      camera_name:
        typeof parsed.camera_name === "string" ? parsed.camera_name : undefined,
    };
  }

  return editorTarget;
}

function readAgentDraftConfigString(
  draft: Record<string, unknown>,
  key: string
): string {
  const configJson = draft.config_json;
  if (!configJson || typeof configJson !== "object" || Array.isArray(configJson)) {
    return "";
  }
  const value = (configJson as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function readAgentDraftString(draft: Record<string, unknown>, key: string): string {
  const value = draft[key];
  return typeof value === "string" ? value.trim() : "";
}

export function isGeneratedCustomAgentName(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized) return false;
  return GENERATED_CUSTOM_AGENT_NAME_PATTERN.test(normalized);
}

export function stripTemporalEngineDiagnostics(content: string): string {
  if (!content) return content;
  return content.replace(TEMPORAL_ENGINE_SUFFIX_PATTERN, "").trimEnd();
}

/**
 * Converts HTML line breaks to actual newlines for display.
 * Handles <br>, <br/>, and <br /> tags (case-insensitive).
 * 
 * Usage: Apply this to message content before displaying, then render
 * with CSS white-space: pre-wrap to preserve line breaks.
 * 
 * Example:
 *   const formatted = formatMessageContent(message.content);
 *   <p className="whitespace-pre-wrap">{formatted}</p>
 */
export function formatMessageContent(content: string): string {
  if (!content) return content;
  
  // Replace <br/><br/>, <br><br>, or similar with double newlines
  let formatted = content.replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '\n\n');
  
  // Replace remaining single <br> tags with single newlines
  formatted = formatted.replace(/<br\s*\/?>/gi, '\n');
  
  return formatted;
}

function normalizeAssistantRawContent(content: string): string {
  return formatMessageContent(stripTemporalEngineDiagnostics(content))
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function applyGenericAssistantSpacing(content: string): string {
  let formatted = content.replace(/:\s+(?=\d+\.\s)/g, ":\n\n");
  formatted = formatted.replace(/([.!?])\s+(?=\d+\.\s)/g, "$1\n");
  formatted = formatted.replace(/([.!?])\s+(?=[-*+]\s)/g, "$1\n");
  formatted = formatted.replace(
    /([^\n])\n(?=(?:[-*+]\s|#{1,6}\s|>\s|\d+\.\s))/g,
    "$1\n\n"
  );
  return formatted.trim();
}

function normalizeNarrativeBlock(block: string): string {
  return block.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

function splitOverlongSingleSentence(block: string): string[] {
  const fragments = block
    .split(/(?<=[;:])\s+/u)
    .map((fragment) => fragment.trim())
    .filter(Boolean);

  if (fragments.length < 2) {
    return [block];
  }

  const paragraphs: string[] = [];
  let current = "";

  fragments.forEach((fragment) => {
    if (
      current &&
      (current.length >= TARGET_PARAGRAPH_LENGTH ||
        current.length + fragment.length + 1 > MAX_PARAGRAPH_LENGTH)
    ) {
      paragraphs.push(current.trim());
      current = fragment;
      return;
    }

    current = current ? `${current} ${fragment}` : fragment;
  });

  if (current) {
    paragraphs.push(current.trim());
  }

  return paragraphs.length > 1 ? paragraphs : [block];
}

function splitNarrativeBlockIntoParagraphs(block: string): string[] {
  const normalized = normalizeNarrativeBlock(block);
  if (!normalized) {
    return [];
  }

  const sentences = normalized
    .split(SENTENCE_BOUNDARY_PATTERN)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    return normalized.length >= MAX_PARAGRAPH_LENGTH
      ? splitOverlongSingleSentence(normalized)
      : [normalized];
  }

  if (sentences.length < 3 && normalized.length < LARGE_PARAGRAPH_MIN_LENGTH) {
    return [normalized];
  }

  const paragraphs: string[] = [];
  let current = "";
  let sentenceCount = 0;

  sentences.forEach((sentence) => {
    const shouldBreakBefore =
      current.length > 0 &&
      ((sentenceCount >= MAX_SENTENCES_PER_PARAGRAPH && current.length >= 100) ||
        current.length >= TARGET_PARAGRAPH_LENGTH ||
        (PARAGRAPH_CUE_PATTERN.test(sentence) && current.length >= 80));

    if (shouldBreakBefore) {
      paragraphs.push(current.trim());
      current = sentence;
      sentenceCount = 1;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
      sentenceCount += 1;
    }

    if (current.endsWith(":") && current.length <= 120) {
      paragraphs.push(current.trim());
      current = "";
      sentenceCount = 0;
      return;
    }

    if (current.length >= MAX_PARAGRAPH_LENGTH) {
      paragraphs.push(current.trim());
      current = "";
      sentenceCount = 0;
    }
  });

  if (current) {
    paragraphs.push(current.trim());
  }

  return paragraphs.length > 0 ? paragraphs : [normalized];
}

function reflowAssistantNarrativeParagraphs(content: string): string {
  const blocks = content.split(/\n{2,}/);

  const reformattedBlocks = blocks.map((block) => {
    const trimmed = block.trim();
    if (!trimmed) {
      return "";
    }

    if (STRUCTURED_MARKDOWN_LINE_PATTERN.test(trimmed)) {
      return trimmed;
    }

    return splitNarrativeBlockIntoParagraphs(trimmed).join("\n\n");
  });

  return reformattedBlocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function formatPlainAssistantBody(content: string): string {
  return reflowAssistantNarrativeParagraphs(applyGenericAssistantSpacing(content));
}

function parseLegacyVideoSearchSections(content: string): LegacyVideoSearchSection[] {
  const sections: LegacyVideoSearchSection[] = [];
  let match: RegExpExecArray | null;

  LEGACY_VIDEO_SEARCH_SECTION_PATTERN.lastIndex = 0;
  while ((match = LEGACY_VIDEO_SEARCH_SECTION_PATTERN.exec(content)) !== null) {
    const cameraLabel = (match[1] || "").trim();
    const timeRange = (match[2] || "").trim();
    const body = formatPlainAssistantBody((match[3] || "").trim());

    if (!cameraLabel || !timeRange || !body) {
      continue;
    }

    sections.push({
      cameraLabel,
      timeRange,
      body,
    });
  }

  return sections;
}

export function shouldSuppressAssistantCameraFooter(content: string): boolean {
  if (!content) return false;
  const normalized = normalizeAssistantRawContent(content);
  return parseLegacyVideoSearchSections(normalized).length > 0;
}

export function formatAssistantMessageContent(content: string): string {
  if (!content) return content;

  const normalized = normalizeAssistantRawContent(content);
  const legacySections = parseLegacyVideoSearchSections(normalized);

  if (legacySections.length > 0) {
    return legacySections
      .map((section) => {
        const heading = `### ${section.cameraLabel}`;
        const timeRange = `> ${section.timeRange}`;
        return `${heading}\n${timeRange}\n\n${section.body}`;
      })
      .join("\n\n---\n\n")
      .trim();
  }

  return formatPlainAssistantBody(normalized);
}

/**
 * Extracts hit media (images and videos) from a chat message's camera_selection_json.
 * Returns both images and videos with proper media_type.
 * Supports multiple formats with fallbacks for backward compatibility:
 * 1. Top-level hit_images array (preferred)
 * 2. hit_images and hit_videos nested in vision_hits
 * 3. frames_image_urls in vision_hits
 * 4. Legacy base64 formats (frames_jpeg_base64, frame_jpeg_base64)
 */
export function extractHitMediaFromMessage(message: ChatMessage): HitMediaItem[] {
  const selectionData = parseMessageCameraSelectionJson(message);
  if (!selectionData) {
    return [];
  }

  let hitMedia: HitMediaItem[] = [];
  
  // Priority 1: top-level hit_images (preferred single album)
  if (Array.isArray(selectionData.hit_images) && selectionData.hit_images.length > 0) {
    hitMedia = selectionData.hit_images
      .filter((img: any) => typeof img.url === "string")
      .map((img: any) => ({
        media_type: "image" as const,
        url: img.url,
        key: img.key ?? undefined,
        time_in_video: img.time_in_video ?? undefined,
      }));
    return hitMedia;
  }

  // Priority 2: flatten hit_images and hit_videos from vision_hits if top-level not present
  const visionHits = selectionData.vision_hits || [];
  if (!Array.isArray(visionHits) || visionHits.length === 0) {
    return [];
  }

  const allFrames: HitMediaItem[] = [];
  
  visionHits.forEach((hit: any) => {
    // 1a) New structured format: hit_images with URL
    if (Array.isArray(hit.hit_images) && hit.hit_images.length > 0) {
      hit.hit_images
        .filter((img: any) => typeof img.url === "string")
        .forEach((img: any) => {
          allFrames.push({
            media_type: "image" as const,
            url: img.url,
            key: img.key ?? undefined,
            time_in_video: img.time_in_video ?? undefined,
          });
        });
    }
    // 1b) New structured format: hit_videos with URL
    if (Array.isArray(hit.hit_videos) && hit.hit_videos.length > 0) {
      hit.hit_videos
        .filter((vid: any) => typeof vid.url === "string")
        .forEach((vid: any) => {
          allFrames.push({
            media_type: "video" as const,
            url: vid.url,
            key: vid.key ?? undefined,
            time_in_video: vid.time_in_video ?? undefined,
          });
        });
    }
    // 2) Fallback: simple URL array (legacy images only)
    else if (Array.isArray(hit.frames_image_urls) && hit.frames_image_urls.length > 0) {
      hit.frames_image_urls.forEach((url: string) => {
        allFrames.push({
          media_type: "image" as const,
          url,
          time_in_video: undefined,
        });
      });
    }
    // 3) Fallback: simple video URL array (legacy videos)
    else if (Array.isArray(hit.frames_video_urls) && hit.frames_video_urls.length > 0) {
      hit.frames_video_urls.forEach((url: string) => {
        allFrames.push({
          media_type: "video" as const,
          url,
          time_in_video: undefined,
        });
      });
    }
    // 4) Ultra-fallback: base64 strings (backward compatibility)
    else if (Array.isArray(hit.frames_jpeg_base64) && hit.frames_jpeg_base64.length > 0) {
      hit.frames_jpeg_base64.forEach((b64: string) => {
        allFrames.push({
          media_type: "image" as const,
          url: b64, // "data:image/jpeg;base64,..."
          time_in_video: undefined,
        });
      });
    }
    // 5) Single frame fallback (legacy)
    else if (hit.frame_jpeg_base64) {
      allFrames.push({
        media_type: "image" as const,
        url: hit.frame_jpeg_base64,
        time_in_video: undefined,
      });
    }
    // 6) Single video frame fallback (if exists)
    else if (hit.frame_video_url) {
      allFrames.push({
        media_type: "video" as const,
        url: hit.frame_video_url,
        time_in_video: undefined,
      });
    }
  });

  return allFrames;
}

export function extractIdentityCardsFromMessage(
  message: ChatMessage
): ChatIdentityCardMetadata[] {
  const selectionData = parseMessageCameraSelectionJson(message);
  if (!selectionData) {
    return [];
  }

  const cardsByKey = new Map<string, ChatIdentityCardMetadata>();
  const primaryCardOrder: string[] = [];
  let fallbackIndex = 0;

  const pushCard = (card: unknown) => {
    if (!card || typeof card !== "object" || Array.isArray(card)) {
      return;
    }

    const normalizedCard = card as Record<string, unknown>;
    const dedupeKey = identityCardDedupeKey(normalizedCard, fallbackIndex++);
    if (!cardsByKey.has(dedupeKey)) {
      cardsByKey.set(dedupeKey, normalizedCard as ChatIdentityCardMetadata);
    }
  };

  const topLevelIdentityCards = Array.isArray((selectionData as any).identity_cards)
    ? ((selectionData as any).identity_cards as unknown[])
    : [];
  topLevelIdentityCards.forEach(pushCard);

  const visionHits = Array.isArray((selectionData as any).vision_hits)
    ? ((selectionData as any).vision_hits as unknown[])
    : [];

  visionHits.forEach((hit) => {
    if (!hit || typeof hit !== "object" || Array.isArray(hit)) {
      return;
    }

    const hitRecord = hit as Record<string, unknown>;
    const primaryIdentityCardId =
      typeof hitRecord.primary_identity_card_id === "string"
        ? hitRecord.primary_identity_card_id.trim()
        : "";
    if (primaryIdentityCardId) {
      primaryCardOrder.push(primaryIdentityCardId);
    }

    const hitCards = Array.isArray(hitRecord.identity_cards)
      ? (hitRecord.identity_cards as unknown[])
      : [];
    hitCards.forEach(pushCard);
  });

  if (cardsByKey.size === 0) {
    return [];
  }

  const orderedCards = Array.from(cardsByKey.values());
  if (primaryCardOrder.length === 0) {
    return orderedCards;
  }

  const priority = new Map<string, number>();
  primaryCardOrder.forEach((cardId, index) => {
    if (!priority.has(cardId)) {
      priority.set(cardId, index);
    }
  });

  orderedCards.sort((lhs, rhs) => {
    const lhsCardId = typeof lhs.card_id === "string" ? lhs.card_id : "";
    const rhsCardId = typeof rhs.card_id === "string" ? rhs.card_id : "";
    const lhsPriority = priority.has(lhsCardId) ? priority.get(lhsCardId)! : Number.MAX_SAFE_INTEGER;
    const rhsPriority = priority.has(rhsCardId) ? priority.get(rhsCardId)! : Number.MAX_SAFE_INTEGER;
    if (lhsPriority !== rhsPriority) {
      return lhsPriority - rhsPriority;
    }
    return (lhsCardId || lhs.entity_id || "").localeCompare(rhsCardId || rhs.entity_id || "");
  });

  return orderedCards;
}

export function extractChatProgressFromMessage(message: ChatMessage): ChatProgressInfo | null {
  const raw = (message as any)?.progress_json;
  if (!raw) {
    return null;
  }

  let parsed: any = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const progress: ChatProgressInfo = {
    skill: typeof parsed.skill === "string" ? parsed.skill : undefined,
    phase: typeof parsed.phase === "string" ? parsed.phase : undefined,
    sequence:
      typeof parsed.sequence === "number"
        ? parsed.sequence
        : Number.isFinite(Number(parsed.sequence))
          ? Number(parsed.sequence)
          : undefined,
    headline: typeof parsed.headline === "string" ? parsed.headline : undefined,
    detail: typeof parsed.detail === "string" ? parsed.detail : undefined,
    step_index:
      typeof parsed.step_index === "number"
        ? parsed.step_index
        : Number.isFinite(Number(parsed.step_index))
          ? Number(parsed.step_index)
          : undefined,
    step_count:
      typeof parsed.step_count === "number"
        ? parsed.step_count
        : Number.isFinite(Number(parsed.step_count))
          ? Number(parsed.step_count)
          : undefined,
    updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : undefined,
  };

  if (!progress.headline && !progress.detail) {
    return null;
  }

  return progress;
}

export function extractCameraRegistrationDraftFromMessage(
  message: ChatMessage
): CameraRegistrationDraftMessageMetadata | null {
  const raw = (message as any)?.camera_selection_json;
  if (!raw) {
    return null;
  }

  let parsed: any = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  if (parsed.type !== "camera_registration_draft") {
    return null;
  }

  if (!parsed.draft || typeof parsed.draft !== "object" || Array.isArray(parsed.draft)) {
    return null;
  }

  const createdCameraId = Number(parsed.created_camera_id);

  return {
    type: "camera_registration_draft",
    status: parsed.status === "registered" ? "registered" : "awaiting_confirmation",
    language: typeof parsed.language === "string" ? parsed.language : undefined,
    draft: parsed.draft as Record<string, unknown>,
    target_client_id:
      typeof parsed.target_client_id === "string" ? parsed.target_client_id : undefined,
    created_camera_id:
      Number.isInteger(createdCameraId) && createdCameraId > 0 ? createdCameraId : undefined,
    created_camera_name:
      typeof parsed.created_camera_name === "string" ? parsed.created_camera_name : undefined,
  };
}

export function extractCameraNetworkScanFromMessage(
  message: ChatMessage
): CameraNetworkScanMessageMetadata | null {
  const raw = (message as any)?.camera_selection_json;
  if (!raw) {
    return null;
  }

  let parsed: any = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  if (parsed.type !== "camera_network_scan") {
    return null;
  }

  if (!parsed.summary || typeof parsed.summary !== "object" || Array.isArray(parsed.summary)) {
    return null;
  }

  const elapsedMs = Number(parsed.elapsed_ms);
  const timeoutMs = Number(parsed.timeout_ms);

  return {
    type: "camera_network_scan",
    status: "completed",
    language: typeof parsed.language === "string" ? parsed.language : undefined,
    elapsed_ms: Number.isFinite(elapsedMs) ? elapsedMs : undefined,
    timeout_ms: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
    summary: parsed.summary as CameraDiscoverySummary,
  };
}

export function extractCameraBatchRegistrationDraftFromMessage(
  message: ChatMessage
): CameraBatchRegistrationDraftMessageMetadata | null {
  const raw = (message as any)?.camera_selection_json;
  if (!raw) {
    return null;
  }

  let parsed: any = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  if (parsed.type !== "camera_batch_registration_draft") {
    return null;
  }

  if (!parsed.preview || typeof parsed.preview !== "object" || Array.isArray(parsed.preview)) {
    return null;
  }

  const expectedCount = Number(parsed.expected_count);

  return {
    type: "camera_batch_registration_draft",
    status: parsed.status === "registered" ? "registered" : "awaiting_confirmation",
    language: typeof parsed.language === "string" ? parsed.language : undefined,
    expected_count:
      Number.isInteger(expectedCount) && expectedCount > 0 ? expectedCount : undefined,
    preview: parsed.preview as CameraImportPreview,
    target_client_id:
      typeof parsed.target_client_id === "string" ? parsed.target_client_id : undefined,
    apply_result:
      parsed.apply_result && typeof parsed.apply_result === "object" && !Array.isArray(parsed.apply_result)
        ? (parsed.apply_result as CameraImportApplyResult)
        : undefined,
  };
}

export function extractCameraBatchEditDraftFromMessage(
  message: ChatMessage
): CameraBatchEditDraftMessageMetadata | null {
  const raw = (message as any)?.camera_selection_json;
  if (!raw) {
    return null;
  }

  let parsed: any = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  if (parsed.type !== "camera_batch_edit_draft") {
    return null;
  }

  if (!parsed.preview || typeof parsed.preview !== "object" || Array.isArray(parsed.preview)) {
    return null;
  }

  return {
    type: "camera_batch_edit_draft",
    status: parsed.status === "updated" ? "updated" : "awaiting_confirmation",
    language: typeof parsed.language === "string" ? parsed.language : undefined,
    preview: parsed.preview as CameraBatchEditPreview,
    patch_body:
      parsed.patch_body &&
      typeof parsed.patch_body === "object" &&
      !Array.isArray(parsed.patch_body)
        ? (parsed.patch_body as Record<string, unknown>)
        : undefined,
    target_client_id:
      typeof parsed.target_client_id === "string" ? parsed.target_client_id : undefined,
    apply_result:
      parsed.apply_result &&
      typeof parsed.apply_result === "object" &&
      !Array.isArray(parsed.apply_result)
        ? (parsed.apply_result as CameraBatchEditApplyResult)
        : undefined,
  };
}

export function extractCameraEditFormRequestFromMessage(
  message: ChatMessage
): CameraEditFormRequestMessageMetadata | null {
  const raw = (message as any)?.camera_selection_json;
  if (!raw) {
    return null;
  }

  let parsed: any = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  if (parsed.type !== "camera_edit_form_request" || parsed.status !== "awaiting_form_open") {
    return null;
  }

  const cameraId = Number(parsed.camera_id);
  if (!Number.isInteger(cameraId) || cameraId <= 0) {
    return null;
  }

  return {
    type: "camera_edit_form_request",
    status: "awaiting_form_open",
    language: typeof parsed.language === "string" ? parsed.language : undefined,
    camera_id: cameraId,
    camera_name:
      typeof parsed.camera_name === "string" ? parsed.camera_name : undefined,
    draft_patch:
      parsed.draft_patch &&
      typeof parsed.draft_patch === "object" &&
      !Array.isArray(parsed.draft_patch)
        ? (parsed.draft_patch as Record<string, unknown>)
        : {},
    clear_fields: Array.isArray(parsed.clear_fields)
      ? parsed.clear_fields.filter((entry: unknown): entry is string => typeof entry === "string")
      : [],
  };
}

export function extractCameraAgentFormRequestFromMessage(
  message: ChatMessage
): CameraAgentFormRequestMessageMetadata | null {
  const raw = (message as any)?.camera_selection_json;
  if (!raw) {
    return null;
  }

  let parsed: any = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  if (parsed.type !== "camera_agent_form_request" || parsed.status !== "awaiting_form_open") {
    return null;
  }

  const editorTarget = parseCameraAgentEditorTarget(parsed as Record<string, unknown>);
  if (!editorTarget) {
    return null;
  }

  const agentId = Number(parsed.agent_id);

  return {
    type: "camera_agent_form_request",
    status: "awaiting_form_open",
    language: typeof parsed.language === "string" ? parsed.language : undefined,
    camera_id: editorTarget.camera_id,
    camera_name:
      typeof parsed.camera_name === "string"
        ? parsed.camera_name
        : editorTarget.camera_name,
    agent_id: Number.isInteger(agentId) && agentId > 0 ? agentId : undefined,
    editor_target: editorTarget,
    draft_agent:
      parsed.draft_agent &&
      typeof parsed.draft_agent === "object" &&
      !Array.isArray(parsed.draft_agent)
        ? (parsed.draft_agent as Record<string, unknown>)
        : {},
  };
}

export function extractCameraAgentEditContextFromMessage(
  message: ChatMessage
): CameraAgentEditContextMessageMetadata | null {
  const raw = (message as any)?.camera_selection_json;
  if (!raw) {
    return null;
  }

  let parsed: any = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  if (parsed.type !== "camera_agent_edit_context" || parsed.status !== "awaiting_changes") {
    return null;
  }

  const editorTarget = parseCameraAgentEditorTarget(parsed as Record<string, unknown>);
  if (!editorTarget) {
    return null;
  }

  const agentId = Number(parsed.agent_id);

  return {
    type: "camera_agent_edit_context",
    status: "awaiting_changes",
    language: typeof parsed.language === "string" ? parsed.language : undefined,
    agent_id: Number.isInteger(agentId) && agentId > 0 ? agentId : undefined,
    agent_name: typeof parsed.agent_name === "string" ? parsed.agent_name : undefined,
    agent_summary: typeof parsed.agent_summary === "string" ? parsed.agent_summary : undefined,
    editor_target: editorTarget,
  };
}

export function extractCameraAgentUpdateResultFromMessage(
  message: ChatMessage
): CameraAgentUpdateResultMessageMetadata | null {
  const raw = (message as any)?.camera_selection_json;
  if (!raw) {
    return null;
  }

  let parsed: any = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  if (parsed.type !== "camera_agent_update_result" || parsed.status !== "updated") {
    return null;
  }

  const editorTarget = parseCameraAgentEditorTarget(parsed as Record<string, unknown>);
  if (!editorTarget) {
    return null;
  }

  const updatedFields = Array.isArray(parsed.updated_fields)
    ? parsed.updated_fields
        .map((entry: unknown): CameraAgentUpdatedFieldMetadata | null => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return null;
          }
          const row = entry as Record<string, unknown>;
          const field =
            typeof row.field === "string" && row.field.trim() ? row.field.trim() : "";
          if (!field) {
            return null;
          }
          return {
            field,
            label: typeof row.label === "string" ? row.label : undefined,
            before: typeof row.before === "string" ? row.before : undefined,
            after: typeof row.after === "string" ? row.after : undefined,
          };
        })
        .filter(
          (
            entry: CameraAgentUpdatedFieldMetadata | null
          ): entry is CameraAgentUpdatedFieldMetadata => entry !== null
        )
    : [];

  const agentId = Number(parsed.agent_id);

  return {
    type: "camera_agent_update_result",
    status: "updated",
    language: typeof parsed.language === "string" ? parsed.language : undefined,
    agent_id: Number.isInteger(agentId) && agentId > 0 ? agentId : undefined,
    agent_name: typeof parsed.agent_name === "string" ? parsed.agent_name : undefined,
    agent_summary: typeof parsed.agent_summary === "string" ? parsed.agent_summary : undefined,
    editor_target: editorTarget,
    updated_fields: updatedFields,
  };
}

export function extractCameraAgentCreationResultFromMessage(
  message: ChatMessage
): CameraAgentCreationResultMessageMetadata | null {
  const raw = (message as any)?.camera_selection_json;
  if (!raw) {
    return null;
  }

  let parsed: any = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  if (parsed.type !== "camera_agent_creation_result") {
    return null;
  }

  const createdDestinationsRaw = Array.isArray(parsed.created_destinations)
    ? parsed.created_destinations
    : [];

  const createdDestinations = createdDestinationsRaw
    .map((entry: any): CameraAgentCreationDestinationMetadata | null => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const destinationType =
        entry.destination_type === "camera" ||
        entry.destination_type === "step_default" ||
        entry.destination_type === "step_camera"
          ? entry.destination_type
          : null;
      const label =
        typeof entry.label === "string" && entry.label.trim()
          ? entry.label.trim()
          : "";

      if (!destinationType || !label) {
        return null;
      }

      const agentId = Number(entry.agent_id);
      const cameraId = Number(entry.camera_id);
      const stepId = Number(entry.step_id);
      const jobId = Number(entry.job_id);

      return {
        destination_type: destinationType,
        label,
        agent_id: Number.isInteger(agentId) && agentId > 0 ? agentId : undefined,
        camera_id: Number.isInteger(cameraId) && cameraId > 0 ? cameraId : undefined,
        camera_name:
          typeof entry.camera_name === "string" ? entry.camera_name : undefined,
        step_id: Number.isInteger(stepId) && stepId > 0 ? stepId : undefined,
        step_title:
          typeof entry.step_title === "string" ? entry.step_title : undefined,
        job_id: Number.isInteger(jobId) && jobId > 0 ? jobId : undefined,
        job_name:
          typeof entry.job_name === "string" ? entry.job_name : undefined,
      };
    })
    .filter(
      (
        entry: CameraAgentCreationDestinationMetadata | null
      ): entry is CameraAgentCreationDestinationMetadata => entry !== null
    );

  if (createdDestinations.length === 0) {
    return null;
  }

  return {
    type: "camera_agent_creation_result",
    status:
      parsed.status === "partially_created" ? "partially_created" : "created",
    language: typeof parsed.language === "string" ? parsed.language : undefined,
    agent_name:
      typeof parsed.agent_name === "string" ? parsed.agent_name : undefined,
    created_destinations: createdDestinations,
  };
}

export function extractJobCreationResultFromMessage(
  message: ChatMessage
): JobCreationResultMessageMetadata | null {
  const parsed = parseMessageCameraSelectionJson(message);
  if (!parsed) {
    return null;
  }

  if (parsed.type !== "job_creation_result" || parsed.status !== "created") {
    return null;
  }

  const jobId = Number(parsed.job_id);
  const stepCount = Number(parsed.step_count);
  const targetCount = Number(parsed.target_count);

  const steps = Array.isArray(parsed.steps)
    ? parsed.steps
        .map((entry: unknown): JobCreationStepMessageMetadata | null => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return null;
          }

          const row = entry as Record<string, unknown>;
          const stepIndex = Number(row.step_index);
          const targetStepCount = Number(row.target_count);
          const runEverySeconds = Number(row.run_every_seconds);
          const remainingTargetCount = Number(row.remaining_target_count);
          const previewLabels = Array.isArray(row.target_preview_labels)
            ? row.target_preview_labels
                .map((item: unknown) => (typeof item === "string" ? item.trim() : ""))
                .filter((item: string) => item.length > 0)
            : [];

          if (!Number.isInteger(stepIndex) || stepIndex <= 0) {
            return null;
          }

          return {
            step_index: stepIndex,
            step_name:
              typeof row.step_name === "string" ? row.step_name : undefined,
            step_key:
              typeof row.step_key === "string" ? row.step_key : undefined,
            role: typeof row.role === "string" ? row.role : undefined,
            execution_mode:
              typeof row.execution_mode === "string"
                ? row.execution_mode
                : undefined,
            input_type:
              typeof row.input_type === "string" ? row.input_type : undefined,
            run_every_seconds:
              Number.isInteger(runEverySeconds) && runEverySeconds > 0
                ? runEverySeconds
                : undefined,
            target_count:
              Number.isInteger(targetStepCount) && targetStepCount >= 0
                ? targetStepCount
                : previewLabels.length,
            target_preview_labels: previewLabels,
            remaining_target_count:
              Number.isInteger(remainingTargetCount) && remainingTargetCount > 0
                ? remainingTargetCount
                : undefined,
          };
        })
        .filter(
          (
            entry: JobCreationStepMessageMetadata | null
          ): entry is JobCreationStepMessageMetadata => entry !== null
        )
    : [];

  if (steps.length === 0 && (!Number.isInteger(jobId) || jobId <= 0)) {
    return null;
  }

  return {
    type: "job_creation_result",
    status: "created",
    language: typeof parsed.language === "string" ? parsed.language : undefined,
    job_id: Number.isInteger(jobId) && jobId > 0 ? jobId : undefined,
    job_name:
      typeof parsed.job_name === "string" ? parsed.job_name : undefined,
    step_count:
      Number.isInteger(stepCount) && stepCount > 0 ? stepCount : steps.length,
    target_count:
      Number.isInteger(targetCount) && targetCount >= 0
        ? targetCount
        : steps.reduce((sum, step) => sum + step.target_count, 0),
    steps,
  };
}

export function extractReportDocumentFromMessage(
  message: ChatMessage
): ReportDocumentMessageMetadata | null {
  const parsed = parseMessageCameraSelectionJson(message);
  if (!parsed) {
    return null;
  }

  if (parsed.type !== "report_document" || parsed.status !== "generated") {
    return null;
  }

  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const downloadPath =
    typeof parsed.download_path === "string" ? parsed.download_path.trim() : "";
  if (!title || !downloadPath) {
    return null;
  }

  const stats = Array.isArray(parsed.stats)
    ? parsed.stats
        .map((entry: unknown): ReportDocumentStatMetadata | null => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return null;
          }
          const row = entry as Record<string, unknown>;
          const label = typeof row.label === "string" ? row.label.trim() : "";
          const value = typeof row.value === "string" ? row.value.trim() : "";
          if (!label || !value) {
            return null;
          }
          return { label, value };
        })
        .filter(
          (entry: ReportDocumentStatMetadata | null): entry is ReportDocumentStatMetadata =>
            entry !== null
        )
    : [];

  const rawRollupStatus =
    parsed.rollup_status && typeof parsed.rollup_status === "object" && !Array.isArray(parsed.rollup_status)
      ? (parsed.rollup_status as Record<string, unknown>)
      : null;
  const rollupStatus: ReportDocumentRollupStatusMetadata | undefined = rawRollupStatus
    ? {
        camera_daily_rollups:
          rawRollupStatus.camera_daily_rollups === "ready" ? "ready" : "empty",
        job_daily_rollups:
          rawRollupStatus.job_daily_rollups === "ready" ? "ready" : "empty",
        agent_daily_rollups:
          rawRollupStatus.agent_daily_rollups === "ready" ? "ready" : "empty",
      }
    : undefined;

  const imageCount = Number(parsed.image_count);
  const videoCount = Number(parsed.video_count);
  const evidenceFileCount = Number(parsed.evidence_file_count);

  return {
    type: "report_document",
    status: "generated",
    language: typeof parsed.language === "string" ? parsed.language : undefined,
    report_id: typeof parsed.report_id === "string" ? parsed.report_id : undefined,
    report_kind: typeof parsed.report_kind === "string" ? parsed.report_kind : undefined,
    title,
    summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    generated_at:
      typeof parsed.generated_at === "string" ? parsed.generated_at : undefined,
    download_path: downloadPath,
    download_filename:
      typeof parsed.download_filename === "string" ? parsed.download_filename : undefined,
    evidence_download_path:
      typeof parsed.evidence_download_path === "string"
        ? parsed.evidence_download_path
        : null,
    evidence_filename:
      typeof parsed.evidence_filename === "string" ? parsed.evidence_filename : undefined,
    stats,
    rollup_status: rollupStatus,
    image_count: Number.isInteger(imageCount) && imageCount >= 0 ? imageCount : undefined,
    video_count: Number.isInteger(videoCount) && videoCount >= 0 ? videoCount : undefined,
    evidence_file_count:
      Number.isInteger(evidenceFileCount) && evidenceFileCount >= 0
        ? evidenceFileCount
        : undefined,
    phase2_ready: parsed.phase2_ready === true,
  };
}

export function buildCameraAgentDraftForEditor(
  metadata: CameraAgentFormRequestMessageMetadata
): Record<string, unknown> {
  const draft = metadata.draft_agent && typeof metadata.draft_agent === "object"
    ? metadata.draft_agent
    : {};
  const faceTargetIds = Array.isArray(draft.face_target_ids)
    ? draft.face_target_ids
        .map((entry) => Number(entry))
        .filter((entry) => Number.isInteger(entry) && entry > 0)
    : [];
  const analysisRegions = Array.isArray(draft.analysis_regions) ? draft.analysis_regions : [];
  const directDisplayName = readAgentDraftString(draft, "display_name");
  const configDisplayName = readAgentDraftConfigString(draft, "display_name");
  const summary = readAgentDraftString(draft, "summary") || readAgentDraftConfigString(draft, "summary");
  const alertCondition = readAgentDraftString(draft, "alert_condition");
  const preferredDisplayName =
    (directDisplayName && !isGeneratedCustomAgentName(directDisplayName) ? directDisplayName : "") ||
    (configDisplayName && !isGeneratedCustomAgentName(configDisplayName) ? configDisplayName : "") ||
    summary ||
    alertCondition ||
    directDisplayName ||
    configDisplayName ||
    "agent";
  const displayName =
    preferredDisplayName;
  const existingId =
    typeof draft.id === "number" && Number.isInteger(draft.id) && draft.id > 0
      ? draft.id
      : typeof metadata.agent_id === "number" &&
          Number.isInteger(metadata.agent_id) &&
          metadata.agent_id > 0
        ? metadata.agent_id
      : typeof draft.id === "string"
        ? Number.parseInt(draft.id, 10)
        : typeof (draft as { algorithm_id?: unknown }).algorithm_id === "number" &&
            Number.isInteger((draft as { algorithm_id?: number }).algorithm_id) &&
            Number((draft as { algorithm_id?: number }).algorithm_id) > 0
          ? Number((draft as { algorithm_id?: number }).algorithm_id)
          : typeof (draft as { algorithm_id?: unknown }).algorithm_id === "string"
            ? Number.parseInt(
                String((draft as { algorithm_id?: unknown }).algorithm_id),
                10
              )
            : 0;

  return {
    id: Number.isInteger(existingId) && existingId > 0 ? existingId : 0,
    algorithm_type:
      typeof draft.agent_key === "string" && draft.agent_key.trim()
        ? draft.agent_key.trim()
        : "custom_template",
    is_enabled:
      typeof draft.is_enabled === "boolean"
        ? draft.is_enabled
        : typeof draft.is_enabled === "number"
          ? draft.is_enabled !== 0
          : true,
    input_type:
      typeof draft.input_type === "string" ? draft.input_type : undefined,
    video_packaging_mode:
      typeof draft.video_packaging_mode === "string" ? draft.video_packaging_mode : undefined,
    inference_model:
      typeof draft.inference_model === "string" ? draft.inference_model : undefined,
    model_fps:
      typeof draft.model_fps === "number" ? draft.model_fps : undefined,
    run_every:
      typeof draft.run_every === "number" ? draft.run_every : undefined,
    running_resolution:
      typeof draft.running_resolution === "number" ? draft.running_resolution : undefined,
    only_capture_on_motion:
      typeof draft.only_capture_on_motion === "boolean"
        ? draft.only_capture_on_motion
        : typeof draft.only_capture_on_motion === "number"
          ? draft.only_capture_on_motion !== 0
          : undefined,
    prompt_template:
      typeof draft.prompt_template === "string" ? draft.prompt_template : "",
    alert_condition:
      typeof draft.alert_condition === "string" ? draft.alert_condition : "",
    negative_condition:
      typeof draft.negative_condition === "string" ? draft.negative_condition : "",
    face_target_ids: faceTargetIds,
    negative_reference_images: [],
    analysis_regions: analysisRegions,
    config_json: {
      display_name: displayName,
      summary,
    },
  };
}

export function applyCameraEditDraftToCamera<T extends Record<string, any>>(
  camera: T,
  metadata: CameraEditFormRequestMessageMetadata
): T {
  const next: Record<string, any> = {
    ...camera,
  };

  (metadata.clear_fields || []).forEach((field) => {
    if (!field) return;
    if (field === "webcam_index") {
      next[field] = null;
      return;
    }
    if (field === "country") {
      next.country = "";
      next.country_code = "";
      return;
    }
    next[field] = "";
  });

  Object.entries(metadata.draft_patch || {}).forEach(([key, value]) => {
    next[key] = value;
  });

  return next as T;
}

/**
 * Legacy function - extracts only images for backward compatibility.
 * New code should use extractHitMediaFromMessage() instead.
 */
export function extractHitImagesFromMessage(message: ChatMessage): HitImage[] {
  const allMedia = extractHitMediaFromMessage(message);
  return allMedia
    .filter(item => item.media_type === "image")
    .map(item => ({
      url: item.url,
      time_in_video: item.time_in_video,
      key: item.key,
    }));
}
