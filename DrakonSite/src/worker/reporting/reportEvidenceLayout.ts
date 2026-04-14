import type {
  ReportDocxImageEvidence,
  ReportDocxVideoEvidence,
  ReportEvidenceLayout,
  ReportMediaLocation,
  ReportVideoCard,
} from "./reportBlocks";

function isPtLanguage(language: string | undefined): boolean {
  return typeof language === "string" && language.trim().toLowerCase().startsWith("pt");
}

function normalizeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
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
  const imageGallery = params.images.map((image) => ({
    ...image,
    title: normalizeText(image.title, isPt ? "Imagem de evidencia" : "Evidence image"),
    caption: normalizeText(image.caption) || undefined,
  }));

  const videoCards: ReportVideoCard[] = params.videos.map((video, index) => ({
    ...video,
    title: normalizeText(video.title, isPt ? `Video ${index + 1}` : `Video ${index + 1}`),
    caption: normalizeText(video.caption) || undefined,
  }));

  return {
    imageGallery,
    videoCards,
    mediaLocations: buildMediaLocations(params.images, params.videos),
  };
}
