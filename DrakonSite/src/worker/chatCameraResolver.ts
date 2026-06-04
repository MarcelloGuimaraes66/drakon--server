export type ChatCameraResolutionRow = {
  id?: unknown;
  name?: unknown;
  camera_name?: unknown;
  description?: unknown;
  connection_method?: unknown;
  webcam_index?: unknown;
};

export type ChatCameraResolution = {
  cameraId: number | null;
  cameraIds: number[];
  cameraName: string | null;
  cameraSelection: {
    source: "explicit" | "name_mention" | "none";
    matched_text: string | null;
    confidence: number;
  };
};

function normalizeCameraText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function compactCameraText(value: unknown): string {
  return normalizeCameraText(value).replace(/[^a-z0-9]+/g, "");
}

function positiveInt(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function rowCameraName(row: ChatCameraResolutionRow): string {
  const name = String(row.name ?? row.camera_name ?? "").trim();
  return name || `Camera ${positiveInt(row.id) ?? ""}`.trim();
}

function scoreMention(query: string, row: ChatCameraResolutionRow): number {
  const queryText = normalizeCameraText(query);
  const queryCompact = compactCameraText(query);
  const name = rowCameraName(row);
  const nameText = normalizeCameraText(name);
  const nameCompact = compactCameraText(name);
  const descriptionText = normalizeCameraText(row.description);
  const webcamIndex = positiveInt(row.webcam_index);

  if (!queryText || !queryCompact || !nameCompact) return 0;
  if (queryText === nameText) return 1;
  if (queryText.includes(nameText)) return 0.98;
  if (queryCompact.includes(nameCompact)) return 0.95;

  const nameTokens = nameText.split(/[^a-z0-9]+/).filter((token) => token.length >= 2);
  if (nameTokens.length > 0 && nameTokens.every((token) => queryText.includes(token))) {
    return 0.86;
  }

  if (descriptionText && queryText.includes(descriptionText)) return 0.72;
  if (webcamIndex !== null) {
    const webcamPatterns = [
      `webcam ${webcamIndex}`,
      `webcam-${webcamIndex}`,
      `webcam_${webcamIndex}`,
      `/dev/video${webcamIndex}`,
      `video${webcamIndex}`,
    ];
    if (webcamPatterns.some((pattern) => queryText.includes(pattern))) return 0.8;
  }

  return 0;
}

export function resolveChatCameraReferenceFromRows(
  rows: ChatCameraResolutionRow[],
  query: unknown,
  explicitCameraId?: unknown
): ChatCameraResolution {
  const explicit = positiveInt(explicitCameraId);
  if (explicit !== null) {
    const explicitRow = rows.find((row) => positiveInt(row.id) === explicit);
    return {
      cameraId: explicit,
      cameraIds: [explicit],
      cameraName: explicitRow ? rowCameraName(explicitRow) : null,
      cameraSelection: {
        source: "explicit",
        matched_text: explicitRow ? rowCameraName(explicitRow) : String(explicit),
        confidence: 1,
      },
    };
  }

  let bestRow: ChatCameraResolutionRow | null = null;
  let bestScore = 0;
  for (const row of rows) {
    const rowId = positiveInt(row.id);
    if (rowId === null) continue;
    const score = scoreMention(String(query ?? ""), row);
    if (score > bestScore) {
      bestRow = row;
      bestScore = score;
    }
  }

  if (!bestRow || bestScore < 0.72) {
    return {
      cameraId: null,
      cameraIds: [],
      cameraName: null,
      cameraSelection: {
        source: "none",
        matched_text: null,
        confidence: 0,
      },
    };
  }

  const cameraId = positiveInt(bestRow.id)!;
  const cameraName = rowCameraName(bestRow);
  return {
    cameraId,
    cameraIds: [cameraId],
    cameraName,
    cameraSelection: {
      source: "name_mention",
      matched_text: cameraName,
      confidence: bestScore,
    },
  };
}
