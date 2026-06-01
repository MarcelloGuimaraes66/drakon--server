export type PublicAiModelTier = "core" | "light" | "ultra" | "ultra_plus";

type ModelTierPattern = {
  tier: PublicAiModelTier;
  label: string;
  pattern: RegExp;
};

const DEFAULT_AI_API_ERROR_MESSAGE = "AI API request failed during inference.";

const MODEL_TIER_PATTERNS: ModelTierPattern[] = [
  {
    tier: "ultra_plus",
    label: "Ultra+",
    pattern: /(?:\bultra\+|\bultra[_-]?plus\b|\bgpt-5\.4(?!-mini)\b)/gi,
  },
  {
    tier: "light",
    label: "Light",
    pattern: /\b(?:light|gpt-(?:4(?:\.\d+)?|5(?:\.\d+)?)-mini)\b/gi,
  },
  {
    tier: "core",
    label: "Core",
    pattern: /\b(?:core|glm(?:-[a-z0-9.+-]+)?)\b/gi,
  },
  {
    tier: "ultra",
    label: "Ultra",
    pattern: /\b(?:legacy|pro|ultra|gpt-5(?:\.\d+)?(?!-mini))\b/gi,
  },
];

const trimToString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const firstNonEmptyString = (...values: unknown[]): string => {
  for (const value of values) {
    const normalized = trimToString(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
};

export function getPublicAiModelTier(value: unknown): PublicAiModelTier | null {
  const normalizedValue = trimToString(value);
  if (!normalizedValue) {
    return null;
  }

  for (const entry of MODEL_TIER_PATTERNS) {
    entry.pattern.lastIndex = 0;
    if (entry.pattern.test(normalizedValue)) {
      return entry.tier;
    }
  }

  return null;
}

export function getPublicAiModelLabel(value: unknown): string | null {
  const normalizedValue = trimToString(value);
  if (!normalizedValue) {
    return null;
  }

  for (const entry of MODEL_TIER_PATTERNS) {
    entry.pattern.lastIndex = 0;
    if (entry.pattern.test(normalizedValue)) {
      return entry.label;
    }
  }

  return null;
}

export function sanitizeAiApiErrorText(value: unknown): string {
  const normalizedValue = trimToString(value);
  if (!normalizedValue) {
    return "";
  }

  let sanitized = normalizedValue;
  for (const entry of MODEL_TIER_PATTERNS) {
    entry.pattern.lastIndex = 0;
    sanitized = sanitized.replace(entry.pattern, entry.label);
  }

  return sanitized;
}

export function getAiApiErrorSourceLabel(source: unknown): string {
  const normalizedSource = trimToString(source).toLowerCase();
  if (normalizedSource.includes("chat")) return "Chat";
  if (normalizedSource.includes("job_or_camera")) return "Jobs / AI Agents";
  if (normalizedSource.includes("group") || normalizedSource.includes("job")) return "Jobs";
  if (normalizedSource.includes("camera")) return "AI Agents";
  return "Inference";
}

export function formatAiApiErrorDisplay(input: {
  source?: unknown;
  model?: unknown;
  message?: unknown;
  apiErrorMessage?: unknown;
  rawError?: unknown;
}): {
  title: string;
  message: string;
  modelLabel: string | null;
  sourceLabel: string;
} {
  const sourceLabel = getAiApiErrorSourceLabel(input.source);
  const modelLabel = getPublicAiModelLabel(input.model);
  const title = modelLabel
    ? `AI API Error (${sourceLabel} - ${modelLabel})`
    : `AI API Error (${sourceLabel})`;
  const message = sanitizeAiApiErrorText(
    firstNonEmptyString(
      input.message,
      input.apiErrorMessage,
      input.rawError,
      DEFAULT_AI_API_ERROR_MESSAGE
    )
  );

  return {
    title,
    message,
    modelLabel,
    sourceLabel,
  };
}

export function sanitizeAgentApiErrorDetails(
  details: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!details) {
    return {};
  }

  const nextDetails: Record<string, unknown> = { ...details };
  const modelLabel = getPublicAiModelLabel(details.model);

  if (modelLabel) {
    nextDetails.model = modelLabel;
  } else if (typeof details.model === "string") {
    nextDetails.model = sanitizeAiApiErrorText(details.model);
  }

  if (typeof details.api_error_message === "string") {
    nextDetails.api_error_message = sanitizeAiApiErrorText(details.api_error_message);
  }
  if (typeof details.raw_error === "string") {
    nextDetails.raw_error = sanitizeAiApiErrorText(details.raw_error);
  }

  return nextDetails;
}
