import type {
  ReportDocxImageEvidence,
  ReportDocxVideoEvidence,
  ReportEvidenceLayout,
  ReportMediaLocation,
  ReportVideoCard,
} from "./reportBlocks";
import { REPORT_THEME } from "./reportTheme";

function isPtLanguage(language: string | undefined): boolean {
  return typeof language === "string" && language.trim().toLowerCase().startsWith("pt");
}

function normalizeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function svgBytes(svg: string): Uint8Array {
  return new TextEncoder().encode(svg);
}

function trimLabel(label: string, maxLength = 42): string {
  const normalized = normalizeText(label);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildVideoPosterSvg(
  video: ReportDocxVideoEvidence,
  index: number,
  isPt: boolean
): string {
  const width = 1280;
  const height = 720;
  const title = trimLabel(
    normalizeText(video.title, isPt ? `Vídeo ${index + 1}` : `Video ${index + 1}`),
    42
  );
  const caption =
    trimLabel(
      normalizeText(video.caption || video.detectedAt, isPt ? "Evidência em vídeo" : "Video evidence"),
      64
    ) || (isPt ? "Evidência em vídeo" : "Video evidence");
  const source = trimLabel(
    normalizeText(video.sourceLabel || video.filename, isPt ? "Arquivo associado" : "Linked file"),
    48
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#${REPORT_THEME.colors.surfaceStrong}"/><stop offset="100%" stop-color="#${REPORT_THEME.colors.primary}"/></linearGradient></defs>`,
    `<rect x="0" y="0" width="${width}" height="${height}" rx="32" fill="url(#bg)"/>`,
    `<circle cx="640" cy="320" r="110" fill="rgba(255,255,255,0.12)"/>`,
    `<polygon points="610,252 610,388 724,320" fill="#${REPORT_THEME.colors.white}"/>`,
    `<text x="72" y="548" font-family="${REPORT_THEME.fonts.display}" font-size="42" font-weight="700" fill="#${REPORT_THEME.colors.white}">${escapeSvgText(title)}</text>`,
    `<text x="72" y="598" font-family="${REPORT_THEME.fonts.body}" font-size="28" fill="rgba(255,255,255,0.84)">${escapeSvgText(caption)}</text>`,
    `<text x="72" y="650" font-family="${REPORT_THEME.fonts.body}" font-size="24" fill="rgba(255,255,255,0.72)">${escapeSvgText(source)}</text>`,
    `<rect x="72" y="84" width="220" height="44" rx="22" fill="rgba(20,184,166,0.18)" stroke="rgba(255,255,255,0.22)"/>`,
    `<text x="182" y="113" text-anchor="middle" font-family="${REPORT_THEME.fonts.body}" font-size="22" font-weight="700" fill="#${REPORT_THEME.colors.white}">${escapeSvgText(isPt ? "Vídeo relacionado" : "Related video")}</text>`,
    "</svg>",
  ].join("");
}

function buildMediaLocations(
  images: readonly ReportDocxImageEvidence[],
  videos: readonly ReportDocxVideoEvidence[]
): ReportMediaLocation[] {
  const imageLocations = images.map((image) => ({
    kind: "image" as const,
    title: normalizeText(image.title, normalizeText(image.filename, "Image evidence")),
    filename: normalizeText(image.filename) || undefined,
    downloadUrl: normalizeText(image.downloadUrl) || undefined,
    localPath: normalizeText(image.localPath) || undefined,
    detectedAt: normalizeText(image.detectedAt) || null,
    caption: normalizeText(image.caption) || undefined,
  }));

  const videoLocations = videos.map((video) => ({
    kind: "video" as const,
    title: normalizeText(video.title, normalizeText(video.filename, "Video evidence")),
    filename: normalizeText(video.filename) || undefined,
    downloadUrl: normalizeText(video.downloadUrl) || undefined,
    localPath: normalizeText(video.localPath) || undefined,
    detectedAt: normalizeText(video.detectedAt) || null,
    caption: normalizeText(video.caption) || undefined,
  }));

  return [...imageLocations, ...videoLocations];
}

export function buildReportEvidenceLayout(params: {
  images: readonly ReportDocxImageEvidence[];
  videos: readonly ReportDocxVideoEvidence[];
  language?: string;
}): ReportEvidenceLayout {
  const isPt = isPtLanguage(params.language);
  const imageGallery = params.images.slice(0, 4).map((image) => ({
    ...image,
    title: normalizeText(image.title, isPt ? "Imagem de evidência" : "Evidence image"),
    caption: normalizeText(image.caption) || undefined,
  }));

  const videoCards: ReportVideoCard[] = params.videos.slice(0, 6).map((video, index) => ({
    ...video,
    title: normalizeText(video.title, isPt ? `Vídeo ${index + 1}` : `Video ${index + 1}`),
    caption: normalizeText(video.caption) || undefined,
    posterContentType: "image/svg+xml",
    posterFilename: `video-poster-${index + 1}.svg`,
    posterBytes: svgBytes(buildVideoPosterSvg(video, index, isPt)),
  }));

  return {
    imageGallery,
    videoCards,
    mediaLocations: buildMediaLocations(params.images, params.videos),
  };
}
