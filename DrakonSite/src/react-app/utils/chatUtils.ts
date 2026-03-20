import { ChatMessage } from "@/shared/types";

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

const TEMPORAL_ENGINE_SUFFIX_PATTERN =
  /(?:<br\s*\/?>|\r?\n|\s)*Temporal engine:\s*[\s\S]*$/i;

const LEGACY_VIDEO_SEARCH_SECTION_PATTERN =
  /(?:^|\n{2,})(?:Camera|Camara|C[âa]mera):\s*([^\n]+)\n([^\n|]+?\s-\s[^\n|]+?)\s*\|\s*([\s\S]*?)(?=(?:\n{2,}(?:Camera|Camara|C[âa]mera):\s)|$)/gi;

interface LegacyVideoSearchSection {
  cameraLabel: string;
  timeRange: string;
  body: string;
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

function parseLegacyVideoSearchSections(content: string): LegacyVideoSearchSection[] {
  const sections: LegacyVideoSearchSection[] = [];
  let match: RegExpExecArray | null;

  LEGACY_VIDEO_SEARCH_SECTION_PATTERN.lastIndex = 0;
  while ((match = LEGACY_VIDEO_SEARCH_SECTION_PATTERN.exec(content)) !== null) {
    const cameraLabel = (match[1] || "").trim();
    const timeRange = (match[2] || "").trim();
    const body = applyGenericAssistantSpacing((match[3] || "").trim());

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

  return applyGenericAssistantSpacing(normalized);
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
  const msg = message as any;
  
  if (!msg.camera_selection_json) {
    return [];
  }

  let selectionData: any;
  try {
    selectionData = JSON.parse(msg.camera_selection_json);
  } catch (e) {
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
