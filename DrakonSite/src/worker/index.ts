import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { getCookie, setCookie } from "hono/cookie";
import {
  CreateCameraSchema,
  UpdateCameraSchema,
  SendChatMessageSchema,
  CreateAlgorithmSchema,
  CreateReIDTargetSchema,
  CreateDrakonFindTargetSchema,
  CreateDrakonFindSearchSchema,
  ResolveDrakonFindScopeSchema,
  UpdateDrakonFindSearchStatusSchema,
  UpdatePreferencesSchema,
  CreateCheckoutSessionSchema,
  ClaimPairingSchema,
} from "@/shared/types";
import Stripe from "stripe";
import { upgradeWebSocket } from "hono/cloudflare-workers";
import { createWebSocketHandler } from "./websocket";
import bcrypt from "bcryptjs";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import {
  enqueueManualJobStart,
  loadJobInferenceProviderRequirements,
  runJobSchedulerTick,
} from "./jobScheduler";
import { buildEnabledAlgorithmsForCamera } from "./cameraAlgorithmsPayload";
import { brand } from "@/shared/brand";
import {
  BRAZIL_STATE_NAME_BY_CODE,
  normalizeBrazilStateCode,
  normalizeBrazilStateSelection,
  normalizeCountryCode,
} from "@/shared/brazilStates";

// AI agent descriptions mapping
const ALGORITHM_DESCRIPTIONS: Record<string, string> = {
  weapon: "Detect firearms, knives, and other weapons",
  intruder: "Detect unauthorized persons in restricted areas",
  masked: "Detect people wearing masks or face coverings",
  robbery: "Detect potential robbery situations with raised hands",
  fallen: "Detect people who have fallen or collapsed",
  crowd: "Detect unusual crowd formations or gatherings",
  abandoned: "Detect unattended bags or objects",
  reid: "Identify specific people across camera feeds",
};

// Algorithm display names mapping
const ALGORITHM_DISPLAY_NAMES: Record<string, string> = {
  faceid: "FaceID (Face Search)",
  weapon: "Weapon Detection",
  intruder: "Intruder Detection",
  masked: "Masked Person Detection",
  robbery: "Robbery Detection (Hands Raised)",
  fallen: "Person Fallen",
  crowd: "Crowd Detection",
  abandoned: "Abandoned Object/Bag",
  reid: "ReID (Person Identification)",
};

async function buildEnabledAlgorithmsPayloadForCamera(
  db: D1Database,
  userId: string,
  cameraId: number
): Promise<any[]> {
  const openAiApiKey = await getUserOpenAIApiKey(db, userId);
  const zAiApiKey = await getUserZAIApiKey(db, userId);
  return buildEnabledAlgorithmsForCamera({
    db,
    userId,
    cameraId,
    openAiApiKey,
    zAiApiKey,
    onlyEnabled: true,
    algorithmDescriptions: ALGORITHM_DESCRIPTIONS,
    algorithmDisplayNames: ALGORITHM_DISPLAY_NAMES,
  });
}

function normalizeOpenAIApiKeyInput(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeZAIApiKeyInput(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function maskOpenAIApiKeyPreview(apiKey: unknown): string {
  const raw = normalizeOpenAIApiKeyInput(apiKey);
  if (!raw) return "";
  const visiblePrefixLength = Math.min(12, raw.length);
  return `${raw.slice(0, visiblePrefixLength)}****`;
}

function maskZAIApiKeyPreview(apiKey: unknown): string {
  const raw = normalizeZAIApiKeyInput(apiKey);
  if (!raw) return "";
  const visiblePrefixLength = Math.min(12, raw.length);
  return `${raw.slice(0, visiblePrefixLength)}****`;
}

function redactSensitiveForLog(value: unknown): unknown {
  const sensitiveKeys = new Set([
    "api_key",
    "model_api_key",
    "router_api_key",
    "description_model_api_key",
    "openai_api_key",
    "zai_api_key",
    "z_ai_api_key",
    "zai_key",
    "z_api_key",
    "validator_model_api_key",
    "password",
    "bot_token",
    "telegram_bot_token",
  ]);

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map((item) => walk(item));
    }
    if (!node || typeof node !== "object") {
      return node;
    }
    const out: Record<string, unknown> = {};
    for (const [rawKey, rawValue] of Object.entries(node as Record<string, unknown>)) {
      const key = String(rawKey || "").trim().toLowerCase();
      if (sensitiveKeys.has(key) && typeof rawValue === "string" && rawValue.trim()) {
        out[rawKey] = "****";
      } else {
        out[rawKey] = walk(rawValue);
      }
    }
    return out;
  };

  return walk(value);
}

const OPENAI_KEY_REQUIRED_ERROR = "OPENAI_KEY_REQUIRED";
const OPENAI_KEY_REQUIRED_MESSAGE = "OpenAI API key is not configured in Settings.";
const ZAI_KEY_REQUIRED_ERROR = "ZAI_KEY_REQUIRED";
const ZAI_KEY_REQUIRED_MESSAGE = "Z.ai API key is not configured in Settings.";
const CORE_MODEL_JOB_LIMIT_ERROR = "CORE_MODEL_JOB_LIMIT";
const CORE_MODEL_JOB_LIMIT_MESSAGE = "Only one AI agent per job can use Core model.";
const CORE_MODEL_SCHEDULE_CONFLICT_ERROR = "CORE_MODEL_SCHEDULE_CONFLICT";
const CORE_MODEL_BUSY_ERROR = "CORE_MODEL_BUSY";
const CORE_MODEL_CHAT_CONTENTION_WARNING = "CORE_MODEL_CONTENTION_WARNING";

function buildOpenAiKeyRequiredErrorBody() {
  return {
    error: OPENAI_KEY_REQUIRED_ERROR,
    message: OPENAI_KEY_REQUIRED_MESSAGE,
  };
}

function buildZAiKeyRequiredErrorBody() {
  return {
    error: ZAI_KEY_REQUIRED_ERROR,
    message: ZAI_KEY_REQUIRED_MESSAGE,
  };
}

// Helper function to generate pair code
function generatePairCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getWebCrypto() {
  const cryptoApi = (globalThis as any).crypto;
  if (!cryptoApi) {
    throw new Error("Web Crypto API is not available in this runtime.");
  }
  return cryptoApi;
}

// Helper function to generate UUID
function generateUUID(): string {
  const cryptoApi = getWebCrypto();
  if (typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  // RFC 4122 v4 fallback when randomUUID is unavailable
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
}

// Helper function to hash token with SHA-256
async function hashToken(token: string): Promise<string> {
  const serverSalt = "mocha-exe-pairing-salt-v1"; // In production, store in env
  const data = new TextEncoder().encode(token + serverSalt);
  const hashBuffer = await getWebCrypto().subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The desktop EXE polls /api/agent/commands every 15 seconds.
// Production adds network + D1 visibility lag, so chat freshness needs a
// wider window than local dev to avoid false "stale" states.
const EXE_HEARTBEAT_STALE_AFTER_MS = 35_000;
const CHAT_DESKTOP_AGENT_REQUIRED_FRESH_AFTER_MS = 25_000;
const SUPPORTED_CHAT_LANGUAGE_CODES = ["en", "es", "pt", "fr", "zh", "ar"] as const;
const JOB_ALERT_MEDIA_MAX_VIDEO_BYTES = 25 * 1024 * 1024;

function normalizeSupportedChatLanguage(value: unknown, fallback: string = "en"): string {
  const fallbackLanguage = typeof fallback === "string" && fallback.trim() ? fallback.trim().toLowerCase() : "en";
  if (typeof value !== "string" || !value.trim()) {
    return SUPPORTED_CHAT_LANGUAGE_CODES.includes(fallbackLanguage as any) ? fallbackLanguage : "en";
  }

  const normalized = value.trim().toLowerCase();
  const baseLanguage = normalized.split(/[-_]/, 1)[0];
  if (SUPPORTED_CHAT_LANGUAGE_CODES.includes(baseLanguage as any)) {
    return baseLanguage;
  }

  return SUPPORTED_CHAT_LANGUAGE_CODES.includes(fallbackLanguage as any) ? fallbackLanguage : "en";
}

function scoreLanguageTokens(tokens: string[], candidates: readonly string[]): number {
  let score = 0;
  for (const token of tokens) {
    if (candidates.includes(token)) {
      score += 1;
    }
  }
  return score;
}

function detectChatMessageLanguage(
  messageInput: unknown,
  fallbackLanguage: string
): { language: string; source: "detected" | "fallback" } {
  const fallback = normalizeSupportedChatLanguage(fallbackLanguage, "en");
  if (typeof messageInput !== "string" || !messageInput.trim()) {
    return { language: fallback, source: "fallback" };
  }

  const raw = messageInput.trim();
  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u.test(raw)) {
    return { language: "ar", source: "detected" };
  }
  if (/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u.test(raw)) {
    return { language: "zh", source: "detected" };
  }

  const lower = raw.toLowerCase();
  const normalizedForTokens = lower
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const tokens = normalizedForTokens ? normalizedForTokens.split(/\s+/).filter(Boolean) : [];

  const scores: Record<"en" | "es" | "pt" | "fr", number> = {
    en: 0,
    es: 0,
    pt: 0,
    fr: 0,
  };

  if (/[ãõç]/u.test(lower)) scores.pt += 4;
  if (/[ñ¡¿]/u.test(lower)) scores.es += 4;
  if (/[àâæçéèêëîïôœùûüÿ]/u.test(lower)) scores.fr += 4;

  scores.en += scoreLanguageTokens(tokens, [
    "how", "what", "where", "when", "why", "billing", "payment", "subscription",
    "camera", "cameras", "explain", "help", "works", "settings", "pairing",
  ]);
  scores.es += scoreLanguageTokens(tokens, [
    "como", "que", "donde", "cuando", "por", "pago", "pagos", "suscripcion",
    "camara", "camaras", "explica", "ayuda", "configuracion", "clave", "emparejar",
  ]);
  scores.pt += scoreLanguageTokens(tokens, [
    "como", "que", "onde", "quando", "pagamento", "pagamentos", "assinatura",
    "camera", "cameras", "explica", "ajuda", "configuracao", "chave", "parear",
    "funciona",
  ]);
  scores.fr += scoreLanguageTokens(tokens, [
    "comment", "quoi", "ou", "quand", "paiement", "abonnement", "camera",
    "cameras", "explique", "aide", "parametres", "cle", "association",
    "fonctionne",
  ]);

  let bestLanguage: "en" | "es" | "pt" | "fr" | null = null;
  let bestScore = -1;
  let secondBestScore = -1;

  for (const language of ["en", "es", "pt", "fr"] as const) {
    const score = scores[language];
    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestLanguage = language;
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  if (!bestLanguage || bestScore <= 0) {
    return { language: fallback, source: "fallback" };
  }

  if (bestScore == secondBestScore) {
    return { language: fallback, source: "fallback" };
  }

  return { language: bestLanguage, source: "detected" };
}

function buildExeHeartbeatSummary(pairing: any | null) {
  const lastSeenAt =
    pairing && typeof pairing.last_seen_at === "string" && pairing.last_seen_at.trim()
      ? pairing.last_seen_at.trim()
      : null;
  const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
  const ageMs = Number.isFinite(lastSeenMs) ? Math.max(0, Date.now() - lastSeenMs) : Number.NaN;
  const lastSeenAgeSeconds = Number.isFinite(ageMs) ? Math.floor(ageMs / 1000) : null;
  const isHeartbeatFresh = Number.isFinite(ageMs) && ageMs <= EXE_HEARTBEAT_STALE_AFTER_MS;

  return {
    last_seen_at: lastSeenAt,
    last_seen_age_seconds: lastSeenAgeSeconds,
    is_heartbeat_fresh: isHeartbeatFresh,
    effective_status: !pairing
      ? "not_connected"
      : isHeartbeatFresh
        ? "connected"
        : "stale",
  };
}

function buildChatDesktopAgentAvailability(pairing: any | null) {
  const heartbeat = buildExeHeartbeatSummary(pairing);
  const ageSeconds =
    typeof heartbeat.last_seen_age_seconds === "number" ? heartbeat.last_seen_age_seconds : null;
  const isAvailableForChat =
    !!pairing &&
    typeof ageSeconds === "number" &&
    ageSeconds <= Math.floor(CHAT_DESKTOP_AGENT_REQUIRED_FRESH_AFTER_MS / 1000);

  return {
    ...heartbeat,
    chat_effective_status: !pairing ? "not_connected" : isAvailableForChat ? "connected" : "stale",
    is_available_for_chat: isAvailableForChat,
  };
}

function buildChatCancellationMessage(
  languageInput: unknown,
  reason: "manual" | "offline" | "stale"
): string {
  const language = String(languageInput || "en").trim().toLowerCase();

  if (reason === "offline") {
    if (language.startsWith("pt")) {
      return "Nao consegui me comunicar com o aplicativo desktop nesta maquina. Abra o EXE e tente novamente.";
    }
    if (language.startsWith("es")) {
      return "No pude comunicarme con la app de escritorio en esta maquina. Abre el EXE e intentalo de nuevo.";
    }
    if (language.startsWith("fr")) {
      return "Impossible de communiquer avec l'application desktop sur cette machine. Ouvrez l'EXE et reessayez.";
    }
    return "I couldn't communicate with the desktop app on this machine. Open the EXE and try again.";
  }

  if (reason === "stale") {
    if (language.startsWith("pt")) {
      return "A conexao com o aplicativo desktop parece desatualizada. Verifique se o EXE esta aberto e conectado e tente novamente.";
    }
    if (language.startsWith("es")) {
      return "La conexion con la app de escritorio parece desactualizada. Verifica que el EXE siga abierto y conectado, y vuelve a intentarlo.";
    }
    if (language.startsWith("fr")) {
      return "La connexion avec l'application desktop semble expiree. Verifiez que l'EXE est ouvert et connecte, puis reessayez.";
    }
    return "The desktop app connection looks stale. Make sure the EXE is open and connected, then try again.";
  }

  if (language.startsWith("pt")) {
    return "Resposta interrompida.";
  }
  if (language.startsWith("es")) {
    return "Respuesta detenida.";
  }
  if (language.startsWith("fr")) {
    return "Reponse interrompue.";
  }
  return "Response stopped.";
}

const DEFAULT_GLOBAL_TIMEZONE = "UTC";

function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function readNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function buildTemporalContributionKey(entry: any, fallbackIndex: number): string {
  const temporalEvidenceKey = readNonEmptyString(
    entry?.temporal_evidence_key,
    entry?.temporalEvidenceKey
  );
  if (temporalEvidenceKey) {
    return `evidence:${temporalEvidenceKey}`;
  }

  const imageKey = readNonEmptyString(entry?.image_key, entry?.imageKey);
  if (imageKey) {
    return `image:${imageKey}`;
  }

  const timestampName = readNonEmptyString(entry?.timestamp_name, entry?.timestampName);
  const snapshotUtcIso = readNonEmptyString(
    entry?.snapshot_ts_utc_iso,
    entry?.snapshotTsUtcIso,
    entry?.ts_utc,
    entry?.tsUtc
  );
  const eventName = readNonEmptyString(entry?.event);
  const entityId = readNonEmptyString(entry?.entity_id, entry?.entityId);
  const frameIndexRaw = Number(entry?.frame_index ?? entry?.frameIndex);
  const frameIndex = Number.isFinite(frameIndexRaw) ? String(frameIndexRaw) : "";

  const compositeParts = [
    timestampName ? `timestamp:${timestampName}` : "",
    snapshotUtcIso ? `snapshot:${snapshotUtcIso}` : "",
    eventName ? `event:${eventName}` : "",
    entityId ? `entity:${entityId}` : "",
    frameIndex ? `frame:${frameIndex}` : "",
  ].filter(Boolean);

  if (compositeParts.length > 0) {
    return compositeParts.join("|");
  }

  return `fallback:${fallbackIndex}`;
}

function countTemporalContributingEvents(payloadDetails: any): number {
  const operatorResults = Array.isArray(payloadDetails?.temporal_operator_results)
    ? payloadDetails.temporal_operator_results
    : [];
  const seen = new Set<string>();

  for (const result of operatorResults) {
    if (!result || typeof result !== "object") continue;
    const contributingEvents = Array.isArray(result.contributing_events)
      ? result.contributing_events
      : [];
    for (let index = 0; index < contributingEvents.length; index++) {
      const entry = contributingEvents[index];
      if (!entry || typeof entry !== "object") continue;
      seen.add(buildTemporalContributionKey(entry, seen.size + index));
    }
  }

  return seen.size;
}

function normalizeTimezoneInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  if (/^utc$/i.test(raw)) return "UTC";
  if (isValidIanaTimezone(raw)) return raw;

  const offsetPattern = /^(?:UTC|GMT)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i;
  const match = offsetPattern.exec(raw);
  if (!match) return null;

  const sign = match[1];
  const hours = Number.parseInt(match[2], 10);
  const minutes = Number.parseInt(match[3] ?? "0", 10);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 14 || minutes < 0 || minutes > 59) return null;

  if (hours === 0 && minutes === 0) {
    return "UTC";
  }

  // IANA Etc/GMT has inverted sign semantics.
  // Example: UTC-3 => Etc/GMT+3
  if (minutes === 0) {
    const etcSign = sign === "+" ? "-" : "+";
    return `Etc/GMT${etcSign}${hours}`;
  }

  // Non-hour offsets should be provided as proper IANA zones (e.g. Asia/Kolkata).
  return null;
}

async function resolveUserGlobalTimezone(db: D1Database, userId: string): Promise<string> {
  const userRow = await db.prepare(
    "SELECT timezone_iana, timezone_source FROM app_users WHERE id = ? LIMIT 1"
  )
    .bind(userId)
    .first();
  const dbTimezone = normalizeTimezoneInput((userRow as any)?.timezone_iana);
  const dbTimezoneSource = (userRow as any)?.timezone_source || null;

  // If EXE is connected and reports a timezone, it is the source of truth.
  try {
    const pairingRow = await db.prepare(
      `SELECT timezone_iana
       FROM exe_pairings
       WHERE user_id = ?
         AND status = 'connected'
       ORDER BY COALESCE(timezone_updated_at, last_seen_at, paired_at) DESC
       LIMIT 1`
    )
      .bind(userId)
      .first();

    const pairingTimezone = normalizeTimezoneInput((pairingRow as any)?.timezone_iana);
    if (pairingTimezone) {
      if (dbTimezone !== pairingTimezone || dbTimezoneSource !== "exe_pairing") {
        await setUserGlobalTimezone(db, userId, pairingTimezone, "exe_pairing");
      }
      return pairingTimezone;
    }
  } catch (error) {
    // Backward compatibility: older DBs may not have exe_pairings timezone columns yet.
    console.log("[TIMEZONE] Could not read timezone from exe_pairings, falling back:", error);
  }

  if (dbTimezone) return dbTimezone;

  // Backfill from most recent job timezone when app_users timezone is missing.
  const latestJobTimezoneRow = await db.prepare(
    `SELECT timezone
     FROM jobs
     WHERE user_id = ?
       AND timezone IS NOT NULL
       AND TRIM(timezone) <> ''
     ORDER BY COALESCE(updated_at, created_at) DESC
     LIMIT 1`
  )
    .bind(userId)
    .first();
  const jobTimezone = normalizeTimezoneInput((latestJobTimezoneRow as any)?.timezone);
  const fallbackTimezone = jobTimezone || DEFAULT_GLOBAL_TIMEZONE;

  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE app_users
     SET timezone_iana = ?,
         timezone_updated_at = COALESCE(timezone_updated_at, ?),
         timezone_source = COALESCE(timezone_source, ?),
         updated_at = ?
     WHERE id = ?`
  )
    .bind(
      fallbackTimezone,
      now,
      jobTimezone ? "backfill_jobs" : "default",
      now,
      userId
    )
    .run();

  return fallbackTimezone;
}

type TimezoneLocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function getLocalDateTimePartsInTimezone(
  timezone: string,
  atDate: Date
): TimezoneLocalDateTimeParts | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const parts = fmt.formatToParts(atDate);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || "";

    const year = Number.parseInt(get("year"), 10);
    const month = Number.parseInt(get("month"), 10);
    const day = Number.parseInt(get("day"), 10);
    const hour = Number.parseInt(get("hour"), 10);
    const minute = Number.parseInt(get("minute"), 10);

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      !Number.isInteger(hour) ||
      !Number.isInteger(minute)
    ) {
      return null;
    }

    return { year, month, day, hour, minute };
  } catch {
    return null;
  }
}

function parseIsoLocalDateParts(
  localDate: string
): Omit<TimezoneLocalDateTimeParts, "hour" | "minute"> | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate.trim());
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;

  return { year, month, day };
}

function parseHHMMPartsForWindow(
  value: string
): Pick<TimezoneLocalDateTimeParts, "hour" | "minute"> | null {
  const match = /^([0-1]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;

  return { hour, minute };
}

function wallClockUtcMillis(parts: TimezoneLocalDateTimeParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
}

function localDateTimeInTimezoneToUtcIso(
  localDate: string,
  hhmm: string,
  timezoneInput: string
): string | null {
  const dateParts = parseIsoLocalDateParts(localDate);
  const timeParts = parseHHMMPartsForWindow(hhmm);
  const timezone = normalizeTimezoneInput(timezoneInput) || "UTC";
  if (!dateParts || !timeParts) return null;

  const target: TimezoneLocalDateTimeParts = { ...dateParts, ...timeParts };
  let guess = new Date(
    Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, 0, 0)
  );

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const observed = getLocalDateTimePartsInTimezone(timezone, guess);
    if (!observed) return null;

    const deltaMs = wallClockUtcMillis(observed) - wallClockUtcMillis(target);
    if (deltaMs === 0) {
      guess.setUTCSeconds(0, 0);
      return guess.toISOString();
    }

    guess = new Date(guess.getTime() - deltaMs);
  }

  const observed = getLocalDateTimePartsInTimezone(timezone, guess);
  if (
    observed &&
    observed.year === target.year &&
    observed.month === target.month &&
    observed.day === target.day &&
    observed.hour === target.hour &&
    observed.minute === target.minute
  ) {
    guess.setUTCSeconds(0, 0);
    return guess.toISOString();
  }

  return null;
}

function deriveJobStartWindowBoundaryUtc(
  payload: any,
  boundary: "start" | "end",
  fallbackTimezone: string
): string | null {
  if (!payload || typeof payload !== "object") return null;

  const windowNode =
    payload?.trigger && typeof payload.trigger === "object" && payload.trigger.window && typeof payload.trigger.window === "object"
      ? payload.trigger.window
      : null;
  if (!windowNode) return null;

  const utcKey = `${boundary}_utc`;
  const directUtc =
    typeof windowNode[utcKey] === "string" && windowNode[utcKey].trim()
      ? windowNode[utcKey].trim()
      : "";
  if (directUtc) return directUtc;

  const timeKey = boundary === "start" ? "start_time" : "end_time";
  const boundaryTime =
    typeof windowNode[timeKey] === "string" && windowNode[timeKey].trim()
      ? windowNode[timeKey].trim()
      : "";
  const localDate =
    typeof payload?.trigger?.local_date === "string" && payload.trigger.local_date.trim()
      ? payload.trigger.local_date.trim()
      : "";
  const timezone =
    normalizeTimezoneInput(payload?.trigger?.timezone) ||
    normalizeTimezoneInput(payload?.job?.timezone) ||
    normalizeTimezoneInput(fallbackTimezone) ||
    "UTC";

  if (!localDate || !boundaryTime) return null;
  return localDateTimeInTimezoneToUtcIso(localDate, boundaryTime, timezone);
}

async function setUserGlobalTimezone(
  db: D1Database,
  userId: string,
  timezoneInput: unknown,
  source: "exe_pairing" | "manual"
): Promise<string> {
  const timezoneIana = normalizeTimezoneInput(timezoneInput);
  if (!timezoneIana) {
    throw new Error("Invalid timezone. Use a valid IANA timezone (e.g. America/Sao_Paulo).");
  }

  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE app_users
     SET timezone_iana = ?,
         timezone_updated_at = ?,
         timezone_source = ?,
         updated_at = ?
     WHERE id = ?`
  )
    .bind(timezoneIana, now, source, now, userId)
    .run();

  // Keep jobs.timezone derived from the global user timezone.
  await db.prepare(
    "UPDATE jobs SET timezone = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?"
  )
    .bind(timezoneIana, userId)
    .run();

  return timezoneIana;
}

async function syncTimezoneFromExeSignal(
  db: D1Database,
  args: {
    userId: string;
    timezoneInput: unknown;
    clientId?: string | null;
    exeTokenHash?: string | null;
  }
): Promise<string | null> {
  const timezoneIana = normalizeTimezoneInput(args.timezoneInput);
  if (!timezoneIana) {
    return null;
  }

  const now = new Date().toISOString();

  try {
    if (args.clientId) {
      await db.prepare(
        `UPDATE exe_pairings
         SET timezone_iana = ?,
             timezone_updated_at = ?
         WHERE user_id = ?
           AND client_id = ?
           AND status = 'connected'`
      )
        .bind(timezoneIana, now, args.userId, args.clientId)
        .run();
    } else if (args.exeTokenHash) {
      await db.prepare(
        `UPDATE exe_pairings
         SET timezone_iana = ?,
             timezone_updated_at = ?
         WHERE user_id = ?
           AND exe_token_hash = ?
           AND status = 'connected'`
      )
        .bind(timezoneIana, now, args.userId, args.exeTokenHash)
        .run();
    }
  } catch (error) {
    console.log("[TIMEZONE] Could not persist EXE timezone on exe_pairings:", error);
  }

  const userRow = await db.prepare(
    "SELECT timezone_iana, timezone_source FROM app_users WHERE id = ? LIMIT 1"
  )
    .bind(args.userId)
    .first();

  const currentTimezone = normalizeTimezoneInput((userRow as any)?.timezone_iana);
  const currentSource = (userRow as any)?.timezone_source || null;

  if (currentTimezone !== timezoneIana || currentSource !== "exe_pairing") {
    await setUserGlobalTimezone(db, args.userId, timezoneIana, "exe_pairing");
    console.log(`[TIMEZONE] Synced global timezone from EXE for user ${args.userId}: ${timezoneIana}`);
  }

  return timezoneIana;
}

type DrakonFindSearchStatus =
  | "queued"
  | "dispatching"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

type DrakonFindRuntimeMode = "image_one_shot" | "continuous_video_60s";

type DrakonFindScopeStateSummary = {
  state_code: string;
  state_name: string;
  camera_count: number;
};

type DrakonFindScopeCameraPreview = {
  id: number;
  user_id: string;
  name: string;
  city: string | null;
  state: string | null;
  state_code: string | null;
  country: string | null;
  country_code: string | null;
  allowpublicaccess: number;
};

type ResolvedDrakonFindScope = {
  country_code: string;
  selected_states: string[];
  eligible_camera_count: number;
  eligible_owner_count: number;
  excluded_camera_ids?: number[];
  states: DrakonFindScopeStateSummary[];
  cameras: DrakonFindScopeCameraPreview[];
  preview_updated_at: string;
  eligible_cameras: DrakonFindScopeCameraPreview[];
};

type DrakonFindTargetImageRow = {
  id: number;
  target_id: number;
  storage_key: string;
  image_url: string;
  content_type: string | null;
  created_at: string;
  updated_at: string;
};

type DrakonFindSearchClientSummary = {
  client_id: string;
  exe_id: string;
  camera_count: number;
  completed_camera_count: number;
  matched_camera_count: number;
};

type DrakonFindDispatchAssignment = {
  camera_id: number;
  camera_name: string;
  camera_owner_user_id: string;
  city: string | null;
  state_code: string | null;
  country_code: string | null;
  client_id: string;
  exe_id: string;
  assignment_source:
    | "camera_capture_metrics"
    | "owner_recent_capture_metrics_fallback"
    | "owner_connected_pairing_fallback";
  was_service_running: boolean;
  camera_payload: {
    camera_id: number;
    name: string;
    description: string;
    ip: string;
    port: string | null;
    username: string;
    password: string;
    manufacturer: string;
    connection_method: string;
    webcam_index: number | null;
    channel: string | null;
    subtype: string | null;
    start_origin: "drakon_find";
    enabled_algorithms: [];
    store_frames: boolean;
    retention_days: number;
    frame_rate: number;
    analysis_speed: number;
    model_tier: "light" | "plus" | "pro";
  };
};

type DrakonFindSearchRow = {
  id: number;
  user_id: string;
  target_id: number;
  target_name: string;
  target_entity_type: string;
  target_description: string;
  target_traits: string[];
  status: DrakonFindSearchStatus;
  runtime_mode: DrakonFindRuntimeMode;
  input_type: string;
  window_seconds: number;
  duration_seconds: number;
  run_until: string | null;
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
  last_event_at: string | null;
  last_error: string | null;
  scope_snapshot: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  clients: DrakonFindSearchClientSummary[];
};

const DRAKON_FIND_MAX_TARGET_IMAGES = 6;
const DRAKON_FIND_MAX_TARGET_IMAGE_BYTES = 1_500_000;
const DRAKON_FIND_MAX_HITS_PER_SEARCH = 2000;
const DRAKON_FIND_MAX_ACTIVE_SEARCHES_PER_OPERATOR = 2;
const DRAKON_FIND_MAX_ACTIVE_SEARCHES_PER_CLIENT = 1;
const DRAKON_FIND_MAX_PARALLEL_CAMERAS_PER_CLIENT = 3;
const DRAKON_FIND_DEFAULT_DURATION_SECONDS = 1800;
const DRAKON_FIND_MIN_DURATION_SECONDS = 1800;
const DRAKON_FIND_MAX_DURATION_SECONDS = 2_592_000;
const DRAKON_FIND_WINDOW_SECONDS = 60;
const DRAKON_FIND_RUNTIME_MODE: DrakonFindRuntimeMode = "continuous_video_60s";
const DRAKON_FIND_AGENT_MEDIA_MAX_BYTES = 25 * 1024 * 1024;


function requireDrakonFindEnabled(c: any) {
  if (!brand.features.drakonFindEnabled) {
    return c.json({ error: "Drakon Find is not available for this brand" }, 404);
  }
  return null;
}

function normalizeDrakonFindText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeDrakonFindTraits(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => normalizeDrakonFindText(item, 80))
        .filter((item) => item.length > 0)
    )
  ).slice(0, 24);
}

function normalizeDrakonFindDurationSeconds(value: unknown) {
  const numeric = Math.floor(toFiniteNumber(value, DRAKON_FIND_DEFAULT_DURATION_SECONDS));
  if (!Number.isFinite(numeric)) return DRAKON_FIND_DEFAULT_DURATION_SECONDS;
  return Math.max(
    DRAKON_FIND_MIN_DURATION_SECONDS,
    Math.min(DRAKON_FIND_MAX_DURATION_SECONDS, numeric)
  );
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter((item) => item.length > 0);
      }
    } catch {
      return [];
    }
  }

  return [];
}

function normalizePositiveIntegerArray(value: unknown, maxItems = 20000): number[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
    ? (() => {
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })()
    : [];

  return Array.from(
    new Set(
      rawValues
        .map((item) => clampInteger(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  ).slice(0, Math.max(0, Math.floor(maxItems)));
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampInteger(value: unknown, fallback = 0): number {
  return Math.max(0, Math.floor(toFiniteNumber(value, fallback)));
}

function arrayBufferToBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function buildDrakonFindTargetImageUrl(storageKey: string): string {
  return `/api/drakon-find-target-images/${encodeURIComponent(storageKey)}`;
}

function buildDrakonFindSearchPrompt(target: {
  entity_type: string;
  name: string;
  description: string;
  traits?: string[];
}) {
  const entityType = normalizeDrakonFindText(target.entity_type, 40) || "alvo";
  const name = normalizeDrakonFindText(target.name, 120) || "target";
  const description = normalizeDrakonFindText(target.description, 2000);
  const traits = normalizeDrakonFindTraits(target.traits);

  const promptParts = [
    `Procure por um ${entityType} chamado "${name}" no material atual da camera.`,
    description ? `Descricao principal: ${description}.` : "",
    traits.length > 0 ? `Sinais visuais importantes: ${traits.join("; ")}.` : "",
    "Considere variacoes de angulo, iluminacao, escala, oclusao parcial, movimento e fundo.",
    "Se o material atual mostrar o mesmo alvo com alta confianca, marque match como true.",
    "Se a evidencia for fraca, ambigua ou insuficiente, responda match como false.",
  ];

  return promptParts.filter(Boolean).join(" ");
}

function parseDataUrl(value: unknown): { contentType: string; base64: string } | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = /^data:([^;]+);base64,(.+)$/i.exec(trimmed);
  if (!match) return null;
  const contentType = match[1]?.trim() || "application/octet-stream";
  const base64 = match[2]?.trim() || "";
  if (!base64) return null;
  return { contentType, base64 };
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function buildDrakonFindHitImageUrl(storageKey: string): string {
  return `/api/drakon-find-hit-images/${encodeURIComponent(storageKey)}`;
}

function buildDrakonFindHitVideoUrl(storageKey: string): string {
  return `/api/drakon-find-hit-videos/${encodeURIComponent(storageKey)}`;
}

function buildDrakonFindTargetImageStorageKey(
  userId: string,
  targetId: number,
  contentType: string
): string {
  const safeUserId = sanitizeStoragePathSegment(userId, "user");
  const safeTargetId = sanitizeStoragePathSegment(targetId, "target");
  const extension = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
    ? "webp"
    : "jpg";
  return `drakon_find/targets/${safeUserId}/target_${safeTargetId}/${Date.now()}_${generateUUID()}.${extension}`;
}

function buildDrakonFindHitStorageKey(
  userId: string,
  searchId: number,
  cameraId: number,
  contentType: string
): string {
  const safeUserId = sanitizeStoragePathSegment(userId, "user");
  const safeSearchId = sanitizeStoragePathSegment(searchId, "search");
  const safeCameraId = sanitizeStoragePathSegment(cameraId, "camera");
  const extension = contentType.includes("mp4")
    ? "mp4"
    : contentType.includes("png")
    ? "png"
    : "jpg";
  return `drakon_find/hits/${safeUserId}/search_${safeSearchId}/camera_${safeCameraId}/${Date.now()}_${generateUUID()}.${extension}`;
}

function normalizeCameraGeography(stateValue: unknown, countryValue: unknown) {
  const stateText = normalizeOptionalCameraField(stateValue);
  const countryText = normalizeOptionalCameraField(countryValue);
  const stateCode = normalizeBrazilStateCode(stateText);
  const countryCode = normalizeCountryCode(countryText, stateCode);

  return {
    stateText,
    countryText,
    stateCode,
    countryCode,
  };
}

async function createDrakonFindAuditLog(
  db: D1Database,
  entry: {
    actorUserId: string;
    actionType: string;
    targetId?: number | null;
    searchId?: number | null;
    message: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO drakon_find_audit_logs (
         actor_user_id,
         action_type,
         target_id,
         search_id,
         message,
         metadata_json,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      entry.actorUserId,
      entry.actionType,
      entry.targetId ?? null,
      entry.searchId ?? null,
      entry.message,
      JSON.stringify(entry.metadata || {}),
      now
    )
    .run();
}

async function resolveDrakonFindScope(
  db: D1Database,
  selectedStatesInput: unknown,
  countryCodeInput?: unknown
): Promise<ResolvedDrakonFindScope> {
  const selectedStates = normalizeBrazilStateSelection(selectedStatesInput);
  const countryCode = normalizeCountryCode(countryCodeInput, selectedStates[0] || null) || "BR";

  if (selectedStates.length === 0) {
    return {
      country_code: countryCode,
      selected_states: [],
      eligible_camera_count: 0,
      eligible_owner_count: 0,
      excluded_camera_ids: [],
      states: [],
      cameras: [],
      preview_updated_at: new Date().toISOString(),
      eligible_cameras: [],
    };
  }

  const placeholders = selectedStates.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT
         id,
         user_id,
         name,
         city,
         state,
         state_code,
         country,
         country_code,
         allowpublicaccess
       FROM cameras
       WHERE allowpublicaccess = 1
         AND COALESCE(NULLIF(TRIM(country_code), ''), 'BR') = ?
         AND state_code IN (${placeholders})
       ORDER BY state_code ASC, city ASC, name ASC, id ASC`
    )
    .bind(countryCode, ...selectedStates)
    .all();

  const eligibleCameras: DrakonFindScopeCameraPreview[] = (results || []).map((row: any) => ({
    id: Number(row?.id || 0),
    user_id: String(row?.user_id || ""),
    name: String(row?.name || ""),
    city: typeof row?.city === "string" ? row.city : null,
    state: typeof row?.state === "string" ? row.state : null,
    state_code: typeof row?.state_code === "string" ? row.state_code : null,
    country: typeof row?.country === "string" ? row.country : null,
    country_code: typeof row?.country_code === "string" ? row.country_code : null,
    allowpublicaccess: Number(row?.allowpublicaccess || 0),
  }));

  const stateCounts = new Map<string, number>();
  const ownerIds = new Set<string>();
  for (const camera of eligibleCameras) {
    const stateCode = typeof camera.state_code === "string" ? camera.state_code.trim() : "";
    if (stateCode) {
      stateCounts.set(stateCode, (stateCounts.get(stateCode) || 0) + 1);
    }
    if (camera.user_id) {
      ownerIds.add(camera.user_id);
    }
  }

  const states: DrakonFindScopeStateSummary[] = selectedStates.map((stateCode) => ({
    state_code: stateCode,
    state_name: BRAZIL_STATE_NAME_BY_CODE[stateCode as keyof typeof BRAZIL_STATE_NAME_BY_CODE] || stateCode,
    camera_count: stateCounts.get(stateCode) || 0,
  }));

  return {
    country_code: countryCode,
    selected_states: selectedStates,
    eligible_camera_count: eligibleCameras.length,
    eligible_owner_count: ownerIds.size,
    excluded_camera_ids: [],
    states,
    cameras: eligibleCameras,
    preview_updated_at: new Date().toISOString(),
    eligible_cameras: eligibleCameras,
  };
}

function applyDrakonFindCameraExclusions(
  scope: ResolvedDrakonFindScope,
  excludedCameraIdsInput: unknown
): ResolvedDrakonFindScope {
  const excludedCameraIds = normalizePositiveIntegerArray(excludedCameraIdsInput);
  if (excludedCameraIds.length === 0) {
    return {
      ...scope,
      excluded_camera_ids: [],
    };
  }

  const excludedIdSet = new Set(excludedCameraIds);
  const eligibleCameraIdSet = new Set(scope.eligible_cameras.map((camera) => camera.id));
  const filteredEligibleCameras = scope.eligible_cameras.filter(
    (camera) => !excludedIdSet.has(camera.id)
  );
  const filteredOwners = new Set(
    filteredEligibleCameras
      .map((camera) => (typeof camera.user_id === "string" ? camera.user_id.trim() : ""))
      .filter((value) => value.length > 0)
  );
  const stateCounts = new Map<string, number>();
  for (const camera of filteredEligibleCameras) {
    const stateCode =
      typeof camera.state_code === "string" ? camera.state_code.trim().toUpperCase() : "";
    if (stateCode) {
      stateCounts.set(stateCode, (stateCounts.get(stateCode) || 0) + 1);
    }
  }

  return {
    ...scope,
    eligible_camera_count: filteredEligibleCameras.length,
    eligible_owner_count: filteredOwners.size,
    excluded_camera_ids: excludedCameraIds.filter((cameraId) => eligibleCameraIdSet.has(cameraId)),
    states: scope.states.map((state) => ({
      ...state,
      camera_count: stateCounts.get(state.state_code) || 0,
    })),
    cameras: filteredEligibleCameras,
    eligible_cameras: filteredEligibleCameras,
  };
}

async function fetchDrakonFindTargetImagesByTargetIds(
  db: D1Database,
  targetIds: number[]
): Promise<Map<number, DrakonFindTargetImageRow[]>> {
  const normalizedTargetIds = Array.from(
    new Set(targetIds.filter((value) => Number.isInteger(value) && value > 0))
  );
  const imageMap = new Map<number, DrakonFindTargetImageRow[]>();
  if (normalizedTargetIds.length === 0) return imageMap;

  const placeholders = normalizedTargetIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT id, target_id, storage_key, image_url, content_type, created_at, updated_at
       FROM drakon_find_target_images
       WHERE target_id IN (${placeholders})
       ORDER BY created_at ASC, id ASC`
    )
    .bind(...normalizedTargetIds)
    .all();

  for (const row of results || []) {
    const targetId = Number((row as any)?.target_id || 0);
    if (!Number.isInteger(targetId) || targetId <= 0) continue;
    const bucket = imageMap.get(targetId) || [];
    bucket.push({
      id: Number((row as any)?.id || 0),
      target_id: targetId,
      storage_key: String((row as any)?.storage_key || ""),
      image_url: String((row as any)?.image_url || ""),
      content_type:
        typeof (row as any)?.content_type === "string"
          ? String((row as any).content_type)
          : null,
      created_at: String((row as any)?.created_at || ""),
      updated_at: String((row as any)?.updated_at || ""),
    });
    imageMap.set(targetId, bucket);
  }

  return imageMap;
}

async function fetchDrakonFindTargetsForUser(db: D1Database, userId: string) {
  const { results } = await db
    .prepare(
      `SELECT
         t.*,
         COUNT(s.id) AS search_count,
         SUM(CASE WHEN s.status = 'queued' THEN 1 ELSE 0 END) AS queued_search_count,
         SUM(CASE WHEN s.status = 'running' THEN 1 ELSE 0 END) AS running_search_count,
         MAX(s.created_at) AS last_search_at
       FROM drakon_find_targets t
       LEFT JOIN drakon_find_searches s
         ON s.target_id = t.id
        AND s.user_id = t.user_id
       WHERE t.user_id = ?
       GROUP BY t.id, t.user_id, t.entity_type, t.name, t.description, t.traits_json, t.created_at, t.updated_at
       ORDER BY t.updated_at DESC, t.id DESC`
    )
    .bind(userId)
    .all();

  const targetIds = (results || []).map((row: any) => Number(row?.id || 0));
  const imageMap = await fetchDrakonFindTargetImagesByTargetIds(db, targetIds);

  return (results || []).map((row: any) => {
    const targetId = Number(row?.id || 0);
    const images = (imageMap.get(targetId) || []).map((image) => ({
      id: image.id,
      target_id: image.target_id,
      image_url: image.image_url,
      content_type: image.content_type,
      created_at: image.created_at,
      updated_at: image.updated_at,
    }));
    return {
    id: Number(row?.id || 0),
    user_id: String(row?.user_id || ""),
    entity_type: String(row?.entity_type || ""),
    name: String(row?.name || ""),
    description: String(row?.description || ""),
    traits: parseStringArray(row?.traits_json),
    images,
    image_count: images.length,
    created_at: String(row?.created_at || ""),
    updated_at: String(row?.updated_at || ""),
    search_count: Number(row?.search_count || 0),
    queued_search_count: Number(row?.queued_search_count || 0),
    running_search_count: Number(row?.running_search_count || 0),
    last_search_at: row?.last_search_at ? String(row.last_search_at) : null,
    };
  });
}

async function fetchDrakonFindSearchesForUser(db: D1Database, userId: string) {
  const { results } = await db
    .prepare(
      `SELECT
         s.*,
         t.name AS target_name,
         t.entity_type AS target_entity_type,
         t.description AS target_description,
         t.traits_json AS target_traits_json
       FROM drakon_find_searches s
       JOIN drakon_find_targets t ON t.id = s.target_id
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC, s.id DESC`
    )
    .bind(userId)
    .all();

  const searchIds = (results || [])
    .map((row: any) => Number(row?.id || 0))
    .filter((value: number) => Number.isInteger(value) && value > 0);
  const searchCameraStats = new Map<
    number,
    {
      completed_camera_count: number;
      matched_camera_count: number;
    }
  >();
  const searchClients = new Map<number, DrakonFindSearchClientSummary[]>();

  if (searchIds.length > 0) {
    const placeholders = searchIds.map(() => "?").join(", ");
    const { results: cameraStatsRows } = await db
      .prepare(
        `SELECT
           search_id,
           SUM(CASE WHEN dispatch_status IN ('completed', 'failed', 'cancelled', 'skipped') THEN 1 ELSE 0 END) AS completed_camera_count,
           SUM(CASE WHEN match_count > 0 THEN 1 ELSE 0 END) AS matched_camera_count
         FROM drakon_find_search_cameras
         WHERE search_id IN (${placeholders})
         GROUP BY search_id`
      )
      .bind(...searchIds)
      .all();

    for (const row of cameraStatsRows || []) {
      const searchId = Number((row as any)?.search_id || 0);
      if (!Number.isInteger(searchId) || searchId <= 0) continue;
      searchCameraStats.set(searchId, {
        completed_camera_count: clampInteger((row as any)?.completed_camera_count),
        matched_camera_count: clampInteger((row as any)?.matched_camera_count),
      });
    }

    const { results: clientRows } = await db
      .prepare(
        `SELECT
           search_id,
           assigned_client_id,
           assigned_exe_id,
           COUNT(*) AS camera_count,
           SUM(CASE WHEN dispatch_status IN ('completed', 'failed', 'cancelled', 'skipped') THEN 1 ELSE 0 END) AS completed_camera_count,
           SUM(CASE WHEN match_count > 0 THEN 1 ELSE 0 END) AS matched_camera_count
         FROM drakon_find_search_cameras
         WHERE search_id IN (${placeholders})
           AND assigned_client_id IS NOT NULL
           AND TRIM(assigned_client_id) <> ''
         GROUP BY search_id, assigned_client_id, assigned_exe_id
         ORDER BY search_id ASC, assigned_client_id ASC`
      )
      .bind(...searchIds)
      .all();

    for (const row of clientRows || []) {
      const searchId = Number((row as any)?.search_id || 0);
      if (!Number.isInteger(searchId) || searchId <= 0) continue;
      const bucket = searchClients.get(searchId) || [];
      bucket.push({
        client_id: String((row as any)?.assigned_client_id || ""),
        exe_id: String((row as any)?.assigned_exe_id || ""),
        camera_count: clampInteger((row as any)?.camera_count),
        completed_camera_count: clampInteger((row as any)?.completed_camera_count),
        matched_camera_count: clampInteger((row as any)?.matched_camera_count),
      });
      searchClients.set(searchId, bucket);
    }
  }

  return (results || []).map((row: any): DrakonFindSearchRow => {
    const scopeSnapshot = parseJsonObject(row?.scope_snapshot_json);
    const selectedStates = normalizeBrazilStateSelection(
      parseStringArray(row?.selected_states_json).length > 0
        ? parseStringArray(row?.selected_states_json)
        : scopeSnapshot.selected_states
    );
    const searchId = Number(row?.id || 0);
    const cameraStats = searchCameraStats.get(searchId) || {
      completed_camera_count: clampInteger((row as any)?.completed_camera_count),
      matched_camera_count: clampInteger((row as any)?.matched_camera_count),
    };
    const clients = searchClients.get(searchId) || [];
    const eligibleCameraCount = Number(row?.eligible_camera_count || 0);
    const completedCameraCount = clampInteger(cameraStats.completed_camera_count);

    return {
      id: searchId,
      user_id: String(row?.user_id || ""),
      target_id: Number(row?.target_id || 0),
      target_name: String(row?.target_name || ""),
      target_entity_type: String(row?.target_entity_type || ""),
      target_description: String(row?.target_description || ""),
      target_traits: parseStringArray((row as any)?.target_traits_json),
      status: String(row?.status || "queued") as DrakonFindSearchStatus,
      runtime_mode:
        String((row as any)?.runtime_mode || DRAKON_FIND_RUNTIME_MODE) as DrakonFindRuntimeMode,
      input_type: String((row as any)?.input_type || "video"),
      window_seconds: Math.max(
        1,
        clampInteger((row as any)?.window_seconds, DRAKON_FIND_WINDOW_SECONDS)
      ),
      duration_seconds: normalizeDrakonFindDurationSeconds(
        (row as any)?.duration_seconds ?? DRAKON_FIND_DEFAULT_DURATION_SECONDS
      ),
      run_until:
        typeof (row as any)?.run_until === "string" && String((row as any).run_until).trim()
          ? String((row as any).run_until)
          : null,
      country_code:
        normalizeCountryCode(row?.country_code, selectedStates[0] || null) || "BR",
      selected_states: selectedStates,
      selected_state_count: selectedStates.length,
      eligible_camera_count: eligibleCameraCount,
      eligible_owner_count: Number(row?.eligible_owner_count || 0),
      attempt_count: Math.max(1, clampInteger((row as any)?.attempt_count, 1)),
      dispatched_command_count: clampInteger((row as any)?.dispatched_command_count),
      completed_camera_count: completedCameraCount,
      matched_camera_count: clampInteger(cameraStats.matched_camera_count),
      pending_camera_count: Math.max(0, eligibleCameraCount - completedCameraCount),
      hit_count: clampInteger((row as any)?.hit_count),
      active_client_count: clients.length,
      last_event_at:
        typeof (row as any)?.last_event_at === "string"
          ? String((row as any).last_event_at)
          : null,
      last_error:
        typeof (row as any)?.last_error === "string" && String((row as any).last_error).trim()
          ? String((row as any).last_error)
          : null,
      clients,
      scope_snapshot:
        Object.keys(scopeSnapshot).length > 0 ? scopeSnapshot : null,
      started_at: row?.started_at ? String(row.started_at) : null,
      completed_at: row?.completed_at ? String(row.completed_at) : null,
      cancelled_at: row?.cancelled_at ? String(row.cancelled_at) : null,
      created_at: String(row?.created_at || ""),
      updated_at: String(row?.updated_at || ""),
    };
  });
}

async function fetchDrakonFindHitsForUser(
  db: D1Database,
  userId: string,
  options?: {
    searchId?: number | null;
    limit?: number;
  }
) {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(options?.limit || 60)));
  const searchId =
    Number.isInteger(options?.searchId) && Number(options?.searchId) > 0
      ? Number(options?.searchId)
      : null;

  const queryParts = [
    `SELECT
       h.*,
       c.name AS camera_name_live,
       s.user_id AS search_user_id,
       s.target_id AS search_target_id,
       sc.camera_name AS scoped_camera_name,
       sc.city AS scoped_camera_city,
       sc.state_code AS scoped_state_code
     FROM drakon_find_hits h
     JOIN drakon_find_searches s ON s.id = h.search_id
     LEFT JOIN cameras c ON c.id = h.camera_id
     LEFT JOIN drakon_find_search_cameras sc
       ON sc.search_id = h.search_id
      AND sc.camera_id = h.camera_id
     WHERE s.user_id = ?`,
  ];
  const bindings: any[] = [userId];

  if (searchId) {
    queryParts.push("AND h.search_id = ?");
    bindings.push(searchId);
  }

  queryParts.push("ORDER BY h.matched_at DESC, h.id DESC LIMIT ?");
  bindings.push(safeLimit);

  const { results } = await db.prepare(queryParts.join(" ")).bind(...bindings).all();
  return (results || []).map((row: any) => {
    const details = parseJsonObject(row?.details_json);
    return {
      id: Number(row?.id || 0),
      search_id: Number(row?.search_id || 0),
      target_id: Number(row?.target_id || row?.search_target_id || 0),
      camera_id: Number(row?.camera_id || 0),
      camera_name:
        typeof row?.camera_name_live === "string" && row.camera_name_live.trim()
          ? String(row.camera_name_live)
          : typeof row?.scoped_camera_name === "string"
          ? String(row.scoped_camera_name)
          : null,
      camera_owner_user_id: String(row?.camera_owner_user_id || ""),
      client_id:
        typeof row?.client_id === "string" && row.client_id.trim()
          ? String(row.client_id)
          : null,
      exe_id:
        typeof row?.exe_id === "string" && row.exe_id.trim() ? String(row.exe_id) : null,
      camera_city:
        typeof row?.scoped_camera_city === "string" ? String(row.scoped_camera_city) : null,
      camera_state_code:
        typeof row?.scoped_state_code === "string" ? String(row.scoped_state_code) : null,
      summary: String(row?.summary || ""),
      confidence: toFiniteNumber(row?.confidence, 0),
      image_url:
        typeof row?.image_url === "string" && row.image_url.trim()
          ? String(row.image_url)
          : typeof details?.image_url === "string" && details.image_url.trim()
          ? String(details.image_url)
          : null,
      video_url:
        typeof row?.video_url === "string" && row.video_url.trim()
          ? String(row.video_url)
          : typeof details?.video_url === "string" && details.video_url.trim()
          ? String(details.video_url)
          : typeof details?.clip_url === "string" && details.clip_url.trim()
          ? String(details.clip_url)
          : null,
      details,
      matched_at: String(row?.matched_at || row?.created_at || ""),
      created_at: String(row?.created_at || ""),
    };
  });
}

async function fetchDrakonFindAuditForUser(
  db: D1Database,
  userId: string,
  limit = 50
) {
  const numericLimit = Number.isFinite(limit) ? Math.floor(limit) : 50;
  const safeLimit = Math.max(1, Math.min(100, numericLimit));
  const { results } = await db
    .prepare(
      `SELECT
         a.*,
         u.email AS actor_email
       FROM drakon_find_audit_logs a
       LEFT JOIN app_users u ON u.id = a.actor_user_id
       WHERE a.actor_user_id = ?
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`
    )
    .bind(userId, safeLimit)
    .all();

  return (results || []).map((row: any) => ({
    id: Number(row?.id || 0),
    actor_user_id: String(row?.actor_user_id || ""),
    actor_email: row?.actor_email ? String(row.actor_email) : null,
    action_type: String(row?.action_type || ""),
    target_id:
      row?.target_id === null || row?.target_id === undefined ? null : Number(row.target_id),
    search_id:
      row?.search_id === null || row?.search_id === undefined ? null : Number(row.search_id),
    message: String(row?.message || ""),
    metadata: parseJsonObject(row?.metadata_json),
    created_at: String(row?.created_at || ""),
  }));
}

async function fetchDrakonFindSearchForDispatch(db: D1Database, searchId: number) {
  if (!Number.isInteger(searchId) || searchId <= 0) return null;

  const row = await db
    .prepare(
      `SELECT
         s.*,
         t.name AS target_name,
         t.entity_type AS target_entity_type,
         t.description AS target_description,
         t.traits_json AS target_traits_json
       FROM drakon_find_searches s
       JOIN drakon_find_targets t ON t.id = s.target_id
       WHERE s.id = ?
       LIMIT 1`
    )
    .bind(searchId)
    .first();

  if (!row) return null;

  return {
    id: Number((row as any)?.id || 0),
    user_id: String((row as any)?.user_id || ""),
    target_id: Number((row as any)?.target_id || 0),
    status: String((row as any)?.status || "queued"),
    runtime_mode:
      String((row as any)?.runtime_mode || DRAKON_FIND_RUNTIME_MODE) as DrakonFindRuntimeMode,
    input_type: String((row as any)?.input_type || "video"),
    window_seconds: Math.max(
      1,
      clampInteger((row as any)?.window_seconds, DRAKON_FIND_WINDOW_SECONDS)
    ),
    duration_seconds: normalizeDrakonFindDurationSeconds(
      (row as any)?.duration_seconds ?? DRAKON_FIND_DEFAULT_DURATION_SECONDS
    ),
    run_until:
      typeof (row as any)?.run_until === "string" && String((row as any).run_until).trim()
        ? String((row as any).run_until)
        : null,
    country_code:
      normalizeCountryCode((row as any)?.country_code, null) || "BR",
    selected_states: normalizeBrazilStateSelection(
      parseStringArray((row as any)?.selected_states_json)
    ),
    scope_snapshot: parseJsonObject((row as any)?.scope_snapshot_json),
    eligible_camera_count: clampInteger((row as any)?.eligible_camera_count),
    eligible_owner_count: clampInteger((row as any)?.eligible_owner_count),
    attempt_count: Math.max(1, clampInteger((row as any)?.attempt_count, 1)),
    target_name: String((row as any)?.target_name || ""),
    target_entity_type: String((row as any)?.target_entity_type || ""),
    target_description: String((row as any)?.target_description || ""),
    target_traits: parseStringArray((row as any)?.target_traits_json),
    last_error:
      typeof (row as any)?.last_error === "string" ? String((row as any).last_error) : null,
    created_at: String((row as any)?.created_at || ""),
    updated_at: String((row as any)?.updated_at || ""),
  };
}

async function chooseDrakonFindModelConfig(
  db: D1Database,
  userId: string
): Promise<{
  model_name: string;
  model_api_key: string;
  provider: "openai";
  model_fps: number;
}> {
  const openAiApiKey = await getUserOpenAIApiKey(db, userId);
  if (!openAiApiKey) {
    const error = new Error(OPENAI_KEY_REQUIRED_MESSAGE);
    (error as any).code = OPENAI_KEY_REQUIRED_ERROR;
    throw error;
  }

  const ultraRuntimeConfig = await loadChatModelRuntimeConfig(db, "ultra");

  return {
    model_name: "gpt-5.1",
    model_api_key: openAiApiKey,
    provider: "openai",
    model_fps: ultraRuntimeConfig.defaultFps,
  };
}

async function loadDrakonFindReferenceImagesForDispatch(
  env: Env,
  targetId: number
): Promise<
  Array<{
    image_id: number;
    image_url: string;
    content_type: string;
    data_url: string;
  }>
> {
  const imageMap = await fetchDrakonFindTargetImagesByTargetIds(env.DB, [targetId]);
  const images = imageMap.get(targetId) || [];
  const references: Array<{
    image_id: number;
    image_url: string;
    content_type: string;
    data_url: string;
  }> = [];

  for (const image of images.slice(0, DRAKON_FIND_MAX_TARGET_IMAGES)) {
    if (!image.storage_key) continue;

    try {
      const object = await env.R2_BUCKET.get(image.storage_key);
      if (!object) continue;
      const arrayBuffer = await object.arrayBuffer();
      const contentType = image.content_type || "image/jpeg";
      const dataUrl = `data:${contentType};base64,${arrayBufferToBase64(arrayBuffer)}`;
      references.push({
        image_id: image.id,
        image_url: image.image_url,
        content_type: contentType,
        data_url: dataUrl,
      });
    } catch (error) {
      console.error("[DRAKON FIND] Failed to load target reference image", {
        targetId,
        imageId: image.id,
        storageKey: image.storage_key,
        error,
      });
    }
  }

  return references;
}

async function resolveDrakonFindAssignmentsForSearch(db: D1Database, searchId: number) {
  if (!Number.isInteger(searchId) || searchId <= 0) {
    return {
      assignments: [] as DrakonFindDispatchAssignment[],
      unresolved: [] as Array<{ camera_id: number; reason: string }>,
    };
  }

  const { results: cameraRows } = await db
    .prepare(
      `SELECT
         camera_id,
         camera_name,
         camera_owner_user_id,
         city,
         state_code,
         country_code
       FROM drakon_find_search_cameras
       WHERE search_id = ?
         AND dispatch_status = 'queued'
       ORDER BY camera_id ASC`
    )
    .bind(searchId)
    .all();

  const scopedRows = (cameraRows || []).map((row: any) => ({
    camera_id: Number(row?.camera_id || 0),
    camera_name: String(row?.camera_name || ""),
    camera_owner_user_id: String(row?.camera_owner_user_id || ""),
    city: typeof row?.city === "string" ? String(row.city) : null,
    state_code: typeof row?.state_code === "string" ? String(row.state_code) : null,
    country_code: typeof row?.country_code === "string" ? String(row.country_code) : null,
  }));
  const cameraIds = scopedRows
    .map((row: { camera_id: number }) => row.camera_id)
    .filter((value: number) => Number.isInteger(value) && value > 0);

  if (cameraIds.length === 0) {
    return {
      assignments: [] as DrakonFindDispatchAssignment[],
      unresolved: [] as Array<{ camera_id: number; reason: string }>,
    };
  }

  const placeholders = cameraIds.map(() => "?").join(", ");
  const { results: cameraDetailRows } = await db
    .prepare(
      `SELECT
         id,
         user_id,
         name,
         description,
         ip_address,
         rtsp_port,
         username,
         password,
         manufacturer,
         connection_method,
         webcam_index,
         channel,
         subtype,
         retention_days,
         analysis_speed,
         model_tier,
         is_service_running
       FROM cameras
       WHERE id IN (${placeholders})`
    )
    .bind(...cameraIds)
    .all();
  const { results: metricRows } = await db
    .prepare(
      `SELECT
         user_id,
         client_id,
         exe_id,
         camera_id,
         sampled_at,
         updated_at
       FROM capture_thread_metrics_latest
       WHERE camera_id IN (${placeholders})`
    )
    .bind(...cameraIds)
    .all();

  const cameraDetailById = new Map<number, any>();
  for (const row of cameraDetailRows || []) {
    const cameraId = Number((row as any)?.id || 0);
    if (!Number.isInteger(cameraId) || cameraId <= 0) continue;
    cameraDetailById.set(cameraId, row);
  }

  const latestMetricByCamera = new Map<number, any>();
  const latestMetricByOwner = new Map<string, any>();
  for (const row of metricRows || []) {
    const cameraId = Number((row as any)?.camera_id || 0);
    const ownerUserId = String((row as any)?.user_id || "").trim();
    const stamp = String((row as any)?.updated_at || (row as any)?.sampled_at || "");

    if (Number.isInteger(cameraId) && cameraId > 0) {
      const existing = latestMetricByCamera.get(cameraId);
      const existingStamp = String(existing?.updated_at || existing?.sampled_at || "");
      if (!existing || stamp > existingStamp) {
        latestMetricByCamera.set(cameraId, row);
      }
    }

    if (ownerUserId) {
      const existingOwnerMetric = latestMetricByOwner.get(ownerUserId);
      const existingOwnerStamp = String(
        existingOwnerMetric?.updated_at || existingOwnerMetric?.sampled_at || ""
      );
      if (!existingOwnerMetric || stamp > existingOwnerStamp) {
        latestMetricByOwner.set(ownerUserId, row);
      }
    }
  }

  const ownerUserIds = Array.from(
    new Set(
      scopedRows
        .map((row: { camera_id: number; camera_owner_user_id: string }) => {
          const cameraDetails = cameraDetailById.get(row.camera_id);
          return (row.camera_owner_user_id || String((cameraDetails as any)?.user_id || "")).trim();
        })
        .filter((value: string) => value.length > 0)
    )
  );

  const pairingMap = new Map<string, any>();
  const pairingsByOwner = new Map<string, any[]>();
  if (ownerUserIds.length > 0) {
    const pairingPlaceholders = ownerUserIds.map(() => "?").join(", ");
    const { results: pairingRows } = await db
      .prepare(
        `SELECT user_id, client_id, exe_id, status, last_seen_at
         FROM exe_pairings
         WHERE status = 'connected'
           AND user_id IN (${pairingPlaceholders})
         ORDER BY last_seen_at DESC, client_id ASC, exe_id ASC`
      )
      .bind(...ownerUserIds)
      .all();

    for (const row of pairingRows || []) {
      const userId = String((row as any)?.user_id || "").trim();
      const clientId = String((row as any)?.client_id || "").trim();
      const exeId = String((row as any)?.exe_id || "").trim();
      const heartbeat = buildExeHeartbeatSummary(row);
      if (!userId || !clientId || !exeId || !heartbeat.is_heartbeat_fresh) continue;

      const key = `${userId}::${clientId}::${exeId}`;
      pairingMap.set(key, row);
      const bucket = pairingsByOwner.get(userId) || [];
      bucket.push(row);
      pairingsByOwner.set(userId, bucket);
    }
  }

  const resolveFallbackPairing = (cameraOwnerUserId: string) => {
    if (!cameraOwnerUserId) {
      return null;
    }

    const preferredOwnerMetric = latestMetricByOwner.get(cameraOwnerUserId);
    if (preferredOwnerMetric) {
      const preferredClientId = String((preferredOwnerMetric as any)?.client_id || "").trim();
      const preferredExeId = String((preferredOwnerMetric as any)?.exe_id || "").trim();
      const preferredKey = `${cameraOwnerUserId}::${preferredClientId}::${preferredExeId}`;
      const preferredPairing = pairingMap.get(preferredKey);
      if (preferredPairing && preferredClientId && preferredExeId) {
        return {
          ownerUserId: cameraOwnerUserId,
          clientId: preferredClientId,
          exeId: preferredExeId,
          source: "owner_recent_capture_metrics_fallback" as const,
        };
      }
    }

    const ownerPairings = pairingsByOwner.get(cameraOwnerUserId) || [];
    const newestOwnerPairing = ownerPairings[0];
    if (!newestOwnerPairing) {
      return null;
    }

    const fallbackClientId = String((newestOwnerPairing as any)?.client_id || "").trim();
    const fallbackExeId = String((newestOwnerPairing as any)?.exe_id || "").trim();
    if (!fallbackClientId || !fallbackExeId) {
      return null;
    }

    return {
      ownerUserId: cameraOwnerUserId,
      clientId: fallbackClientId,
      exeId: fallbackExeId,
      source: "owner_connected_pairing_fallback" as const,
    };
  };

  const assignments: DrakonFindDispatchAssignment[] = [];
  const unresolved: Array<{ camera_id: number; reason: string }> = [];

  for (const row of scopedRows) {
    const cameraDetails = cameraDetailById.get(row.camera_id);
    if (!cameraDetails) {
      unresolved.push({
        camera_id: row.camera_id,
        reason: "Nao foi possivel carregar a configuracao base da camera para o Drakon Find.",
      });
      continue;
    }

    const cameraOwnerUserId =
      row.camera_owner_user_id.trim() || String((cameraDetails as any)?.user_id || "").trim();
    let resolvedAssignment:
      | {
          ownerUserId: string;
          clientId: string;
          exeId: string;
          source: DrakonFindDispatchAssignment["assignment_source"];
        }
      | null = null;

    const metric = latestMetricByCamera.get(row.camera_id);
    if (metric) {
      const ownerUserId = String((metric as any)?.user_id || "").trim();
      const clientId = String((metric as any)?.client_id || "").trim();
      const exeId = String((metric as any)?.exe_id || "").trim();
      const pairingKey = `${ownerUserId}::${clientId}::${exeId}`;
      const pairing = pairingMap.get(pairingKey);

      if (ownerUserId && clientId && exeId && ownerUserId === cameraOwnerUserId && pairing) {
        resolvedAssignment = {
          ownerUserId,
          clientId,
          exeId,
          source: "camera_capture_metrics",
        };
      }
    }

    if (!resolvedAssignment) {
      resolvedAssignment = resolveFallbackPairing(cameraOwnerUserId);
    }

    if (!resolvedAssignment) {
      unresolved.push({
        camera_id: row.camera_id,
        reason: !cameraOwnerUserId
          ? "Nao foi possivel identificar um dono valido para esta camera publica."
          : !metric
          ? "Camera sem heartbeat proprio; nenhum EXE conectado do dono estava disponivel para start sob demanda."
          : "Nao foi possivel confirmar um EXE conectado para esta camera publica.",
      });
      continue;
    }

    const rawAnalysisSpeed = Number((cameraDetails as any)?.analysis_speed ?? 3);
    const analysisSpeed =
      rawAnalysisSpeed === 1 || rawAnalysisSpeed === 3 || rawAnalysisSpeed === 5 || rawAnalysisSpeed === 10
        ? rawAnalysisSpeed
        : 3;
    const rawPort = (cameraDetails as any)?.rtsp_port;
    const normalizedPort =
      rawPort === null || rawPort === undefined || String(rawPort).trim() === ""
        ? null
        : String(rawPort);
    const webcamIndexRaw = (cameraDetails as any)?.webcam_index;
    const webcamIndex =
      webcamIndexRaw === null || webcamIndexRaw === undefined || Number.isNaN(Number(webcamIndexRaw))
        ? null
        : Number(webcamIndexRaw);
    const retentionDaysRaw = Number((cameraDetails as any)?.retention_days ?? 0);
    const retentionDays = Number.isFinite(retentionDaysRaw) && retentionDaysRaw > 0
      ? Math.max(1, Math.floor(retentionDaysRaw))
      : 1;

    assignments.push({
      camera_id: row.camera_id,
      camera_name: row.camera_name,
      camera_owner_user_id: cameraOwnerUserId,
      city: row.city,
      state_code: row.state_code,
      country_code: row.country_code,
      client_id: resolvedAssignment.clientId,
      exe_id: resolvedAssignment.exeId,
      assignment_source: resolvedAssignment.source,
      was_service_running: Number((cameraDetails as any)?.is_service_running || 0) === 1,
      camera_payload: {
        camera_id: row.camera_id,
        name:
          typeof (cameraDetails as any)?.name === "string" && String((cameraDetails as any).name).trim()
            ? String((cameraDetails as any).name)
            : row.camera_name,
        description:
          typeof (cameraDetails as any)?.description === "string"
            ? String((cameraDetails as any).description)
            : "",
        ip:
          typeof (cameraDetails as any)?.ip_address === "string"
            ? String((cameraDetails as any).ip_address)
            : "",
        port: normalizedPort,
        username:
          typeof (cameraDetails as any)?.username === "string"
            ? String((cameraDetails as any).username)
            : "",
        password:
          typeof (cameraDetails as any)?.password === "string"
            ? String((cameraDetails as any).password)
            : "",
        manufacturer:
          typeof (cameraDetails as any)?.manufacturer === "string"
            ? String((cameraDetails as any).manufacturer)
            : "",
        connection_method:
          typeof (cameraDetails as any)?.connection_method === "string"
            ? String((cameraDetails as any).connection_method)
            : "",
        webcam_index: webcamIndex,
        channel:
          (cameraDetails as any)?.channel === null || (cameraDetails as any)?.channel === undefined
            ? null
            : String((cameraDetails as any).channel),
        subtype:
          (cameraDetails as any)?.subtype === null || (cameraDetails as any)?.subtype === undefined
            ? null
            : String((cameraDetails as any).subtype),
        start_origin: "drakon_find",
        enabled_algorithms: [],
        store_frames: true,
        retention_days: retentionDays,
        frame_rate: 3,
        analysis_speed: analysisSpeed,
        model_tier: normalizeTier(String((cameraDetails as any)?.model_tier || "light")),
      },
    });
  }

  return { assignments, unresolved };
}

function groupDrakonFindAssignmentsByClient(assignments: DrakonFindDispatchAssignment[]) {
  const groups = new Map<
    string,
    {
      camera_owner_user_id: string;
      client_id: string;
      exe_id: string;
      cameras: DrakonFindDispatchAssignment[];
    }
  >();

  for (const assignment of assignments) {
    const key = `${assignment.camera_owner_user_id}::${assignment.client_id}::${assignment.exe_id}`;
    const bucket =
      groups.get(key) ||
      ({
        camera_owner_user_id: assignment.camera_owner_user_id,
        client_id: assignment.client_id,
        exe_id: assignment.exe_id,
        cameras: [],
      } as {
        camera_owner_user_id: string;
        client_id: string;
        exe_id: string;
        cameras: DrakonFindDispatchAssignment[];
      });
    bucket.cameras.push(assignment);
    groups.set(key, bucket);
  }

  return Array.from(groups.values()).sort((left, right) =>
    `${left.camera_owner_user_id}:${left.client_id}`.localeCompare(
      `${right.camera_owner_user_id}:${right.client_id}`
    )
  );
}

function buildDrakonFindDispatchWaitMessage(
  scopeState: "queued" | "dispatching" | "running",
  reason: "blocked_client" | "unresolved_assignment"
) {
  if (scopeState === "running") {
    return reason === "blocked_client"
      ? "Uma parte do escopo ja esta ao vivo; outras cameras aguardam slot livre nos clientes elegiveis."
      : "Uma parte do escopo ja esta ao vivo; outras cameras ainda aguardam roteamento para um cliente elegivel.";
  }
  if (scopeState === "dispatching") {
    return reason === "blocked_client"
      ? "Parte do escopo ja foi despachada; outras cameras aguardam slot livre nos clientes elegiveis."
      : "Parte do escopo ja foi despachada; outras cameras ainda aguardam roteamento para um cliente elegivel.";
  }
  return reason === "blocked_client"
    ? "Aguardando slot livre nos clientes elegiveis para continuar a distribuicao."
    : "Ainda existem cameras aguardando roteamento para um cliente elegivel.";
}

async function refreshDrakonFindSearchRollups(db: D1Database, searchId: number) {
  if (!Number.isInteger(searchId) || searchId <= 0) return null;

  const aggregate = await db
    .prepare(
      `SELECT
         COUNT(*) AS total_cameras,
         SUM(CASE WHEN dispatch_status IN ('completed', 'failed', 'cancelled', 'skipped') THEN 1 ELSE 0 END) AS terminal_camera_count,
         SUM(CASE WHEN dispatch_status = 'completed' THEN 1 ELSE 0 END) AS successful_camera_count,
         SUM(CASE WHEN dispatch_status = 'failed' THEN 1 ELSE 0 END) AS failed_camera_count,
         SUM(CASE WHEN dispatch_status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_camera_count,
         SUM(CASE WHEN dispatch_status = 'skipped' THEN 1 ELSE 0 END) AS skipped_camera_count,
         SUM(CASE WHEN dispatch_status = 'running' THEN 1 ELSE 0 END) AS running_camera_count,
         SUM(CASE WHEN dispatch_status = 'sent' THEN 1 ELSE 0 END) AS sent_camera_count,
         SUM(CASE WHEN dispatch_status = 'queued' THEN 1 ELSE 0 END) AS queued_camera_count,
         SUM(CASE WHEN match_count > 0 THEN 1 ELSE 0 END) AS matched_camera_count,
         COUNT(DISTINCT CASE WHEN dispatch_command_id IS NOT NULL THEN dispatch_command_id END) AS dispatched_command_count,
         MAX(last_event_at) AS last_event_at
       FROM drakon_find_search_cameras
       WHERE search_id = ?`
    )
    .bind(searchId)
    .first();

  const hitAggregate = await db
    .prepare(
      `SELECT COUNT(*) AS hit_count
       FROM drakon_find_hits
       WHERE search_id = ?`
    )
    .bind(searchId)
    .first();

  const totalCameras = clampInteger((aggregate as any)?.total_cameras);
  const terminalCameraCount = clampInteger((aggregate as any)?.terminal_camera_count);
  const matchedCameraCount = clampInteger((aggregate as any)?.matched_camera_count);
  const dispatchedCommandCount = clampInteger((aggregate as any)?.dispatched_command_count);
  const hitCount = clampInteger((hitAggregate as any)?.hit_count);
  const lastEventAt =
    typeof (aggregate as any)?.last_event_at === "string"
      ? String((aggregate as any).last_event_at)
      : null;

  await db
    .prepare(
      `UPDATE drakon_find_searches
       SET dispatched_command_count = ?,
           completed_camera_count = ?,
           matched_camera_count = ?,
           hit_count = ?,
           last_event_at = COALESCE(?, last_event_at),
           updated_at = ?
       WHERE id = ?`
    )
    .bind(
      dispatchedCommandCount,
      terminalCameraCount,
      matchedCameraCount,
      hitCount,
      lastEventAt,
      new Date().toISOString(),
      searchId
    )
    .run();

  return {
    total_cameras: totalCameras,
    terminal_camera_count: terminalCameraCount,
    successful_camera_count: clampInteger((aggregate as any)?.successful_camera_count),
    failed_camera_count: clampInteger((aggregate as any)?.failed_camera_count),
    cancelled_camera_count: clampInteger((aggregate as any)?.cancelled_camera_count),
    skipped_camera_count: clampInteger((aggregate as any)?.skipped_camera_count),
    running_camera_count: clampInteger((aggregate as any)?.running_camera_count),
    sent_camera_count: clampInteger((aggregate as any)?.sent_camera_count),
    queued_camera_count: clampInteger((aggregate as any)?.queued_camera_count),
    matched_camera_count: matchedCameraCount,
    dispatched_command_count: dispatchedCommandCount,
    hit_count: hitCount,
    last_event_at: lastEventAt,
  };
}

async function finalizeDrakonFindSearchIfTerminal(db: D1Database, searchId: number) {
  if (!Number.isInteger(searchId) || searchId <= 0) return;

  const rollups = await refreshDrakonFindSearchRollups(db, searchId);
  if (!rollups) return;

  const search = await db
    .prepare(
      `SELECT id, user_id, target_id, status, completed_at, cancelled_at, last_error
       FROM drakon_find_searches
       WHERE id = ?
       LIMIT 1`
    )
    .bind(searchId)
    .first();

  if (!search) return;

  const currentStatus = String((search as any)?.status || "queued");
  const currentCancelledAt =
    typeof (search as any)?.cancelled_at === "string" && String((search as any)?.cancelled_at).trim()
      ? String((search as any).cancelled_at)
      : null;
  if (rollups.total_cameras <= 0 || rollups.terminal_camera_count < rollups.total_cameras) {
    return;
  }

  let nextStatus = currentStatus;
  if (currentStatus === "cancelled" || currentCancelledAt) {
    nextStatus = "cancelled";
  } else if (rollups.successful_camera_count <= 0 && rollups.hit_count <= 0) {
    nextStatus = "failed";
  } else {
    nextStatus = "completed";
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE drakon_find_searches
       SET status = ?,
           completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE completed_at END,
           cancelled_at = CASE WHEN ? = 'cancelled' THEN COALESCE(cancelled_at, ?) ELSE cancelled_at END,
           updated_at = ?
       WHERE id = ?`
    )
    .bind(nextStatus, nextStatus, now, nextStatus, now, now, searchId)
    .run();
}

async function cancelQueuedDrakonFindSearchCameras(
  db: D1Database,
  searchId: number,
  now: string
) {
  if (!Number.isInteger(searchId) || searchId <= 0) return 0;

  const result = await db
    .prepare(
      `UPDATE drakon_find_search_cameras
       SET dispatch_status = 'cancelled',
           last_error = NULL,
           completed_at = COALESCE(completed_at, ?),
           updated_at = ?
       WHERE search_id = ?
         AND dispatch_status = 'queued'`
    )
    .bind(now, now, searchId)
    .run();

  return clampInteger((result.meta as any)?.changes);
}

async function reconcileDrakonFindSearchClientTerminalState(
  db: D1Database,
  args: {
    searchId: number;
    clientId: string;
    exeId?: string | null;
    dispatchStatus: "completed" | "cancelled" | "failed";
    lastEventType: string;
    now: string;
    lastError?: string | null;
  }
) {
  const searchId = Number(args.searchId);
  const clientId = typeof args.clientId === "string" ? args.clientId.trim() : "";
  const exeId = typeof args.exeId === "string" ? args.exeId.trim() : "";
  if (!Number.isInteger(searchId) || searchId <= 0 || !clientId) {
    return 0;
  }

  const result = exeId
    ? await db
        .prepare(
          `UPDATE drakon_find_search_cameras
           SET assigned_client_id = COALESCE(NULLIF(assigned_client_id, ''), ?),
               assigned_exe_id = COALESCE(NULLIF(assigned_exe_id, ''), ?),
               dispatch_status = ?,
               last_event_type = ?,
               last_event_at = ?,
               last_error = ?,
               completed_at = COALESCE(completed_at, ?),
               updated_at = ?
           WHERE search_id = ?
             AND COALESCE(NULLIF(assigned_client_id, ''), ?) = ?
             AND COALESCE(NULLIF(assigned_exe_id, ''), ?) = ?
             AND dispatch_status IN ('sent', 'running', 'cancel_requested')`
        )
        .bind(
          clientId,
          exeId,
          args.dispatchStatus,
          args.lastEventType,
          args.now,
          args.lastError ?? null,
          args.now,
          args.now,
          searchId,
          clientId,
          clientId,
          exeId,
          exeId
        )
        .run()
    : await db
        .prepare(
          `UPDATE drakon_find_search_cameras
           SET assigned_client_id = COALESCE(NULLIF(assigned_client_id, ''), ?),
               dispatch_status = ?,
               last_event_type = ?,
               last_event_at = ?,
               last_error = ?,
               completed_at = COALESCE(completed_at, ?),
               updated_at = ?
           WHERE search_id = ?
             AND COALESCE(NULLIF(assigned_client_id, ''), ?) = ?
             AND dispatch_status IN ('sent', 'running', 'cancel_requested')`
        )
        .bind(
          clientId,
          args.dispatchStatus,
          args.lastEventType,
          args.now,
          args.lastError ?? null,
          args.now,
          args.now,
          searchId,
          clientId,
          clientId
        )
        .run();

  return clampInteger((result.meta as any)?.changes);
}

async function dispatchSingleDrakonFindSearch(env: Env, searchId: number) {
  const search = await fetchDrakonFindSearchForDispatch(env.DB, searchId);
  if (!search) {
    return { searchId, dispatched_command_count: 0, status: "missing" };
  }

  if (["completed", "cancelled", "failed"].includes(search.status)) {
    return {
      searchId,
      dispatched_command_count: 0,
      status: search.status,
    };
  }

  const now = new Date().toISOString();
  let modelConfig: Awaited<ReturnType<typeof chooseDrakonFindModelConfig>>;
  try {
    modelConfig = await chooseDrakonFindModelConfig(env.DB, search.user_id);
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "OpenAI API key is not configured in Settings.";
    await env.DB
      .prepare(
        `UPDATE drakon_find_searches
         SET status = 'failed',
             last_error = ?,
             completed_at = COALESCE(completed_at, ?),
             updated_at = ?
         WHERE id = ?`
      )
      .bind(message, now, now, searchId)
      .run();
    await createDrakonFindAuditLog(env.DB, {
      actorUserId: search.user_id,
      actionType: "search_dispatch_failed",
      searchId,
      targetId: search.target_id,
      message: `Dispatch falhou para "${search.target_name}" por falta de configuracao do modelo.`,
      metadata: {
        error: message,
        stage: "model_config",
      },
    });
    return { searchId, dispatched_command_count: 0, status: "failed", error: message };
  }

  const referenceImages = await loadDrakonFindReferenceImagesForDispatch(env, search.target_id);
  const { assignments, unresolved } = await resolveDrakonFindAssignmentsForSearch(env.DB, searchId);
  const effectiveRunUntil =
    search.run_until ||
    new Date(
      Date.now() + normalizeDrakonFindDurationSeconds(search.duration_seconds) * 1000
    ).toISOString();

  if (!search.run_until) {
    await env.DB
      .prepare(
        `UPDATE drakon_find_searches
         SET run_until = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(effectiveRunUntil, now, searchId)
      .run();
  }

  for (const unresolvedCamera of unresolved) {
    await env.DB
      .prepare(
        `UPDATE drakon_find_search_cameras
         SET dispatch_status = 'skipped',
             last_error = ?,
             completed_at = COALESCE(completed_at, ?),
             updated_at = ?
         WHERE search_id = ? AND camera_id = ?`
      )
      .bind(unresolvedCamera.reason, now, now, searchId, unresolvedCamera.camera_id)
      .run();
  }

  const searchPrompt = buildDrakonFindSearchPrompt({
    entity_type: search.target_entity_type,
    name: search.target_name,
    description: search.target_description,
    traits: search.target_traits,
  });
  const groupedAssignments = groupDrakonFindAssignmentsByClient(assignments);
  let dispatchedCommandCount = 0;
  let blockedClientCount = 0;

  for (const group of groupedAssignments) {
    const clientLoad = await env.DB
      .prepare(
        `SELECT COUNT(DISTINCT sc.search_id) AS active_search_count
         FROM drakon_find_search_cameras sc
         JOIN drakon_find_searches s ON s.id = sc.search_id
         WHERE sc.camera_owner_user_id = ?
           AND sc.assigned_client_id = ?
           AND sc.dispatch_status IN ('sent', 'running', 'cancel_requested')
           AND s.status IN ('dispatching', 'running', 'cancelled')
           AND sc.search_id <> ?`
      )
      .bind(group.camera_owner_user_id, group.client_id, searchId)
      .first();

    const activeSearchCount = clampInteger((clientLoad as any)?.active_search_count);
    if (activeSearchCount >= DRAKON_FIND_MAX_ACTIVE_SEARCHES_PER_CLIENT) {
      blockedClientCount += 1;
      continue;
    }

    const camerasForCommand = group.cameras.slice(0, DRAKON_FIND_MAX_PARALLEL_CAMERAS_PER_CLIENT);
    if (camerasForCommand.length === 0) {
      continue;
    }

    const payload = {
      search_id: search.id,
      target_id: search.target_id,
      operator_user_id: search.user_id,
      attempt_count: search.attempt_count,
      runtime_mode: search.runtime_mode,
      input_type: search.input_type || "video",
      window_seconds: Math.max(1, search.window_seconds || DRAKON_FIND_WINDOW_SECONDS),
      duration_seconds: normalizeDrakonFindDurationSeconds(search.duration_seconds),
      run_until: effectiveRunUntil,
      target: {
        id: search.target_id,
        entity_type: search.target_entity_type,
        name: search.target_name,
        description: search.target_description,
        traits: search.target_traits,
      },
      search_prompt: searchPrompt,
      reference_images: referenceImages.map((image) => ({
        image_id: image.image_id,
        image_url: image.image_url,
        content_type: image.content_type,
        data_url: image.data_url,
      })),
      camera_assignments: camerasForCommand.map((camera) => ({
        camera_id: camera.camera_id,
        camera_name: camera.camera_name,
        camera_owner_user_id: camera.camera_owner_user_id,
        assignment_source: camera.assignment_source,
        city: camera.city,
        state_code: camera.state_code,
        country_code: camera.country_code,
        was_service_running: camera.was_service_running,
        camera_payload: camera.camera_payload,
      })),
      model_name: modelConfig.model_name,
      model_api_key: modelConfig.model_api_key,
      model_provider: modelConfig.provider,
      model_fps: modelConfig.model_fps,
      max_hits_hint: DRAKON_FIND_MAX_HITS_PER_SEARCH,
    };

    const insertResult = await env.DB
      .prepare(
        `INSERT INTO commands (
           user_id,
           camera_id,
           command_type,
           payload,
           status,
           created_at,
           updated_at,
           target_client_id,
           target_exe_id
         )
         VALUES (?, NULL, 'drakon_find_start', ?, 'pending', ?, ?, ?, ?)`
      )
      .bind(
        group.camera_owner_user_id,
        JSON.stringify(payload),
        now,
        now,
        group.client_id,
        group.exe_id
      )
      .run();

    const commandId = Number(insertResult.meta.last_row_id || 0);
    if (!Number.isInteger(commandId) || commandId <= 0) {
      continue;
    }

    dispatchedCommandCount += 1;

    for (const camera of camerasForCommand) {
      await env.DB
        .prepare(
          `UPDATE drakon_find_search_cameras
           SET assigned_client_id = ?,
               assigned_exe_id = ?,
               dispatch_status = 'sent',
               dispatch_command_id = ?,
               last_error = NULL,
               attempt_count = COALESCE(attempt_count, 0) + 1,
               updated_at = ?
           WHERE search_id = ? AND camera_id = ?`
        )
        .bind(group.client_id, group.exe_id, commandId, now, searchId, camera.camera_id)
        .run();
    }
  }

  const rollupsAfterDispatch = await refreshDrakonFindSearchRollups(env.DB, searchId);
  const queuedCameraCount = clampInteger(rollupsAfterDispatch?.queued_camera_count);
  const sentCameraCount = clampInteger(rollupsAfterDispatch?.sent_camera_count);
  const runningCameraCount = clampInteger(rollupsAfterDispatch?.running_camera_count);
  const hasQueuedCameras = queuedCameraCount > 0;
  const hasInflightDispatch = sentCameraCount > 0;
  const hasLiveRuntime = runningCameraCount > 0;

  let nextStatus = search.status;
  let lastError: string | null = null;
  if (hasLiveRuntime) {
    nextStatus = "running";
    if (hasQueuedCameras) {
      lastError = buildDrakonFindDispatchWaitMessage(
        "running",
        blockedClientCount > 0 ? "blocked_client" : "unresolved_assignment"
      );
    }
  } else if (dispatchedCommandCount > 0 || hasInflightDispatch) {
    nextStatus = "dispatching";
    if (hasQueuedCameras) {
      lastError = buildDrakonFindDispatchWaitMessage(
        "dispatching",
        blockedClientCount > 0 ? "blocked_client" : "unresolved_assignment"
      );
    }
  } else if (hasQueuedCameras) {
    nextStatus = "queued";
    lastError = buildDrakonFindDispatchWaitMessage(
      "queued",
      blockedClientCount > 0 ? "blocked_client" : "unresolved_assignment"
    );
  }

  await env.DB
    .prepare(
      `UPDATE drakon_find_searches
       SET status = ?,
           started_at = CASE
             WHEN ? > 0 THEN COALESCE(started_at, ?)
             ELSE started_at
           END,
           last_dispatch_at = CASE WHEN ? > 0 THEN ? ELSE last_dispatch_at END,
           last_error = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .bind(nextStatus, dispatchedCommandCount, now, dispatchedCommandCount, now, lastError, now, searchId)
    .run();

  if (dispatchedCommandCount > 0) {
    await createDrakonFindAuditLog(env.DB, {
      actorUserId: search.user_id,
      actionType: "search_dispatched",
      searchId,
      targetId: search.target_id,
      message: `Busca "${search.target_name}" distribuida para ${dispatchedCommandCount} EXE(s).`,
      metadata: {
        dispatched_command_count: dispatchedCommandCount,
        reference_image_count: referenceImages.length,
      },
    });
  }

  await finalizeDrakonFindSearchIfTerminal(env.DB, searchId);

  return {
    searchId,
    dispatched_command_count: dispatchedCommandCount,
    queued_camera_count: queuedCameraCount,
    blocked_client_count: blockedClientCount,
    status: nextStatus,
  };
}

async function dispatchQueuedDrakonFindSearches(env: Env) {
  const { results } = await env.DB
    .prepare(
      `SELECT id, user_id, status
       FROM drakon_find_searches
       WHERE status IN ('queued', 'dispatching', 'running')
       ORDER BY created_at ASC, id ASC
       LIMIT 20`
    )
    .all();

  for (const row of results || []) {
    const searchId = Number((row as any)?.id || 0);
    const userId = String((row as any)?.user_id || "");
    const status = String((row as any)?.status || "queued");
    if (!Number.isInteger(searchId) || searchId <= 0 || !userId) continue;

    if (status === "queued") {
      const activeSearchRow = await env.DB
        .prepare(
          `SELECT COUNT(DISTINCT s.id) AS active_search_count
           FROM drakon_find_searches s
           LEFT JOIN drakon_find_search_cameras sc
             ON sc.search_id = s.id
           WHERE s.user_id = ?
             AND s.id <> ?
             AND (
               s.status IN ('dispatching', 'running')
               OR (
                 s.status = 'cancelled'
                 AND sc.dispatch_status IN ('sent', 'running', 'cancel_requested')
               )
             )`
        )
        .bind(userId, searchId)
        .first();
      const activeSearchCount = clampInteger((activeSearchRow as any)?.active_search_count);
      if (activeSearchCount >= DRAKON_FIND_MAX_ACTIVE_SEARCHES_PER_OPERATOR) {
        continue;
      }
    }

    await dispatchSingleDrakonFindSearch(env, searchId);
  }
}

async function requestDrakonFindSearchCancellation(
  env: Env,
  userId: string,
  searchId: number
) {
  const search = await fetchDrakonFindSearchForDispatch(env.DB, searchId);
  if (!search || search.user_id !== userId) {
    return { ok: false, status: 404, error: "Drakon Find search not found" };
  }

  if (["completed", "failed", "cancelled"].includes(search.status)) {
    return { ok: true, search };
  }

  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `UPDATE drakon_find_searches
       SET status = 'cancelled',
           cancelled_at = COALESCE(cancelled_at, ?),
           last_error = NULL,
           updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
    .bind(now, now, searchId, userId)
    .run();

  await env.DB
    .prepare(
      `UPDATE drakon_find_search_cameras
       SET dispatch_status = CASE
             WHEN dispatch_status IN ('sent', 'running') THEN 'cancel_requested'
             ELSE dispatch_status
           END,
           updated_at = ?
       WHERE search_id = ?`
    )
    .bind(now, searchId)
    .run();

  await cancelQueuedDrakonFindSearchCameras(env.DB, searchId, now);

  const { results: clientRows } = await env.DB
    .prepare(
      `SELECT
         camera_owner_user_id,
         assigned_client_id,
         assigned_exe_id
       FROM drakon_find_search_cameras
       WHERE search_id = ?
         AND assigned_client_id IS NOT NULL
         AND TRIM(assigned_client_id) <> ''
         AND dispatch_status IN ('cancel_requested', 'sent', 'running')
       GROUP BY camera_owner_user_id, assigned_client_id, assigned_exe_id`
    )
    .bind(searchId)
    .all();

  for (const row of clientRows || []) {
    const cameraOwnerUserId = String((row as any)?.camera_owner_user_id || "");
    const clientId = String((row as any)?.assigned_client_id || "");
    const exeId = String((row as any)?.assigned_exe_id || "");
    if (!cameraOwnerUserId || !clientId) continue;

    await env.DB
      .prepare(
        `INSERT INTO commands (
           user_id,
           camera_id,
           command_type,
           payload,
           status,
           created_at,
           updated_at,
           target_client_id,
           target_exe_id
         )
         VALUES (?, NULL, 'drakon_find_cancel', ?, 'pending', ?, ?, ?, ?)`
      )
      .bind(
        cameraOwnerUserId,
        JSON.stringify({
          search_id: searchId,
          operator_user_id: userId,
          attempt_count: search.attempt_count,
        }),
        now,
        now,
        clientId,
        exeId || null
      )
      .run();
  }

  await createDrakonFindAuditLog(env.DB, {
    actorUserId: userId,
    actionType: "search_cancel_requested",
    searchId,
    targetId: search.target_id,
    message: `Cancelamento solicitado para "${search.target_name}".`,
    metadata: {
      status_before: search.status,
    },
  });

  await finalizeDrakonFindSearchIfTerminal(env.DB, searchId);
  return { ok: true };
}

async function deleteDrakonFindHitMediaFromStorage(
  env: Env,
  searchId: number,
  reason: "retry" | "delete"
) {
  const { results: hitRows } = await env.DB
    .prepare(
      `SELECT image_key, video_key
       FROM drakon_find_hits
       WHERE search_id = ?`
    )
    .bind(searchId)
    .all();

  for (const row of hitRows || []) {
    const imageKey = typeof (row as any)?.image_key === "string" ? String((row as any).image_key) : "";
    if (!imageKey) continue;
    try {
      await env.R2_BUCKET.delete(imageKey);
    } catch (error) {
      console.warn(`[DRAKON FIND] Failed to delete ${reason} hit image from R2`, {
        searchId,
        imageKey,
        error,
      });
    }
  }

  for (const row of hitRows || []) {
    const videoKey = typeof (row as any)?.video_key === "string" ? String((row as any).video_key) : "";
    if (!videoKey) continue;
    try {
      await env.R2_BUCKET.delete(videoKey);
    } catch (error) {
      console.warn(`[DRAKON FIND] Failed to delete ${reason} hit video from R2`, {
        searchId,
        videoKey,
        error,
      });
    }
  }
}

async function deleteDrakonFindStorageObject(
  env: Env,
  storageKey: string,
  failureLabel: string,
  details: Record<string, unknown>
) {
  if (!storageKey || !env.R2_BUCKET || typeof env.R2_BUCKET.delete !== "function") {
    return;
  }
  try {
    await env.R2_BUCKET.delete(storageKey);
  } catch (error) {
    console.warn(failureLabel, {
      ...details,
      storageKey,
      error,
    });
  }
}

async function deleteDrakonFindTarget(env: Env, userId: string, targetId: number) {
  const targetRow = await env.DB
    .prepare(
      `SELECT
         t.id,
         t.name,
         (
           SELECT COUNT(*)
           FROM drakon_find_searches s
           WHERE s.target_id = t.id
             AND s.user_id = t.user_id
         ) AS search_count
       FROM drakon_find_targets t
       WHERE t.id = ? AND t.user_id = ?
       LIMIT 1`
    )
    .bind(targetId, userId)
    .first();

  if (!targetRow) {
    return { ok: false, status: 404, error: "Drakon Find target not found" };
  }

  const searchCount = clampInteger((targetRow as any)?.search_count);
  if (searchCount > 0) {
    return {
      ok: false,
      status: 409,
      error:
        searchCount === 1
          ? "Este target ainda possui 1 busca vinculada. Exclua a busca antes de remover o target."
          : `Este target ainda possui ${searchCount} buscas vinculadas. Exclua as buscas antes de remover o target.`,
    };
  }

  const { results: imageRows } = await env.DB
    .prepare(
      `SELECT id, storage_key
       FROM drakon_find_target_images
       WHERE target_id = ?`
    )
    .bind(targetId)
    .all();

  try {
    await env.DB
      .prepare("DELETE FROM drakon_find_targets WHERE id = ? AND user_id = ?")
      .bind(targetId, userId)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (/FOREIGN KEY/i.test(message)) {
      return {
        ok: false,
        status: 409,
        error: "Este target ganhou uma busca vinculada durante a exclusao. Atualize a tela e tente novamente.",
      };
    }
    throw error;
  }

  for (const row of imageRows || []) {
    const storageKey =
      typeof (row as any)?.storage_key === "string" ? String((row as any).storage_key) : "";
    if (!storageKey) continue;
    await deleteDrakonFindStorageObject(
      env,
      storageKey,
      "[DRAKON FIND] Failed to delete target image from R2",
      {
        targetId,
        imageId: Number((row as any)?.id || 0),
      }
    );
  }

  await createDrakonFindAuditLog(env.DB, {
    actorUserId: userId,
    actionType: "target_deleted",
    targetId,
    message: `Target "${String((targetRow as any)?.name || "").trim()}" removido do catalogo.`,
  });

  return { ok: true };
}

async function deleteDrakonFindHit(env: Env, userId: string, hitId: number) {
  const hitRow = await env.DB
    .prepare(
      `SELECT
         h.id,
         h.search_id,
         h.target_id,
         h.camera_id,
         h.summary,
         h.image_key,
         h.video_key,
         t.name AS target_name
       FROM drakon_find_hits h
       JOIN drakon_find_searches s ON s.id = h.search_id
       LEFT JOIN drakon_find_targets t ON t.id = h.target_id
       WHERE h.id = ? AND s.user_id = ?
       LIMIT 1`
    )
    .bind(hitId, userId)
    .first();

  if (!hitRow) {
    return { ok: false, status: 404, error: "Drakon Find hit not found" };
  }

  const searchId = Number((hitRow as any)?.search_id || 0);
  const targetId = Number((hitRow as any)?.target_id || 0);
  const cameraId = Number((hitRow as any)?.camera_id || 0);
  const imageKey =
    typeof (hitRow as any)?.image_key === "string" ? String((hitRow as any).image_key) : "";
  const videoKey =
    typeof (hitRow as any)?.video_key === "string" ? String((hitRow as any).video_key) : "";
  await env.DB.prepare("DELETE FROM drakon_find_hits WHERE id = ?").bind(hitId).run();

  const now = new Date().toISOString();
  const remainingCameraHitRow = await env.DB
    .prepare(
      `SELECT COUNT(*) AS hit_count
       FROM drakon_find_hits
       WHERE search_id = ? AND camera_id = ?`
    )
    .bind(searchId, cameraId)
    .first();
  const remainingCameraHitCount = clampInteger((remainingCameraHitRow as any)?.hit_count);

  await env.DB
    .prepare(
      `UPDATE drakon_find_search_cameras
       SET match_count = ?,
           updated_at = ?
       WHERE search_id = ? AND camera_id = ?`
    )
    .bind(remainingCameraHitCount, now, searchId, cameraId)
    .run();

  const remainingHitRow = await env.DB
    .prepare(
      `SELECT COUNT(*) AS hit_count
       FROM drakon_find_hits
       WHERE search_id = ?`
    )
    .bind(searchId)
    .first();
  const matchedCameraRow = await env.DB
    .prepare(
      `SELECT COUNT(*) AS matched_camera_count
       FROM drakon_find_search_cameras
       WHERE search_id = ?
         AND match_count > 0`
    )
    .bind(searchId)
    .first();

  await env.DB
    .prepare(
      `UPDATE drakon_find_searches
       SET hit_count = ?,
           matched_camera_count = ?,
           updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
    .bind(
      clampInteger((remainingHitRow as any)?.hit_count),
      clampInteger((matchedCameraRow as any)?.matched_camera_count),
      now,
      searchId,
      userId
    )
    .run();

  if (imageKey) {
    await deleteDrakonFindStorageObject(
      env,
      imageKey,
      "[DRAKON FIND] Failed to delete hit image from R2",
      { hitId, searchId, cameraId }
    );
  }
  if (videoKey) {
    await deleteDrakonFindStorageObject(
      env,
      videoKey,
      "[DRAKON FIND] Failed to delete hit video from R2",
      { hitId, searchId, cameraId }
    );
  }

  await createDrakonFindAuditLog(env.DB, {
    actorUserId: userId,
    actionType: "search_hit_deleted",
    searchId,
    targetId,
    message: `Hit #${hitId} removido de "${String((hitRow as any)?.target_name || "").trim() || "target"}".`,
    metadata: {
      camera_id: cameraId,
      summary: String((hitRow as any)?.summary || ""),
    },
  });

  return { ok: true };
}

async function retryDrakonFindSearch(env: Env, userId: string, searchId: number) {
  const search = await fetchDrakonFindSearchForDispatch(env.DB, searchId);
  if (!search || search.user_id !== userId) {
    return { ok: false, status: 404, error: "Drakon Find search not found" };
  }

  if (["queued", "dispatching", "running"].includes(search.status)) {
    return {
      ok: false,
      status: 409,
      error: "A busca ainda esta ativa. Cancele ou aguarde a conclusao antes do retry.",
    };
  }

  const activeCameraRow = await env.DB
    .prepare(
      `SELECT COUNT(*) AS active_camera_count
       FROM drakon_find_search_cameras
       WHERE search_id = ?
         AND dispatch_status IN ('sent', 'running', 'cancel_requested')`
    )
    .bind(searchId)
    .first();
  const activeCameraCount = clampInteger((activeCameraRow as any)?.active_camera_count);
  if (activeCameraCount > 0) {
    return {
      ok: false,
      status: 409,
      error: `Ainda existem ${activeCameraCount} camera(s) finalizando o ciclo anterior. Aguarde o encerramento completo antes do retry.`,
    };
  }

  const modelCheck = await chooseDrakonFindModelConfig(env.DB, userId).catch((error) => error);
  if (modelCheck instanceof Error) {
    return {
      ok: false,
      status: 400,
      error: modelCheck.message || OPENAI_KEY_REQUIRED_MESSAGE,
    };
  }

  await deleteDrakonFindHitMediaFromStorage(env, searchId, "retry");

  const now = new Date().toISOString();
  const nextRunUntil = new Date(
    Date.now() + normalizeDrakonFindDurationSeconds(search.duration_seconds) * 1000
  ).toISOString();
  await env.DB.prepare(`DELETE FROM drakon_find_hits WHERE search_id = ?`).bind(searchId).run();

  await env.DB
    .prepare(
      `UPDATE drakon_find_search_cameras
       SET assigned_client_id = NULL,
           assigned_exe_id = NULL,
           dispatch_status = 'queued',
           dispatch_command_id = NULL,
           last_event_type = NULL,
           last_event_at = NULL,
           last_error = NULL,
           started_at = NULL,
           completed_at = NULL,
           match_count = 0,
           attempt_count = 0,
           updated_at = ?
       WHERE search_id = ?`
    )
    .bind(now, searchId)
    .run();

  await env.DB
    .prepare(
      `UPDATE drakon_find_searches
       SET status = 'queued',
           attempt_count = COALESCE(attempt_count, 0) + 1,
           dispatched_command_count = 0,
           completed_camera_count = 0,
           matched_camera_count = 0,
           hit_count = 0,
           last_event_at = NULL,
           last_dispatch_at = NULL,
           last_error = NULL,
           started_at = NULL,
           completed_at = NULL,
           cancelled_at = NULL,
           run_until = ?,
           updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
    .bind(nextRunUntil, now, searchId, userId)
    .run();

  await createDrakonFindAuditLog(env.DB, {
    actorUserId: userId,
    actionType: "search_retried",
    searchId,
    targetId: search.target_id,
      message: `Retry solicitado para "${search.target_name}".`,
      metadata: {
        previous_status: search.status,
        duration_seconds: normalizeDrakonFindDurationSeconds(search.duration_seconds),
        run_until: nextRunUntil,
      },
    });

  await dispatchQueuedDrakonFindSearches(env);
  return { ok: true };
}

async function deleteDrakonFindSearch(env: Env, userId: string, searchId: number) {
  const search = await fetchDrakonFindSearchForDispatch(env.DB, searchId);
  if (!search || search.user_id !== userId) {
    return { ok: false, status: 404, error: "Drakon Find search not found" };
  }

  if (["queued", "dispatching", "running"].includes(search.status)) {
    return {
      ok: false,
      status: 409,
      error: "A busca ainda esta ativa. Cancele ou aguarde a conclusao antes de excluir.",
    };
  }

  const activeCameraRow = await env.DB
    .prepare(
      `SELECT COUNT(*) AS active_camera_count
       FROM drakon_find_search_cameras
       WHERE search_id = ?
         AND dispatch_status IN ('sent', 'running', 'cancel_requested')`
    )
    .bind(searchId)
    .first();
  const activeCameraCount = clampInteger((activeCameraRow as any)?.active_camera_count);
  if (activeCameraCount > 0) {
    return {
      ok: false,
      status: 409,
      error: `Ainda existem ${activeCameraCount} camera(s) finalizando o ciclo anterior. Aguarde o encerramento completo antes de excluir.`,
    };
  }

  await deleteDrakonFindHitMediaFromStorage(env, searchId, "delete");
  await env.DB.prepare(`DELETE FROM drakon_find_hits WHERE search_id = ?`).bind(searchId).run();
  await env.DB.prepare(`DELETE FROM drakon_find_search_cameras WHERE search_id = ?`).bind(searchId).run();
  await env.DB.prepare(`DELETE FROM drakon_find_searches WHERE id = ? AND user_id = ?`).bind(searchId, userId).run();

  return { ok: true };
}

async function handleDrakonFindAgentEvent(
  env: Env,
  options: {
    eventType: string;
    clientId: string;
    exeId: string;
    cameraId: number | null;
    message: string;
    details: Record<string, unknown>;
    receivedAt: string;
  }
) {
  const details = options.details || {};
  const searchId = Number((details as any)?.search_id || (details as any)?.searchId || 0);
  if (!Number.isInteger(searchId) || searchId <= 0) {
    return { recorded: false, reason: "missing_search_id" };
  }

  const search = await fetchDrakonFindSearchForDispatch(env.DB, searchId);
  if (!search) {
    return { recorded: false, reason: "search_not_found" };
  }

  const targetId =
    Number((details as any)?.target_id || (details as any)?.targetId || search.target_id) ||
    search.target_id;
  const currentAttemptCount = Math.max(1, clampInteger(search.attempt_count, 1));
  const eventAttemptCount = Math.max(
    1,
    clampInteger((details as any)?.attempt_count ?? (details as any)?.attemptCount, currentAttemptCount)
  );
  if (eventAttemptCount !== currentAttemptCount) {
    return {
      recorded: false,
      reason: "stale_attempt",
      search_id: searchId,
      expected_attempt_count: currentAttemptCount,
      event_attempt_count: eventAttemptCount,
    };
  }
  const currentStatus = search.status;
  const now = options.receivedAt;
  const safeMessage =
    (typeof options.message === "string" && options.message.trim()) ||
    (typeof (details as any)?.error === "string" && String((details as any).error).trim()) ||
    "";

  const updateSearchRow = async (
    patch: Partial<{
      status: string;
      started_at: string | null;
      completed_at: string | null;
      cancelled_at: string | null;
      last_error: string | null;
    }>
  ) => {
    const hasStatus = Object.prototype.hasOwnProperty.call(patch, "status");
    const hasStartedAt = Object.prototype.hasOwnProperty.call(patch, "started_at");
    const hasCompletedAt = Object.prototype.hasOwnProperty.call(patch, "completed_at");
    const hasCancelledAt = Object.prototype.hasOwnProperty.call(patch, "cancelled_at");
    const hasLastError = Object.prototype.hasOwnProperty.call(patch, "last_error");
    await env.DB
      .prepare(
        `UPDATE drakon_find_searches
         SET status = CASE WHEN ? = 1 THEN ? ELSE status END,
             started_at = CASE WHEN ? = 1 THEN ? ELSE started_at END,
             completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END,
             cancelled_at = CASE WHEN ? = 1 THEN ? ELSE cancelled_at END,
             last_error = CASE WHEN ? = 1 THEN ? ELSE last_error END,
             last_event_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .bind(
        hasStatus ? 1 : 0,
        patch.status ?? null,
        hasStartedAt ? 1 : 0,
        patch.started_at ?? null,
        hasCompletedAt ? 1 : 0,
        patch.completed_at ?? null,
        hasCancelledAt ? 1 : 0,
        patch.cancelled_at ?? null,
        hasLastError ? 1 : 0,
        patch.last_error ?? null,
        now,
        now,
        searchId
      )
      .run();
  };

  const updateSearchCameraRow = async (
    patch: Partial<{
      dispatch_status: string;
      last_event_type: string;
      last_error: string | null;
      started_at: string | null;
      completed_at: string | null;
      match_count_increment: number;
    }>
  ) => {
    if (!options.cameraId || options.cameraId <= 0) return;
    const hasDispatchStatus = Object.prototype.hasOwnProperty.call(patch, "dispatch_status");
    const hasLastEventType = Object.prototype.hasOwnProperty.call(patch, "last_event_type");
    const hasLastError = Object.prototype.hasOwnProperty.call(patch, "last_error");
    const hasStartedAt = Object.prototype.hasOwnProperty.call(patch, "started_at");
    const hasCompletedAt = Object.prototype.hasOwnProperty.call(patch, "completed_at");
    await env.DB
      .prepare(
        `UPDATE drakon_find_search_cameras
         SET assigned_client_id = COALESCE(assigned_client_id, ?),
             assigned_exe_id = COALESCE(assigned_exe_id, ?),
             dispatch_status = CASE WHEN ? = 1 THEN ? ELSE dispatch_status END,
             last_event_type = CASE WHEN ? = 1 THEN ? ELSE last_event_type END,
             last_event_at = ?,
             last_error = CASE WHEN ? = 1 THEN ? ELSE last_error END,
             started_at = CASE WHEN ? = 1 THEN ? ELSE started_at END,
             completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END,
             match_count = COALESCE(match_count, 0) + ?,
             updated_at = ?
         WHERE search_id = ? AND camera_id = ?`
      )
      .bind(
        options.clientId || null,
        options.exeId || null,
        hasDispatchStatus ? 1 : 0,
        patch.dispatch_status ?? null,
        hasLastEventType ? 1 : 0,
        patch.last_event_type ?? null,
        now,
        hasLastError ? 1 : 0,
        patch.last_error ?? null,
        hasStartedAt ? 1 : 0,
        patch.started_at ?? null,
        hasCompletedAt ? 1 : 0,
        patch.completed_at ?? null,
        Math.max(0, clampInteger(patch.match_count_increment)),
        now,
        searchId,
        options.cameraId
      )
      .run();
  };

  switch (options.eventType) {
    case "drakon_find_search_started": {
      if (!["cancelled", "failed", "completed"].includes(currentStatus)) {
        await updateSearchRow({
          status: "running",
          started_at: now,
          last_error: null,
        });
      }
      break;
    }
    case "drakon_find_camera_started":
    case "drakon_find_camera_progress": {
      if (!["cancelled", "failed", "completed"].includes(currentStatus)) {
        await updateSearchRow({
          status: "running",
          started_at: now,
        });
      }
      await updateSearchCameraRow({
        dispatch_status: "running",
        last_event_type: options.eventType,
        started_at: now,
      });
      break;
    }
    case "drakon_find_hit": {
      const hitCountRow = await env.DB
        .prepare(
          `SELECT COUNT(*) AS hit_count
           FROM drakon_find_hits
           WHERE search_id = ?`
        )
        .bind(searchId)
        .first();
      const hitCount = clampInteger((hitCountRow as any)?.hit_count);
      const confidence = Math.max(
        0,
        Math.min(
          1,
          toFiniteNumber(
            (details as any)?.confidence ?? (details as any)?.match_confidence ?? 0,
            0
          )
        )
      );
      const summary =
        normalizeDrakonFindText(
          (details as any)?.summary ?? (details as any)?.answer ?? safeMessage,
          1000
        ) || "Match registrado pelo agente";

      let imageKey =
        typeof (details as any)?.image_key === "string" && String((details as any).image_key).trim()
          ? String((details as any).image_key)
          : null;
      let imageUrl =
        typeof (details as any)?.image_url === "string" && String((details as any).image_url).trim()
          ? String((details as any).image_url)
          : imageKey
          ? buildDrakonFindHitImageUrl(imageKey)
          : null;
      let videoKey =
        typeof (details as any)?.video_key === "string" && String((details as any).video_key).trim()
          ? String((details as any).video_key)
          : null;
      let videoUrl =
        typeof (details as any)?.video_url === "string" && String((details as any).video_url).trim()
          ? String((details as any).video_url)
          : typeof (details as any)?.clip_url === "string" && String((details as any).clip_url).trim()
          ? String((details as any).clip_url)
          : videoKey
          ? buildDrakonFindHitVideoUrl(videoKey)
          : null;
      const videoDataUrl =
        !videoKey && !videoUrl
          ? typeof (details as any)?.video_mp4_base64 === "string"
            ? String((details as any).video_mp4_base64)
            : typeof (details as any)?.video_data_url === "string"
            ? String((details as any).video_data_url)
            : typeof (details as any)?.videoDataUrl === "string"
            ? String((details as any).videoDataUrl)
            : ""
          : "";
      const parsedVideo = parseDataUrl(videoDataUrl);
      if (parsedVideo && hitCount < DRAKON_FIND_MAX_HITS_PER_SEARCH && options.cameraId) {
        try {
          const bytes = base64ToUint8Array(parsedVideo.base64);
          videoKey = buildDrakonFindHitStorageKey(
            search.user_id,
            searchId,
            options.cameraId,
            parsedVideo.contentType || "video/mp4"
          );
          await env.R2_BUCKET.put(videoKey, bytes, {
            httpMetadata: {
              contentType: parsedVideo.contentType || "video/mp4",
            },
          });
          videoUrl = buildDrakonFindHitVideoUrl(videoKey);
        } catch (error) {
          console.error("[DRAKON FIND] Failed to upload hit video", {
            searchId,
            cameraId: options.cameraId,
            error,
          });
        }
      }

      const snapshotDataUrl =
        !imageKey && !imageUrl
          ? typeof (details as any)?.snapshot_image_data_url === "string"
            ? String((details as any).snapshot_image_data_url)
            : typeof (details as any)?.image_data_url === "string"
            ? String((details as any).image_data_url)
            : ""
          : "";
      const parsedSnapshot = parseDataUrl(snapshotDataUrl);
      if (parsedSnapshot && hitCount < DRAKON_FIND_MAX_HITS_PER_SEARCH && options.cameraId) {
        try {
          const bytes = base64ToUint8Array(parsedSnapshot.base64);
          imageKey = buildDrakonFindHitStorageKey(
            search.user_id,
            searchId,
            options.cameraId,
            parsedSnapshot.contentType || "image/jpeg"
          );
          await env.R2_BUCKET.put(imageKey, bytes, {
            httpMetadata: {
              contentType: parsedSnapshot.contentType || "image/jpeg",
            },
          });
          imageUrl = buildDrakonFindHitImageUrl(imageKey);
        } catch (error) {
          console.error("[DRAKON FIND] Failed to upload hit image", {
            searchId,
            cameraId: options.cameraId,
            error,
          });
        }
      }
      const sanitizedDetails = {
        ...details,
      };
      delete (sanitizedDetails as any).video_mp4_base64;
      delete (sanitizedDetails as any).video_data_url;
      delete (sanitizedDetails as any).videoDataUrl;
      delete (sanitizedDetails as any).snapshot_image_data_url;
      delete (sanitizedDetails as any).image_data_url;

      if (hitCount < DRAKON_FIND_MAX_HITS_PER_SEARCH && options.cameraId) {
        await env.DB
          .prepare(
            `INSERT INTO drakon_find_hits (
               search_id,
               target_id,
               operator_user_id,
               camera_id,
               camera_owner_user_id,
               client_id,
               exe_id,
               attempt_count,
               summary,
               confidence,
               image_key,
               image_url,
               video_key,
               video_url,
               details_json,
               matched_at,
               created_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            searchId,
            targetId,
            search.user_id,
            options.cameraId,
            typeof (details as any)?.camera_owner_user_id === "string" &&
              String((details as any).camera_owner_user_id).trim()
              ? String((details as any).camera_owner_user_id)
              : search.user_id,
            options.clientId || null,
            options.exeId || null,
            Math.max(1, clampInteger((details as any)?.attempt_count, search.attempt_count)),
            summary,
            confidence,
            imageKey,
            imageUrl,
            videoKey,
            videoUrl,
            JSON.stringify(sanitizedDetails),
            now,
            now
          )
          .run();

        await createDrakonFindAuditLog(env.DB, {
          actorUserId: search.user_id,
          actionType: "search_hit_recorded",
          searchId,
          targetId,
          message: `Match em camera #${options.cameraId} para "${search.target_name}".`,
          metadata: {
            camera_id: options.cameraId,
            confidence,
          },
        });
      }

      if (!["cancelled", "failed", "completed"].includes(currentStatus)) {
        await updateSearchRow({
          status: "running",
          started_at: now,
          last_error: null,
        });
      }
      await updateSearchCameraRow({
        dispatch_status: "running",
        last_event_type: options.eventType,
        started_at: now,
        match_count_increment: 1,
      });
      break;
    }
    case "drakon_find_camera_completed": {
      await updateSearchCameraRow({
        dispatch_status: "completed",
        last_event_type: options.eventType,
        last_error: null,
        completed_at: now,
      });
      break;
    }
    case "drakon_find_camera_failed": {
      await updateSearchCameraRow({
        dispatch_status: "failed",
        last_event_type: options.eventType,
        last_error: safeMessage || "Falha reportada pelo agente",
        completed_at: now,
      });
      await updateSearchRow({
        last_error: safeMessage || "Falha reportada pelo agente",
      });
      break;
    }
    case "drakon_find_camera_cancelled": {
      await updateSearchCameraRow({
        dispatch_status: "cancelled",
        last_event_type: options.eventType,
        completed_at: now,
      });
      break;
    }
    case "drakon_find_search_failed": {
      const terminalDispatchStatus = currentStatus === "cancelled" ? "cancelled" : "failed";
      await reconcileDrakonFindSearchClientTerminalState(env.DB, {
        searchId,
        clientId: options.clientId,
        exeId: options.exeId,
        dispatchStatus: terminalDispatchStatus,
        lastEventType: options.eventType,
        now,
        lastError:
          terminalDispatchStatus === "failed"
            ? safeMessage || "Busca falhou em um dos agentes"
            : null,
      });
      await updateSearchRow({
        last_error:
          terminalDispatchStatus === "failed"
            ? safeMessage || "Busca falhou em um dos agentes"
            : null,
      });
      await createDrakonFindAuditLog(env.DB, {
        actorUserId: search.user_id,
        actionType: "search_client_failed",
        searchId,
        targetId,
        message: `Cliente ${options.clientId || "desconhecido"} reportou falha na busca "${search.target_name}".`,
        metadata: {
          client_id: options.clientId,
          exe_id: options.exeId,
          error: safeMessage,
        },
      });
      break;
    }
    case "drakon_find_search_cancelled": {
      await reconcileDrakonFindSearchClientTerminalState(env.DB, {
        searchId,
        clientId: options.clientId,
        exeId: options.exeId,
        dispatchStatus: "cancelled",
        lastEventType: options.eventType,
        now,
        lastError: null,
      });
      await updateSearchRow({
        status: "cancelled",
        cancelled_at: now,
        last_error: null,
      });
      await createDrakonFindAuditLog(env.DB, {
        actorUserId: search.user_id,
        actionType: "search_client_cancelled",
        searchId,
        targetId,
        message: `Cliente ${options.clientId || "desconhecido"} confirmou cancelamento da busca "${search.target_name}".`,
        metadata: {
          client_id: options.clientId,
          exe_id: options.exeId,
        },
      });
      break;
    }
    case "drakon_find_search_completed": {
      await reconcileDrakonFindSearchClientTerminalState(env.DB, {
        searchId,
        clientId: options.clientId,
        exeId: options.exeId,
        dispatchStatus: currentStatus === "cancelled" ? "cancelled" : "completed",
        lastEventType: options.eventType,
        now,
        lastError: null,
      });
      await createDrakonFindAuditLog(env.DB, {
        actorUserId: search.user_id,
        actionType: "search_client_completed",
        searchId,
        targetId,
        message: `Cliente ${options.clientId || "desconhecido"} concluiu o lote da busca "${search.target_name}".`,
        metadata: {
          client_id: options.clientId,
          exe_id: options.exeId,
        },
      });
      break;
    }
    default: {
      return { recorded: false, reason: "unsupported_event_type" };
    }
  }

  await finalizeDrakonFindSearchIfTerminal(env.DB, searchId);
  return { recorded: true, search_id: searchId };
}

// Schema initialization - runs once per Worker instance
let schemaReady: Promise<void> | null = null;

async function ensureSchema(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const isPgLike =
        String((db as any)?.constructor?.name || "")
          .toLowerCase()
          .includes("pgd1");

      const addColumnIfMissing = async (sql: string) => {
        try {
          await db.prepare(sql).run();
        } catch (error: any) {
          const message = String(error?.message || error || "");
          const lowered = message.toLowerCase();
          const isDuplicateColumn =
            error?.code === "42701" || // PostgreSQL duplicate_column
            lowered.includes("duplicate column name") || // SQLite
            lowered.includes("already exists"); // PostgreSQL/D1 adapter text
          if (!isDuplicateColumn) {
            throw error;
          }
        }
      };

      const tableExists = async (tableName: string): Promise<boolean> => {
        try {
          await db.prepare(`SELECT 1 FROM ${tableName} LIMIT 1`).first();
          return true;
        } catch {
          return false;
        }
      };

      const getSqlitePrimaryKeyColumns = async (tableName: string): Promise<string[]> => {
        if (isPgLike) return [];
        try {
          const { results } = await db.prepare(`PRAGMA table_info(${tableName})`).all();
          return (results || [])
            .map((row: any) => ({
              name: String(row?.name || ""),
              pkPos: Number(row?.pk || 0),
            }))
            .filter((row: { name: string; pkPos: number }) => row.name.length > 0 && row.pkPos > 0)
            .sort(
              (a: { name: string; pkPos: number }, b: { name: string; pkPos: number }) =>
                a.pkPos - b.pkPos
            )
            .map((row: { name: string; pkPos: number }) => row.name);
        } catch {
          return [];
        }
      };

      if (await tableExists("chat_messages")) {
        await addColumnIfMissing(`ALTER TABLE chat_messages ADD COLUMN progress_json TEXT`);
      }

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS app_users (
          id TEXT PRIMARY KEY,
          email TEXT,
          auth_provider TEXT NOT NULL,
          country_code TEXT,
          locale TEXT,
          timezone_iana TEXT NOT NULL DEFAULT 'UTC',
          timezone_updated_at TEXT,
          timezone_source TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `).run();

      // Forward-compatible column migrations for existing databases.
      await addColumnIfMissing(`ALTER TABLE app_users ADD COLUMN created_at TEXT`);
      await addColumnIfMissing(`ALTER TABLE app_users ADD COLUMN updated_at TEXT`);
      await addColumnIfMissing(`ALTER TABLE app_users ADD COLUMN timezone_iana TEXT`);
      await addColumnIfMissing(`ALTER TABLE app_users ADD COLUMN timezone_updated_at TEXT`);
      await addColumnIfMissing(`ALTER TABLE app_users ADD COLUMN timezone_source TEXT`);

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS oauth_identities (
          provider TEXT NOT NULL,
          provider_subject TEXT NOT NULL,
          user_id TEXT NOT NULL,
          email_at_link TEXT,
          profile_json TEXT,
          last_signed_in_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (provider, provider_subject)
        )
      `).run();
      await addColumnIfMissing(`ALTER TABLE oauth_identities ADD COLUMN profile_json TEXT`);
      await addColumnIfMissing(`ALTER TABLE oauth_identities ADD COLUMN last_signed_in_at TEXT`);

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS oauth_sessions (
          session_token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          provider_subject TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `).run();

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS exe_pairings (
          user_id TEXT NOT NULL,
          client_id TEXT NOT NULL,
          exe_id TEXT NOT NULL,
          exe_token_hash TEXT NOT NULL,
          paired_at TEXT NOT NULL,
          last_seen_at TEXT,
          status TEXT NOT NULL DEFAULT 'connected',
          timezone_iana TEXT,
          timezone_updated_at TEXT,
          PRIMARY KEY (user_id, client_id)
        )
      `).run();

      if (await tableExists("exe_pairings")) {
        await addColumnIfMissing(`ALTER TABLE exe_pairings ADD COLUMN timezone_iana TEXT`);
        await addColumnIfMissing(`ALTER TABLE exe_pairings ADD COLUMN timezone_updated_at TEXT`);

        if (isPgLike) {
          await db.prepare(`
            DO $$
            DECLARE
              pk_name TEXT;
              pk_is_user_only BOOLEAN := FALSE;
            BEGIN
              SELECT tc.constraint_name
                INTO pk_name
              FROM information_schema.table_constraints tc
              WHERE tc.table_schema = 'public'
                AND tc.table_name = 'exe_pairings'
                AND tc.constraint_type = 'PRIMARY KEY'
              LIMIT 1;

              IF pk_name IS NOT NULL THEN
                SELECT TRUE
                  INTO pk_is_user_only
                FROM information_schema.key_column_usage k
                WHERE k.table_schema = 'public'
                  AND k.table_name = 'exe_pairings'
                  AND k.constraint_name = pk_name
                GROUP BY k.constraint_name
                HAVING COUNT(*) = 1 AND MAX(k.column_name) = 'user_id';

                pk_is_user_only := COALESCE(pk_is_user_only, FALSE);
              END IF;

              IF pk_name IS NULL THEN
                ALTER TABLE public.exe_pairings
                  ADD CONSTRAINT exe_pairings_pkey PRIMARY KEY (user_id, client_id);
              ELSIF pk_is_user_only THEN
                EXECUTE format('ALTER TABLE public.exe_pairings DROP CONSTRAINT %I', pk_name);
                ALTER TABLE public.exe_pairings
                  ADD CONSTRAINT exe_pairings_pkey PRIMARY KEY (user_id, client_id);
              END IF;
            END $$;
          `).run();
        }

        if (!isPgLike) {
          const pkCols = await getSqlitePrimaryKeyColumns("exe_pairings");
          const needsPkMigration = pkCols.length === 1 && pkCols[0] === "user_id";
          if (needsPkMigration) {
            await db.prepare(`
              CREATE TABLE IF NOT EXISTS exe_pairings_v2 (
                user_id TEXT NOT NULL,
                client_id TEXT NOT NULL,
                exe_id TEXT NOT NULL,
                exe_token_hash TEXT NOT NULL,
                paired_at TEXT NOT NULL,
                last_seen_at TEXT,
                status TEXT NOT NULL DEFAULT 'connected',
                timezone_iana TEXT,
                timezone_updated_at TEXT,
                PRIMARY KEY (user_id, client_id)
              )
            `).run();

            await db.prepare(
              `INSERT OR REPLACE INTO exe_pairings_v2 (
                 user_id,
                 client_id,
                 exe_id,
                 exe_token_hash,
                 paired_at,
                 last_seen_at,
                 status,
                 timezone_iana,
                 timezone_updated_at
               )
               SELECT
                 user_id,
                 client_id,
                 exe_id,
                 exe_token_hash,
                 paired_at,
                 last_seen_at,
                 status,
                 timezone_iana,
                 timezone_updated_at
               FROM exe_pairings`
            ).run();

            await db.prepare(`DROP TABLE exe_pairings`).run();
            await db.prepare(`ALTER TABLE exe_pairings_v2 RENAME TO exe_pairings`).run();
          }
        }
      }

      await db.prepare(
        isPgLike
          ? `
        CREATE TABLE IF NOT EXISTS chat_v2_routing_events (
          id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          user_id TEXT NOT NULL,
          chat_session_id INTEGER,
          routing_mode TEXT NOT NULL,
          actual_command_type TEXT NOT NULL,
          selected_skill TEXT NOT NULL,
          confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
          selection_source TEXT,
          selection_reason TEXT,
          reply_preview TEXT,
          user_query TEXT NOT NULL DEFAULT '',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        )
      `
          : `
        CREATE TABLE IF NOT EXISTS chat_v2_routing_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          chat_session_id INTEGER,
          routing_mode TEXT NOT NULL,
          actual_command_type TEXT NOT NULL,
          selected_skill TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 0,
          selection_source TEXT,
          selection_reason TEXT,
          reply_preview TEXT,
          user_query TEXT NOT NULL DEFAULT '',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        )
      `
      ).run();

      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_chat_v2_routing_events_user_created
        ON chat_v2_routing_events(user_id, created_at DESC)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_chat_v2_routing_events_session_created
        ON chat_v2_routing_events(chat_session_id, created_at DESC)
      `).run();

      if (await tableExists("job_step_agents")) {
        await addColumnIfMissing(
          `ALTER TABLE job_step_agents ADD COLUMN negative_condition TEXT`
        );
        await addColumnIfMissing(
          `ALTER TABLE job_step_agents ADD COLUMN only_capture_on_motion INTEGER NOT NULL DEFAULT 0`
        );
        await addColumnIfMissing(
          `ALTER TABLE job_step_agents ADD COLUMN analysis_regions TEXT`
        );
        await addColumnIfMissing(
          `ALTER TABLE job_step_agents ADD COLUMN running_resolution INTEGER`
        );
        await addColumnIfMissing(
          `ALTER TABLE job_step_agents ADD COLUMN model_fps INTEGER NOT NULL DEFAULT 1`
        );
        await addColumnIfMissing(
          `ALTER TABLE job_step_agents ADD COLUMN use_temporal_context INTEGER NOT NULL DEFAULT 1`
        );
        await addColumnIfMissing(
          `ALTER TABLE job_step_agents ADD COLUMN temporal_plan_json TEXT`
        );
        await addColumnIfMissing(
          `ALTER TABLE job_step_agents ADD COLUMN temporal_plan_hash TEXT`
        );
        await addColumnIfMissing(
          `ALTER TABLE job_step_agents ADD COLUMN temporal_plan_version TEXT`
        );
        await addColumnIfMissing(
          `ALTER TABLE job_step_agents ADD COLUMN temporal_compiled_at TEXT`
        );
        await addColumnIfMissing(
          `ALTER TABLE job_step_agents ADD COLUMN temporal_compile_model TEXT`
        );
        await addColumnIfMissing(
          `ALTER TABLE job_step_agents ADD COLUMN temporal_explain_json TEXT`
        );

        if (isPgLike) {
          await db.prepare(
            `UPDATE job_step_agents
             SET inference_model = CASE
               WHEN LOWER(COALESCE(NULLIF(BTRIM(inference_model), ''), 'ultra')) IN ('legacy', 'pro', 'ultra', 'core')
                 THEN LOWER(COALESCE(NULLIF(BTRIM(inference_model), ''), 'ultra'))
               ELSE 'ultra'
             END`
          ).run();

          await db.prepare(`
            DO $$
            DECLARE
              existing_name TEXT;
            BEGIN
              FOR existing_name IN
              SELECT c.conname
              FROM pg_constraint c
              JOIN pg_class t ON t.oid = c.conrelid
              JOIN pg_namespace n ON n.oid = t.relnamespace
              WHERE n.nspname = 'public'
                AND t.relname = 'job_step_agents'
                AND c.contype = 'c'
                AND pg_get_constraintdef(c.oid) ILIKE '%inference_model%'
              LOOP
                EXECUTE format(
                  'ALTER TABLE public.job_step_agents DROP CONSTRAINT %I',
                  existing_name
                );
              END LOOP;

              ALTER TABLE public.job_step_agents
                ADD CONSTRAINT job_step_agents_inference_model_chk
                CHECK (
                  LOWER(COALESCE(NULLIF(BTRIM(inference_model), ''), 'ultra')) = ANY (
                    ARRAY['legacy'::text, 'pro'::text, 'ultra'::text, 'core'::text]
                  )
                );
            EXCEPTION
              WHEN duplicate_object THEN
                NULL;
            END $$;
          `).run();
        }
      }

      if (await tableExists("cameras")) {
        await addColumnIfMissing(
          `ALTER TABLE cameras ADD COLUMN description_first_check_successful INTEGER NOT NULL DEFAULT 0`
        );
        await addColumnIfMissing(
          `ALTER TABLE cameras ADD COLUMN description_first_check_success_at TEXT`
        );
        await addColumnIfMissing(`ALTER TABLE cameras ADD COLUMN state_code TEXT`);
        await addColumnIfMissing(`ALTER TABLE cameras ADD COLUMN country_code TEXT`);
      }

      if (await tableExists("camera_algorithms")) {
        await addColumnIfMissing(
          `ALTER TABLE camera_algorithms ADD COLUMN prompt_template TEXT`
        );
        await addColumnIfMissing(
          `ALTER TABLE camera_algorithms ADD COLUMN alert_condition TEXT`
        );
        await addColumnIfMissing(
          `ALTER TABLE camera_algorithms ADD COLUMN negative_condition TEXT`
        );
        await addColumnIfMissing(
          `ALTER TABLE camera_algorithms ADD COLUMN analysis_regions TEXT`
        );
        await addColumnIfMissing(
          `ALTER TABLE camera_algorithms ADD COLUMN input_type TEXT DEFAULT 'video'`
        );
        await addColumnIfMissing(
          `ALTER TABLE camera_algorithms ADD COLUMN inference_model TEXT DEFAULT 'ultra'`
        );
        await addColumnIfMissing(
          `ALTER TABLE camera_algorithms ADD COLUMN run_every INTEGER DEFAULT 60`
        );
        await addColumnIfMissing(
          `ALTER TABLE camera_algorithms ADD COLUMN running_resolution INTEGER`
        );
        await addColumnIfMissing(
          `ALTER TABLE camera_algorithms ADD COLUMN model_fps INTEGER NOT NULL DEFAULT 1`
        );
        await addColumnIfMissing(
          `ALTER TABLE camera_algorithms ADD COLUMN only_capture_on_motion INTEGER DEFAULT 1`
        );
        await addColumnIfMissing(
          `ALTER TABLE camera_algorithms ADD COLUMN temporal_plan_json TEXT`
        );
        await addColumnIfMissing(
          `ALTER TABLE camera_algorithms ADD COLUMN temporal_plan_hash TEXT`
        );
        await addColumnIfMissing(
          `ALTER TABLE camera_algorithms ADD COLUMN temporal_plan_version TEXT`
        );
        await addColumnIfMissing(
          `ALTER TABLE camera_algorithms ADD COLUMN temporal_compiled_at TEXT`
        );
        await addColumnIfMissing(
          `ALTER TABLE camera_algorithms ADD COLUMN temporal_compile_model TEXT`
        );
        await addColumnIfMissing(
          `ALTER TABLE camera_algorithms ADD COLUMN temporal_explain_json TEXT`
        );
      }

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS capture_thread_metrics_latest (
          user_id TEXT NOT NULL,
          client_id TEXT NOT NULL,
          exe_id TEXT NOT NULL,
          camera_id INTEGER NOT NULL,
          thread_name TEXT NOT NULL,
          cpu_percent REAL NOT NULL DEFAULT 0,
          capture_mem_estimated_bytes BIGINT NOT NULL DEFAULT 0,
          process_working_set_bytes BIGINT NOT NULL DEFAULT 0,
          process_private_bytes BIGINT NOT NULL DEFAULT 0,
          queue_depth INTEGER NOT NULL DEFAULT 0,
          sampled_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, client_id, camera_id, thread_name)
        )
      `).run();

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS open_monitor_host_latest (
          user_id TEXT NOT NULL,
          client_id TEXT NOT NULL,
          exe_id TEXT NOT NULL,
          sampled_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          snapshot_id TEXT NOT NULL DEFAULT '',
          cpu_total_percent REAL,
          cpu_hottest_core_percent REAL,
          logical_cores INTEGER,
          ram_total_bytes BIGINT,
          ram_used_bytes BIGINT,
          ram_available_bytes BIGINT,
          disk_total_bytes BIGINT,
          disk_free_bytes BIGINT,
          net_rx_bytes_per_sec REAL,
          net_tx_bytes_per_sec REAL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          PRIMARY KEY (user_id, client_id)
        )
      `).run();

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS open_monitor_process_latest (
          user_id TEXT NOT NULL,
          client_id TEXT NOT NULL,
          exe_id TEXT NOT NULL,
          sampled_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          snapshot_id TEXT NOT NULL DEFAULT '',
          process_cpu_percent REAL,
          working_set_bytes BIGINT,
          private_bytes BIGINT,
          handle_count INTEGER,
          thread_count INTEGER,
          uptime_seconds BIGINT,
          active_cameras INTEGER,
          unique_streams INTEGER,
          total_consumers INTEGER,
          payload_json TEXT NOT NULL DEFAULT '{}',
          PRIMARY KEY (user_id, client_id)
        )
      `).run();

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS open_monitor_job_step_latest (
          user_id TEXT NOT NULL,
          client_id TEXT NOT NULL,
          exe_id TEXT NOT NULL,
          job_id INTEGER NOT NULL,
          step_id INTEGER NOT NULL,
          sampled_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          snapshot_id TEXT NOT NULL DEFAULT '',
          status TEXT,
          camera_count INTEGER,
          total_consumers INTEGER,
          queue_depth INTEGER,
          retry_count BIGINT,
          timeout_count BIGINT,
          error_count BIGINT,
          payload_json TEXT NOT NULL DEFAULT '{}',
          PRIMARY KEY (user_id, client_id, job_id, step_id)
        )
      `).run();

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS open_monitor_camera_latest (
          user_id TEXT NOT NULL,
          client_id TEXT NOT NULL,
          exe_id TEXT NOT NULL,
          camera_id INTEGER NOT NULL,
          sampled_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          snapshot_id TEXT NOT NULL DEFAULT '',
          actual_fps REAL,
          expected_fps REAL,
          last_frame_age_ms BIGINT,
          queue_depth INTEGER,
          overwritten_frames BIGINT,
          reconnect_count BIGINT,
          consumer_count INTEGER,
          payload_json TEXT NOT NULL DEFAULT '{}',
          PRIMARY KEY (user_id, client_id, camera_id)
        )
      `).run();

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS open_monitor_thread_latest (
          user_id TEXT NOT NULL,
          client_id TEXT NOT NULL,
          exe_id TEXT NOT NULL,
          camera_id INTEGER NOT NULL,
          thread_name TEXT NOT NULL,
          sampled_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          snapshot_id TEXT NOT NULL DEFAULT '',
          thread_cpu_percent REAL,
          queue_depth INTEGER,
          dropped_items BIGINT,
          payload_json TEXT NOT NULL DEFAULT '{}',
          PRIMARY KEY (user_id, client_id, camera_id, thread_name)
        )
      `).run();

      await addColumnIfMissing(`ALTER TABLE open_monitor_host_latest ADD COLUMN snapshot_id TEXT`);
      await addColumnIfMissing(`ALTER TABLE open_monitor_process_latest ADD COLUMN snapshot_id TEXT`);
      await addColumnIfMissing(`ALTER TABLE open_monitor_job_step_latest ADD COLUMN snapshot_id TEXT`);
      await addColumnIfMissing(`ALTER TABLE open_monitor_camera_latest ADD COLUMN snapshot_id TEXT`);
      await addColumnIfMissing(`ALTER TABLE open_monitor_thread_latest ADD COLUMN snapshot_id TEXT`);

      let droppedOpenMonitorHistoryTables = false;
      const openMonitorHistoryTables = [
        "open_monitor_host_history",
        "open_monitor_process_history",
        "open_monitor_job_step_history",
        "open_monitor_camera_history",
        "open_monitor_thread_history",
      ] as const;

      for (const tableName of openMonitorHistoryTables) {
        if (!(await tableExists(tableName))) continue;
        await db.prepare(`DROP TABLE IF EXISTS ${tableName}`).run();
        droppedOpenMonitorHistoryTables = true;
      }

      if (droppedOpenMonitorHistoryTables && !isPgLike) {
        try {
          await db.prepare(`VACUUM`).run();
        } catch (error) {
          console.error("[OPEN MONITOR] SQLite vacuum after dropping history tables failed:", error);
        }
      }

      if (isPgLike) {
        await db.prepare(`
          DO $$
          BEGIN
            BEGIN
              ALTER TABLE public.capture_thread_metrics_latest
                ALTER COLUMN capture_mem_estimated_bytes TYPE BIGINT USING capture_mem_estimated_bytes::BIGINT,
                ALTER COLUMN process_working_set_bytes TYPE BIGINT USING process_working_set_bytes::BIGINT,
                ALTER COLUMN process_private_bytes TYPE BIGINT USING process_private_bytes::BIGINT;
            EXCEPTION
              WHEN undefined_table THEN
                NULL;
            END;
          END $$;
        `).run();
      }

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS agent_error_logs (
          user_id TEXT NOT NULL,
          client_id TEXT NOT NULL,
          exe_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          level TEXT NOT NULL,
          message TEXT NOT NULL,
          flow TEXT,
          function_name TEXT,
          operation TEXT,
          context_json TEXT,
          occurred_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `).run();

      await addColumnIfMissing(`ALTER TABLE agent_error_logs ADD COLUMN flow TEXT`);
      await addColumnIfMissing(`ALTER TABLE agent_error_logs ADD COLUMN function_name TEXT`);
      await addColumnIfMissing(`ALTER TABLE agent_error_logs ADD COLUMN operation TEXT`);
      await addColumnIfMissing(`ALTER TABLE agent_error_logs ADD COLUMN context_json TEXT`);

      await db.prepare(
        `UPDATE app_users
         SET timezone_iana = COALESCE(NULLIF(TRIM(timezone_iana), ''), 'UTC'),
             timezone_updated_at = COALESCE(timezone_updated_at, updated_at)
         WHERE timezone_iana IS NULL
            OR TRIM(timezone_iana) = ''`
      ).run();

      if (isPgLike) {
        await db.prepare(
          `UPDATE app_users
           SET created_at = COALESCE(created_at, updated_at, CURRENT_TIMESTAMP),
               updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
           WHERE created_at IS NULL
              OR updated_at IS NULL`
        ).run();
      } else {
        await db.prepare(
          `UPDATE app_users
           SET created_at = COALESCE(NULLIF(TRIM(created_at), ''), updated_at, CURRENT_TIMESTAMP),
               updated_at = COALESCE(NULLIF(TRIM(updated_at), ''), created_at, CURRENT_TIMESTAMP)
           WHERE created_at IS NULL
              OR TRIM(created_at) = ''
              OR updated_at IS NULL
              OR TRIM(updated_at) = ''`
        ).run();
      }
      
      await db.prepare(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email_unique ON app_users(email)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_oauth_sessions_user_provider
        ON oauth_sessions(user_id, provider, expires_at)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_oauth_sessions_provider_subject
        ON oauth_sessions(provider, provider_subject, expires_at)
      `).run();

      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_exe_pairings_user_status
        ON exe_pairings(user_id, status)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_exe_pairings_client_token_status
        ON exe_pairings(client_id, exe_token_hash, status)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_exe_pairings_user_last_seen
        ON exe_pairings(user_id, last_seen_at)
      `).run();

      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_capture_metrics_latest_user_camera
        ON capture_thread_metrics_latest(user_id, camera_id)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_capture_metrics_latest_user_updated
        ON capture_thread_metrics_latest(user_id, updated_at)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_open_monitor_job_step_latest_user_job
        ON open_monitor_job_step_latest(user_id, job_id)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_open_monitor_camera_latest_user_camera
        ON open_monitor_camera_latest(user_id, camera_id)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_open_monitor_thread_latest_user_camera
        ON open_monitor_thread_latest(user_id, camera_id)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_agent_error_logs_user_occurred
        ON agent_error_logs(user_id, occurred_at)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_agent_error_logs_user_client_occurred
        ON agent_error_logs(user_id, client_id, occurred_at)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_agent_error_logs_user_exe_occurred
        ON agent_error_logs(user_id, exe_id, occurred_at)
      `).run();
      
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS telegram_settings (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE,
          enabled INTEGER NOT NULL DEFAULT 0,
          profile TEXT NOT NULL DEFAULT '',
          chat_id TEXT NOT NULL DEFAULT '',
          bot_token TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
        )
      `).run();

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS openai_settings (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE,
          api_key TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
        )
      `).run();

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS zai_settings (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE,
          api_key TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
        )
      `).run();

      await db.prepare(
        isPgLike
          ? `
        CREATE TABLE IF NOT EXISTS face_targets (
          id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `
          : `
        CREATE TABLE IF NOT EXISTS face_targets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `
      ).run();

      await db.prepare(
        isPgLike
          ? `
        CREATE TABLE IF NOT EXISTS face_target_images (
          id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          face_target_id INTEGER NOT NULL,
          image_url TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (face_target_id) REFERENCES face_targets(id) ON DELETE CASCADE
        )
      `
          : `
        CREATE TABLE IF NOT EXISTS face_target_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          face_target_id INTEGER NOT NULL,
          image_url TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (face_target_id) REFERENCES face_targets(id) ON DELETE CASCADE
        )
      `
      ).run();

      await db.prepare(
        isPgLike
          ? `
        CREATE TABLE IF NOT EXISTS job_step_agent_face_targets (
          id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          agent_id INTEGER NOT NULL,
          face_target_id INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(agent_id, face_target_id),
          FOREIGN KEY (agent_id) REFERENCES job_step_agents(id) ON DELETE CASCADE,
          FOREIGN KEY (face_target_id) REFERENCES face_targets(id) ON DELETE CASCADE
        )
      `
          : `
        CREATE TABLE IF NOT EXISTS job_step_agent_face_targets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id INTEGER NOT NULL,
          face_target_id INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(agent_id, face_target_id),
          FOREIGN KEY (agent_id) REFERENCES job_step_agents(id) ON DELETE CASCADE,
          FOREIGN KEY (face_target_id) REFERENCES face_targets(id) ON DELETE CASCADE
        )
      `
      ).run();

      await db.prepare(
        isPgLike
          ? `
        CREATE TABLE IF NOT EXISTS job_step_agent_negative_images (
          id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          agent_id INTEGER NOT NULL,
          image_url TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (agent_id) REFERENCES job_step_agents(id) ON DELETE CASCADE
        )
      `
          : `
        CREATE TABLE IF NOT EXISTS job_step_agent_negative_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id INTEGER NOT NULL,
          image_url TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (agent_id) REFERENCES job_step_agents(id) ON DELETE CASCADE
        )
      `
      ).run();

      await db.prepare(
        isPgLike
          ? `
        CREATE TABLE IF NOT EXISTS camera_algorithm_face_targets (
          id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          algorithm_id INTEGER NOT NULL,
          face_target_id INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(algorithm_id, face_target_id),
          FOREIGN KEY (algorithm_id) REFERENCES camera_algorithms(id) ON DELETE CASCADE,
          FOREIGN KEY (face_target_id) REFERENCES face_targets(id) ON DELETE CASCADE
        )
      `
          : `
        CREATE TABLE IF NOT EXISTS camera_algorithm_face_targets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          algorithm_id INTEGER NOT NULL,
          face_target_id INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(algorithm_id, face_target_id),
          FOREIGN KEY (algorithm_id) REFERENCES camera_algorithms(id) ON DELETE CASCADE,
          FOREIGN KEY (face_target_id) REFERENCES face_targets(id) ON DELETE CASCADE
        )
      `
      ).run();

      await db.prepare(
        isPgLike
          ? `
        CREATE TABLE IF NOT EXISTS camera_algorithm_negative_images (
          id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          algorithm_id INTEGER NOT NULL,
          image_url TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (algorithm_id) REFERENCES camera_algorithms(id) ON DELETE CASCADE
        )
      `
          : `
        CREATE TABLE IF NOT EXISTS camera_algorithm_negative_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          algorithm_id INTEGER NOT NULL,
          image_url TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (algorithm_id) REFERENCES camera_algorithms(id) ON DELETE CASCADE
        )
      `
      ).run();

      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_face_targets_user_id
        ON face_targets(user_id)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_face_target_images_target_id
        ON face_target_images(face_target_id)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_job_step_agent_face_targets_agent_id
        ON job_step_agent_face_targets(agent_id)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_job_step_agent_face_targets_target_id
        ON job_step_agent_face_targets(face_target_id)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_job_step_agent_negative_images_agent_id
        ON job_step_agent_negative_images(agent_id)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_camera_algorithm_face_targets_algorithm_id
        ON camera_algorithm_face_targets(algorithm_id)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_camera_algorithm_face_targets_target_id
        ON camera_algorithm_face_targets(face_target_id)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_camera_algorithm_negative_images_algorithm_id
        ON camera_algorithm_negative_images(algorithm_id)
      `).run();

      await db.prepare(
        isPgLike
          ? `
        CREATE TABLE IF NOT EXISTS drakon_find_targets (
          id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          user_id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          traits_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `
          : `
        CREATE TABLE IF NOT EXISTS drakon_find_targets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          traits_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `
      ).run();

      await db.prepare(
        isPgLike
          ? `
        CREATE TABLE IF NOT EXISTS drakon_find_target_images (
          id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          target_id INTEGER NOT NULL,
          storage_key TEXT NOT NULL,
          image_url TEXT NOT NULL,
          content_type TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (target_id) REFERENCES drakon_find_targets(id) ON DELETE CASCADE
        )
      `
          : `
        CREATE TABLE IF NOT EXISTS drakon_find_target_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          target_id INTEGER NOT NULL,
          storage_key TEXT NOT NULL,
          image_url TEXT NOT NULL,
          content_type TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (target_id) REFERENCES drakon_find_targets(id) ON DELETE CASCADE
        )
      `
      ).run();

      await db.prepare(
        isPgLike
          ? `
        CREATE TABLE IF NOT EXISTS drakon_find_searches (
          id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          user_id TEXT NOT NULL,
          target_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          runtime_mode TEXT NOT NULL DEFAULT 'continuous_video_60s',
          input_type TEXT NOT NULL DEFAULT 'video',
          window_seconds INTEGER NOT NULL DEFAULT 60,
          duration_seconds INTEGER NOT NULL DEFAULT 1800,
          run_until TEXT,
          country_code TEXT NOT NULL DEFAULT 'BR',
          selected_states_json TEXT NOT NULL DEFAULT '[]',
          scope_snapshot_json TEXT NOT NULL DEFAULT '{}',
          eligible_camera_count INTEGER NOT NULL DEFAULT 0,
          eligible_owner_count INTEGER NOT NULL DEFAULT 0,
          attempt_count INTEGER NOT NULL DEFAULT 1,
          dispatched_command_count INTEGER NOT NULL DEFAULT 0,
          completed_camera_count INTEGER NOT NULL DEFAULT 0,
          matched_camera_count INTEGER NOT NULL DEFAULT 0,
          hit_count INTEGER NOT NULL DEFAULT 0,
          last_event_at TEXT,
          last_dispatch_at TEXT,
          last_error TEXT,
          started_at TEXT,
          completed_at TEXT,
          cancelled_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (target_id) REFERENCES drakon_find_targets(id)
        )
      `
          : `
        CREATE TABLE IF NOT EXISTS drakon_find_searches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          target_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          runtime_mode TEXT NOT NULL DEFAULT 'continuous_video_60s',
          input_type TEXT NOT NULL DEFAULT 'video',
          window_seconds INTEGER NOT NULL DEFAULT 60,
          duration_seconds INTEGER NOT NULL DEFAULT 1800,
          run_until TEXT,
          country_code TEXT NOT NULL DEFAULT 'BR',
          selected_states_json TEXT NOT NULL DEFAULT '[]',
          scope_snapshot_json TEXT NOT NULL DEFAULT '{}',
          eligible_camera_count INTEGER NOT NULL DEFAULT 0,
          eligible_owner_count INTEGER NOT NULL DEFAULT 0,
          attempt_count INTEGER NOT NULL DEFAULT 1,
          dispatched_command_count INTEGER NOT NULL DEFAULT 0,
          completed_camera_count INTEGER NOT NULL DEFAULT 0,
          matched_camera_count INTEGER NOT NULL DEFAULT 0,
          hit_count INTEGER NOT NULL DEFAULT 0,
          last_event_at TEXT,
          last_dispatch_at TEXT,
          last_error TEXT,
          started_at TEXT,
          completed_at TEXT,
          cancelled_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (target_id) REFERENCES drakon_find_targets(id)
        )
      `
      ).run();

      await db.prepare(
        isPgLike
          ? `
        CREATE TABLE IF NOT EXISTS drakon_find_search_cameras (
          id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          search_id INTEGER NOT NULL,
          camera_id INTEGER NOT NULL,
          camera_owner_user_id TEXT NOT NULL,
          camera_name TEXT NOT NULL,
          city TEXT,
          state_code TEXT,
          country_code TEXT,
          is_public_access INTEGER NOT NULL DEFAULT 1,
          assigned_client_id TEXT,
          assigned_exe_id TEXT,
          dispatch_status TEXT NOT NULL DEFAULT 'queued',
          dispatch_command_id INTEGER,
          last_event_type TEXT,
          last_event_at TEXT,
          last_error TEXT,
          started_at TEXT,
          completed_at TEXT,
          match_count INTEGER NOT NULL DEFAULT 0,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(search_id, camera_id),
          FOREIGN KEY (search_id) REFERENCES drakon_find_searches(id) ON DELETE CASCADE
        )
      `
          : `
        CREATE TABLE IF NOT EXISTS drakon_find_search_cameras (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          search_id INTEGER NOT NULL,
          camera_id INTEGER NOT NULL,
          camera_owner_user_id TEXT NOT NULL,
          camera_name TEXT NOT NULL,
          city TEXT,
          state_code TEXT,
          country_code TEXT,
          is_public_access INTEGER NOT NULL DEFAULT 1,
          assigned_client_id TEXT,
          assigned_exe_id TEXT,
          dispatch_status TEXT NOT NULL DEFAULT 'queued',
          dispatch_command_id INTEGER,
          last_event_type TEXT,
          last_event_at TEXT,
          last_error TEXT,
          started_at TEXT,
          completed_at TEXT,
          match_count INTEGER NOT NULL DEFAULT 0,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(search_id, camera_id),
          FOREIGN KEY (search_id) REFERENCES drakon_find_searches(id) ON DELETE CASCADE
        )
      `
      ).run();

      await db.prepare(
        isPgLike
          ? `
        CREATE TABLE IF NOT EXISTS drakon_find_hits (
          id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          search_id INTEGER NOT NULL,
          target_id INTEGER NOT NULL,
          operator_user_id TEXT NOT NULL,
          camera_id INTEGER NOT NULL,
          camera_owner_user_id TEXT NOT NULL,
          client_id TEXT,
          exe_id TEXT,
          attempt_count INTEGER NOT NULL DEFAULT 1,
          summary TEXT NOT NULL DEFAULT '',
          confidence REAL NOT NULL DEFAULT 0,
          image_key TEXT,
          image_url TEXT,
          video_key TEXT,
          video_url TEXT,
          details_json TEXT NOT NULL DEFAULT '{}',
          matched_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (search_id) REFERENCES drakon_find_searches(id) ON DELETE CASCADE,
          FOREIGN KEY (target_id) REFERENCES drakon_find_targets(id) ON DELETE CASCADE
        )
      `
          : `
        CREATE TABLE IF NOT EXISTS drakon_find_hits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          search_id INTEGER NOT NULL,
          target_id INTEGER NOT NULL,
          operator_user_id TEXT NOT NULL,
          camera_id INTEGER NOT NULL,
          camera_owner_user_id TEXT NOT NULL,
          client_id TEXT,
          exe_id TEXT,
          attempt_count INTEGER NOT NULL DEFAULT 1,
          summary TEXT NOT NULL DEFAULT '',
          confidence REAL NOT NULL DEFAULT 0,
          image_key TEXT,
          image_url TEXT,
          video_key TEXT,
          video_url TEXT,
          details_json TEXT NOT NULL DEFAULT '{}',
          matched_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (search_id) REFERENCES drakon_find_searches(id) ON DELETE CASCADE,
          FOREIGN KEY (target_id) REFERENCES drakon_find_targets(id) ON DELETE CASCADE
        )
      `
      ).run();

      await db.prepare(
        isPgLike
          ? `
        CREATE TABLE IF NOT EXISTS drakon_find_audit_logs (
          id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          actor_user_id TEXT NOT NULL,
          action_type TEXT NOT NULL,
          target_id INTEGER,
          search_id INTEGER,
          message TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        )
      `
          : `
        CREATE TABLE IF NOT EXISTS drakon_find_audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_user_id TEXT NOT NULL,
          action_type TEXT NOT NULL,
          target_id INTEGER,
          search_id INTEGER,
          message TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        )
      `
      ).run();

      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_cameras_public_scope
        ON cameras(allowpublicaccess, country_code, state_code)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_drakon_find_targets_user_updated
        ON drakon_find_targets(user_id, updated_at)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_drakon_find_target_images_target_created
        ON drakon_find_target_images(target_id, created_at)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_drakon_find_searches_user_status_created
        ON drakon_find_searches(user_id, status, created_at)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_drakon_find_search_cameras_search_id
        ON drakon_find_search_cameras(search_id)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_drakon_find_search_cameras_client_status
        ON drakon_find_search_cameras(search_id, assigned_client_id, dispatch_status)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_drakon_find_hits_search_matched
        ON drakon_find_hits(search_id, matched_at)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_drakon_find_hits_operator_created
        ON drakon_find_hits(operator_user_id, created_at)
      `).run();
      await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_drakon_find_audit_logs_actor_created
        ON drakon_find_audit_logs(actor_user_id, created_at)
      `).run();

      if (await tableExists("drakon_find_searches")) {
        await addColumnIfMissing(`ALTER TABLE drakon_find_searches ADD COLUMN runtime_mode TEXT NOT NULL DEFAULT 'continuous_video_60s'`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_searches ADD COLUMN input_type TEXT NOT NULL DEFAULT 'video'`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_searches ADD COLUMN window_seconds INTEGER NOT NULL DEFAULT 60`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_searches ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 1800`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_searches ADD COLUMN run_until TEXT`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_searches ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_searches ADD COLUMN dispatched_command_count INTEGER NOT NULL DEFAULT 0`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_searches ADD COLUMN completed_camera_count INTEGER NOT NULL DEFAULT 0`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_searches ADD COLUMN matched_camera_count INTEGER NOT NULL DEFAULT 0`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_searches ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 0`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_searches ADD COLUMN last_event_at TEXT`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_searches ADD COLUMN last_dispatch_at TEXT`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_searches ADD COLUMN last_error TEXT`);
      }

      if (await tableExists("drakon_find_search_cameras")) {
        await addColumnIfMissing(`ALTER TABLE drakon_find_search_cameras ADD COLUMN assigned_client_id TEXT`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_search_cameras ADD COLUMN assigned_exe_id TEXT`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_search_cameras ADD COLUMN dispatch_status TEXT NOT NULL DEFAULT 'queued'`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_search_cameras ADD COLUMN dispatch_command_id INTEGER`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_search_cameras ADD COLUMN last_event_type TEXT`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_search_cameras ADD COLUMN last_event_at TEXT`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_search_cameras ADD COLUMN last_error TEXT`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_search_cameras ADD COLUMN started_at TEXT`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_search_cameras ADD COLUMN completed_at TEXT`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_search_cameras ADD COLUMN match_count INTEGER NOT NULL DEFAULT 0`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_search_cameras ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0`);
      }

      if (await tableExists("drakon_find_hits")) {
        await addColumnIfMissing(`ALTER TABLE drakon_find_hits ADD COLUMN video_key TEXT`);
        await addColumnIfMissing(`ALTER TABLE drakon_find_hits ADD COLUMN video_url TEXT`);
      }

      if (await tableExists("commands")) {
        await addColumnIfMissing(`ALTER TABLE commands ADD COLUMN target_client_id TEXT`);
        await addColumnIfMissing(`ALTER TABLE commands ADD COLUMN target_exe_id TEXT`);
      }

      if (await tableExists("cameras")) {
        const { results: cameraGeoRows } = await db
          .prepare(
            `SELECT id, state, country, state_code, country_code
             FROM cameras`
          )
          .all();

        for (const row of cameraGeoRows || []) {
          const normalizedGeo = normalizeCameraGeography(
            (row as any)?.state,
            (row as any)?.country
          );
          const currentStateCode =
            typeof (row as any)?.state_code === "string"
              ? String((row as any).state_code).trim() || null
              : null;
          const currentCountryCode =
            typeof (row as any)?.country_code === "string"
              ? String((row as any).country_code).trim() || null
              : null;

          if (
            currentStateCode !== normalizedGeo.stateCode ||
            currentCountryCode !== normalizedGeo.countryCode
          ) {
            await db
              .prepare(
                `UPDATE cameras
                 SET state_code = ?, country_code = ?
                 WHERE id = ?`
              )
              .bind(
                normalizedGeo.stateCode,
                normalizedGeo.countryCode,
                Number((row as any)?.id || 0)
              )
              .run();
          }
        }
      }

      // Backfill Custom Agent V2 safe defaults.
      if (await tableExists("camera_algorithms")) {
        await db.prepare(
          `UPDATE camera_algorithms
           SET prompt_template = COALESCE(NULLIF(TRIM(prompt_template), ''), llm_prompt, ''),
               alert_condition = COALESCE(
                 NULLIF(TRIM(alert_condition), ''),
                 'Trigger an alert only when the requested event is clearly visible.'
               ),
               negative_condition = COALESCE(negative_condition, ''),
               input_type = COALESCE(NULLIF(TRIM(input_type), ''), 'video'),
               inference_model = COALESCE(NULLIF(TRIM(inference_model), ''), 'ultra'),
               run_every = CASE
                 WHEN run_every = 10 THEN 10
                 ELSE 60
               END,
               running_resolution = CASE
                 WHEN LOWER(COALESCE(NULLIF(TRIM(inference_model), ''), 'ultra')) = 'core'
                   THEN CASE
                     WHEN running_resolution = 1024 THEN 1024
                     ELSE 640
                   END
                 ELSE NULL
               END,
               updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
           WHERE algorithm_type LIKE 'custom_%'`
        ).run();
      }

      if (await tableExists("job_step_agents")) {
        await db.prepare(
          `UPDATE job_step_agents
           SET run_every = CASE
                 WHEN run_every = 10 THEN 10
                 ELSE 60
               END,
               running_resolution = CASE
                 WHEN LOWER(COALESCE(NULLIF(TRIM(inference_model), ''), 'ultra')) = 'core'
                   THEN CASE
                     WHEN running_resolution = 1024 THEN 1024
                     ELSE 640
                   END
                 ELSE NULL
               END
           WHERE 1 = 1`
        ).run();
      }

      if (await tableExists("chat_messages")) {
        await addColumnIfMissing(`ALTER TABLE chat_messages ADD COLUMN progress_json TEXT`);
      }
    })();
  }
  await schemaReady;
}

// Helper function to upsert app user row (writes to app_users table)
async function ensureAppUserRow(
  db: D1Database,
  userData: {
    id: string;
    email: string;
    auth_provider: string;
    country_code?: string | null;
    locale?: string | null;
    timezone_iana?: string | null;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const isPgLike =
    String((db as any)?.constructor?.name || "")
      .toLowerCase()
      .includes("pgd1");
  // Browser/session profile timezone must never define global scheduler timezone.
  // EXE pairing is the only source of truth; until then keep UTC fallback.
  const normalizedTimezone = DEFAULT_GLOBAL_TIMEZONE;
  const createdAtConflictSql = isPgLike
    ? "created_at = COALESCE(app_users.created_at, excluded.created_at),"
    : "created_at = COALESCE(NULLIF(TRIM(app_users.created_at), ''), excluded.created_at),";
  
  await db.prepare(
    `INSERT INTO app_users (
       id, email, auth_provider, country_code, locale,
       timezone_iana, timezone_updated_at, timezone_source,
       created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       country_code = COALESCE(excluded.country_code, app_users.country_code),
       locale = COALESCE(excluded.locale, app_users.locale),
       timezone_iana = COALESCE(NULLIF(TRIM(app_users.timezone_iana), ''), excluded.timezone_iana, 'UTC'),
       timezone_updated_at = COALESCE(app_users.timezone_updated_at, excluded.timezone_updated_at),
       timezone_source = COALESCE(app_users.timezone_source, excluded.timezone_source),
       ${createdAtConflictSql}
       updated_at = excluded.updated_at`
  )
    .bind(
      userData.id,
      userData.email,
      userData.auth_provider,
      userData.country_code || null,
      userData.locale || null,
      normalizedTimezone,
      now,
      "default",
      now,
      now
    )
    .run();
}

async function getAppUserCreatedAt(
  db: D1Database,
  userId: string
): Promise<string | null> {
  const row = await db
    .prepare("SELECT created_at FROM app_users WHERE id = ? LIMIT 1")
    .bind(userId)
    .first();
  const createdAt = (row as any)?.created_at;
  if (typeof createdAt === "string" && createdAt.trim()) {
    return createdAt;
  }
  if (createdAt instanceof Date) {
    return createdAt.toISOString();
  }
  if (createdAt !== null && createdAt !== undefined) {
    const asString = String(createdAt).trim();
    return asString || null;
  }
  return null;
}

type GoogleOidcDiscovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
};

type GoogleIdTokenClaims = JWTPayload & {
  sub: string;
  email?: string;
  email_verified?: boolean;
  hd?: string;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  nonce?: string;
};

type GoogleOAuthUser = {
  id?: string;
  email: string;
  google_sub?: string | null;
  google_user_data?: {
    email?: string | null;
    email_verified?: boolean | null;
    hd?: string | null;
    name?: string | null;
    picture?: string | null;
    given_name?: string | null;
    family_name?: string | null;
    sub?: string | null;
  } | null;
};

type GoogleSessionUser = {
  id: string;
  email: string;
  auth_provider: "google";
  google_user_data: NonNullable<GoogleOAuthUser["google_user_data"]>;
  created_at: string | null;
};

let googleOidcDiscoveryCache: { expiresAt: number; value: GoogleOidcDiscovery } | null = null;
let googleRemoteJwkSet: ReturnType<typeof createRemoteJWKSet> | null = null;
let googleRemoteJwkSetUri = "";

function getGoogleOAuthConfig(env: Env) {
  const clientId = String(env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = String(env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google login is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET."
    );
  }
  return { clientId, clientSecret };
}

function resolveBrowserOrigin(c: any): string {
  const headerOrigin = String(c.req.header("origin") || "").trim();
  if (headerOrigin.startsWith("http://") || headerOrigin.startsWith("https://")) {
    return headerOrigin.replace(/\/$/, "");
  }
  return new URL(c.req.url).origin.replace(/\/$/, "");
}

function resolveAuthoritativeGoogleRedirectUri(): string {
  const siteUrl = String(brand.siteUrl || "").trim();
  if (!siteUrl) {
    return "";
  }

  try {
    return new URL("/auth/callback", siteUrl).toString();
  } catch {
    return "";
  }
}

function isDesktopHostedGoogleLoginRequest(c: any): boolean {
  try {
    if (new URL(c.req.url).searchParams.get("desktop_host") === "1") {
      return true;
    }
  } catch {
  }

  const desktopHeader = String(c.req.header("x-drakon-desktop-host") || "").trim().toLowerCase();
  return desktopHeader === "1" || desktopHeader === "true" || desktopHeader === "yes";
}

function resolveGoogleRedirectUri(c: any, options?: { preferAuthoritative?: boolean }): string {
  const configured = String(c.env.GOOGLE_OAUTH_REDIRECT_URI || "").trim();
  if (configured) {
    return configured;
  }

  if (options?.preferAuthoritative) {
    const authoritative = resolveAuthoritativeGoogleRedirectUri();
    if (authoritative) {
      return authoritative;
    }
  }

  return `${resolveBrowserOrigin(c)}/auth/callback`;
}

async function getGoogleOidcDiscovery(): Promise<GoogleOidcDiscovery> {
  if (googleOidcDiscoveryCache && googleOidcDiscoveryCache.expiresAt > Date.now()) {
    return googleOidcDiscoveryCache.value;
  }

  const response = await fetch(GOOGLE_OIDC_DISCOVERY_URL);
  if (!response.ok) {
    throw new Error(`Failed to load Google OpenID discovery: HTTP ${response.status}`);
  }

  const discovery = (await response.json()) as GoogleOidcDiscovery;
  googleOidcDiscoveryCache = {
    value: discovery,
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
  return discovery;
}

async function getGoogleRemoteJwkSet() {
  const discovery = await getGoogleOidcDiscovery();
  if (!googleRemoteJwkSet || googleRemoteJwkSetUri !== discovery.jwks_uri) {
    googleRemoteJwkSet = createRemoteJWKSet(new URL(discovery.jwks_uri));
    googleRemoteJwkSetUri = discovery.jwks_uri;
  }
  return googleRemoteJwkSet;
}

function buildGoogleUserDataFromClaims(claims: GoogleIdTokenClaims) {
  return {
    email: claims.email || null,
    email_verified: claims.email_verified === true,
    hd: typeof claims.hd === "string" ? claims.hd : null,
    name: typeof claims.name === "string" ? claims.name : null,
    picture: typeof claims.picture === "string" ? claims.picture : null,
    given_name: typeof claims.given_name === "string" ? claims.given_name : null,
    family_name: typeof claims.family_name === "string" ? claims.family_name : null,
    sub: claims.sub,
  };
}

function getNormalizedGoogleEmail(mochaUser: GoogleOAuthUser): string {
  const providerEmail =
    typeof mochaUser.google_user_data?.email === "string" &&
    mochaUser.google_user_data.email.trim()
      ? mochaUser.google_user_data.email
      : mochaUser.email;
  return normalizeEmail(providerEmail);
}

function getGoogleSubject(mochaUser: GoogleOAuthUser): string {
  const rawSubject =
    typeof mochaUser.google_sub === "string" && mochaUser.google_sub.trim()
      ? mochaUser.google_sub
      : typeof mochaUser.google_user_data?.sub === "string" &&
          mochaUser.google_user_data.sub.trim()
        ? mochaUser.google_user_data.sub
        : "";
  return rawSubject.trim();
}

function isGoogleEmailVerified(mochaUser: GoogleOAuthUser): boolean {
  return mochaUser.google_user_data?.email_verified === true;
}

function isGoogleAuthoritativeEmail(mochaUser: GoogleOAuthUser): boolean {
  const normalizedEmail = getNormalizedGoogleEmail(mochaUser);
  return (
    normalizedEmail.endsWith("@gmail.com") ||
    (isGoogleEmailVerified(mochaUser) &&
      typeof mochaUser.google_user_data?.hd === "string" &&
      mochaUser.google_user_data.hd.trim().length > 0)
  );
}

function shouldClearGoogleSessionOnAuthFailure(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
  return (
    message.includes("google account email is not verified") ||
    message.includes("google account subject is missing") ||
    message.includes("google account email is invalid") ||
    message.includes("invalid google login state") ||
    message.includes("missing google login state") ||
    message.includes("missing google login nonce") ||
    message.includes("missing google login pkce verifier")
  );
}

async function upsertOAuthIdentityLink(
  db: D1Database,
  provider: string,
  providerSubject: string,
  userId: string,
  emailAtLink: string,
  profileJson: string,
  lastSignedInAt: string
): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO oauth_identities (
       provider, provider_subject, user_id, email_at_link, profile_json, last_signed_in_at, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, provider_subject) DO UPDATE SET
       user_id = excluded.user_id,
       email_at_link = excluded.email_at_link,
       profile_json = excluded.profile_json,
       last_signed_in_at = excluded.last_signed_in_at,
       updated_at = excluded.updated_at`
  )
    .bind(provider, providerSubject, userId, emailAtLink, profileJson, lastSignedInAt, now, now)
    .run();
}

async function markAppUserAsGoogleLinked(
  db: D1Database,
  userId: string,
  normalizedEmail: string
): Promise<void> {
  const now = new Date().toISOString();
  const existingUser = await db
    .prepare("SELECT email FROM app_users WHERE id = ? LIMIT 1")
    .bind(userId)
    .first();

  if (!existingUser) {
    await ensureAppUserRow(db, {
      id: userId,
      email: normalizedEmail,
      auth_provider: "google",
    });
    return;
  }

  const existingEmailRaw = (existingUser as any)?.email;
  const existingEmail =
    typeof existingEmailRaw === "string" && existingEmailRaw.trim()
      ? normalizeEmail(existingEmailRaw)
      : "";
  const shouldUpdateEmail = !existingEmail || existingEmail === normalizedEmail;

  if (shouldUpdateEmail) {
    await db.prepare(
      `UPDATE app_users
       SET email = ?,
           auth_provider = 'google',
           timezone_iana = COALESCE(NULLIF(TRIM(timezone_iana), ''), 'UTC'),
           timezone_updated_at = COALESCE(timezone_updated_at, ?),
           updated_at = ?
       WHERE id = ?`
    )
      .bind(normalizedEmail, now, now, userId)
      .run();
    return;
  }

  await db.prepare(
    `UPDATE app_users
     SET auth_provider = 'google',
         timezone_iana = COALESCE(NULLIF(TRIM(timezone_iana), ''), 'UTC'),
         timezone_updated_at = COALESCE(timezone_updated_at, ?),
         updated_at = ?
     WHERE id = ?`
  )
    .bind(now, now, userId)
    .run();

  console.warn(
    `[GOOGLE AUTH] Preserving existing email for ${userId}; current=${existingEmail}, google=${normalizedEmail}`
  );
}

async function createGoogleOAuthRedirectUrl(c: any): Promise<string> {
  const { clientId } = getGoogleOAuthConfig(c.env);
  const discovery = await getGoogleOidcDiscovery();
  const desktopHosted = isDesktopHostedGoogleLoginRequest(c);
  const redirectUri = resolveGoogleRedirectUri(c, {
    preferAuthoritative: desktopHosted,
  });
  const state = generateRandomBase64Url(24);
  const nonce = generateRandomBase64Url(24);
  const codeVerifier = generateRandomBase64Url(48);
  const codeChallenge = await sha256Base64Url(codeVerifier);

  if (AUTH_DEBUG) {
    console.log(
      `[GOOGLE LOGIN] redirect_uri=${redirectUri} desktop_hosted=${desktopHosted} request_origin=${resolveBrowserOrigin(c)}`
    );
  }

  setSessionCookie(c, GOOGLE_OAUTH_STATE_COOKIE_NAME, state, GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS);
  setSessionCookie(c, GOOGLE_OAUTH_NONCE_COOKIE_NAME, nonce, GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS);
  setSessionCookie(c, GOOGLE_OAUTH_PKCE_COOKIE_NAME, codeVerifier, GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS);
  setSessionCookie(
    c,
    GOOGLE_OAUTH_REDIRECT_URI_COOKIE_NAME,
    redirectUri,
    GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS
  );

  const authorizationUrl = new URL(discovery.authorization_endpoint);
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", GOOGLE_OIDC_SCOPES.join(" "));
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("nonce", nonce);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("prompt", "select_account");

  return authorizationUrl.toString();
}

async function exchangeGoogleAuthorizationCode(
  c: any,
  code: string,
  state: string
): Promise<GoogleOAuthUser> {
  const { clientId, clientSecret } = getGoogleOAuthConfig(c.env);
  const expectedState = getCookie(c, GOOGLE_OAUTH_STATE_COOKIE_NAME);
  const expectedNonce = getCookie(c, GOOGLE_OAUTH_NONCE_COOKIE_NAME);
  const codeVerifier = getCookie(c, GOOGLE_OAUTH_PKCE_COOKIE_NAME);
  const redirectUri =
    getCookie(c, GOOGLE_OAUTH_REDIRECT_URI_COOKIE_NAME) || resolveGoogleRedirectUri(c);

  if (!expectedState) {
    throw new Error("Missing Google login state.");
  }
  if (state !== expectedState) {
    throw new Error("Invalid Google login state.");
  }
  if (!expectedNonce) {
    throw new Error("Missing Google login nonce.");
  }
  if (!codeVerifier) {
    throw new Error("Missing Google login PKCE verifier.");
  }

  const discovery = await getGoogleOidcDiscovery();
  const tokenResponse = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });

  const tokenPayload = (await tokenResponse.json().catch(() => ({}))) as Record<string, unknown>;
  if (!tokenResponse.ok) {
    const errorDescription =
      typeof tokenPayload.error_description === "string"
        ? tokenPayload.error_description
        : typeof tokenPayload.error === "string"
        ? tokenPayload.error
        : "Google token exchange failed.";
    throw new Error(errorDescription);
  }

  const idToken =
    typeof tokenPayload.id_token === "string" ? tokenPayload.id_token : "";
  if (!idToken) {
    throw new Error("Google token response did not include id_token.");
  }

  const jwks = await getGoogleRemoteJwkSet();
  const verification = await jwtVerify<GoogleIdTokenClaims>(idToken, jwks, {
    audience: clientId,
    issuer: [discovery.issuer, "https://accounts.google.com", "accounts.google.com"],
    maxTokenAge: "15 minutes",
  });

  const claims = verification.payload;
  if (claims.nonce !== expectedNonce) {
    throw new Error("Invalid Google login nonce.");
  }

  const googleUserData = buildGoogleUserDataFromClaims(claims);
  const normalizedEmail =
    typeof googleUserData.email === "string" ? normalizeEmail(googleUserData.email) : "";
  if (!normalizedEmail) {
    throw new Error("Google account email is invalid.");
  }

  return {
    id: `google:${claims.sub}`,
    email: normalizedEmail,
    google_sub: claims.sub,
    google_user_data: googleUserData,
  };
}

function clearGoogleOAuthFlowCookies(c: any) {
  clearSessionCookie(c, GOOGLE_OAUTH_STATE_COOKIE_NAME);
  clearSessionCookie(c, GOOGLE_OAUTH_NONCE_COOKIE_NAME);
  clearSessionCookie(c, GOOGLE_OAUTH_PKCE_COOKIE_NAME);
  clearSessionCookie(c, GOOGLE_OAUTH_REDIRECT_URI_COOKIE_NAME);
}

async function createGoogleSession(
  db: D1Database,
  userId: string,
  providerSubject: string
): Promise<string> {
  const sessionToken = generateSessionToken();
  const now = new Date().toISOString();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);

  await db.prepare(
    `INSERT INTO oauth_sessions (
       session_token, user_id, provider, provider_subject, expires_at, created_at, updated_at
     )
     VALUES (?, ?, 'google', ?, ?, ?, ?)`
  )
    .bind(sessionToken, userId, providerSubject, expiresAt.toISOString(), now, now)
    .run();

  return sessionToken;
}

async function deleteGoogleSessionByToken(db: D1Database, sessionToken: string | null | undefined) {
  if (!sessionToken) {
    return;
  }
  await db.prepare("DELETE FROM oauth_sessions WHERE session_token = ?")
    .bind(sessionToken)
    .run();
}

async function getGoogleSessionUser(
  db: D1Database,
  sessionToken: string | null | undefined
): Promise<GoogleSessionUser | null> {
  if (!sessionToken) {
    return null;
  }

  const row = await db.prepare(
    `SELECT
       os.user_id,
       os.provider_subject,
       au.email,
       au.created_at,
       oi.profile_json
     FROM oauth_sessions os
     JOIN app_users au ON au.id = os.user_id
     LEFT JOIN oauth_identities oi
       ON oi.provider = os.provider
      AND oi.provider_subject = os.provider_subject
     WHERE os.session_token = ?
       AND os.provider = 'google'
       AND os.expires_at > ?
     LIMIT 1`
  )
    .bind(sessionToken, new Date().toISOString())
    .first();

  if (!row) {
    return null;
  }

  const rawProfile = typeof (row as any).profile_json === "string" ? (row as any).profile_json : "";
  let parsedProfile: NonNullable<GoogleOAuthUser["google_user_data"]> | null = null;
  if (rawProfile) {
    try {
      parsedProfile = JSON.parse(rawProfile) as NonNullable<GoogleOAuthUser["google_user_data"]>;
    } catch {
      parsedProfile = null;
    }
  }

  const providerSubject = String((row as any).provider_subject || "");
  const email = normalizeEmail(String((row as any).email || ""));
  const googleUserData =
    parsedProfile ||
    {
      email,
      email_verified: true,
      hd: null,
      name: null,
      picture: null,
      given_name: null,
      family_name: null,
      sub: providerSubject,
    };

  return {
    id: String((row as any).user_id || ""),
    email,
    auth_provider: "google",
    google_user_data: googleUserData,
    created_at:
      typeof (row as any).created_at === "string" && (row as any).created_at.trim()
        ? String((row as any).created_at)
        : null,
  };
}

// Helper function to resolve or create Google app user based on google_sub first,
// then fall back to the verified, authoritative email only for the initial link.
async function resolveOrCreateGoogleAppUser(
  db: D1Database,
  mochaUser: GoogleOAuthUser
): Promise<string> {
  const normalizedEmail = getNormalizedGoogleEmail(mochaUser);
  const googleSubject = getGoogleSubject(mochaUser);
  const googleProfileJson = JSON.stringify(mochaUser.google_user_data || {});
  const signedInAt = new Date().toISOString();

  if (!isValidEmail(normalizedEmail)) {
    throw new Error("Google account email is invalid.");
  }

  if (!isGoogleEmailVerified(mochaUser)) {
    throw new Error("Google account email is not verified.");
  }

  if (!googleSubject) {
    throw new Error("Google account subject is missing.");
  }

  const existingLinkedIdentity = await db.prepare(
    `SELECT user_id FROM oauth_identities
     WHERE provider = 'google' AND provider_subject = ?
     LIMIT 1`
  )
    .bind(googleSubject)
    .first();

  if (existingLinkedIdentity) {
    const canonicalId = String((existingLinkedIdentity as any).user_id);
    await markAppUserAsGoogleLinked(db, canonicalId, normalizedEmail);
    await upsertOAuthIdentityLink(
      db,
      "google",
      googleSubject,
      canonicalId,
      normalizedEmail,
      googleProfileJson,
      signedInAt
    );

    console.log(
      `[GOOGLE AUTH] Resolved via google_sub to existing account: ${canonicalId} (email: ${normalizedEmail})`
    );
    return canonicalId;
  }

  if (isGoogleAuthoritativeEmail(mochaUser)) {
    // First-time link: look up existing app user by authoritative email.
    const existingAppUser = await db.prepare(
      `SELECT id, email, auth_provider FROM app_users WHERE LOWER(email) = LOWER(?) LIMIT 1`
    )
      .bind(normalizedEmail)
      .first();
    
    if (existingAppUser) {
      const canonicalId = String((existingAppUser as any).id);
      await markAppUserAsGoogleLinked(db, canonicalId, normalizedEmail);
      await upsertOAuthIdentityLink(
        db,
        "google",
        googleSubject,
        canonicalId,
        normalizedEmail,
        googleProfileJson,
        signedInAt
      );

      console.log(
        `[GOOGLE AUTH] Linked google_sub to existing app_users account: ${canonicalId} (email: ${normalizedEmail})`
      );
      return canonicalId;
    }
    
    // Check if there's a local user with this email
    const existingLocalUser = await db.prepare(
      `SELECT id, email FROM local_users WHERE LOWER(email) = LOWER(?) LIMIT 1`
    )
      .bind(normalizedEmail)
      .first();
    
    if (existingLocalUser) {
      const localId = (existingLocalUser as any).id;
      const canonicalId = `local:${localId}`;

      await ensureAppUserRow(db, {
        id: canonicalId,
        email: normalizedEmail,
        auth_provider: "google",
      });
      await markAppUserAsGoogleLinked(db, canonicalId, normalizedEmail);
      await upsertOAuthIdentityLink(
        db,
        "google",
        googleSubject,
        canonicalId,
        normalizedEmail,
        googleProfileJson,
        signedInAt
      );

      console.log(
        `[GOOGLE AUTH] Linked google_sub to existing local_users account: ${canonicalId} (email: ${normalizedEmail})`
      );
      return canonicalId;
    }
  }
  
  // No existing account - keep a canonical Google ID based on the stable subject.
  const canonicalId = `google:${googleSubject}`;

  await ensureAppUserRow(db, {
    id: canonicalId,
    email: normalizedEmail,
    auth_provider: "google",
  });
  await upsertOAuthIdentityLink(
    db,
    "google",
    googleSubject,
    canonicalId,
    normalizedEmail,
    googleProfileJson,
    signedInAt
  );

  console.log(`[GOOGLE AUTH] Created new user: ${canonicalId} (email: ${normalizedEmail})`);
  return canonicalId;
}

// Helper function to upsert active card
async function upsertActiveCard(
  db: D1Database,
  userId: string,
  customerId: string,
  pm: Stripe.PaymentMethod
) {
  if (!pm.card) return;

  const now = new Date().toISOString();

  const existing = await db.prepare(
    "SELECT * FROM active_cards WHERE user_id = ?"
  )
    .bind(userId)
    .first();

  if (existing) {
    await db.prepare(
      `UPDATE active_cards
         SET stripe_customer_id = ?,
             stripe_payment_method_id = ?,
             brand = ?,
             last4 = ?,
             exp_month = ?,
             exp_year = ?,
             is_default = 1,
             updated_at = ?
       WHERE user_id = ?`
    )
      .bind(
        customerId,
        pm.id,
        pm.card.brand,
        pm.card.last4,
        pm.card.exp_month,
        pm.card.exp_year,
        now,
        userId
      )
      .run();
  } else {
    await db.prepare(
      `INSERT INTO active_cards
         (user_id, stripe_customer_id, stripe_payment_method_id,
          brand, last4, exp_month, exp_year, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
      .bind(
        userId,
        customerId,
        pm.id,
        pm.card.brand,
        pm.card.last4,
        pm.card.exp_month,
        pm.card.exp_year,
        now,
        now
      )
      .run();
  }
}

// Helper function for normalizing model tier
type ModelTier = "light" | "plus" | "pro";

function normalizeTier(tier: string | null | undefined): ModelTier {
  const t = (tier || "").toLowerCase();
  if (t === "pro") return "pro";
  if (t === "plus") return "plus";
  return "light";
}

type ChatModelTier = "legacy" | "pro" | "ultra" | "core";
type ChatRunningResolution = 640 | 1024;
const DEFAULT_CHAT_MODEL_TIER: ChatModelTier = "ultra";
const DEFAULT_CHAT_CORE_RUNNING_RESOLUTION: ChatRunningResolution = 640;

function normalizeChatModelTier(tier: string | null | undefined): ChatModelTier {
  const normalized = String(tier || "").trim().toLowerCase();
  if (
    normalized === "legacy" ||
    normalized === "pro" ||
    normalized === "ultra" ||
    normalized === "core"
  ) {
    return normalized;
  }
  return DEFAULT_CHAT_MODEL_TIER;
}

function getChatModelDefaultFps(_tier: ChatModelTier): number {
  return DEFAULT_ULTRA_VIDEO_MODEL_FPS;
}

function normalizeChatModelFps(value: unknown, tier: ChatModelTier): number {
  const fallback = getChatModelDefaultFps(tier);
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    return Math.min(MAX_ULTRA_VIDEO_MODEL_FPS, Math.max(DEFAULT_ULTRA_VIDEO_MODEL_FPS, rounded));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.min(MAX_ULTRA_VIDEO_MODEL_FPS, Math.max(DEFAULT_ULTRA_VIDEO_MODEL_FPS, parsed));
    }
  }
  return Math.min(MAX_ULTRA_VIDEO_MODEL_FPS, Math.max(DEFAULT_ULTRA_VIDEO_MODEL_FPS, fallback));
}

function stripTemporalEngineDiagnosticsFromChatAnswer(value: string): string {
  if (!value) return value;
  return value
    .replace(/(?:<br\s*\/?>|\r?\n|\s)*Temporal engine:\s*[\s\S]*$/i, "")
    .trimEnd();
}

function normalizeChatRunningResolution(
  value: unknown,
  fallback: ChatRunningResolution = DEFAULT_CHAT_CORE_RUNNING_RESOLUTION
): ChatRunningResolution {
  const parse = (candidate: unknown): number | null => {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return Math.round(candidate);
    }
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Number.parseInt(candidate.trim(), 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const normalized = parse(value);
  if (normalized === 640 || normalized === 1024) return normalized;
  const fallbackValue = parse(fallback);
  if (fallbackValue === 640 || fallbackValue === 1024) return fallbackValue;
  return DEFAULT_CHAT_CORE_RUNNING_RESOLUTION;
}

function isChatV2EnabledForRequest(
  env: Env,
  requestedMode: unknown
): boolean {
  if (typeof requestedMode === "string") {
    const normalized = requestedMode.trim().toLowerCase();
    if (normalized === "v2" || normalized === "chatv2" || normalized === "orchestrator") {
      return true;
    }
    if (normalized === "v1" || normalized === "legacy") {
      return false;
    }
  }

  const envValue = String(env.CHAT_V2_ENABLED || "").trim().toLowerCase();
  return envValue === "1" || envValue === "true" || envValue === "yes" || envValue === "on";
}

function buildChatSessionTitleFromFirstMessage(content: string): string {
  const normalized = String(content || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "Untitled chat";

  const words = normalized.split(" ");
  const snippet = words.slice(0, 10).join(" ");
  const maxChars = 64;
  return snippet.length > maxChars ? `${snippet.slice(0, maxChars).trimEnd()}...` : snippet;
}

function isAutoGeneratedChatTitle(title: string | null | undefined): boolean {
  const normalized = String(title || "").trim().toLowerCase();
  if (!normalized) return true;
  if (/^new chat(\s+\d+)?$/.test(normalized)) return true;
  if (normalized.startsWith("quick chat")) return true;
  if (normalized === "untitled chat") return true;
  if (/^novo chat(\s+\d+)?$/.test(normalized)) return true;
  return false;
}

type ChatModelRuntimeConfig = {
  apiKey: string;
  defaultFps: number;
};

async function loadChatModelRuntimeConfig(db: D1Database, tier: ChatModelTier): Promise<ChatModelRuntimeConfig> {
  try {
    const row = await db
      .prepare(
        "SELECT api_key, default_fps FROM model_api_keys WHERE model_name = ? AND is_active = 1 ORDER BY updated_at DESC, id DESC LIMIT 1"
      )
      .bind(tier)
      .first();

    const apiKey =
      row && typeof (row as any).api_key === "string"
        ? String((row as any).api_key).trim()
        : "";

    const defaultFps = normalizeChatModelFps(
      row ? (row as any).default_fps : undefined,
      tier
    );

    return {
      apiKey,
      defaultFps,
    };
  } catch (error) {
    console.error("[CHAT MODEL CONFIG] Failed to load model_api_keys runtime config", error);
    return {
      apiKey: "",
      defaultFps: getChatModelDefaultFps(tier),
    };
  }
}

// Subscription pricing and token allowances
// Tokens are in millions per camera, 12h/day, 30 days/month
// Base values: 402M input at 1fps, 7M output (constant)

const SECONDS_PER_FRAME_OPTIONS = [1, 3, 5, 10] as const;
type SecondsPerFrame = typeof SECONDS_PER_FRAME_OPTIONS[number];

// Per-million token prices by tier
const TOKEN_PRICES: Record<ModelTier, { inputPricePerM: number; outputPricePerM: number }> = {
  pro:   { inputPricePerM: 0.30,  outputPricePerM: 2.50 },  // 2.5 flash
  plus:  { inputPricePerM: 0.10,  outputPricePerM: 0.40 },  // 2.0 flash
  light: { inputPricePerM: 0.075, outputPricePerM: 0.30 },  // 2.0 flash lite
};

// Token allowances per camera: input scales with 1/S, output is constant at 7M
const TOKEN_TABLE: Record<ModelTier, Record<SecondsPerFrame, { inputTokensM: number; outputTokensM: number }>> = {
  pro: {
    1:  { inputTokensM: 402,   outputTokensM: 7 },
    3:  { inputTokensM: 134,   outputTokensM: 7 },
    5:  { inputTokensM: 80.4,  outputTokensM: 7 },
    10: { inputTokensM: 40.2,  outputTokensM: 7 },
  },
  plus: {
    1:  { inputTokensM: 402,   outputTokensM: 7 },
    3:  { inputTokensM: 134,   outputTokensM: 7 },
    5:  { inputTokensM: 80.4,  outputTokensM: 7 },
    10: { inputTokensM: 40.2,  outputTokensM: 7 },
  },
  light: {
    1:  { inputTokensM: 402,   outputTokensM: 7 },
    3:  { inputTokensM: 134,   outputTokensM: 7 },
    5:  { inputTokensM: 80.4,  outputTokensM: 7 },
    10: { inputTokensM: 40.2,  outputTokensM: 7 },
  },
};

function getSubscriptionPricingForCamera(
  tier: ModelTier,
  secondsPerFrame: SecondsPerFrame
): {
  pricePerCameraUSD: number;
  inputTokensM: number;
  outputTokensM: number;
} {
  const tokens = TOKEN_TABLE[tier][secondsPerFrame];
  const prices = TOKEN_PRICES[tier];
  
  const inputCost = tokens.inputTokensM * prices.inputPricePerM;
  const outputCost = tokens.outputTokensM * prices.outputPricePerM;
  const totalCost = inputCost + outputCost;
  const margin = totalCost * 0.20;
  const pricePerCameraUSD = totalCost + margin;
  
  return {
    pricePerCameraUSD,
    inputTokensM: tokens.inputTokensM,
    outputTokensM: tokens.outputTokensM,
  };
}

// Helper function to get Telegram settings for a user
async function getTelegramSettingsForUser(db: D1Database, userId: string) {
  const row = await db
    .prepare(
      "SELECT enabled, chat_id, bot_token FROM telegram_settings WHERE user_id = ? LIMIT 1"
    )
    .bind(userId)
    .first();

  if (!row) {
    return {
      enabled: false,
      chat_id: "",
      bot_token: "",
    };
  }

  const r = row as any;

  return {
    enabled: !!r.enabled,
    chat_id: r.chat_id ?? "",
    bot_token: r.bot_token ?? "",
  };
}

async function getUserOpenAIApiKey(db: D1Database, userId: string): Promise<string> {
  const row = await db
    .prepare("SELECT api_key FROM openai_settings WHERE user_id = ? LIMIT 1")
    .bind(userId)
    .first();

  if (!row) return "";
  return normalizeOpenAIApiKeyInput((row as any)?.api_key);
}

async function getUserZAIApiKey(db: D1Database, userId: string): Promise<string> {
  const row = await db
    .prepare("SELECT api_key FROM zai_settings WHERE user_id = ? LIMIT 1")
    .bind(userId)
    .first();

  if (!row) return "";
  return normalizeZAIApiKeyInput((row as any)?.api_key);
}

const app = new Hono<{ Bindings: Env }>();

// CORS middleware - must run before all routes
app.use("*", async (c, next) => {
  const origin = c.req.header("origin");
  const path = new URL(c.req.url).pathname;
  const configuredOrigins = (c.env.APP_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item: string) => item.trim())
    .filter(Boolean);
  const wildcardOriginAllowed = configuredOrigins.includes("*");
  
  // List of allowed origins
  const allowedOrigins = Array.from(
    new Set([
      ...brand.allowedOrigins,
      "https://e4a722mkktilw.mocha.app",
      "https://getmocha.com",
      ...configuredOrigins,
    ])
  );
  
  // Check if origin is allowed (exact match or *.mocha.app subdomain)
  const isAllowed = !!origin && (
    wildcardOriginAllowed ||
    allowedOrigins.includes(origin) ||
    (origin.startsWith("https://") && origin.endsWith(".mocha.app")) ||
    origin.startsWith("http://localhost") ||
    origin.startsWith("https://localhost") ||
    origin.startsWith("http://127.0.0.1") ||
    origin.startsWith("https://127.0.0.1")
  );
  
  // Special handling for OAuth callback - allow requests without origin header
  // This is needed because OAuth redirects from Google may not include origin
  if (path === "/api/sessions" || path === "/api/oauth/google/redirect_url") {
    if (origin) {
      // If origin is present and allowed, set CORS headers
      if (isAllowed) {
        c.header("Access-Control-Allow-Origin", origin);
        c.header("Vary", "Origin");
        c.header("Access-Control-Allow-Credentials", "true");
        c.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
        c.header(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization, X-Drakon-Desktop-Host"
        );
        c.header("Access-Control-Max-Age", "86400");
      }
    }
    // Always allow these endpoints even without origin header
    await next();
    return;
  }
  
  if (isAllowed) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    c.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Drakon-Desktop-Host"
    );
    c.header("Access-Control-Max-Age", "86400");
  }
  
  await next();
});

// Handle OPTIONS preflight requests
app.options("*", (c) => c.body(null, 204));

// Constants for local auth
const LOCAL_SESSION_COOKIE_NAME = brand.cookieNames.localSession;
const GOOGLE_SESSION_COOKIE_NAME = `${brand.id}_google_session`;
const GOOGLE_OAUTH_STATE_COOKIE_NAME = `${brand.id}_google_oauth_state`;
const GOOGLE_OAUTH_NONCE_COOKIE_NAME = `${brand.id}_google_oauth_nonce`;
const GOOGLE_OAUTH_PKCE_COOKIE_NAME = `${brand.id}_google_oauth_pkce`;
const GOOGLE_OAUTH_REDIRECT_URI_COOKIE_NAME = `${brand.id}_google_oauth_redirect_uri`;
const SESSION_DURATION_DAYS = 30;
const AUTH_DEBUG = process.env.AUTH_DEBUG === "1";
const GOOGLE_OIDC_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration";
const GOOGLE_OIDC_SCOPES = ["openid", "email", "profile"];
const GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

// Helper to generate session token
function generateSessionToken(): string {
  return generateUUID();
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  const base64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(bytes).toString("base64")
      : btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function generateRandomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

async function sha256Base64Url(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return base64UrlEncodeBytes(new Uint8Array(digest));
}

function setSessionCookie(c: any, name: string, value: string, maxAgeSeconds: number) {
  const cookieOptions = getSessionCookieOptions(c);
  setCookie(c, name, value, {
    ...cookieOptions,
    maxAge: maxAgeSeconds,
  });
}

function clearSessionCookie(c: any, name: string) {
  const cookieOptions = getSessionCookieOptions(c);
  setCookie(c, name, "", {
    ...cookieOptions,
    maxAge: 0,
  });
}

function isLocalDevelopmentHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost")
  );
}

function getSessionCookieOptions(c: any) {
  const candidates = [c.req.header("origin"), c.req.url];

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) {
      continue;
    }

    try {
      const parsed = new URL(candidate);
      const localHttp =
        parsed.protocol === "http:" && isLocalDevelopmentHost(parsed.hostname);

      if (localHttp) {
        return {
          httpOnly: true,
          path: "/",
          sameSite: "lax" as const,
          secure: false,
        };
      }

      return {
        httpOnly: true,
        path: "/",
        sameSite: "none" as const,
        secure: true,
      };
    } catch {
      // Ignore malformed candidate and continue to the next source.
    }
  }

  return {
    httpOnly: true,
    path: "/",
    sameSite: "none" as const,
    secure: true,
  };
}

// Helper to normalize email
function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

// Helper to validate email format
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Helper to validate password
function isValidPassword(password: string): boolean {
  return password.length >= 8;
}

function normalizeOptionalCameraField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCameraTransportField(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseStructuredCameraDescription(
  value: unknown
): { label: string; description: string } | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const inlineMatch = raw.match(/LABEL:\s*(.+?)\s*DESCRIPTION:\s*([\s\S]+)$/i);
  if (inlineMatch) {
    const label = inlineMatch[1].trim();
    const description = inlineMatch[2].trim();
    if (label && description) return { label, description };
    return null;
  }

  const labelMatch = raw.match(/LABEL:\s*([^\r\n]+)/i);
  const descriptionMatch = raw.match(/DESCRIPTION:\s*([\s\S]+)$/i);
  if (!labelMatch || !descriptionMatch) return null;

  const label = labelMatch[1].trim();
  const description = descriptionMatch[1].trim();
  if (!label || !description) return null;

  return { label, description };
}

function normalizeStructuredCameraDescription(value: unknown): string | null {
  const parsed = parseStructuredCameraDescription(value);
  if (!parsed) return null;
  return `LABEL: ${parsed.label} DESCRIPTION: ${parsed.description}`;
}

function validateRequiredRtspCameraFields(data: any): string[] {
  const missing: string[] = [];
  if (!normalizeOptionalCameraField(data?.rtsp_port)) missing.push("rtsp_port");
  if (!normalizeOptionalCameraField(data?.manufacturer)) missing.push("manufacturer");
  if (!normalizeOptionalCameraField(data?.connection_method)) missing.push("connection_method");
  if (!normalizeOptionalCameraField(data?.username)) missing.push("username");
  if (!normalizeOptionalCameraField(data?.password)) missing.push("password");
  return missing;
}

// Helper to clear local session
async function clearLocalSession(c: any) {
  const sessionToken = getCookie(c, LOCAL_SESSION_COOKIE_NAME);
  
  if (sessionToken) {
    // Delete session from database
    await c.env.DB.prepare(
      "DELETE FROM local_sessions WHERE session_token = ?"
    )
      .bind(sessionToken)
      .run();
  }
  
  // Clear cookie
  clearSessionCookie(c, LOCAL_SESSION_COOKIE_NAME);
}

// Helper to clear Google session cookie
function clearGoogleSessionCookie(c: any) {
  clearSessionCookie(c, GOOGLE_SESSION_COOKIE_NAME);
  clearGoogleOAuthFlowCookies(c);
}

async function clearGoogleSession(c: any) {
  await deleteGoogleSessionByToken(c.env.DB, getCookie(c, GOOGLE_SESSION_COOKIE_NAME));
  clearGoogleSessionCookie(c);
}

// Unified auth middleware that accepts both Local and Google OAuth
const anyAuthMiddleware = async (c: any, next: any) => {
  if (AUTH_DEBUG) {
    console.log("[AUTH] origin=", c.req.header("origin"));
    console.log("[AUTH] cookieHeaderLen=", (c.req.header("cookie") || "").length);
  }
  
  // Ensure schema is initialized
  await ensureSchema(c.env.DB);

  // Check Google OAuth session FIRST (priority)
  const googleSessionToken = getCookie(c, GOOGLE_SESSION_COOKIE_NAME);
  
  if (googleSessionToken) {
    try {
      const user = await getGoogleSessionUser(c.env.DB, googleSessionToken);

      if (user) {
        c.set("user", {
          id: user.id,
          email: user.email,
          auth_provider: "google",
          google_user_data: user.google_user_data || null,
        });
        return next();
      }
    } catch (error) {
      console.error("[AUTH] Failed to get Google OAuth user:", error);
      if (shouldClearGoogleSessionOnAuthFailure(error)) {
        clearGoogleSessionCookie(c);
      }
    }
  }

  // Check Local session only if Google session not valid
  const localSessionToken = getCookie(c, LOCAL_SESSION_COOKIE_NAME);
  
  if (localSessionToken) {
    const session = await c.env.DB.prepare(
      `SELECT ls.*, lu.email, lu.country_code
       FROM local_sessions ls
       JOIN local_users lu ON ls.user_id = lu.id
       WHERE ls.session_token = ? AND ls.expires_at > ?`
    )
      .bind(localSessionToken, new Date().toISOString())
      .first();

    if (session) {
      const sessionData = session as any;
      const userId = `local:${sessionData.user_id}`;
      
      // Ensure app_users row exists
      await ensureAppUserRow(c.env.DB, {
        id: userId,
        email: sessionData.email,
        auth_provider: "local",
        country_code: sessionData.country_code || null,
        locale: null,
      });
      
      c.set("user", {
        id: userId,
        email: sessionData.email,
        auth_provider: "local",
        country_code: sessionData.country_code || null,
      });
      return next();
    }
  }

  return c.json({ error: "Not authenticated" }, 401);
};

const OPEN_MONITOR_STALE_AFTER_MS = 90_000;
const OPEN_MONITOR_SNAPSHOT_ID_MAX_LENGTH = 96;

function openMonitorNowIso(): string {
  return new Date().toISOString();
}

function openMonitorBuildSnapshotId(nowIso: string = openMonitorNowIso()): string {
  const nowMs = Date.parse(nowIso);
  const timestamp = Number.isFinite(nowMs) ? Math.max(0, Math.floor(nowMs)) : Date.now();
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `om-${timestamp}-${randomPart}`;
}

function openMonitorNormalizeSnapshotId(
  value: unknown,
  fallback: string = openMonitorBuildSnapshotId()
): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, OPEN_MONITOR_SNAPSHOT_ID_MAX_LENGTH);
  return trimmed || fallback;
}

async function openMonitorPruneLatestRowsBySnapshot(
  db: D1Database,
  tableName:
    | "open_monitor_camera_latest"
    | "open_monitor_thread_latest"
    | "open_monitor_job_step_latest",
  userId: string,
  clientId: string,
  snapshotId: string
): Promise<void> {
  try {
    await db.prepare(
      `DELETE FROM ${tableName}
       WHERE user_id = ?
         AND client_id = ?
         AND COALESCE(snapshot_id, '') <> ?`
    )
      .bind(userId, clientId, snapshotId)
      .run();
  } catch (error) {
    console.error(`[OPEN MONITOR] Latest prune failed for ${tableName}:`, error);
  }
}

function openMonitorNormalizeIso(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return fallback;
  return new Date(parsed).toISOString();
}

function openMonitorToFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function openMonitorToNonNegativeInt(value: unknown): number {
  const numeric = openMonitorToFiniteNumber(value);
  if (numeric === null || numeric <= 0) return 0;
  const clipped = Math.floor(numeric);
  return clipped > 9_223_372_036_854_775_000 ? 9_223_372_036_854_775_000 : clipped;
}

function openMonitorParseObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function openMonitorParseArray(value: unknown): Record<string, any>[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => entry as Record<string, any>);
}

function openMonitorParseJsonObject(value: unknown): Record<string, any> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return openMonitorParseObject(JSON.parse(value));
  } catch {
    return {};
  }
}

function openMonitorSafeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function openMonitorSampleAgeMs(sampledAt: unknown, updatedAt?: unknown): number | null {
  const candidate =
    typeof updatedAt === "string" && updatedAt.trim()
      ? updatedAt
      : typeof sampledAt === "string"
      ? sampledAt
      : "";
  if (!candidate) return null;
  const parsed = Date.parse(candidate);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Date.now() - parsed);
}

function openMonitorBuildHostSnapshot(latestHostRow: any): Record<string, any> | null {
  if (!latestHostRow) return null;
  const payload = openMonitorParseJsonObject(latestHostRow?.payload_json);
  return {
    client_id: String(latestHostRow.client_id || ""),
    exe_id: String(latestHostRow.exe_id || ""),
    cpu_total_percent:
      latestHostRow.cpu_total_percent !== undefined && latestHostRow.cpu_total_percent !== null
        ? Number(latestHostRow.cpu_total_percent) || 0
        : null,
    cpu_hottest_core_percent:
      latestHostRow.cpu_hottest_core_percent !== undefined && latestHostRow.cpu_hottest_core_percent !== null
        ? Number(latestHostRow.cpu_hottest_core_percent) || 0
        : payload.cpu_hottest_core_percent !== undefined
        ? Number(payload.cpu_hottest_core_percent) || 0
        : null,
    logical_cores:
      latestHostRow.logical_cores !== undefined && latestHostRow.logical_cores !== null
        ? Number(latestHostRow.logical_cores) || 0
        : null,
    ram_total_bytes:
      latestHostRow.ram_total_bytes !== undefined && latestHostRow.ram_total_bytes !== null
        ? Number(latestHostRow.ram_total_bytes) || 0
        : null,
    ram_used_bytes:
      latestHostRow.ram_used_bytes !== undefined && latestHostRow.ram_used_bytes !== null
        ? Number(latestHostRow.ram_used_bytes) || 0
        : null,
    ram_available_bytes:
      latestHostRow.ram_available_bytes !== undefined && latestHostRow.ram_available_bytes !== null
        ? Number(latestHostRow.ram_available_bytes) || 0
        : null,
    disk_total_bytes:
      latestHostRow.disk_total_bytes !== undefined && latestHostRow.disk_total_bytes !== null
        ? Number(latestHostRow.disk_total_bytes) || 0
        : null,
    disk_free_bytes:
      latestHostRow.disk_free_bytes !== undefined && latestHostRow.disk_free_bytes !== null
        ? Number(latestHostRow.disk_free_bytes) || 0
        : null,
    disk_read_bytes_per_sec:
      payload.disk_read_bytes_per_sec !== undefined ? Number(payload.disk_read_bytes_per_sec) || 0 : null,
    disk_write_bytes_per_sec:
      payload.disk_write_bytes_per_sec !== undefined ? Number(payload.disk_write_bytes_per_sec) || 0 : null,
    net_rx_bytes_per_sec:
      latestHostRow.net_rx_bytes_per_sec !== undefined && latestHostRow.net_rx_bytes_per_sec !== null
        ? Number(latestHostRow.net_rx_bytes_per_sec) || 0
        : null,
    net_tx_bytes_per_sec:
      latestHostRow.net_tx_bytes_per_sec !== undefined && latestHostRow.net_tx_bytes_per_sec !== null
        ? Number(latestHostRow.net_tx_bytes_per_sec) || 0
        : null,
    sample_age_ms: openMonitorSampleAgeMs(latestHostRow.sampled_at, latestHostRow.updated_at),
    sampled_at: typeof latestHostRow.sampled_at === "string" ? latestHostRow.sampled_at : null,
    updated_at: typeof latestHostRow.updated_at === "string" ? latestHostRow.updated_at : null,
  };
}

function openMonitorBuildProcessSnapshot(
  latestProcessRow: any,
  camerasResponse: Array<Record<string, any>>
): Record<string, any> | null {
  if (!latestProcessRow) return null;
  const payload = openMonitorParseJsonObject(latestProcessRow?.payload_json);
  return {
    client_id: String(latestProcessRow.client_id || ""),
    exe_id: String(latestProcessRow.exe_id || ""),
    process_cpu_percent:
      latestProcessRow.process_cpu_percent !== undefined && latestProcessRow.process_cpu_percent !== null
        ? Number(latestProcessRow.process_cpu_percent) || 0
        : null,
    working_set_bytes:
      latestProcessRow.working_set_bytes !== undefined && latestProcessRow.working_set_bytes !== null
        ? Number(latestProcessRow.working_set_bytes) || 0
        : null,
    private_bytes:
      latestProcessRow.private_bytes !== undefined && latestProcessRow.private_bytes !== null
        ? Number(latestProcessRow.private_bytes) || 0
        : null,
    handle_count:
      latestProcessRow.handle_count !== undefined && latestProcessRow.handle_count !== null
        ? Number(latestProcessRow.handle_count) || 0
        : null,
    thread_count:
      latestProcessRow.thread_count !== undefined && latestProcessRow.thread_count !== null
        ? Number(latestProcessRow.thread_count) || 0
        : null,
    uptime_seconds:
      latestProcessRow.uptime_seconds !== undefined && latestProcessRow.uptime_seconds !== null
        ? Number(latestProcessRow.uptime_seconds) || 0
        : null,
    active_cameras:
      latestProcessRow.active_cameras !== undefined && latestProcessRow.active_cameras !== null
        ? Number(latestProcessRow.active_cameras) || 0
        : camerasResponse.filter((camera) => Boolean(camera.is_service_running)).length,
    unique_streams:
      latestProcessRow.unique_streams !== undefined && latestProcessRow.unique_streams !== null
        ? Number(latestProcessRow.unique_streams) || 0
        : camerasResponse.filter((camera) => camera.sampled_at !== null).length,
    total_consumers:
      latestProcessRow.total_consumers !== undefined && latestProcessRow.total_consumers !== null
        ? Number(latestProcessRow.total_consumers) || 0
        : camerasResponse.reduce((total, camera) => total + Number(camera.consumer_count || 0), 0),
    process_read_bytes_per_sec:
      payload.process_read_bytes_per_sec !== undefined
        ? Number(payload.process_read_bytes_per_sec) || 0
        : null,
    process_write_bytes_per_sec:
      payload.process_write_bytes_per_sec !== undefined
        ? Number(payload.process_write_bytes_per_sec) || 0
        : null,
    process_other_bytes_per_sec:
      payload.process_other_bytes_per_sec !== undefined
        ? Number(payload.process_other_bytes_per_sec) || 0
        : null,
    workloads: payload.workloads && typeof payload.workloads === "object" ? payload.workloads : null,
    sample_age_ms: openMonitorSampleAgeMs(latestProcessRow.sampled_at, latestProcessRow.updated_at),
    sampled_at: typeof latestProcessRow.sampled_at === "string" ? latestProcessRow.sampled_at : null,
    updated_at: typeof latestProcessRow.updated_at === "string" ? latestProcessRow.updated_at : null,
  };
}

function openMonitorBuildThreadRows(
  threadRows: any[],
  cameraById: Map<number, any>
): Array<Record<string, any>> {
  return threadRows.map((row) => {
    const payload = openMonitorParseJsonObject((row as any)?.payload_json);
    const cameraId = Number((row as any)?.camera_id) || 0;
    return {
      client_id: String((row as any)?.client_id || ""),
      exe_id: String((row as any)?.exe_id || ""),
      camera_id: cameraId,
      camera_name:
        payload.camera_name ||
        (typeof cameraById.get(cameraId)?.name === "string" ? cameraById.get(cameraId)?.name : null),
      thread_name: String((row as any)?.thread_name || ""),
      thread_cpu_percent:
        (row as any)?.thread_cpu_percent !== undefined && (row as any)?.thread_cpu_percent !== null
          ? Number((row as any).thread_cpu_percent) || 0
          : (row as any)?.cpu_percent !== undefined && (row as any)?.cpu_percent !== null
          ? Number((row as any).cpu_percent) || 0
          : null,
      queue_depth:
        (row as any)?.queue_depth !== undefined && (row as any)?.queue_depth !== null
          ? Number((row as any).queue_depth) || 0
          : null,
      dropped_items:
        (row as any)?.dropped_items !== undefined && (row as any)?.dropped_items !== null
          ? Number((row as any).dropped_items) || 0
          : null,
      sample_age_ms: openMonitorSampleAgeMs((row as any)?.sampled_at, (row as any)?.updated_at),
      sampled_at: typeof (row as any)?.sampled_at === "string" ? (row as any).sampled_at : null,
      updated_at: typeof (row as any)?.updated_at === "string" ? (row as any).updated_at : null,
      capture_mem_estimated_bytes:
        payload.capture_mem_estimated_bytes !== undefined
          ? Number(payload.capture_mem_estimated_bytes) || 0
          : (row as any)?.capture_mem_estimated_bytes !== undefined &&
            (row as any)?.capture_mem_estimated_bytes !== null
          ? Number((row as any).capture_mem_estimated_bytes) || 0
          : null,
      process_working_set_bytes:
        payload.process_working_set_bytes !== undefined
          ? Number(payload.process_working_set_bytes) || 0
          : (row as any)?.process_working_set_bytes !== undefined &&
            (row as any)?.process_working_set_bytes !== null
          ? Number((row as any).process_working_set_bytes) || 0
          : null,
      process_private_bytes:
        payload.process_private_bytes !== undefined
          ? Number(payload.process_private_bytes) || 0
          : (row as any)?.process_private_bytes !== undefined &&
            (row as any)?.process_private_bytes !== null
          ? Number((row as any).process_private_bytes) || 0
          : null,
      capture_read_latency_ms:
        payload.capture_read_latency_ms !== undefined
          ? Number(payload.capture_read_latency_ms) || 0
          : null,
      decode_latency_ms:
        payload.decode_latency_ms !== undefined ? Number(payload.decode_latency_ms) || 0 : null,
      disk_read_bytes_per_sec:
        payload.disk_read_bytes_per_sec !== undefined
          ? Number(payload.disk_read_bytes_per_sec) || 0
          : null,
      disk_read_latency_ms:
        payload.disk_read_latency_ms !== undefined ? Number(payload.disk_read_latency_ms) || 0 : null,
      disk_write_bytes_per_sec:
        payload.disk_write_bytes_per_sec !== undefined
          ? Number(payload.disk_write_bytes_per_sec) || 0
          : null,
      disk_write_latency_ms:
        payload.disk_write_latency_ms !== undefined ? Number(payload.disk_write_latency_ms) || 0 : null,
      input_rate: payload.input_rate !== undefined ? Number(payload.input_rate) || 0 : null,
      processing_rate:
        payload.processing_rate !== undefined ? Number(payload.processing_rate) || 0 : null,
      last_inference_age_ms:
        payload.last_inference_age_ms !== undefined ? Number(payload.last_inference_age_ms) || 0 : null,
      success_count: payload.success_count !== undefined ? Number(payload.success_count) || 0 : null,
      error_count: payload.error_count !== undefined ? Number(payload.error_count) || 0 : null,
    };
  });
}

function openMonitorBuildCameraRows(
  cameraIds: number[],
  latestCameraById: Map<number, any>,
  cameraById: Map<number, any>,
  enabledAgentsByCamera: Map<number, number>,
  jobConsumerCountsByCamera: Map<number, number>
): Array<Record<string, any>> {
  return cameraIds.map((cameraId) => {
    const row = latestCameraById.get(cameraId) || null;
    const payload = openMonitorParseJsonObject(row?.payload_json);
    const configuredCamera = cameraById.get(cameraId) as any;
    const enabledAgents = enabledAgentsByCamera.get(cameraId) || 0;
    const jobConsumers = jobConsumerCountsByCamera.get(cameraId) || 0;
    const consumerCount =
      row?.consumer_count !== undefined && row?.consumer_count !== null && Number(row.consumer_count) > 0
        ? Number(row.consumer_count) || 0
        : enabledAgents + jobConsumers;

    return {
      client_id: String(row?.client_id || ""),
      exe_id: String(row?.exe_id || ""),
      camera_id: cameraId,
      camera_name:
        payload.camera_name ||
        (typeof configuredCamera?.name === "string" ? configuredCamera.name : `Camera #${cameraId}`),
      actual_fps:
        row?.actual_fps !== undefined && row?.actual_fps !== null ? Number(row.actual_fps) || 0 : null,
      expected_fps:
        row?.expected_fps !== undefined && row?.expected_fps !== null
          ? Number(row.expected_fps) || 0
          : typeof configuredCamera?.expected_fps === "number"
          ? Number(configuredCamera.expected_fps) || 0
          : null,
      last_frame_age_ms:
        row?.last_frame_age_ms !== undefined && row?.last_frame_age_ms !== null
          ? Number(row.last_frame_age_ms) || 0
          : null,
      queue_depth:
        row?.queue_depth !== undefined && row?.queue_depth !== null ? Number(row.queue_depth) || 0 : null,
      overwritten_frames:
        row?.overwritten_frames !== undefined && row?.overwritten_frames !== null
          ? Number(row.overwritten_frames) || 0
          : 0,
      reconnect_count:
        row?.reconnect_count !== undefined && row?.reconnect_count !== null
          ? Number(row.reconnect_count) || 0
          : 0,
      consumer_count: consumerCount,
      is_service_running: Number(configuredCamera?.is_service_running || 0) === 1,
      configured_fps:
        payload.configured_fps !== undefined
          ? Number(payload.configured_fps) || 0
          : typeof configuredCamera?.expected_fps === "number"
          ? Number(configuredCamera.expected_fps) || 0
          : null,
      width: payload.width !== undefined ? Number(payload.width) || 0 : null,
      height: payload.height !== undefined ? Number(payload.height) || 0 : null,
      use_gpu: payload.use_gpu !== undefined ? Boolean(payload.use_gpu) : null,
      stream_online: payload.stream_online !== undefined ? Boolean(payload.stream_online) : null,
      capture_read_latency_ms:
        payload.capture_read_latency_ms !== undefined
          ? Number(payload.capture_read_latency_ms) || 0
          : null,
      decode_latency_ms:
        payload.decode_latency_ms !== undefined ? Number(payload.decode_latency_ms) || 0 : null,
      disk_read_bytes_per_sec:
        payload.disk_read_bytes_per_sec !== undefined
          ? Number(payload.disk_read_bytes_per_sec) || 0
          : null,
      disk_read_latency_ms:
        payload.disk_read_latency_ms !== undefined ? Number(payload.disk_read_latency_ms) || 0 : null,
      disk_write_bytes_per_sec:
        payload.disk_write_bytes_per_sec !== undefined
          ? Number(payload.disk_write_bytes_per_sec) || 0
          : null,
      disk_write_latency_ms:
        payload.disk_write_latency_ms !== undefined ? Number(payload.disk_write_latency_ms) || 0 : null,
      last_inference_age_ms:
        payload.last_inference_age_ms !== undefined ? Number(payload.last_inference_age_ms) || 0 : null,
      inference_input_rate:
        payload.inference_input_rate !== undefined
          ? Number(payload.inference_input_rate) || 0
          : null,
      inference_processing_rate:
        payload.inference_processing_rate !== undefined
          ? Number(payload.inference_processing_rate) || 0
          : null,
      inference_success_count:
        payload.inference_success_count !== undefined
          ? Number(payload.inference_success_count) || 0
          : null,
      inference_error_count:
        payload.inference_error_count !== undefined
          ? Number(payload.inference_error_count) || 0
          : null,
      sample_age_ms: openMonitorSampleAgeMs(row?.sampled_at, row?.updated_at),
      sampled_at: typeof row?.sampled_at === "string" ? row.sampled_at : null,
      updated_at: typeof row?.updated_at === "string" ? row.updated_at : null,
    };
  });
}

async function resolveAgentPairingForClient(
  db: D1Database,
  clientId: string,
  authorizationHeader: string | undefined
): Promise<{ userId: string; clientId: string; exeId: string } | null> {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return null;
  }

  const exeToken = authorizationHeader.slice("Bearer ".length).trim();
  if (!exeToken) return null;

  const exeTokenHash = await hashToken(exeToken);
  const pairing = await db.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) return null;

  const pairingRow = pairing as any;
  return {
    userId: String(pairingRow.user_id || ""),
    clientId: String(pairingRow.client_id || clientId),
    exeId: String(pairingRow.exe_id || "unknown_exe"),
  };
}

// WebSocket handler
const wsHandler = createWebSocketHandler();

// Country detection endpoint
app.get("/api/auth/country", async (c) => {
  // Try to get country from Cloudflare headers
  const countryCode = c.req.header("CF-IPCountry") || null;
  
  return c.json({ 
    detectedCountryCode: countryCode === "XX" ? null : countryCode 
  });
});

// Local auth endpoints
app.post("/api/auth/local/signup", async (c) => {
  // Ensure schema is initialized
  await ensureSchema(c.env.DB);
  
  try {
    const body = await c.req.json<{ 
      email: string; 
      password: string; 
      country_code?: string;
    }>();

    const email = normalizeEmail(body.email);
    const password = body.password;
    const countryCode = body.country_code || c.req.header("CF-IPCountry") || null;

    // Validate email
    if (!isValidEmail(email)) {
      return c.json({ error: "Invalid email format" }, 400);
    }

    // Validate password
    if (!isValidPassword(password)) {
      return c.json({ error: "Password must be at least 8 characters" }, 400);
    }

    // Check if user already exists
    const existingUser = await c.env.DB.prepare(
      "SELECT id FROM local_users WHERE email = ?"
    )
      .bind(email)
      .first();

    if (existingUser) {
      return c.json({ error: "Email already registered" }, 400);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const now = new Date().toISOString();
    const result = await c.env.DB.prepare(
      `INSERT INTO local_users (email, password_hash, country_code, last_login_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(email, passwordHash, countryCode, now, now, now)
      .run();

    const localUserId = result.meta.last_row_id;
    const appUserId = `local:${localUserId}`;

    // Create app user row
    await ensureAppUserRow(c.env.DB, {
      id: appUserId,
      email,
      auth_provider: "local",
      country_code: countryCode,
    });

    // Create session
    const sessionToken = generateSessionToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);

    await c.env.DB.prepare(
      `INSERT INTO local_sessions (session_token, user_id, expires_at)
       VALUES (?, ?, ?)`
    )
      .bind(sessionToken, localUserId, expiresAt.toISOString())
      .run();

    // Clear any existing Google session cookie before setting local session
    await clearGoogleSession(c);
    
    // Set session cookie with mobile-compatible attributes
    setCookie(c, LOCAL_SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      path: "/",
      sameSite: "none",
      secure: true,
      maxAge: SESSION_DURATION_DAYS * 24 * 60 * 60,
    });

    return c.json({ 
      success: true,
      user: {
        id: appUserId,
        email,
        country_code: countryCode,
      }
    }, 201);
  } catch (error) {
    console.error("Signup error:", error);
    return c.json({ error: "Signup failed" }, 500);
  }
});

app.post("/api/auth/local/login", async (c) => {
  // Ensure schema is initialized
  await ensureSchema(c.env.DB);
  
  try {
    const body = await c.req.json<{ email: string; password: string }>();

    const email = normalizeEmail(body.email);
    const password = body.password;

    // Validate inputs
    if (!isValidEmail(email) || !password) {
      return c.json({ error: "Invalid email or password" }, 400);
    }

    // Find user
    const user = await c.env.DB.prepare(
      "SELECT * FROM local_users WHERE email = ?"
    )
      .bind(email)
      .first();

    if (!user) {
      return c.json({ error: "Invalid email or password" }, 401);
    }

    const userData = user as any;

    // Verify password
    const isValidPassword = await bcrypt.compare(password, userData.password_hash);

    if (!isValidPassword) {
      return c.json({ error: "Invalid email or password" }, 401);
    }

    // Update last login
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      "UPDATE local_users SET last_login_at = ?, updated_at = ? WHERE id = ?"
    )
      .bind(now, now, userData.id)
      .run();

    const localUserId = userData.id;
    const appUserId = `local:${localUserId}`;

    // Ensure app user row exists
    await ensureAppUserRow(c.env.DB, {
      id: appUserId,
      email: userData.email,
      auth_provider: "local",
      country_code: userData.country_code,
    });

    // Create session
    const sessionToken = generateSessionToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);

    await c.env.DB.prepare(
      `INSERT INTO local_sessions (session_token, user_id, expires_at)
       VALUES (?, ?, ?)`
    )
      .bind(sessionToken, localUserId, expiresAt.toISOString())
      .run();

    // Clear any existing Google session cookie before setting local session
    await clearGoogleSession(c);
    
    // Set session cookie with mobile-compatible attributes
    setCookie(c, LOCAL_SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      path: "/",
      sameSite: "none",
      secure: true,
      maxAge: SESSION_DURATION_DAYS * 24 * 60 * 60,
    });

    return c.json({ 
      success: true,
      user: {
        id: appUserId,
        email: userData.email,
        country_code: userData.country_code,
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    return c.json({ error: "Login failed" }, 500);
  }
});

app.post("/api/auth/local/logout", async (c) => {
  const sessionToken = getCookie(c, LOCAL_SESSION_COOKIE_NAME);

  if (sessionToken) {
    // Delete session from database
    await c.env.DB.prepare(
      "DELETE FROM local_sessions WHERE session_token = ?"
    )
      .bind(sessionToken)
      .run();
  }

  // Clear cookie with same attributes
  setCookie(c, LOCAL_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: true,
    maxAge: 0,
  });

  return c.json({ success: true });
});

app.get("/api/auth/me", async (c) => {
  // Ensure schema is initialized
  await ensureSchema(c.env.DB);
  
  const localCookie = getCookie(c, LOCAL_SESSION_COOKIE_NAME);
  const googleCookie = getCookie(c, GOOGLE_SESSION_COOKIE_NAME);
  
  console.log("[auth/me] Local cookie exists:", !!localCookie);
  console.log("[auth/me] Google cookie exists:", !!googleCookie);
  
  // Check Google cookie FIRST (priority)
  if (googleCookie) {
    try {
      const user = await getGoogleSessionUser(c.env.DB, googleCookie);

      if (user) {
        console.log("[auth/me] -> google (canonical ID:", user.id, ")");
        return c.json({
          isAuthenticated: true,
          authProvider: "google",
          user: {
            id: user.id,
            email: user.email,
            google_user_data: user.google_user_data,
            created_at: user.created_at,
          },
        });
      }
    } catch (error) {
      console.error("[auth/me] Failed to get Google OAuth user:", error);
      if (shouldClearGoogleSessionOnAuthFailure(error)) {
        clearGoogleSessionCookie(c);
      }
    }
  }

  // Check local session only if Google not valid
  if (localCookie) {
    const session = await c.env.DB.prepare(
      `SELECT ls.*, lu.email, lu.country_code
       FROM local_sessions ls
       JOIN local_users lu ON ls.user_id = lu.id
       WHERE ls.session_token = ? AND ls.expires_at > ?`
    )
      .bind(localCookie, new Date().toISOString())
      .first();

    if (session) {
      const sessionData = session as any;
      const appUserId = `local:${sessionData.user_id}`;
      await ensureAppUserRow(c.env.DB, {
        id: appUserId,
        email: sessionData.email,
        auth_provider: "local",
        country_code: sessionData.country_code || null,
        locale: null,
      });
      const createdAt = await getAppUserCreatedAt(c.env.DB, appUserId);
      console.log("[auth/me] -> local");
      return c.json({
        isAuthenticated: true,
        authProvider: "local",
        user: {
          id: appUserId,
          email: sessionData.email,
          country_code: sessionData.country_code,
          created_at: createdAt,
        },
      });
    }
  }

  console.log("[auth/me] -> not authenticated");
  return c.json({
    isAuthenticated: false,
    authProvider: null,
    user: null,
  });
});

// OAuth endpoints
app.get("/api/oauth/google/redirect_url", async (c) => {
  try {
    const redirectUrl = await createGoogleOAuthRedirectUrl(c);
    return c.json({ redirectUrl }, 200);
  } catch (error) {
    console.error("[GOOGLE LOGIN] Failed to build redirect URL:", error);
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to initialize Google login.",
      },
      503
    );
  }
});

app.post("/api/sessions", async (c) => {
  // Ensure schema is initialized
  await ensureSchema(c.env.DB);
  
  const body = await c.req.json();

  if (!body.code) {
    return c.json({ error: "No authorization code provided" }, 400);
  }
  
  try {
    const state = typeof body.state === "string" ? body.state : "";
    const googleUser = await exchangeGoogleAuthorizationCode(c, body.code, state);
    const canonicalUserId = await resolveOrCreateGoogleAppUser(c.env.DB, googleUser);
    const providerSubject = getGoogleSubject(googleUser);
    const sessionToken = await createGoogleSession(c.env.DB, canonicalUserId, providerSubject);

    setSessionCookie(
      c,
      GOOGLE_SESSION_COOKIE_NAME,
      sessionToken,
      SESSION_DURATION_DAYS * 24 * 60 * 60
    );

    // Clear any existing local session to prevent dual sessions
    await clearLocalSession(c);
    clearGoogleOAuthFlowCookies(c);
    
    return c.json({ 
      success: true,
      user: {
        id: canonicalUserId,
        email: googleUser.email,
        auth_provider: "google",
      }
    }, 200);
  } catch (error) {
    console.error("[GOOGLE LOGIN] Failed to resolve canonical user:", error);
    clearGoogleOAuthFlowCookies(c);

    if (shouldClearGoogleSessionOnAuthFailure(error)) {
      return c.json(
        { error: error instanceof Error ? error.message : "Google login not allowed" },
        403
      );
    }

    return c.json({ error: "Failed to complete Google login" }, 500);
  }

  return c.json({ error: "Failed to authenticate with Google" }, 502);
});

app.get("/api/users/me", async (c) => {
  // Debug logging
  console.log("[AUTH] /api/users/me origin=", c.req.header("origin"));
  console.log("[AUTH] /api/users/me cookieHeaderLen=", (c.req.header("cookie") || "").length);
  
  // Ensure schema is initialized
  await ensureSchema(c.env.DB);
  
  // Check for local session first
  const localSessionToken = getCookie(c, LOCAL_SESSION_COOKIE_NAME);
  
  if (localSessionToken) {
    const session = await c.env.DB.prepare(
      `SELECT ls.*, lu.email, lu.country_code
       FROM local_sessions ls
       JOIN local_users lu ON ls.user_id = lu.id
       WHERE ls.session_token = ? AND ls.expires_at > ?`
    )
      .bind(localSessionToken, new Date().toISOString())
      .first();

    if (session) {
      const sessionData = session as any;
      const appUserId = `local:${sessionData.user_id}`;
      await ensureAppUserRow(c.env.DB, {
        id: appUserId,
        email: sessionData.email,
        auth_provider: "local",
        country_code: sessionData.country_code || null,
        locale: null,
      });
      const createdAt = await getAppUserCreatedAt(c.env.DB, appUserId);
      return c.json({
        id: appUserId,
        email: sessionData.email,
        auth_provider: "local",
        country_code: sessionData.country_code,
        created_at: createdAt,
      });
    }
  }

  // Fallback to Google OAuth
  const googleSessionToken = getCookie(c, GOOGLE_SESSION_COOKIE_NAME);
  
  if (googleSessionToken) {
    try {
      const user = await getGoogleSessionUser(c.env.DB, googleSessionToken);

      if (user) {
        return c.json({
          id: user.id,
          email: user.email,
          auth_provider: "google",
          google_user_data: user.google_user_data,
          created_at: user.created_at,
        });
      }
    } catch (error) {
      console.error("Failed to get Google OAuth user:", error);
      if (shouldClearGoogleSessionOnAuthFailure(error)) {
        clearGoogleSessionCookie(c);
      }
    }
  }

  return c.json({ error: "Not authenticated" }, 401);
});

app.get("/api/logout", async (c) => {
  await clearGoogleSession(c);

  return c.json({ success: true }, 200);
});

// Video upload endpoint
app.post("/api/video-uploads", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  console.log("[VIDEO UPLOAD] Received upload request from user:", user.id);

  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      console.log("[VIDEO UPLOAD] Error: No file provided");
      return c.json({ error: "No file provided" }, 400);
    }

    // Validate file type
    const allowedTypes = ["video/mp4", "video/webm", "video/quicktime"];
    const allowedExtensions = [".mp4", ".webm", ".mov"];
    
    const fileName = file.name.toLowerCase();
    const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext));
    const hasValidMimeType = allowedTypes.includes(file.type);

    if (!hasValidExtension || !hasValidMimeType) {
      console.log("[VIDEO UPLOAD] Error: Invalid file type. Got:", file.type, fileName);
      return c.json({ 
        error: "Invalid file type. Only MP4, WebM, and MOV videos are allowed." 
      }, 400);
    }

    // Validate file size (max 500MB)
    const maxSize = 500 * 1024 * 1024; // 500MB
    if (file.size > maxSize) {
      console.log("[VIDEO UPLOAD] Error: File too large:", file.size, "bytes");
      return c.json({ 
        error: "Video file is too large. Maximum size is 500MB." 
      }, 400);
    }

    // Generate storage key
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const extension = fileName.substring(fileName.lastIndexOf("."));
    const storageKey = `videos/${user.id}/${timestamp}-${random}${extension}`;

    console.log("[VIDEO UPLOAD] Uploading to R2:", storageKey);

    // Upload to R2
    const arrayBuffer = await file.arrayBuffer();
    await c.env.R2_BUCKET.put(storageKey, arrayBuffer, {
      httpMetadata: { 
        contentType: file.type 
      },
    });

    // Generate public URL
    const publicUrl = `${c.req.header("origin")}/api/video-downloads/${encodeURIComponent(storageKey)}`;

    // Insert into database
    const now = new Date().toISOString();
    const result = await c.env.DB.prepare(
      `INSERT INTO video_uploads (user_id, storage_key, public_url, original_name, mime_type, size_bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        user.id,
        storageKey,
        publicUrl,
        file.name,
        file.type,
        file.size,
        now,
        now
      )
      .run();

    const videoId = result.meta.last_row_id;

    console.log("[VIDEO UPLOAD] ✓ Video uploaded successfully. ID:", videoId, "Size:", file.size, "bytes");

    return c.json({
      id: videoId,
      public_url: publicUrl,
      original_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      created_at: now,
      storage_key: storageKey,
    }, 201);
  } catch (error) {
    console.error("[VIDEO UPLOAD] Error uploading video:", error);
    return c.json({ error: "Failed to upload video" }, 500);
  }
});

// Video download endpoint (for EXE to download videos)
app.get("/api/video-downloads/:storageKey", async (c) => {
  const storageKey = decodeURIComponent(c.req.param("storageKey"));

  console.log("[VIDEO DOWNLOAD] Request for:", storageKey);

  try {
    const object = await c.env.R2_BUCKET.get(storageKey);

    if (!object) {
      console.log("[VIDEO DOWNLOAD] Not found in R2:", storageKey);
      return c.json({ error: "Video not found" }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "no-cache");

    console.log("[VIDEO DOWNLOAD] ✓ Serving video:", storageKey);

    return c.body(object.body, { headers });
  } catch (error) {
    console.error("[VIDEO DOWNLOAD] Error fetching video:", error);
    return c.json({ error: "Failed to fetch video" }, 500);
  }
});

// Thumbnail endpoints (R2)
app.get("/api/thumbnails/:filename", anyAuthMiddleware, async (c) => {
  const filename = c.req.param("filename");
  console.log("[THUMBNAILS] GET", filename);
  
  try {
    const object = await c.env.R2_BUCKET.get(`thumbs/${filename}`);
    
    if (!object) {
      console.log("[THUMBNAILS] Not found in R2:", filename);
      return c.json({ error: "Thumbnail not found" }, 404);
    }

    // Get ETag from R2 object
    const etag = object.httpEtag;
    
    // Check If-None-Match header for conditional GET
    const ifNoneMatch = c.req.header("if-none-match");
    
    if (ifNoneMatch && ifNoneMatch === etag) {
      // ETag matches - return 304 Not Modified
      const headers = new Headers();
      headers.set("etag", etag);
      headers.set("cache-control", "public, max-age=31536000, immutable");
      headers.set("content-type", object.httpMetadata?.contentType || "image/jpeg");
      
      return c.body(null, { status: 304, headers });
    }

    // ETag doesn't match or not provided - return full response
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    
    // Since filename includes timestamp, it's immutable - can cache aggressively
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("content-type", object.httpMetadata?.contentType || "image/jpeg");
    headers.set("etag", etag);
    
    return c.body(object.body, { headers });
  } catch (error) {
    console.error("Failed to fetch thumbnail:", error);
    return c.json({ error: "Failed to fetch thumbnail" }, 500);
  }
});

// Detection media endpoints (R2) - serves both images and videos
app.get("/api/detections/:filename", anyAuthMiddleware, async (c) => {
  const filename = c.req.param("filename");
  const forceDownload = c.req.query("download") === "1";
  
  try {
    // Determine if this is a video or image based on extension
    const isVideo = filename.toLowerCase().endsWith('.mp4');
    const bucketPath = isVideo ? `detections_videos/${filename}` : `detections/${filename}`;
    const contentType = isVideo ? "video/mp4" : "image/jpeg";
    
    const object = await c.env.R2_BUCKET.get(bucketPath);
    
    if (!object) {
      return c.json({ error: "Detection media not found" }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "no-cache");
    headers.set("content-type", contentType);
    if (forceDownload) {
      const safeFilename = String(filename || "detection_media").replace(/["\r\n]/g, "_");
      headers.set("content-disposition", `attachment; filename="${safeFilename}"`);
    }
    
    return c.body(object.body, { headers });
  } catch (error) {
    console.error("Failed to fetch detection media:", error);
    return c.json({ error: "Failed to fetch detection media" }, 500);
  }
});

// Generic media download endpoint for R2 keys that may include nested folders.
app.get("/api/media-download/*", anyAuthMiddleware, async (c) => {
  let key = c.req.path.replace(/^\/api\/media-download\//, "");
  if (!key) {
    return c.json({ error: "Invalid key" }, 400);
  }

  try {
    key = decodeURIComponent(key);
  } catch {
    // Keep original if decode fails.
  }

  if (!key || key.includes("..") || key.startsWith("/") || key.startsWith("\\")) {
    return c.json({ error: "Invalid key" }, 400);
  }

  try {
    const object = await c.env.R2_BUCKET.get(key);
    if (!object) {
      return c.json({ error: "Media not found" }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "no-cache");

    const filename = key.split("/").pop() || "media";
    const safeFilename = filename.replace(/["\r\n]/g, "_");
    headers.set("content-disposition", `attachment; filename="${safeFilename}"`);

    if (!headers.get("content-type")) {
      const ext = String(filename.split(".").pop() || "").toLowerCase();
      const contentType =
        ext === "mp4"
          ? "video/mp4"
          : ext === "png"
          ? "image/png"
          : ext === "webp"
          ? "image/webp"
          : ext === "gif"
          ? "image/gif"
          : ext === "bmp"
          ? "image/bmp"
          : "image/jpeg";
      headers.set("content-type", contentType);
    }

    return c.body(object.body, { headers });
  } catch (error) {
    console.error("Failed to download media from R2:", error);
    return c.json({ error: "Failed to download media" }, 500);
  }
});

// Job alert clips (local disk)
app.get("/api/job-clips/*", anyAuthMiddleware, async (c) => {
  const forceDownload = c.req.query("download") === "1";
  let rel = c.req.path.replace(/^\/api\/job-clips\//, "");
  if (!rel) {
    return c.json({ error: "Invalid path" }, 400);
  }

  try {
    rel = decodeURIComponent(rel);
  } catch {
    // Keep original if decode fails
  }

  if (!rel || rel.includes("..") || rel.startsWith("/") || rel.startsWith("\\")) {
    return c.json({ error: "Invalid path" }, 400);
  }

  const baseDir = brand.dataPaths.jobAlertClips;

  let fs: any;
  let pathMod: any;
  try {
    fs = await import("node:fs");
    pathMod = await import("node:path");
  } catch {
    return c.json({ error: "Filesystem not available in this runtime" }, 501);
  }

  if (pathMod.isAbsolute(rel)) {
    return c.json({ error: "Invalid path" }, 400);
  }

  const baseResolved = pathMod.resolve(baseDir);
  const fullPath = pathMod.resolve(baseDir, rel);
  const normalizedBase = (baseResolved.toLowerCase() + pathMod.sep);
  const normalizedFull = fullPath.toLowerCase();

  if (!normalizedFull.startsWith(normalizedBase)) {
    return c.json({ error: "Invalid path" }, 400);
  }

  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      return c.json({ error: "Not found" }, 404);
    }

    const stream = fs.createReadStream(fullPath);
    c.header("content-type", "video/mp4");
    c.header("cache-control", "no-cache");
    if (forceDownload) {
      const safeFilename = String(pathMod.basename(fullPath) || "job_clip.mp4").replace(/["\r\n]/g, "_");
      c.header("content-disposition", `attachment; filename="${safeFilename}"`);
    }
    return c.body(stream as any);
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});

// Job alert images (local disk)
app.get("/api/job-images/*", anyAuthMiddleware, async (c) => {
  const forceDownload = c.req.query("download") === "1";
  let rel = c.req.path.replace(/^\/api\/job-images\//, "");
  if (!rel) {
    return c.json({ error: "Invalid path" }, 400);
  }

  try {
    rel = decodeURIComponent(rel);
  } catch {
    // Keep original if decode fails
  }

  if (!rel || rel.includes("..") || rel.startsWith("/") || rel.startsWith("\\")) {
    return c.json({ error: "Invalid path" }, 400);
  }

  const baseDir = brand.dataPaths.jobAlertImages;

  let fs: any;
  let pathMod: any;
  try {
    fs = await import("node:fs");
    pathMod = await import("node:path");
  } catch {
    return c.json({ error: "Filesystem not available in this runtime" }, 501);
  }

  if (pathMod.isAbsolute(rel)) {
    return c.json({ error: "Invalid path" }, 400);
  }

  const baseResolved = pathMod.resolve(baseDir);
  const fullPath = pathMod.resolve(baseDir, rel);
  const normalizedBase = (baseResolved.toLowerCase() + pathMod.sep);
  const normalizedFull = fullPath.toLowerCase();

  if (!normalizedFull.startsWith(normalizedBase)) {
    return c.json({ error: "Invalid path" }, 400);
  }

  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      return c.json({ error: "Not found" }, 404);
    }

    const ext = String(pathMod.extname(fullPath) || "").toLowerCase();
    const imageContentType =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
        ? "image/webp"
        : ext === ".gif"
        ? "image/gif"
        : ext === ".bmp"
        ? "image/bmp"
        : ext === ".jpeg" || ext === ".jpg"
        ? "image/jpeg"
        : "application/octet-stream";

    const stream = fs.createReadStream(fullPath);
    c.header("content-type", imageContentType);
    c.header("cache-control", "no-cache");
    if (forceDownload) {
      const safeFilename = String(pathMod.basename(fullPath) || "job_image.jpg").replace(/["\r\n]/g, "_");
      c.header("content-disposition", `attachment; filename="${safeFilename}"`);
    }
    return c.body(stream as any);
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});

type LocalTimeParts = {
  localDate: string;      // YYYY-MM-DD
  dayOfWeek: number;      // 0=Sunday, 6=Saturday
  dayOfMonth: number;     // 1-31
  monthOfYear: number;    // 1-12
  year: number;
  localTimeHHMM: string;  // HH:MM
};

function getLocalTimeInTimezoneAt(timezone: string, date: Date = new Date()): LocalTimeParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });

  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value || "";

  const year = parseInt(get("year"), 10);
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  const weekdayStr = get("weekday"); // "Sun", "Mon", etc.

  const weekdayMap: Record<string, number> = {
    "Sun": 0, "Mon": 1, "Tue": 2, "Wed": 3, "Thu": 4, "Fri": 5, "Sat": 6
  };
  const dayOfWeek = weekdayMap[weekdayStr] ?? 0;

  return {
    localDate: `${year}-${month}-${day}`,
    dayOfWeek,
    dayOfMonth: parseInt(day, 10),
    monthOfYear: parseInt(month, 10),
    year,
    localTimeHHMM: `${hour}:${minute}`,
  };
}

const normalizeTimeHHMM = (time: string): string | null => {
  if (!time) return null;
  const trimmed = String(time).trim();
  if (!trimmed) return null;
  const base = trimmed.length >= 5 ? trimmed.slice(0, 5) : trimmed;
  const match = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/.exec(base);
  if (!match) return null;
  const hh = match[1].padStart(2, "0");
  const mm = match[2];
  return `${hh}:${mm}`;
};

const parseHHMMToMinutes = (time: string): number | null => {
  const normalized = normalizeTimeHHMM(time);
  if (!normalized) return null;
  const match = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/.exec(normalized);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
};

const formatLocalDate = (y: number, m: number, d: number): string => {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
};

const parseLocalDate = (dateStr: string): { year: number; month: number; day: number } | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  return { year: parseInt(match[1], 10), month: parseInt(match[2], 10), day: parseInt(match[3], 10) };
};

const daysInMonth = (year: number, month: number): number => {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

const addDaysToDate = (year: number, month: number, day: number, deltaDays: number): { year: number; month: number; day: number } => {
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate() };
};

const getDayOfWeekForDate = (year: number, month: number, day: number): number => {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

type ScheduleEntry = {
  day_of_week: number | null;
  day_of_month: number | null;
  month_of_year: number | null;
  start_time: string;
};

const computeNextScheduleTime = (
  scheduleMode: string,
  entries: ScheduleEntry[],
  localNow: LocalTimeParts,
  activeFrom?: string | null,
  activeUntil?: string | null
): { date: string; time: string } | null => {
  if (!entries.length) return null;

  const mode = (scheduleMode || "").toLowerCase();

  let baseDate = localNow.localDate;
  let baseMinutes = parseHHMMToMinutes(localNow.localTimeHHMM) ?? 0;
  let baseParts = parseLocalDate(baseDate);
  if (!baseParts) return null;

  if (activeFrom && activeFrom > baseDate) {
    baseDate = activeFrom;
    baseMinutes = 0;
    const parsed = parseLocalDate(activeFrom);
    if (parsed) {
      baseParts = parsed;
      localNow = {
        ...localNow,
        localDate: activeFrom,
        year: parsed.year,
        monthOfYear: parsed.month,
        dayOfMonth: parsed.day,
        dayOfWeek: getDayOfWeekForDate(parsed.year, parsed.month, parsed.day),
        localTimeHHMM: "00:00",
      };
    }
  }

  const candidates: { date: string; time: string; sortKey: number }[] = [];

  for (const entry of entries) {
    const startMinutes = parseHHMMToMinutes(entry.start_time);
    if (startMinutes === null) continue;

    if (mode === "weekly" && entry.day_of_week !== null) {
      let daysUntil = (entry.day_of_week - localNow.dayOfWeek + 7) % 7;
      if (daysUntil === 0 && startMinutes <= baseMinutes) {
        daysUntil = 7;
      }
      const nextDate = addDaysToDate(baseParts.year, baseParts.month, baseParts.day, daysUntil);
      const dateStr = formatLocalDate(nextDate.year, nextDate.month, nextDate.day);
      if (activeUntil && dateStr > activeUntil) continue;
      candidates.push({
        date: dateStr,
        time: entry.start_time,
        sortKey: Date.UTC(nextDate.year, nextDate.month - 1, nextDate.day, Math.floor(startMinutes / 60), startMinutes % 60),
      });
    }

    if (mode === "monthly" && entry.day_of_month !== null) {
      let year = baseParts.year;
      let month = baseParts.month;
      const targetDay = entry.day_of_month;
      for (let i = 0; i < 24; i++) {
        const dim = daysInMonth(year, month);
        if (targetDay <= dim) {
          const isSameMonth = year === baseParts.year && month === baseParts.month;
          const shouldUse = !isSameMonth || targetDay > baseParts.day || (targetDay === baseParts.day && startMinutes > baseMinutes);
          if (shouldUse) {
            const dateStr = formatLocalDate(year, month, targetDay);
            if (!activeUntil || dateStr <= activeUntil) {
              candidates.push({
                date: dateStr,
                time: entry.start_time,
                sortKey: Date.UTC(year, month - 1, targetDay, Math.floor(startMinutes / 60), startMinutes % 60),
              });
            }
            break;
          }
        }
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
    }

    if (mode === "yearly" && entry.day_of_month !== null && entry.month_of_year !== null) {
      const targetMonth = entry.month_of_year;
      const targetDay = entry.day_of_month;
      let year = baseParts.year;
      for (let i = 0; i < 4; i++) {
        const dim = daysInMonth(year, targetMonth);
        if (targetDay <= dim) {
          const isSameYear = year === baseParts.year;
          const shouldUse =
            !isSameYear ||
            targetMonth > baseParts.month ||
            (targetMonth === baseParts.month && (targetDay > baseParts.day || (targetDay === baseParts.day && startMinutes > baseMinutes)));
          if (shouldUse) {
            const dateStr = formatLocalDate(year, targetMonth, targetDay);
            if (!activeUntil || dateStr <= activeUntil) {
              candidates.push({
                date: dateStr,
                time: entry.start_time,
                sortKey: Date.UTC(year, targetMonth - 1, targetDay, Math.floor(startMinutes / 60), startMinutes % 60),
              });
            }
            break;
          }
        }
        year += 1;
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.sortKey - b.sortKey);
  const next = candidates[0];
  if (activeFrom && next.date < activeFrom) {
    // If the computed candidate is before active_from, try again using active_from as base
    const activeBase = parseLocalDate(activeFrom);
    if (!activeBase) return null;
    const recalculated = computeNextScheduleTime(
      scheduleMode,
      entries,
      {
        localDate: activeFrom,
        dayOfWeek: getDayOfWeekForDate(activeBase.year, activeBase.month, activeBase.day),
        dayOfMonth: activeBase.day,
        monthOfYear: activeBase.month,
        year: activeBase.year,
        localTimeHHMM: "00:00",
      },
      activeFrom,
      activeUntil
    );
    return recalculated;
  }
  return { date: next.date, time: next.time };
};

const computeUpcomingOccurrences = (
  scheduleMode: string,
  entries: ScheduleEntry[],
  localNow: LocalTimeParts,
  activeFrom?: string | null,
  activeUntil?: string | null,
  daysAhead: number = 7
): Array<{ date: string; time: string }> => {
  if (!entries.length) return [];

  const mode = (scheduleMode || "").toLowerCase();

  const baseMinutes = parseHHMMToMinutes(localNow.localTimeHHMM) ?? 0;
  const occurrences: Array<{ date: string; time: string; sortKey: number }> = [];

  for (let i = 0; i <= daysAhead; i++) {
    const dateParts = addDaysToDate(localNow.year, localNow.monthOfYear, localNow.dayOfMonth, i);
    const dateStr = formatLocalDate(dateParts.year, dateParts.month, dateParts.day);

    if (activeFrom && dateStr < activeFrom) continue;
    if (activeUntil && dateStr > activeUntil) continue;

    const dow = getDayOfWeekForDate(dateParts.year, dateParts.month, dateParts.day);
    for (const entry of entries) {
      const normalizedTime = normalizeTimeHHMM(entry.start_time);
      if (!normalizedTime) continue;
      const startMinutes = parseHHMMToMinutes(normalizedTime);
      if (startMinutes === null) continue;

      if (mode === "weekly") {
        if (entry.day_of_week === null || entry.day_of_week !== dow) continue;
      } else if (mode === "monthly") {
        if (entry.day_of_month === null || entry.day_of_month !== dateParts.day) continue;
      } else if (mode === "yearly") {
        if (
          entry.day_of_month === null ||
          entry.month_of_year === null ||
          entry.day_of_month !== dateParts.day ||
          entry.month_of_year !== dateParts.month
        ) {
          continue;
        }
      } else {
        continue;
      }

      if (i === 0 && startMinutes <= baseMinutes) continue;

      occurrences.push({
        date: dateStr,
        time: normalizedTime,
        sortKey: Date.UTC(
          dateParts.year,
          dateParts.month - 1,
          dateParts.day,
          Math.floor(startMinutes / 60),
          startMinutes % 60
        ),
      });
    }
  }

  occurrences.sort((a, b) => a.sortKey - b.sortKey);
  return occurrences.map((o) => ({ date: o.date, time: o.time }));
};

type RecurringScheduleMode = "weekly" | "monthly" | "yearly";
type RecurringScheduleWindow = {
  startMinutes: number;
  endMinutes: number;
};
type RecurringScheduleDay = {
  day_of_week: number | null;
  day_of_month: number | null;
  month_of_year: number | null;
  windows: RecurringScheduleWindow[];
};
type RecurringScheduleShape = {
  job_id: number | null;
  job_name: string;
  schedule_mode: RecurringScheduleMode;
  timezone: string;
  active_from: string | null;
  active_until: string | null;
  days: RecurringScheduleDay[];
};
type CoreModelBusyState =
  | {
      source: "camera_agent";
      camera_id: number | null;
      camera_name: string | null;
      algorithm_id: number | null;
    }
  | {
      source: "running_job";
      job_id: number;
      job_name: string | null;
    };

const normalizeRecurringScheduleMode = (value: unknown): RecurringScheduleMode | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "weekly" || normalized === "monthly" || normalized === "yearly") {
    return normalized;
  }
  return null;
};

const formatMinutesToHHMM = (totalMinutes: number): string => {
  const safe = Math.max(0, Math.min(1439, Math.floor(totalMinutes)));
  const hh = String(Math.floor(safe / 60)).padStart(2, "0");
  const mm = String(safe % 60).padStart(2, "0");
  return `${hh}:${mm}`;
};

const normalizeRecurringScheduleDayFromRaw = (
  mode: RecurringScheduleMode,
  rawDay: {
    day_of_week?: unknown;
    day_of_month?: unknown;
    month_of_year?: unknown;
    windows?: Array<{ start_time?: unknown; end_time?: unknown }>;
  }
): RecurringScheduleDay | null => {
  const windowsRaw = Array.isArray(rawDay.windows) ? rawDay.windows : [];
  const windows: RecurringScheduleWindow[] = [];
  for (const window of windowsRaw) {
    const startMinutes = parseHHMMToMinutes(String(window?.start_time ?? ""));
    const endMinutes = parseHHMMToMinutes(String(window?.end_time ?? ""));
    if (startMinutes === null || endMinutes === null) continue;
    if (endMinutes <= startMinutes) continue;
    windows.push({
      startMinutes,
      endMinutes,
    });
  }
  if (windows.length === 0) return null;

  const dayOfWeekRaw = Number(rawDay.day_of_week);
  const dayOfMonthRaw = Number(rawDay.day_of_month);
  const monthOfYearRaw = Number(rawDay.month_of_year);

  if (mode === "weekly") {
    if (!Number.isInteger(dayOfWeekRaw) || dayOfWeekRaw < 0 || dayOfWeekRaw > 6) return null;
    return {
      day_of_week: dayOfWeekRaw,
      day_of_month: null,
      month_of_year: null,
      windows,
    };
  }
  if (mode === "monthly") {
    if (!Number.isInteger(dayOfMonthRaw) || dayOfMonthRaw < 1 || dayOfMonthRaw > 31) return null;
    return {
      day_of_week: null,
      day_of_month: dayOfMonthRaw,
      month_of_year: null,
      windows,
    };
  }
  if (!Number.isInteger(dayOfMonthRaw) || dayOfMonthRaw < 1 || dayOfMonthRaw > 31) return null;
  if (!Number.isInteger(monthOfYearRaw) || monthOfYearRaw < 1 || monthOfYearRaw > 12) return null;
  return {
    day_of_week: null,
    day_of_month: dayOfMonthRaw,
    month_of_year: monthOfYearRaw,
    windows,
  };
};

const buildRecurringScheduleFromInput = (input: {
  job_id?: number | null;
  job_name?: string | null;
  schedule_mode: unknown;
  timezone?: unknown;
  active_from?: unknown;
  active_until?: unknown;
  schedule_days?: Array<{
    day_of_week?: unknown;
    day_of_month?: unknown;
    month_of_year?: unknown;
    windows?: Array<{ start_time?: unknown; end_time?: unknown }>;
  }>;
}): RecurringScheduleShape | null => {
  const scheduleMode = normalizeRecurringScheduleMode(input.schedule_mode);
  if (!scheduleMode) return null;
  const rawDays = Array.isArray(input.schedule_days) ? input.schedule_days : [];
  const days: RecurringScheduleDay[] = [];
  for (const rawDay of rawDays) {
    const normalized = normalizeRecurringScheduleDayFromRaw(scheduleMode, rawDay);
    if (!normalized) continue;
    days.push(normalized);
  }
  if (days.length === 0) return null;

  return {
    job_id:
      Number.isInteger(Number(input.job_id)) && Number(input.job_id) > 0
        ? Number(input.job_id)
        : null,
    job_name:
      typeof input.job_name === "string" && input.job_name.trim()
        ? input.job_name.trim()
        : "",
    schedule_mode: scheduleMode,
    timezone:
      typeof input.timezone === "string" && input.timezone.trim() ? input.timezone.trim() : "UTC",
    active_from:
      typeof input.active_from === "string" && input.active_from.trim()
        ? input.active_from.trim()
        : null,
    active_until:
      typeof input.active_until === "string" && input.active_until.trim()
        ? input.active_until.trim()
        : null,
    days,
  };
};

const buildRecurringScheduleDaysInputFromSchedule = (
  schedule: RecurringScheduleShape
): Array<{
  day_of_week?: number;
  day_of_month?: number;
  month_of_year?: number;
  windows: Array<{ start_time: string; end_time: string }>;
}> => {
  return schedule.days.map((day) => ({
    ...(day.day_of_week !== null ? { day_of_week: day.day_of_week } : {}),
    ...(day.day_of_month !== null ? { day_of_month: day.day_of_month } : {}),
    ...(day.month_of_year !== null ? { month_of_year: day.month_of_year } : {}),
    windows: day.windows.map((window) => ({
      start_time: formatMinutesToHHMM(window.startMinutes),
      end_time: formatMinutesToHHMM(window.endMinutes),
    })),
  }));
};

const doesRecurringScheduleDayMatchDate = (
  mode: RecurringScheduleMode,
  day: RecurringScheduleDay,
  dateParts: { year: number; month: number; day: number },
  dayOfWeek: number
): boolean => {
  if (mode === "weekly") {
    return day.day_of_week !== null && day.day_of_week === dayOfWeek;
  }
  if (mode === "monthly") {
    return day.day_of_month !== null && day.day_of_month === dateParts.day;
  }
  return (
    day.day_of_month !== null &&
    day.month_of_year !== null &&
    day.day_of_month === dateParts.day &&
    day.month_of_year === dateParts.month
  );
};

const buildRecurringIntervalsByDate = (
  schedule: RecurringScheduleShape,
  horizonDays = 400
): Map<string, RecurringScheduleWindow[]> => {
  const intervalsByDate = new Map<string, RecurringScheduleWindow[]>();
  if (!schedule.days.length) return intervalsByDate;

  let localNow: LocalTimeParts;
  try {
    localNow = getLocalTimeInTimezoneAt(schedule.timezone || "UTC");
  } catch {
    localNow = getLocalTimeInTimezoneAt("UTC");
  }

  let baseDate = localNow.localDate;
  if (schedule.active_from && schedule.active_from > baseDate) {
    baseDate = schedule.active_from;
  }
  const baseDateParts = parseLocalDate(baseDate);
  if (!baseDateParts) return intervalsByDate;

  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const dateParts = addDaysToDate(baseDateParts.year, baseDateParts.month, baseDateParts.day, offset);
    const dateStr = formatLocalDate(dateParts.year, dateParts.month, dateParts.day);
    if (schedule.active_from && dateStr < schedule.active_from) continue;
    if (schedule.active_until && dateStr > schedule.active_until) break;

    const dayOfWeek = getDayOfWeekForDate(dateParts.year, dateParts.month, dateParts.day);
    for (const day of schedule.days) {
      if (!doesRecurringScheduleDayMatchDate(schedule.schedule_mode, day, dateParts, dayOfWeek)) {
        continue;
      }
      if (day.windows.length === 0) continue;
      const current = intervalsByDate.get(dateStr) || [];
      for (const window of day.windows) {
        if (window.endMinutes <= window.startMinutes) continue;
        current.push(window);
      }
      if (current.length > 0) {
        intervalsByDate.set(dateStr, current);
      }
    }
  }

  return intervalsByDate;
};

const recurringSchedulesOverlap = (
  a: RecurringScheduleShape,
  b: RecurringScheduleShape
): boolean => {
  if (a.days.length === 0 || b.days.length === 0) return false;

  const aIntervals = buildRecurringIntervalsByDate(a);
  const bIntervals = buildRecurringIntervalsByDate(b);
  if (aIntervals.size === 0 || bIntervals.size === 0) return false;

  const [smaller, larger] =
    aIntervals.size <= bIntervals.size ? [aIntervals, bIntervals] : [bIntervals, aIntervals];

  for (const [date, firstIntervals] of smaller.entries()) {
    const secondIntervals = larger.get(date);
    if (!secondIntervals || secondIntervals.length === 0) continue;
    for (const first of firstIntervals) {
      for (const second of secondIntervals) {
        if (first.startMinutes < second.endMinutes && second.startMinutes < first.endMinutes) {
          return true;
        }
      }
    }
  }

  return false;
};

const doesInferenceGroupsUseCoreModel = (raw: unknown): boolean => {
  const groups = parseStoredInferenceGroups(raw);
  return groups.some((group) => {
    const model = normalizeJobStepInferenceModel(group?.inference_model);
    return model === "core";
  });
};

const countActiveCoreAgentsInJob = async (
  db: D1Database,
  userId: string,
  jobId: number,
  excludeAgentId?: number
): Promise<number> => {
  if (!Number.isInteger(jobId) || jobId <= 0) return 0;
  let query =
    `SELECT COUNT(*) AS count
     FROM job_step_agents jsa
     JOIN job_steps js ON js.id = jsa.step_id
     JOIN jobs j ON j.id = js.job_id
     WHERE j.user_id = ?
       AND js.job_id = ?
       AND jsa.is_active = 1
       AND LOWER(COALESCE(NULLIF(TRIM(jsa.inference_model), ''), 'ultra')) = 'core'`;
  const params: Array<string | number> = [userId, jobId];
  if (Number.isInteger(excludeAgentId) && Number(excludeAgentId) > 0) {
    query += " AND jsa.id <> ?";
    params.push(Number(excludeAgentId));
  }
  const row = await db.prepare(query).bind(...params).first();
  const count = Number((row as any)?.count ?? 0);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.floor(count);
};

const jobHasCoreModelConfigured = async (
  db: D1Database,
  userId: string,
  jobId: number
): Promise<boolean> => {
  if (!Number.isInteger(jobId) || jobId <= 0) return false;

  const activeCoreAgent = await db
    .prepare(
      `SELECT 1
       FROM job_step_agents jsa
       JOIN job_steps js ON js.id = jsa.step_id
       JOIN jobs j ON j.id = js.job_id
       WHERE j.user_id = ?
         AND js.job_id = ?
         AND jsa.is_active = 1
         AND LOWER(COALESCE(NULLIF(TRIM(jsa.inference_model), ''), 'ultra')) = 'core'
       LIMIT 1`
    )
    .bind(userId, jobId)
    .first();
  if (activeCoreAgent) return true;

  const { results: stepRows } = await db
    .prepare(
      `SELECT js.inference_groups
       FROM job_steps js
       JOIN jobs j ON j.id = js.job_id
       WHERE js.job_id = ? AND j.user_id = ?`
    )
    .bind(jobId, userId)
    .all();
  for (const row of stepRows || []) {
    if (doesInferenceGroupsUseCoreModel((row as any)?.inference_groups)) {
      return true;
    }
  }
  return false;
};

const loadRecurringScheduleForJob = async (
  db: D1Database,
  userId: string,
  jobId: number
): Promise<RecurringScheduleShape | null> => {
  if (!Number.isInteger(jobId) || jobId <= 0) return null;
  const jobRow = await db
    .prepare(
      `SELECT id, name, schedule_mode, timezone, active_from, active_until
       FROM jobs
       WHERE id = ? AND user_id = ?
       LIMIT 1`
    )
    .bind(jobId, userId)
    .first();
  if (!jobRow) return null;

  const scheduleMode = normalizeRecurringScheduleMode((jobRow as any)?.schedule_mode);
  if (!scheduleMode) return null;

  const { results: rows } = await db
    .prepare(
      `SELECT jsd.day_of_week, jsd.day_of_month, jsd.month_of_year, jsw.start_time, jsw.end_time
       FROM job_schedule_days jsd
       JOIN job_schedule_windows jsw ON jsw.schedule_day_id = jsd.id
       WHERE jsd.job_id = ?
         AND (jsw.is_enabled = 1 OR jsw.is_enabled IS NULL)
       ORDER BY jsd.sort_order ASC, jsw.sort_order ASC`
    )
    .bind(jobId)
    .all();

  const grouped = new Map<
    string,
    {
      day_of_week?: number;
      day_of_month?: number;
      month_of_year?: number;
      windows: Array<{ start_time: string; end_time: string }>;
    }
  >();
  for (const row of rows || []) {
    const dayOfWeek = Number((row as any)?.day_of_week);
    const dayOfMonth = Number((row as any)?.day_of_month);
    const monthOfYear = Number((row as any)?.month_of_year);
    const safeDayOfWeek = Number.isInteger(dayOfWeek) ? dayOfWeek : null;
    const safeDayOfMonth = Number.isInteger(dayOfMonth) ? dayOfMonth : null;
    const safeMonthOfYear = Number.isInteger(monthOfYear) ? monthOfYear : null;
    const key = `${safeDayOfWeek ?? "x"}|${safeDayOfMonth ?? "x"}|${safeMonthOfYear ?? "x"}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        ...(safeDayOfWeek !== null ? { day_of_week: safeDayOfWeek } : {}),
        ...(safeDayOfMonth !== null ? { day_of_month: safeDayOfMonth } : {}),
        ...(safeMonthOfYear !== null ? { month_of_year: safeMonthOfYear } : {}),
        windows: [],
      });
    }
    grouped.get(key)!.windows.push({
      start_time: String((row as any)?.start_time ?? ""),
      end_time: String((row as any)?.end_time ?? ""),
    });
  }

  return buildRecurringScheduleFromInput({
    job_id: Number((jobRow as any)?.id),
    job_name: String((jobRow as any)?.name ?? ""),
    schedule_mode: scheduleMode,
    timezone: String((jobRow as any)?.timezone ?? "UTC"),
    active_from: (jobRow as any)?.active_from ?? null,
    active_until: (jobRow as any)?.active_until ?? null,
    schedule_days: Array.from(grouped.values()),
  });
};

const findCoreScheduleConflictForCandidate = async (
  db: D1Database,
  userId: string,
  candidateSchedule: RecurringScheduleShape,
  excludeJobId?: number
): Promise<{ job_id: number; job_name: string | null } | null> => {
  const { results: jobRows } = await db
    .prepare(
      `SELECT id, name
       FROM jobs
       WHERE user_id = ?
         AND schedule_mode IN ('weekly', 'monthly', 'yearly')
         ${Number.isInteger(excludeJobId) && Number(excludeJobId) > 0 ? "AND id <> ?" : ""}
       ORDER BY id ASC`
    )
    .bind(
      userId,
      ...(Number.isInteger(excludeJobId) && Number(excludeJobId) > 0
        ? [Number(excludeJobId)]
        : [])
    )
    .all();

  for (const row of jobRows || []) {
    const jobId = Number((row as any)?.id);
    if (!Number.isInteger(jobId) || jobId <= 0) continue;
    const hasCore = await jobHasCoreModelConfigured(db, userId, jobId);
    if (!hasCore) continue;
    const otherSchedule = await loadRecurringScheduleForJob(db, userId, jobId);
    if (!otherSchedule) continue;
    if (recurringSchedulesOverlap(candidateSchedule, otherSchedule)) {
      return {
        job_id: jobId,
        job_name:
          typeof (row as any)?.name === "string" && (row as any).name.trim()
            ? String((row as any).name).trim()
            : null,
      };
    }
  }

  return null;
};

const findEnabledCoreCameraAgentForUser = async (
  db: D1Database,
  userId: string,
  options: {
    excludeAlgorithmId?: number;
    requireRunningCamera?: boolean;
  } = {}
): Promise<{ algorithm_id: number | null; camera_id: number | null; camera_name: string | null } | null> => {
  let query =
    `SELECT ca.id AS algorithm_id, ca.camera_id, c.name AS camera_name
     FROM camera_algorithms ca
     JOIN cameras c ON c.id = ca.camera_id
     WHERE c.user_id = ?
       AND ca.algorithm_type LIKE 'custom_%'
       AND ca.is_enabled = 1
       AND LOWER(COALESCE(NULLIF(TRIM(ca.inference_model), ''), 'ultra')) = 'core'`;
  const params: Array<string | number> = [userId];
  if (Number.isInteger(options.excludeAlgorithmId) && Number(options.excludeAlgorithmId) > 0) {
    query += " AND ca.id <> ?";
    params.push(Number(options.excludeAlgorithmId));
  }
  if (options.requireRunningCamera) {
    query += " AND c.is_service_running = 1";
  }
  query += " ORDER BY ca.updated_at DESC, ca.id DESC LIMIT 1";

  const row = await db.prepare(query).bind(...params).first();
  if (!row) return null;
  const algorithmId = Number((row as any)?.algorithm_id);
  const cameraId = Number((row as any)?.camera_id);
  return {
    algorithm_id: Number.isInteger(algorithmId) && algorithmId > 0 ? algorithmId : null,
    camera_id: Number.isInteger(cameraId) && cameraId > 0 ? cameraId : null,
    camera_name:
      typeof (row as any)?.camera_name === "string" && (row as any).camera_name.trim()
        ? String((row as any).camera_name).trim()
        : null,
  };
};

const findRunningCoreJobForUser = async (
  db: D1Database,
  userId: string
): Promise<{ job_id: number; job_name: string | null } | null> => {
  const { results } = await db
    .prepare(
      `SELECT jrs.job_id, j.name AS job_name
       FROM job_runtime_states jrs
       JOIN jobs j ON j.id = jrs.job_id
       WHERE j.user_id = ?
         AND jrs.status IN ('running', 'stopping')
       ORDER BY jrs.updated_at DESC`
    )
    .bind(userId)
    .all();

  for (const row of results || []) {
    const jobId = Number((row as any)?.job_id);
    if (!Number.isInteger(jobId) || jobId <= 0) continue;
    const hasCore = await jobHasCoreModelConfigured(db, userId, jobId);
    if (!hasCore) continue;
    return {
      job_id: jobId,
      job_name:
        typeof (row as any)?.job_name === "string" && (row as any).job_name.trim()
          ? String((row as any).job_name).trim()
          : null,
    };
  }
  return null;
};

const findCoreModelBusyStateForCameraEnable = async (
  db: D1Database,
  userId: string,
  options: { excludeAlgorithmId?: number } = {}
): Promise<CoreModelBusyState | null> => {
  const activeCoreAgent = await findEnabledCoreCameraAgentForUser(db, userId, {
    excludeAlgorithmId: options.excludeAlgorithmId,
    requireRunningCamera: false,
  });
  if (activeCoreAgent) {
    return {
      source: "camera_agent",
      camera_id: activeCoreAgent.camera_id,
      camera_name: activeCoreAgent.camera_name,
      algorithm_id: activeCoreAgent.algorithm_id,
    };
  }

  const runningCoreJob = await findRunningCoreJobForUser(db, userId);
  if (runningCoreJob) {
    return {
      source: "running_job",
      job_id: runningCoreJob.job_id,
      job_name: runningCoreJob.job_name,
    };
  }

  return null;
};

const buildCoreModelJobLimitErrorBody = () => ({
  error: CORE_MODEL_JOB_LIMIT_ERROR,
  message: CORE_MODEL_JOB_LIMIT_MESSAGE,
});

const buildCoreModelScheduleConflictErrorBody = (
  conflictingJobName: string | null,
  conflictingJobId: number | null
) => ({
  error: CORE_MODEL_SCHEDULE_CONFLICT_ERROR,
  message: conflictingJobName
    ? `Core model is already reserved by job "${conflictingJobName}" in an overlapping schedule.`
    : "Core model is already reserved by another job in an overlapping schedule.",
  conflicting_job_id:
    Number.isInteger(conflictingJobId) && Number(conflictingJobId) > 0
      ? Number(conflictingJobId)
      : null,
  conflicting_job_name:
    typeof conflictingJobName === "string" && conflictingJobName.trim()
      ? conflictingJobName.trim()
      : null,
});

const buildCoreModelBusyErrorBody = (state: CoreModelBusyState) => {
  if (state.source === "camera_agent") {
    return {
      error: CORE_MODEL_BUSY_ERROR,
      message: state.camera_name
        ? `Core model is already enabled in camera "${state.camera_name}". Disable it before enabling another Core agent.`
        : "Core model is already enabled in another camera agent. Disable it before enabling another Core agent.",
      source: state.source,
      camera_id: state.camera_id,
      camera_name: state.camera_name,
      algorithm_id: state.algorithm_id,
    };
  }
  return {
    error: CORE_MODEL_BUSY_ERROR,
    message: state.job_name
      ? `Core model is currently used by running job "${state.job_name}". Try again after the job finishes.`
      : "Core model is currently used by a running job. Try again after the job finishes.",
    source: state.source,
    job_id: state.job_id,
    job_name: state.job_name,
  };
};

const buildCoreModelChatContentionWarning = (
  language: string,
  details: { cameraBusy: boolean; jobBusy: boolean }
) => {
  const normalizedLanguage = String(language || "").trim().toLowerCase();
  const isPortuguese = normalizedLanguage.startsWith("pt");
  if (isPortuguese) {
    if (details.cameraBusy && details.jobBusy) {
      return "Aviso: o modelo Core está em uso por um agente de câmera e por um job em execução. As respostas do chat podem ficar mais lentas.";
    }
    if (details.cameraBusy) {
      return "Aviso: o modelo Core está em uso por um agente de câmera ativo. As respostas do chat podem ficar mais lentas.";
    }
    return "Aviso: o modelo Core está em uso por um job em execução. As respostas do chat podem ficar mais lentas.";
  }
  if (details.cameraBusy && details.jobBusy) {
    return "Warning: Core model is in use by a camera agent and a running job. Chat responses may be slower.";
  }
  if (details.cameraBusy) {
    return "Warning: Core model is in use by an active camera agent. Chat responses may be slower.";
  }
  return "Warning: Core model is in use by a running job. Chat responses may be slower.";
};

// Combined dashboard endpoint - returns cameras, token balance, and unread count in one request
app.get("/api/dashboard", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  // Fetch cameras
  const { results: cameras } = await c.env.DB.prepare(
    "SELECT * FROM cameras WHERE user_id = ? ORDER BY created_at DESC"
  )
    .bind(user.id)
    .all();

  const camerasWithOffset = cameras || [];

  // Fetch token balance
  let balance = await c.env.DB.prepare(
    "SELECT * FROM token_balances WHERE user_id = ?"
  )
    .bind(user.id)
    .first();

  if (!balance) {
    await c.env.DB.prepare(
      "INSERT INTO token_balances (user_id, balance, input_balance, output_balance, total_spent) VALUES (?, 0, 0, 0, 0)"
    )
      .bind(user.id)
      .run();

    balance = await c.env.DB.prepare(
      "SELECT * FROM token_balances WHERE user_id = ?"
    )
      .bind(user.id)
      .first();
  }

  // Fetch unread notification count
  const unreadResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`
  )
    .bind(user.id)
    .first();

  const unreadCount = (unreadResult as any)?.count || 0;

  // Build dashboard payload (NEW)
  const cameraIds = camerasWithOffset.map((c: any) => c.id);
  const hasCameras = cameraIds.length > 0;

  // Compute enabled agents per camera (one query)
  const enabledAgentsMap: Record<number, { count: number; types: string[] }> = {};
  if (hasCameras) {
    const placeholders = cameraIds.map(() => "?").join(",");
    const { results: agentStats } = await c.env.DB.prepare(
      `SELECT camera_id, COUNT(*) AS enabled_count, GROUP_CONCAT(algorithm_type) AS enabled_types
       FROM camera_algorithms
       WHERE camera_id IN (${placeholders}) AND is_enabled = 1
       GROUP BY camera_id`
    )
      .bind(...cameraIds)
      .all();

    for (const row of (agentStats || [])) {
      const r = row as any;
      enabledAgentsMap[r.camera_id] = {
        count: r.enabled_count || 0,
        types: r.enabled_types ? r.enabled_types.split(",") : [],
      };
    }
  }

  // Last camera started/online timestamp per camera (one query)
  const lastStartedMap: Record<number, string> = {};
  if (hasCameras) {
    const { results: startedStats } = await c.env.DB.prepare(
      `SELECT camera_id, MAX(created_at) AS last_started_at
       FROM events
       WHERE user_id = ? AND event_type IN ('camera_started', 'camera_online')
       GROUP BY camera_id`
    )
      .bind(user.id)
      .all();

    for (const row of (startedStats || [])) {
      const r = row as any;
      lastStartedMap[r.camera_id] = r.last_started_at;
    }
  }

  // Last connection failure per camera (one query)
  const lastErrorMap: Record<number, string> = {};
  if (hasCameras) {
    const { results: errorStats } = await c.env.DB.prepare(
      `SELECT camera_id, MAX(created_at) AS last_error_at
       FROM events
       WHERE user_id = ? AND event_type = 'camera_connection_failed'
       GROUP BY camera_id`
    )
      .bind(user.id)
      .all();

    for (const row of (errorStats || [])) {
      const r = row as any;
      lastErrorMap[r.camera_id] = r.last_error_at;
    }
  }

  // Detection counts per camera last 24h + last detection time (one query)
  const detectionStatsMap: Record<number, { count_24h: number; last_detected_at: string | null }> = {};
  if (hasCameras) {
    const { results: detStats } = await c.env.DB.prepare(
      `SELECT camera_id, COUNT(*) AS det_24h, MAX(detected_at) AS last_detected_at
       FROM detections
       WHERE user_id = ? AND detected_at >= datetime('now', '-1 day')
       GROUP BY camera_id`
    )
      .bind(user.id)
      .all();

    for (const row of (detStats || [])) {
      const r = row as any;
      detectionStatsMap[r.camera_id] = {
        count_24h: r.det_24h || 0,
        last_detected_at: r.last_detected_at || null,
      };
    }
  }

  // Build perCamera map
  const perCamera: Record<number, any> = {};
  for (const cam of camerasWithOffset) {
    const c = cam as any;
    perCamera[c.id] = {
      enabled_agents_count: enabledAgentsMap[c.id]?.count || 0,
      enabled_agents_types: enabledAgentsMap[c.id]?.types || [],
      last_started_at: lastStartedMap[c.id] || null,
      last_error_at: lastErrorMap[c.id] || null,
      detections_24h: detectionStatsMap[c.id]?.count_24h || 0,
      last_detected_at: detectionStatsMap[c.id]?.last_detected_at || null,
    };
  }

  // Global stats
  const camerasTotal = camerasWithOffset.length;
  const camerasRunning = camerasWithOffset.filter((c: any) => c.is_service_running === 1).length;
  const camerasOnline = camerasWithOffset.filter((c: any) => c.is_service_running === 1).length;
  const agentsEnabledTotal = Object.values(enabledAgentsMap).reduce((sum, a) => sum + a.count, 0);

  const detections24hResult = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM detections WHERE user_id = ? AND detected_at >= datetime('now', '-1 day')`
  )
    .bind(user.id)
    .first();
  const detections24hTotal = (detections24hResult as any)?.count || 0;

  const pendingCommandsResult = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM commands WHERE user_id = ? AND status = 'pending'`
  )
    .bind(user.id)
    .first();
  const pendingCommands = (pendingCommandsResult as any)?.count || 0;

  const jobsTotalResult = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM jobs WHERE user_id = ?`
  )
    .bind(user.id)
    .first();
  const jobsTotal = (jobsTotalResult as any)?.count || 0;

  const jobsRunningResult = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM job_runtime_states WHERE user_id = ? AND status = 'running'`
  )
    .bind(user.id)
    .first();
  const jobsRunning = (jobsRunningResult as any)?.count || 0;

  const lastEventResult = await c.env.DB.prepare(
    `SELECT MAX(id) AS last_event_id FROM events WHERE user_id = ?`
  )
    .bind(user.id)
    .first();
  const lastEventId = (lastEventResult as any)?.last_event_id || 0;

  const lastDetectionResult = await c.env.DB.prepare(
    `SELECT MAX(detected_at) AS last_detection_at FROM detections WHERE user_id = ?`
  )
    .bind(user.id)
    .first();
  const lastDetectionAt = (lastDetectionResult as any)?.last_detection_at || null;

  const lastJobFireResult = await c.env.DB.prepare(
    `SELECT MAX(triggered_at_utc) AS last_job_fire_at FROM job_schedule_fires WHERE job_id IN (SELECT id FROM jobs WHERE user_id = ?)`
  )
    .bind(user.id)
    .first();
  const lastJobFireAt = (lastJobFireResult as any)?.last_job_fire_at || null;

  const jobsUpdatedAtMaxResult = await c.env.DB.prepare(
    `SELECT MAX(updated_at) AS max_updated FROM jobs WHERE user_id = ?`
  )
    .bind(user.id)
    .first();
  const jobsUpdatedAtMax = jobsUpdatedAtMaxResult && (jobsUpdatedAtMaxResult as any).max_updated
    ? new Date((jobsUpdatedAtMaxResult as any).max_updated).getTime()
    : 0;

  const { results: captureThreadMetricRows } = await c.env.DB.prepare(
    `SELECT m.client_id,
            m.exe_id,
            m.camera_id,
            m.thread_name,
            m.cpu_percent,
            m.capture_mem_estimated_bytes,
            m.process_working_set_bytes,
            m.process_private_bytes,
            m.queue_depth,
            m.sampled_at,
            m.updated_at,
            c.name AS camera_name
     FROM capture_thread_metrics_latest m
     LEFT JOIN cameras c
       ON c.user_id = m.user_id
      AND c.id = m.camera_id
     WHERE m.user_id = ?
     ORDER BY m.updated_at DESC, m.camera_id ASC, m.thread_name ASC
     LIMIT 512`
  )
    .bind(user.id)
    .all();

  const captureThreads = (captureThreadMetricRows || []).map((row: any) => ({
    client_id: String(row.client_id || ""),
    exe_id: String(row.exe_id || ""),
    camera_id: Number(row.camera_id) || 0,
    camera_name: typeof row.camera_name === "string" ? row.camera_name : null,
    thread_name: String(row.thread_name || ""),
    cpu_percent: Number(row.cpu_percent) || 0,
    capture_mem_estimated_bytes: Number(row.capture_mem_estimated_bytes) || 0,
    process_working_set_bytes: Number(row.process_working_set_bytes) || 0,
    process_private_bytes: Number(row.process_private_bytes) || 0,
    queue_depth: Number(row.queue_depth) || 0,
    sampled_at: String(row.sampled_at || ""),
    updated_at: String(row.updated_at || ""),
  }));

  const captureMetricsUpdatedAtMaxResult = await c.env.DB.prepare(
    `SELECT MAX(updated_at) AS max_updated
     FROM capture_thread_metrics_latest
     WHERE user_id = ?`
  )
    .bind(user.id)
    .first();
  const captureMetricsUpdatedAtMax = captureMetricsUpdatedAtMaxResult &&
    (captureMetricsUpdatedAtMaxResult as any).max_updated
    ? new Date((captureMetricsUpdatedAtMaxResult as any).max_updated).getTime()
    : 0;

  // Recent events (LIMIT 20)
  const { results: recentEvents } = await c.env.DB.prepare(
    `SELECT id, camera_id, event_type, message, created_at FROM events WHERE user_id = ? ORDER BY id DESC LIMIT 20`
  )
    .bind(user.id)
    .all();

  // Recent detections (LIMIT 12)
  const { results: recentDetections } = await c.env.DB.prepare(
    `SELECT camera_id, camera_name, algo_type, detected_at, media_type, image_key, video_key FROM detections WHERE user_id = ? ORDER BY detected_at DESC LIMIT 12`
  )
    .bind(user.id)
    .all();

  // Recent alerts (job alerts + camera-agent detections) (LIMIT 24)
  const { results: recentAlertRows } = await c.env.DB.prepare(
    `SELECT e.id, e.camera_id, e.event_type, e.message, e.details_json, e.created_at, c.name AS camera_name
     FROM events e
     LEFT JOIN cameras c ON e.camera_id = c.id
     WHERE e.user_id = ?
       AND e.event_type IN ('job_alert_triggered', 'ai_detection')
     ORDER BY e.id DESC
     LIMIT 24`
  )
    .bind(user.id)
    .all();

  const recentAlerts = (recentAlertRows || []).map((row: any) => {
    let details: any = null;
    try {
      details = row.details_json ? JSON.parse(row.details_json) : null;
    } catch {
      details = null;
    }

    const readString = (...values: any[]): string | null => {
      for (const value of values) {
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (trimmed) return trimmed;
        }
      }
      return null;
    };
    const buildMediaUrl = (value: string | null): string | null => {
      if (!value) return null;
      if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/api/")) {
        return value;
      }
      const filename = value.split(/[\\/]/).pop();
      return filename ? `/api/detections/${filename}` : null;
    };

    const eventType = typeof row?.event_type === "string" ? row.event_type : "";
    const contributingEventsCount = Math.max(
      0,
      Number(details?.contributing_events_count) || countTemporalContributingEvents(details)
    );
    const groupImageCount = Math.max(
      0,
      Number(details?.group_image_count) ||
        (Array.isArray(details?.group_image_urls) ? details.group_image_urls.length : 0)
    );
    if (details && typeof details === "object") {
      details.contributing_events_count = contributingEventsCount;
      details.group_image_count = groupImageCount;
    }
    const directVideoUrl = readString(details?.video_url, details?.videoUrl);
    const directImageUrl = readString(details?.image_url, details?.imageUrl);
    const videoKey = readString(details?.video_key, details?.videoKey);
    const imageKey = readString(details?.image_key, details?.imageKey);
    const mediaType = readString(details?.media_type, details?.mediaType);
    const algoType = readString(details?.algo_type, details?.algoType, details?.agent_key, details?.agentKey);
    const detectedAt = readString(
      details?.timestamp_iso,
      details?.detected_at,
      details?.detectedAt,
      row?.created_at
    );
    const clipPath = readString(details?.clip_path, details?.clipPath);
    const imagePath = readString(details?.image_path, details?.imagePath);

    const clipUrl = !directVideoUrl ? buildMediaUrl(clipPath) : null;
    const imageUrl = !directImageUrl ? buildMediaUrl(imagePath) : null;

    return {
      id: row.id,
      camera_id: row.camera_id,
      camera_name: readString(details?.camera_name, details?.cameraName, row?.camera_name),
      event_type: eventType,
      algo_type: algoType,
      message: row.message,
      created_at: row.created_at,
      detected_at: detectedAt,
      details,
      priority_level:
        eventType === "job_alert_triggered"
          ? normalizeJobStepPriorityLevel(
              details?.priority_level ?? details?.priorityLevel ?? details?.priority
            )
          : null,
      media_type: mediaType,
      contributing_events_count: contributingEventsCount,
      group_image_count: groupImageCount,
      video_key: videoKey,
      image_key: imageKey,
      video_url: directVideoUrl || clipUrl,
      clip_url: clipUrl,
      image_url: directImageUrl || imageUrl,
      image_path: imagePath,
    };
  });

  // Recent job fires (LIMIT 10)
  const { results: recentJobFires } = await c.env.DB.prepare(
    `SELECT jsf.id, jsf.job_id, jsf.triggered_at_utc, j.name AS job_name
     FROM job_schedule_fires jsf
     JOIN jobs j ON jsf.job_id = j.id
     WHERE j.user_id = ?
     ORDER BY jsf.id DESC
     LIMIT 10`
  )
    .bind(user.id)
    .all();

  // Scheduled jobs (upcoming)
  const { results: scheduledJobsRaw } = await c.env.DB.prepare(
    `SELECT id, name, timezone, schedule_mode, active_from, active_until, status
     FROM jobs
     WHERE user_id = ?
       AND status IN ('scheduled', 'running', 'stopping', 'paused')`
  )
    .bind(user.id)
    .all();

  const scheduledJobIds = (scheduledJobsRaw || []).map((j: any) => j.id);
  const scheduledJobs: any[] = [];
  if (scheduledJobIds.length > 0) {
    const placeholders = scheduledJobIds.map(() => "?").join(",");

    const { results: stepCounts } = await c.env.DB.prepare(
      `SELECT job_id, COUNT(*) as step_count
       FROM job_steps
       WHERE job_id IN (${placeholders})
       GROUP BY job_id`
    )
      .bind(...scheduledJobIds)
      .all();

    const { results: cameraCounts } = await c.env.DB.prepare(
      `SELECT js.job_id, COUNT(DISTINCT jst.camera_id) as camera_count
       FROM job_steps js
       JOIN job_step_targets jst ON jst.step_id = js.id
       WHERE js.job_id IN (${placeholders})
       GROUP BY js.job_id`
    )
      .bind(...scheduledJobIds)
      .all();

    const { results: scheduleRows } = await c.env.DB.prepare(
      `SELECT jsd.job_id, jsd.schedule_mode, jsd.day_of_week, jsd.day_of_month, jsd.month_of_year, jsw.start_time
       FROM job_schedule_days jsd
       JOIN job_schedule_windows jsw ON jsw.schedule_day_id = jsd.id
       WHERE jsd.job_id IN (${placeholders}) AND (jsw.is_enabled = 1 OR jsw.is_enabled IS NULL)`
    )
      .bind(...scheduledJobIds)
      .all();

    const stepCountMap: Record<number, number> = {};
    for (const row of stepCounts || []) {
      stepCountMap[(row as any).job_id] = (row as any).step_count || 0;
    }

    const cameraCountMap: Record<number, number> = {};
    for (const row of cameraCounts || []) {
      cameraCountMap[(row as any).job_id] = (row as any).camera_count || 0;
    }

    const scheduleByJob: Record<number, ScheduleEntry[]> = {};
    const scheduleModeByJob: Record<number, string> = {};
    for (const row of scheduleRows || []) {
      const r = row as any;
      if (!scheduleByJob[r.job_id]) scheduleByJob[r.job_id] = [];
      if (!scheduleModeByJob[r.job_id] && r.schedule_mode) {
        scheduleModeByJob[r.job_id] = String(r.schedule_mode);
      }
      scheduleByJob[r.job_id].push({
        day_of_week: r.day_of_week ?? null,
        day_of_month: r.day_of_month ?? null,
        month_of_year: r.month_of_year ?? null,
        start_time: r.start_time,
      });
    }

    const daysAhead = 6;
    for (const jobRow of scheduledJobsRaw || []) {
      const j = jobRow as any;
      const scheduleMode = (j.schedule_mode || scheduleModeByJob[j.id] || "").toLowerCase();
      if (!["weekly", "monthly", "yearly"].includes(scheduleMode)) continue;
      let localNow: LocalTimeParts;
      const timezone = j.timezone || "UTC";
      try {
        localNow = getLocalTimeInTimezoneAt(timezone);
      } catch {
        localNow = getLocalTimeInTimezoneAt("UTC");
      }
      const occurrences = computeUpcomingOccurrences(
        scheduleMode,
        scheduleByJob[j.id] || [],
        localNow,
        j.active_from || null,
        j.active_until || null,
        daysAhead
      );
      if (!occurrences.length) continue;
      const seen = new Set<string>();
      for (const occ of occurrences) {
        const key = `${occ.date}|${occ.time}`;
        if (seen.has(key)) continue;
        seen.add(key);
        scheduledJobs.push({
          job_id: j.id,
          job_name: j.name,
          next_run_local_date: occ.date,
          next_run_local_time: occ.time,
          step_count: stepCountMap[j.id] || 0,
          camera_count: cameraCountMap[j.id] || 0,
        });
      }
    }

    scheduledJobs.sort((a, b) => {
      const aKey = Date.parse(`${a.next_run_local_date}T${a.next_run_local_time}:00Z`) || 0;
      const bKey = Date.parse(`${b.next_run_local_date}T${b.next_run_local_time}:00Z`) || 0;
      return aKey - bKey;
    });
  }

  // Running jobs list
  const { results: runningJobsResults } = await c.env.DB.prepare(
    `SELECT jrs.job_id, jrs.job_name, jrs.status, jrs.started_at_utc, jrs.updated_at
     FROM job_runtime_states jrs
     WHERE jrs.user_id = ? AND jrs.status = 'running'
     ORDER BY jrs.started_at_utc DESC`
  )
    .bind(user.id)
    .all();

  // Recent job step events for running jobs
  const runningJobIds = (runningJobsResults || []).map((r: any) => r.job_id);
  const runningJobStartById: Record<number, string | null> = {};
  for (const row of runningJobsResults || []) {
    const r = row as any;
    runningJobStartById[r.job_id] = r.started_at_utc || null;
  }
  const stepLogsByJob: Record<number, any[]> = {};
  const runningJobStepsByJob: Record<number, any[]> = {};
  const stepEventHistoryByJobStep: Record<number, Record<number, Array<{ id: number; event_type: string }>>> = {};
  let stepEventRows: any[] = [];
  if (runningJobIds.length > 0) {
    const { results } = await c.env.DB.prepare(
      `SELECT id, event_type, message, details_json, created_at
       FROM events
       WHERE user_id = ?
         AND event_type IN ('job_step_started', 'job_step_completed', 'job_step_skipped')
       ORDER BY id DESC
       LIMIT 200`
    )
      .bind(user.id)
      .all();

    stepEventRows = results || [];
    for (const row of stepEventRows) {
      let details: any = null;
      try {
        details = row.details_json ? JSON.parse(row.details_json) : null;
      } catch {
        details = null;
      }
      const jobId = details?.job_id;
      const stepId = details?.step_id;
      if (!jobId || !runningJobIds.includes(jobId)) continue;
      const jobStartedAt = runningJobStartById[jobId];
      if (jobStartedAt) {
        const eventTime = new Date(row.created_at).getTime();
        const jobStartTime = new Date(jobStartedAt).getTime();
        if (!Number.isNaN(eventTime) && !Number.isNaN(jobStartTime) && eventTime < jobStartTime) {
          continue;
        }
      }
      if (stepId) {
        if (!stepEventHistoryByJobStep[jobId]) stepEventHistoryByJobStep[jobId] = {};
        if (!stepEventHistoryByJobStep[jobId][stepId]) stepEventHistoryByJobStep[jobId][stepId] = [];
        stepEventHistoryByJobStep[jobId][stepId].push({
          id: Number(row.id) || 0,
          event_type: String(row.event_type || ""),
        });
      }

      if (!stepLogsByJob[jobId]) stepLogsByJob[jobId] = [];
      if (stepLogsByJob[jobId].length < 10) {
        stepLogsByJob[jobId].push({
          id: row.id,
          event_type: row.event_type,
          message: row.message,
          created_at: row.created_at,
          details,
        });
      }
    }
  }

  if (runningJobIds.length > 0) {
    const placeholders = runningJobIds.map(() => "?").join(",");
    const { results: stepRows } = await c.env.DB.prepare(
      `SELECT id, job_id, step_order, name
       FROM job_steps
       WHERE job_id IN (${placeholders})
       ORDER BY job_id ASC, step_order ASC`
    )
      .bind(...runningJobIds)
      .all();

    const stepsByJob: Record<number, any[]> = {};
    for (const row of stepRows || []) {
      const r = row as any;
      const jobId = r.job_id;
      let status = "pending";
      const stepEvents = stepEventHistoryByJobStep[jobId]?.[r.id] || [];
      if (stepEvents.length > 0) {
        const orderedEvents = [...stepEvents].sort((a, b) => a.id - b.id);
        let hasStartedInCurrentRun = false;
        for (const evt of orderedEvents) {
          if (evt.event_type === "job_step_started") {
            status = "running";
            hasStartedInCurrentRun = true;
            continue;
          }
          if (evt.event_type === "job_step_completed") {
            // Guard against late/old completed events from previous runs.
            if (hasStartedInCurrentRun) status = "completed";
            continue;
          }
          if (evt.event_type === "job_step_skipped") {
            status = "skipped";
          }
        }
      }

      if (!stepsByJob[jobId]) stepsByJob[jobId] = [];
      stepsByJob[jobId].push({
        id: r.id,
        step_order: r.step_order,
        name: r.name,
        status,
      });
    }

    for (const jobIdStr of Object.keys(stepsByJob)) {
      const jobId = Number(jobIdStr);
      runningJobStepsByJob[jobId] = stepsByJob[jobId] || [];
    }
  }

  const runningJobTargets: Record<number, Array<{
    step_id: number;
    step_order: number;
    step_name: string;
    cameras: Array<{ camera_id: number; camera_name: string | null }>;
  }>> = {};
  if (runningJobIds.length > 0) {
    const placeholders = runningJobIds.map(() => "?").join(",");
    const { results: targetRows } = await c.env.DB.prepare(
      `SELECT js.job_id,
              js.id AS step_id,
              js.step_order,
              js.name AS step_name,
              jst.camera_id,
              c.name AS camera_name
       FROM job_steps js
       JOIN job_step_targets jst ON jst.step_id = js.id
       LEFT JOIN cameras c ON c.id = jst.camera_id AND c.user_id = ?
       WHERE js.job_id IN (${placeholders})
       ORDER BY js.job_id ASC, js.step_order ASC, jst.camera_id ASC`
    )
      .bind(user.id, ...runningJobIds)
      .all();

    const stepMapByJob: Record<number, Map<number, {
      step_id: number;
      step_order: number;
      step_name: string;
      cameras: Array<{ camera_id: number; camera_name: string | null }>;
    }>> = {};

    for (const row of targetRows || []) {
      const r = row as any;
      const jobId = Number(r.job_id) || 0;
      const stepId = Number(r.step_id) || 0;
      if (jobId <= 0 || stepId <= 0) continue;

      if (!stepMapByJob[jobId]) stepMapByJob[jobId] = new Map();
      let stepEntry = stepMapByJob[jobId].get(stepId);
      if (!stepEntry) {
        stepEntry = {
          step_id: stepId,
          step_order: Number(r.step_order) || 0,
          step_name: String(r.step_name || ""),
          cameras: [],
        };
        stepMapByJob[jobId].set(stepId, stepEntry);
      }

      stepEntry.cameras.push({
        camera_id: Number(r.camera_id) || 0,
        camera_name: typeof r.camera_name === "string" ? r.camera_name : null,
      });
    }

    for (const jobIdStr of Object.keys(stepMapByJob)) {
      const jobId = Number(jobIdStr);
      runningJobTargets[jobId] = Array.from(stepMapByJob[jobId].values())
        .sort((a, b) => a.step_order - b.step_order);
    }
  }

  let stepsRunning = 0;
  for (const steps of Object.values(runningJobStepsByJob)) {
    for (const step of steps) {
      if (step.status === "running") stepsRunning += 1;
    }
  }

  // Recent commands (LIMIT 15) - parse job_start payloads, include job_stop
  const { results: recentCommands } = await c.env.DB.prepare(
    `SELECT id, command_type, status, created_at, camera_id, payload FROM commands WHERE user_id = ? AND command_type IN ('job_start', 'job_stop', 'start_camera', 'stop_camera') ORDER BY created_at DESC LIMIT 15`
  )
    .bind(user.id)
    .all();

  const commandsWithParsedPayload = (recentCommands || []).map((cmd: any) => {
    const c = { ...cmd };
    if ((c.command_type === "job_start" || c.command_type === "job_stop") && c.payload) {
      try {
        const p = JSON.parse(c.payload);
        c.job_id = p.job?.id || null;
        c.job_name = p.job?.name || null;
        if (c.command_type === "job_start") {
          c.step_count = Array.isArray(p.steps) ? p.steps.length : null;
        }
      } catch (e) {
        // Failed to parse, keep as is
      }
      delete c.payload; // Remove giant payload string
    } else {
      delete c.payload; // Remove payload for other command types too
    }
    return c;
  });

  // Compute etagHints for improved ETag
  const camerasUpdatedAtMax = camerasWithOffset.length > 0
    ? Math.max(...camerasWithOffset.map((c: any) => new Date(c.updated_at || 0).getTime()))
    : 0;

  const lastDetectionId = await c.env.DB.prepare(
    `SELECT MAX(id) AS id FROM detections WHERE user_id = ?`
  )
    .bind(user.id)
    .first();

  const lastJobFireId = await c.env.DB.prepare(
    `SELECT MAX(id) AS id FROM job_schedule_fires WHERE job_id IN (SELECT id FROM jobs WHERE user_id = ?)`
  )
    .bind(user.id)
    .first();

  const jobAlertCountResult = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM events WHERE user_id = ? AND event_type = 'job_alert_triggered'`
  )
    .bind(user.id)
    .first();
  const jobAlertCount = Number((jobAlertCountResult as any)?.count || 0);

  const etagHints = {
    camerasUpdatedAtMax,
    lastEventId,
    lastDetectionId: (lastDetectionId as any)?.id || 0,
    lastJobFireId: (lastJobFireId as any)?.id || 0,
    jobAlertCount,
    pendingCommandsCount: pendingCommands,
    unreadCount,
    inputBalance: (balance as any).input_balance,
    outputBalance: (balance as any).output_balance,
    jobsUpdatedAtMax,
    captureMetricsUpdatedAtMax,
  };

  // Build improved ETag
  const etag = `"dashboard-${user.id}-${etagHints.camerasUpdatedAtMax}-${etagHints.lastEventId}-${etagHints.lastDetectionId}-${etagHints.lastJobFireId}-${etagHints.jobAlertCount}-${etagHints.pendingCommandsCount}-${etagHints.unreadCount}-${etagHints.inputBalance}-${etagHints.outputBalance}-${etagHints.jobsUpdatedAtMax}-${etagHints.captureMetricsUpdatedAtMax}"`;
  
  // Check If-None-Match for conditional GET
  const ifNoneMatch = c.req.header("if-none-match");
  if (ifNoneMatch === etag) {
    return c.body(null, {
      status: 304,
      headers: {
        "etag": etag,
        "cache-control": "private, no-cache, max-age=0, must-revalidate",
      },
    });
  }

  // Build stats object
  const stats = {
    cameras_total: camerasTotal,
    cameras_running: camerasRunning,
    cameras_online: camerasOnline,
    agents_enabled_total: agentsEnabledTotal,
    detections_24h_total: detections24hTotal,
    unread_alerts: unreadCount,
    pending_commands: pendingCommands,
    last_event_id: lastEventId,
    last_detection_at: lastDetectionAt,
    last_job_fire_at: lastJobFireAt,
    jobs_total: jobsTotal,
    jobs_running: jobsRunning,
    steps_running: stepsRunning,
  };

  return c.json({
    cameras: camerasWithOffset,
    tokenBalance: balance,
    unreadCount,
    dashboard: {
      stats,
      perCamera,
      jobs: {
        recentFires: recentJobFires,
        recentCommands: commandsWithParsedPayload,
        runningJobs: runningJobsResults || [],
        stepLogs: stepLogsByJob,
        runningJobSteps: runningJobStepsByJob,
        scheduledJobs,
      },
      captureThreads,
      runningJobTargets,
      activity: {
        recentEvents,
        recentDetections,
        recentAlerts,
      },
      etagHints,
    },
  }, {
    headers: {
      "etag": etag,
      "cache-control": "private, no-cache, max-age=0, must-revalidate",
    },
  });
});

app.get("/api/open-monitor", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  await ensureSchema(c.env.DB);

  try {
    const camerasQuery = c.env.DB.prepare(
      `SELECT id, name, is_service_running, updated_at
       FROM cameras
       WHERE user_id = ?
       ORDER BY id ASC`
    ).bind(user.id);

  const enabledAgentsQuery = c.env.DB.prepare(
    `SELECT camera_id, COUNT(*) AS enabled_count
     FROM camera_algorithms
     WHERE is_enabled = 1
       AND camera_id IN (SELECT id FROM cameras WHERE user_id = ?)
     GROUP BY camera_id`
  ).bind(user.id);

  const hostQuery = c.env.DB.prepare(
    `SELECT *
     FROM open_monitor_host_latest
     WHERE user_id = ?
     ORDER BY updated_at DESC
     LIMIT 8`
  ).bind(user.id);

  const processQuery = c.env.DB.prepare(
    `SELECT *
     FROM open_monitor_process_latest
     WHERE user_id = ?
     ORDER BY updated_at DESC
     LIMIT 8`
  ).bind(user.id);

  const cameraLatestQuery = c.env.DB.prepare(
    `SELECT *
     FROM open_monitor_camera_latest
     WHERE user_id = ?
     ORDER BY updated_at DESC, camera_id ASC`
  ).bind(user.id);

  const threadLatestQuery = c.env.DB.prepare(
    `SELECT *
     FROM open_monitor_thread_latest
     WHERE user_id = ?
     ORDER BY updated_at DESC, camera_id ASC, thread_name ASC`
  ).bind(user.id);

  const stepLatestQuery = c.env.DB.prepare(
    `SELECT *
     FROM open_monitor_job_step_latest
     WHERE user_id = ?
     ORDER BY updated_at DESC, job_id ASC, step_id ASC`
  ).bind(user.id);

  const runningJobsQuery = c.env.DB.prepare(
    `SELECT job_id, job_name, status, started_at_utc, updated_at
     FROM job_runtime_states
     WHERE user_id = ? AND status = 'running'
     ORDER BY started_at_utc DESC`
  ).bind(user.id);

  const [
    cameraRowsResult,
    enabledAgentRowsResult,
    hostRowsResult,
    processRowsResult,
    cameraLatestResult,
    threadLatestResult,
    stepLatestResult,
    runningJobsResult,
  ] = await Promise.all([
    camerasQuery.all(),
    enabledAgentsQuery.all(),
    hostQuery.all(),
    processQuery.all(),
    cameraLatestQuery.all(),
    threadLatestQuery.all(),
    stepLatestQuery.all(),
    runningJobsQuery.all(),
  ]);

  const cameras = cameraRowsResult.results || [];
  const cameraById = new Map<number, any>();
  for (const row of cameras) {
    const cameraId = Number((row as any)?.id) || 0;
    if (cameraId > 0) {
      cameraById.set(cameraId, row);
    }
  }

  const enabledAgentsByCamera = new Map<number, number>();
  for (const row of enabledAgentRowsResult.results || []) {
    const cameraId = Number((row as any)?.camera_id) || 0;
    if (cameraId > 0) {
      enabledAgentsByCamera.set(cameraId, Number((row as any)?.enabled_count) || 0);
    }
  }

  const runningJobs = (runningJobsResult.results || []).map((row: any) => ({
    job_id: Number(row.job_id) || 0,
    job_name: typeof row.job_name === "string" ? row.job_name : "",
    status: typeof row.status === "string" ? row.status : "running",
    started_at_utc: typeof row.started_at_utc === "string" ? row.started_at_utc : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
  }));

  const runningJobIds = runningJobs
    .map((row: (typeof runningJobs)[number]) => row.job_id)
    .filter((jobId: number) => jobId > 0);

  const stepStatusByJobStep = new Map<string, string>();
  if (runningJobIds.length > 0) {
    const placeholders = runningJobIds.map(() => "?").join(",");
    const { results: stepEvents } = await c.env.DB.prepare(
      `SELECT id, event_type, details_json, created_at
       FROM events
       WHERE user_id = ?
         AND event_type IN ('job_step_started', 'job_step_completed', 'job_step_skipped')
       ORDER BY id DESC
       LIMIT 200`
    )
      .bind(user.id)
      .all();

    const runningJobStartById = new Map<number, number>();
    for (const job of runningJobs) {
      const startedAt = job.started_at_utc ? Date.parse(job.started_at_utc) : NaN;
      runningJobStartById.set(job.job_id, Number.isNaN(startedAt) ? 0 : startedAt);
    }

    const historyByJobStep = new Map<string, Array<{ id: number; event_type: string }>>();
    for (const row of stepEvents || []) {
      let details: any = null;
      try {
        details = (row as any)?.details_json ? JSON.parse((row as any).details_json) : null;
      } catch {
        details = null;
      }
      const jobId = Number(details?.job_id) || 0;
      const stepId = Number(details?.step_id) || 0;
      if (!jobId || !stepId || !runningJobIds.includes(jobId)) continue;
      const jobStartedAt = runningJobStartById.get(jobId) || 0;
      const eventTime = Date.parse(String((row as any)?.created_at || ""));
      if (jobStartedAt > 0 && !Number.isNaN(eventTime) && eventTime < jobStartedAt) {
        continue;
      }
      const key = `${jobId}:${stepId}`;
      const history = historyByJobStep.get(key) || [];
      history.push({
        id: Number((row as any)?.id) || 0,
        event_type: String((row as any)?.event_type || ""),
      });
      historyByJobStep.set(key, history);
    }

    for (const [key, history] of historyByJobStep.entries()) {
      const ordered = [...history].sort((a, b) => a.id - b.id);
      let status = "pending";
      let hasStartedInCurrentRun = false;
      for (const event of ordered) {
        if (event.event_type === "job_step_started") {
          status = "running";
          hasStartedInCurrentRun = true;
          continue;
        }
        if (event.event_type === "job_step_completed") {
          if (hasStartedInCurrentRun) status = "completed";
          continue;
        }
        if (event.event_type === "job_step_skipped") {
          status = "skipped";
        }
      }
      stepStatusByJobStep.set(key, status);
    }

    const { results: targetRows } = await c.env.DB.prepare(
      `SELECT js.job_id,
              js.id AS step_id,
              js.step_order,
              js.name AS step_name,
              jst.camera_id,
              c.name AS camera_name
       FROM job_steps js
       JOIN job_step_targets jst ON jst.step_id = js.id
       LEFT JOIN cameras c ON c.id = jst.camera_id AND c.user_id = ?
       WHERE js.job_id IN (${placeholders})
       ORDER BY js.job_id ASC, js.step_order ASC, jst.camera_id ASC`
    )
      .bind(user.id, ...runningJobIds)
      .all();

    const stepRowsByKey = new Map<string, {
      job_id: number;
      step_id: number;
      step_order: number;
      step_name: string;
      cameras: Array<{ camera_id: number; camera_name: string | null }>;
    }>();
    for (const row of targetRows || []) {
      const jobId = Number((row as any)?.job_id) || 0;
      const stepId = Number((row as any)?.step_id) || 0;
      if (jobId <= 0 || stepId <= 0) continue;
      const key = `${jobId}:${stepId}`;
      const existing = stepRowsByKey.get(key) || {
        job_id: jobId,
        step_id: stepId,
        step_order: Number((row as any)?.step_order) || 0,
        step_name: String((row as any)?.step_name || ""),
        cameras: [],
      };
      existing.cameras.push({
        camera_id: Number((row as any)?.camera_id) || 0,
        camera_name: typeof (row as any)?.camera_name === "string" ? (row as any).camera_name : null,
      });
      stepRowsByKey.set(key, existing);
    }

    const latestStepRows = new Map<string, any>();
    for (const row of stepLatestResult.results || []) {
      const key = `${Number((row as any)?.job_id) || 0}:${Number((row as any)?.step_id) || 0}`;
      latestStepRows.set(key, row);
    }

    const steps = Array.from(stepRowsByKey.values()).map((entry) => {
      const key = `${entry.job_id}:${entry.step_id}`;
      const latest = latestStepRows.get(key) as any;
      const latestPayload = openMonitorParseJsonObject(latest?.payload_json);
      return {
        job_id: entry.job_id,
        step_id: entry.step_id,
        step_order: entry.step_order,
        step_name: entry.step_name,
        status:
          typeof latest?.status === "string" && latest.status.trim()
            ? latest.status
            : stepStatusByJobStep.get(key) || "pending",
        camera_count: entry.cameras.filter((camera) => camera.camera_id > 0).length,
        total_consumers:
          latest?.total_consumers !== undefined && latest?.total_consumers !== null
            ? Number(latest.total_consumers) || 0
            : entry.cameras.filter((camera) => camera.camera_id > 0).length,
        queue_depth:
          latest?.queue_depth !== undefined && latest?.queue_depth !== null
            ? Number(latest.queue_depth) || 0
            : null,
        retry_count:
          latest?.retry_count !== undefined && latest?.retry_count !== null
            ? Number(latest.retry_count) || 0
            : null,
        timeout_count:
          latest?.timeout_count !== undefined && latest?.timeout_count !== null
            ? Number(latest.timeout_count) || 0
            : null,
        error_count:
          latest?.error_count !== undefined && latest?.error_count !== null
            ? Number(latest.error_count) || 0
            : null,
        oldest_pending_age_ms:
          latestPayload.oldest_pending_age_ms !== undefined
            ? Number(latestPayload.oldest_pending_age_ms) || 0
            : null,
        cameras: entry.cameras,
      };
    });

    const stepsByJob = new Map<number, typeof steps>();
    for (const step of steps) {
      const existing = stepsByJob.get(step.job_id) || [];
      existing.push(step);
      stepsByJob.set(step.job_id, existing);
    }

    const jobs = runningJobs.map((job: (typeof runningJobs)[number]) => {
      const jobSteps = stepsByJob.get(job.job_id) || [];
      const uniqueCameraIds = new Set<number>();
      for (const step of jobSteps) {
        for (const camera of step.cameras) {
          if (camera.camera_id > 0) uniqueCameraIds.add(camera.camera_id);
        }
      }
      return {
        ...job,
        camera_count: uniqueCameraIds.size,
        step_count: jobSteps.length,
        running_steps: jobSteps.filter((step) => step.status === "running").length,
      };
    });

    const hostRows = (hostRowsResult.results || []) as any[];
    const processRows = (processRowsResult.results || []) as any[];
    const latestHostRow = hostRows[0] || null;
    const latestProcessRow = processRows[0] || null;

    const openMonitorCameraLatestRows = (cameraLatestResult.results || []) as any[];
    const jobConsumerCountsByCamera = new Map<number, number>();
    for (const step of steps) {
      for (const camera of step.cameras) {
        const cameraId = Number(camera.camera_id) || 0;
        if (cameraId <= 0) continue;
        jobConsumerCountsByCamera.set(cameraId, (jobConsumerCountsByCamera.get(cameraId) || 0) + 1);
      }
    }

    const openMonitorThreadRows = (threadLatestResult.results || []) as any[];
    const threads = openMonitorBuildThreadRows(openMonitorThreadRows, cameraById);

    const latestCameraById = new Map<number, any>();
    for (const row of openMonitorCameraLatestRows) {
      const cameraId = Number((row as any)?.camera_id) || 0;
      if (cameraId > 0) {
        latestCameraById.set(cameraId, row);
      }
    }
    const cameraIds = Array.from(
      new Set<number>([
        ...Array.from(latestCameraById.keys()),
        ...Array.from(enabledAgentsByCamera.keys()),
        ...Array.from(jobConsumerCountsByCamera.keys()),
      ])
    ).filter((cameraId) => cameraId > 0);
    const camerasResponse = openMonitorBuildCameraRows(
      cameraIds,
      latestCameraById,
      cameraById,
      enabledAgentsByCamera,
      jobConsumerCountsByCamera
    );

    const telemetryAges = [
      openMonitorSampleAgeMs(latestHostRow?.sampled_at, latestHostRow?.updated_at),
      openMonitorSampleAgeMs(latestProcessRow?.sampled_at, latestProcessRow?.updated_at),
      ...camerasResponse.map((camera) => camera.sample_age_ms),
      ...threads.map((thread) => thread.sample_age_ms),
    ].filter((age): age is number => typeof age === "number" && Number.isFinite(age));

    const freshestAgeMs = telemetryAges.length > 0 ? Math.min(...telemetryAges) : null;
    const isTelemetryFresh = freshestAgeMs !== null && freshestAgeMs <= OPEN_MONITOR_STALE_AFTER_MS;

    const host = openMonitorBuildHostSnapshot(latestHostRow);
    const process = openMonitorBuildProcessSnapshot(latestProcessRow, camerasResponse);

    const cpuPressure = Math.max(
      host?.cpu_total_percent ?? 0,
      process?.process_cpu_percent ?? 0
    );
    const memoryPressure =
      host?.ram_total_bytes && host.ram_total_bytes > 0 && host.ram_used_bytes !== null
        ? Math.min(100, Math.max(0, (host.ram_used_bytes / host.ram_total_bytes) * 100))
        : 0;
    const maxQueueDepth = camerasResponse.reduce(
      (max, camera) => Math.max(max, Number(camera.queue_depth || 0)),
      0
    );
    const maxCaptureReadLatencyMs = camerasResponse.reduce(
      (max, camera) => Math.max(max, Number((camera as any).capture_read_latency_ms || 0)),
      0
    );
    const maxDecodeLatencyMs = camerasResponse.reduce(
      (max, camera) => Math.max(max, Number((camera as any).decode_latency_ms || 0)),
      0
    );
    const maxDiskReadLatencyMs = camerasResponse.reduce(
      (max, camera) => Math.max(max, Number((camera as any).disk_read_latency_ms || 0)),
      0
    );
    const maxDiskWriteLatencyMs = camerasResponse.reduce(
      (max, camera) => Math.max(max, Number((camera as any).disk_write_latency_ms || 0)),
      0
    );
    const overwrittenCameras = camerasResponse.filter(
      (camera) => Number(camera.overwritten_frames || 0) > 0
    ).length;
    const queuePressure = overwrittenCameras > 0 ? 95 : Math.min(100, maxQueueDepth * 12.5);
    const ioPressure = Math.min(
      100,
      Math.max(maxCaptureReadLatencyMs, maxDecodeLatencyMs, maxDiskReadLatencyMs, maxDiskWriteLatencyMs) / 5
    );
    const stalePressure = isTelemetryFresh ? 0 : 100;

    const bottleneckCandidates = [
      { label: "CPU", score: cpuPressure },
      { label: "RAM", score: memoryPressure },
      { label: "I/O", score: ioPressure },
      { label: "Queue", score: queuePressure },
      { label: "Telemetry", score: stalePressure },
    ].sort((a, b) => b.score - a.score);

    const maxPressure = bottleneckCandidates[0]?.score || 0;
    const headroomPercent = Math.max(0, Math.min(100, 100 - maxPressure));
    const activeCameras = camerasResponse.filter((camera) => camera.is_service_running).length;
    const safeAdditionalCameras =
      activeCameras > 0 && cpuPressure > 0
        ? Math.max(0, Math.floor(headroomPercent / Math.max(cpuPressure / activeCameras, 1)))
        : null;

    const alerts: Array<Record<string, any>> = [];
    if (!isTelemetryFresh) {
      alerts.push({
        severity: "critical",
        code: "telemetry_stale",
        message: "Open monitor telemetry is stale.",
      });
    }
    if (cpuPressure >= 85) {
      alerts.push({
        severity: cpuPressure >= 95 ? "critical" : "warning",
        code: "cpu_pressure",
        message: `CPU pressure is high at ${cpuPressure.toFixed(1)}%.`,
      });
    }
    if (memoryPressure >= 85) {
      alerts.push({
        severity: memoryPressure >= 95 ? "critical" : "warning",
        code: "memory_pressure",
        message: `RAM pressure is high at ${memoryPressure.toFixed(1)}%.`,
      });
    }
    if (overwrittenCameras > 0) {
      alerts.push({
        severity: "warning",
        code: "frame_overwrite",
        message: `${overwrittenCameras} camera(s) reported overwritten buffered frames.`,
      });
    }
    if (maxQueueDepth >= 4) {
      alerts.push({
        severity: maxQueueDepth >= 8 ? "critical" : "warning",
        code: "queue_depth",
        message: `Capture queue depth is elevated at ${maxQueueDepth}.`,
      });
    }
    const maxIoLatencyMs = Math.max(
      maxCaptureReadLatencyMs,
      maxDecodeLatencyMs,
      maxDiskReadLatencyMs,
      maxDiskWriteLatencyMs
    );
    if (maxIoLatencyMs >= 150) {
      alerts.push({
        severity: maxIoLatencyMs >= 400 ? "critical" : "warning",
        code: "io_latency",
        message: `I/O latency is elevated at ${maxIoLatencyMs.toFixed(1)} ms.`,
      });
    }

    const systemStatus =
      stalePressure >= 100 || cpuPressure >= 95 || memoryPressure >= 95 || ioPressure >= 95
        ? "critical"
        : alerts.length > 0 || cpuPressure >= 80 || memoryPressure >= 80 || ioPressure >= 75
        ? "warning"
        : "healthy";

    return c.json({
      summary: {
        system_status: systemStatus,
        dominant_bottleneck: bottleneckCandidates[0]?.label || "Unknown",
        headroom_percent: Number(headroomPercent.toFixed(1)),
        active_jobs: jobs.length,
        active_steps: steps.filter((step) => step.status === "running").length,
        active_cameras: activeCameras,
        unique_streams: camerasResponse.length,
        total_consumers: camerasResponse.reduce(
          (total, camera) => total + Number(camera.consumer_count || 0),
          0
        ),
        telemetry_fresh: isTelemetryFresh,
        telemetry_age_ms: freshestAgeMs,
        safe_additional_cameras: safeAdditionalCameras,
        eta_to_exhaustion: null,
      },
      host,
      process,
      jobs,
      steps,
      cameras: camerasResponse,
      threads,
      alerts,
      historyHints: {
        host_sources: hostRows.length,
        process_sources: processRows.length,
        camera_rows: camerasResponse.length,
        thread_rows: threads.length,
        sampled_at: host?.sampled_at || process?.sampled_at || null,
      },
    });
  }

  const hostRows = (hostRowsResult.results || []) as any[];
  const processRows = (processRowsResult.results || []) as any[];
  const latestHostRow = hostRows[0] || null;
  const latestProcessRow = processRows[0] || null;
  const openMonitorCameraLatestRows = (cameraLatestResult.results || []) as any[];
  const latestCameraById = new Map<number, any>();
  for (const row of openMonitorCameraLatestRows) {
    const cameraId = Number((row as any)?.camera_id) || 0;
    if (cameraId > 0 && !latestCameraById.has(cameraId)) {
      latestCameraById.set(cameraId, row);
    }
  }

  const threads = openMonitorBuildThreadRows((threadLatestResult.results || []) as any[], cameraById);
  const cameraIds = Array.from(
    new Set([
      ...Array.from(cameraById.keys()),
      ...Array.from(latestCameraById.keys()),
      ...threads.map((thread) => Number(thread.camera_id) || 0).filter((cameraId) => cameraId > 0),
    ])
  ).sort((a, b) => a - b);
  const camerasResponse = openMonitorBuildCameraRows(
    cameraIds,
    latestCameraById,
    cameraById,
    enabledAgentsByCamera,
    new Map<number, number>()
  );
  const host = openMonitorBuildHostSnapshot(latestHostRow);
  const process = openMonitorBuildProcessSnapshot(latestProcessRow, camerasResponse);
  const telemetryAges = [
    host?.sample_age_ms ?? null,
    process?.sample_age_ms ?? null,
    ...camerasResponse.map((camera) => camera.sample_age_ms),
    ...threads.map((thread) => thread.sample_age_ms),
  ].filter((age): age is number => typeof age === "number" && Number.isFinite(age));
  const freshestAgeMs = telemetryAges.length > 0 ? Math.min(...telemetryAges) : null;
  const isTelemetryFresh = freshestAgeMs !== null && freshestAgeMs <= OPEN_MONITOR_STALE_AFTER_MS;
  const cpuPressure = Math.max(host?.cpu_total_percent ?? 0, process?.process_cpu_percent ?? 0);
  const memoryPressure =
    host?.ram_total_bytes && host.ram_total_bytes > 0 && host.ram_used_bytes !== null
      ? Math.min(100, Math.max(0, (host.ram_used_bytes / host.ram_total_bytes) * 100))
      : 0;
  const maxQueueDepth = camerasResponse.reduce(
    (max, camera) => Math.max(max, Number(camera.queue_depth || 0)),
    0
  );
  const maxCaptureReadLatencyMs = camerasResponse.reduce(
    (max, camera) => Math.max(max, Number((camera as any).capture_read_latency_ms || 0)),
    0
  );
  const maxDecodeLatencyMs = camerasResponse.reduce(
    (max, camera) => Math.max(max, Number((camera as any).decode_latency_ms || 0)),
    0
  );
  const maxDiskReadLatencyMs = camerasResponse.reduce(
    (max, camera) => Math.max(max, Number((camera as any).disk_read_latency_ms || 0)),
    0
  );
  const maxDiskWriteLatencyMs = camerasResponse.reduce(
    (max, camera) => Math.max(max, Number((camera as any).disk_write_latency_ms || 0)),
    0
  );
  const overwrittenCameras = camerasResponse.filter(
    (camera) => Number(camera.overwritten_frames || 0) > 0
  ).length;
  const queuePressure = overwrittenCameras > 0 ? 95 : Math.min(100, maxQueueDepth * 12.5);
  const ioPressure = Math.min(
    100,
    Math.max(maxCaptureReadLatencyMs, maxDecodeLatencyMs, maxDiskReadLatencyMs, maxDiskWriteLatencyMs) / 5
  );
  const stalePressure = isTelemetryFresh ? 0 : 100;
  const bottleneckCandidates = [
    { label: "CPU", score: cpuPressure },
    { label: "RAM", score: memoryPressure },
    { label: "I/O", score: ioPressure },
    { label: "Queue", score: queuePressure },
    { label: "Telemetry", score: stalePressure },
  ].sort((a, b) => b.score - a.score);
  const maxPressure = bottleneckCandidates[0]?.score || 0;
  const headroomPercent = Math.max(0, Math.min(100, 100 - maxPressure));
  const activeCameras = process?.active_cameras ?? camerasResponse.filter((camera) => camera.is_service_running).length;
  const uniqueStreams = process?.unique_streams ?? camerasResponse.filter((camera) => camera.sampled_at !== null).length;
  const totalConsumers =
    process?.total_consumers ?? camerasResponse.reduce((total, camera) => total + Number(camera.consumer_count || 0), 0);
  const safeAdditionalCameras =
    activeCameras > 0 && cpuPressure > 0
      ? Math.max(0, Math.floor(headroomPercent / Math.max(cpuPressure / activeCameras, 1)))
      : null;
  const alerts: Array<Record<string, any>> = [];
  if (!isTelemetryFresh) {
    alerts.push({
      severity: telemetryAges.length === 0 ? "warning" : "critical",
      code: "telemetry_stale",
      message:
        telemetryAges.length === 0
          ? "Open monitor telemetry has not been reported yet."
          : "Open monitor telemetry is stale.",
    });
  }
  if (cpuPressure >= 85) {
    alerts.push({
      severity: cpuPressure >= 95 ? "critical" : "warning",
      code: "cpu_pressure",
      message: `CPU pressure is high at ${cpuPressure.toFixed(1)}%.`,
    });
  }
  if (memoryPressure >= 85) {
    alerts.push({
      severity: memoryPressure >= 95 ? "critical" : "warning",
      code: "memory_pressure",
      message: `RAM pressure is high at ${memoryPressure.toFixed(1)}%.`,
    });
  }
  if (overwrittenCameras > 0) {
    alerts.push({
      severity: "warning",
      code: "frame_overwrite",
      message: `${overwrittenCameras} camera(s) reported overwritten buffered frames.`,
    });
  }
  if (maxQueueDepth >= 4) {
    alerts.push({
      severity: maxQueueDepth >= 8 ? "critical" : "warning",
      code: "queue_depth",
      message: `Capture queue depth is elevated at ${maxQueueDepth}.`,
    });
  }
  const maxIoLatencyMs = Math.max(
    maxCaptureReadLatencyMs,
    maxDecodeLatencyMs,
    maxDiskReadLatencyMs,
    maxDiskWriteLatencyMs
  );
  if (maxIoLatencyMs >= 150) {
    alerts.push({
      severity: maxIoLatencyMs >= 400 ? "critical" : "warning",
      code: "io_latency",
      message: `I/O latency is elevated at ${maxIoLatencyMs.toFixed(1)} ms.`,
    });
  }
  const systemStatus =
    stalePressure >= 100 || cpuPressure >= 95 || memoryPressure >= 95 || ioPressure >= 95
      ? "critical"
      : alerts.length > 0 || cpuPressure >= 80 || memoryPressure >= 80 || ioPressure >= 75
      ? "warning"
      : "healthy";

  return c.json({
    summary: {
      system_status: systemStatus,
      dominant_bottleneck: bottleneckCandidates[0]?.label || "Unknown",
      headroom_percent: telemetryAges.length > 0 ? Number(headroomPercent.toFixed(1)) : null,
      active_jobs: 0,
      active_steps: 0,
      active_cameras: activeCameras,
      unique_streams: uniqueStreams,
      total_consumers: totalConsumers,
      telemetry_fresh: isTelemetryFresh,
      telemetry_age_ms: freshestAgeMs,
      safe_additional_cameras: safeAdditionalCameras,
      eta_to_exhaustion: null,
    },
    host,
    process,
    jobs: [],
    steps: [],
    cameras: camerasResponse,
    threads,
    alerts,
    historyHints: {
      host_sources: hostRows.length,
      process_sources: processRows.length,
      camera_rows: openMonitorCameraLatestRows.length,
      thread_rows: threads.length,
      sampled_at:
        host?.sampled_at || process?.sampled_at || camerasResponse.find((camera) => camera.sampled_at)?.sampled_at || null,
    },
  });
  } catch (error: any) {
    console.error("[OPEN MONITOR] Failed to build response:", error);
    return c.text("Open monitor failed", 500);
  }
});

app.get("/api/camera-thumbnails", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  const { results } = await c.env.DB.prepare(
    `SELECT id,
            thumbnail_url,
            last_thumbnail_update,
            is_service_running,
            is_online,
            updated_at
     FROM cameras
     WHERE user_id = ?
     ORDER BY id ASC`
  )
    .bind(user.id)
    .all();

  const thumbnails: Array<{
    id: number;
    thumbnail_url: string | null;
    last_thumbnail_update: string | null;
    is_service_running: number;
    is_online: number;
    updated_at: string | null;
  }> = (results || []).map((row: any) => ({
    id: Number(row.id) || 0,
    thumbnail_url:
      typeof row.thumbnail_url === "string" && row.thumbnail_url.trim()
        ? row.thumbnail_url.trim()
        : null,
    last_thumbnail_update:
      typeof row.last_thumbnail_update === "string" && row.last_thumbnail_update.trim()
        ? row.last_thumbnail_update.trim()
        : null,
    is_service_running: Number(row.is_service_running) || 0,
    is_online: Number(row.is_online) || 0,
    updated_at:
      typeof row.updated_at === "string" && row.updated_at.trim()
        ? row.updated_at.trim()
        : null,
  }));

  const updatedAtMax = thumbnails.reduce((latest: number, row) => {
    const parsed = row.updated_at ? Date.parse(row.updated_at) : 0;
    return Number.isFinite(parsed) ? Math.max(latest, parsed) : latest;
  }, 0);
  const runningCount = thumbnails.reduce(
    (count: number, row) => count + (row.is_service_running === 1 ? 1 : 0),
    0,
  );
  const onlineCount = thumbnails.reduce(
    (count: number, row) => count + (row.is_online === 1 ? 1 : 0),
    0,
  );
  const thumbnailCount = thumbnails.reduce(
    (count: number, row) => count + (row.thumbnail_url ? 1 : 0),
    0,
  );
  const etag = `"camera-thumbnails-${user.id}-${updatedAtMax}-${runningCount}-${onlineCount}-${thumbnailCount}"`;
  const ifNoneMatch = c.req.header("if-none-match");
  if (ifNoneMatch === etag) {
    return c.body(null, {
      status: 304,
      headers: {
        "etag": etag,
        "cache-control": "private, no-cache, max-age=0, must-revalidate",
      },
    });
  }

  return c.json(
    thumbnails.map(({ updated_at: _updatedAt, ...row }: typeof thumbnails[number]) => row),
    {
      headers: {
        "etag": etag,
        "cache-control": "private, no-cache, max-age=0, must-revalidate",
      },
    },
  );
});

// Camera endpoints
app.get("/api/cameras", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM cameras WHERE user_id = ? ORDER BY created_at DESC"
  )
    .bind(user.id)
    .all();

  const camerasWithOffset = results || [];

  return c.json(camerasWithOffset);
});

app.post("/api/cameras", anyAuthMiddleware, zValidator("json", CreateCameraSchema, (result, c) => {
  if (!result.success) {
    console.error("[POST /api/cameras] Validation failed:", JSON.stringify(result.error, null, 2));
    return c.json({ 
      error: "Validation failed", 
      details: result.error.issues 
    }, 400);
  }
}), async (c) => {
  const user = c.get("user")!;
  const data = c.req.valid("json");
  
  console.log("[POST /api/cameras] Received payload:", JSON.stringify(data, null, 2));

  // Ensure store_frames is always true and retention_days is valid
  const retentionDays = data.retention_days || 1;
  const validRetentionDays = [1, 3, 7, 15, 30, 90, 180];
  const normalizedRetention = validRetentionDays.includes(retentionDays) ? retentionDays : 1;

  // Determine connection method
  const connectionMethod = data.connection_method || "RTSP";

  if (connectionMethod !== "WEBCAM") {
    const missingRtspFields = validateRequiredRtspCameraFields({
      ...data,
      connection_method: connectionMethod,
    });
    if (missingRtspFields.length > 0) {
      return c.json(
        {
          error: `Missing required RTSP fields: ${missingRtspFields.join(", ")}`,
          missing_fields: missingRtspFields,
        },
        400
      );
    }
  }

  // Normalize name for webcam cameras: ensure "Webcam " prefix
  let cameraName = data.name.trim();
  if (connectionMethod === "WEBCAM") {
    const prefix = "Webcam ";
    if (!cameraName.toLowerCase().startsWith(prefix.toLowerCase())) {
      cameraName = prefix + cameraName;
    }
  }

  const allowPublicAccess = data.allowpublicaccess ? 1 : 0;
  const normalizedGeo = normalizeCameraGeography(data.state, data.country);
  const normalizedStructuredDescription = normalizeStructuredCameraDescription(data.description);
  const rawDescription =
    typeof data.description === "string" ? data.description.trim() : "";
  const persistedDescription = normalizedStructuredDescription ?? rawDescription;
  const descriptionFirstCheckSuccessful = normalizedStructuredDescription ? 1 : 0;
  const descriptionFirstCheckSuccessAt = normalizedStructuredDescription
    ? new Date().toISOString()
    : null;

  const result = await c.env.DB.prepare(
    `INSERT INTO cameras (
      user_id, name, ip_address, rtsp_port, manufacturer, username, password,
      channel, subtype,
      connection_method, store_frames, retention_days, description,
      description_first_check_successful, description_first_check_success_at,
      street, number, city, state, state_code, zip_code, country, country_code,
      webcam_index, allowpublicaccess, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  )
    .bind(
      user.id,
      cameraName,
      connectionMethod === "WEBCAM" ? "" : (normalizeCameraTransportField(data.ip_address) ?? ""),
      connectionMethod === "WEBCAM" ? null : normalizeOptionalCameraField(data.rtsp_port),
      connectionMethod === "WEBCAM" ? "Webcam" : normalizeOptionalCameraField(data.manufacturer),
      connectionMethod === "WEBCAM" ? null : normalizeOptionalCameraField(data.username),
      connectionMethod === "WEBCAM" ? null : normalizeOptionalCameraField(data.password),
      connectionMethod === "WEBCAM" ? null : normalizeOptionalCameraField(data.channel),
      connectionMethod === "WEBCAM" ? null : normalizeOptionalCameraField(data.subtype),
      connectionMethod,
      1, // Always enable frame storage
      normalizedRetention,
      persistedDescription,
      descriptionFirstCheckSuccessful,
      descriptionFirstCheckSuccessAt,
      data.street,
      data.number,
      data.city,
      normalizedGeo.stateText,
      normalizedGeo.stateCode,
      data.zip_code,
      normalizedGeo.countryText,
      normalizedGeo.countryCode,
      connectionMethod === "WEBCAM" ? (data.webcam_index ?? null) : null,
      allowPublicAccess
    )
    .run();

  const camera = await c.env.DB.prepare("SELECT * FROM cameras WHERE id = ?")
    .bind(result.meta.last_row_id)
    .first();

  // Create command for EXE
  await c.env.DB.prepare(
    `INSERT INTO commands (user_id, camera_id, command_type, payload)
     VALUES (?, ?, 'add_camera', ?)`
  )
    .bind(user.id, result.meta.last_row_id, JSON.stringify(camera))
    .run();

  return c.json(camera, 201);
});

app.get("/api/cameras/:id", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");

  const camera = await c.env.DB.prepare(
    "SELECT * FROM cameras WHERE id = ? AND user_id = ?"
  )
    .bind(id, user.id)
    .first();

  if (!camera) {
    return c.json({ error: "Camera not found" }, 404);
  }

  return c.json(camera);
});

app.post("/api/cameras/:cameraId/refresh-thumbnail", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const cameraId = parseInt(c.req.param("cameraId"), 10);

  if (!Number.isInteger(cameraId) || cameraId <= 0) {
    return c.json({ error: "Invalid camera id" }, 400);
  }

  const camera = await c.env.DB.prepare(
    "SELECT * FROM cameras WHERE id = ? AND user_id = ?"
  )
    .bind(cameraId, user.id)
    .first();

  if (!camera) {
    return c.json({ error: "Camera not found" }, 404);
  }

  const existingPending = await c.env.DB.prepare(
    `SELECT id, status
       FROM commands
      WHERE user_id = ?
        AND camera_id = ?
        AND command_type = 'refresh_thumbnail'
        AND status IN ('pending', 'sent')
      ORDER BY created_at DESC
      LIMIT 1`
  )
    .bind(user.id, cameraId)
    .first();

  if (existingPending) {
    return c.json({
      command_id: Number((existingPending as any).id || 0),
      status: String((existingPending as any).status || "pending"),
      deduplicated: true,
    });
  }

  const cam = camera as any;
  const payload = {
    camera_id: cameraId,
    camera_name: typeof cam.name === "string" ? cam.name : `Camera ${cameraId}`,
    snapshot_strategy: {
      warmup_seconds: 4,
      target_second: 3,
      max_capture_seconds: 8,
      require_snapshot: true,
    },
    camera_payload: {
      camera_id: cameraId,
      name: typeof cam.name === "string" ? cam.name : `Camera ${cameraId}`,
      description: typeof cam.description === "string" ? cam.description : "",
      ip: normalizeCameraTransportField(cam.ip_address) ?? "",
      port: normalizeCameraTransportField(cam.rtsp_port),
      username: normalizeCameraTransportField(cam.username) ?? "",
      password: typeof cam.password === "string" ? cam.password : "",
      manufacturer: normalizeCameraTransportField(cam.manufacturer) ?? "",
      connection_method:
        normalizeCameraTransportField(cam.connection_method) ?? "",
      webcam_index:
        cam.webcam_index === null || cam.webcam_index === undefined
          ? null
          : Number(cam.webcam_index),
      channel: normalizeCameraTransportField(cam.channel),
      subtype: normalizeCameraTransportField(cam.subtype),
    },
  };

  const now = new Date().toISOString();
  const insertResult = await c.env.DB.prepare(
    `INSERT INTO commands (user_id, camera_id, command_type, payload, status, created_at, updated_at)
     VALUES (?, ?, 'refresh_thumbnail', ?, 'pending', ?, ?)`
  )
    .bind(user.id, cameraId, JSON.stringify(payload), now, now)
    .run();

  const commandId = Number(insertResult.meta.last_row_id || 0);
  if (!Number.isInteger(commandId) || commandId <= 0) {
    return c.json({ error: "Failed to enqueue thumbnail refresh command" }, 500);
  }

  return c.json({
    command_id: commandId,
    status: "pending",
    deduplicated: false,
  });
});

app.patch("/api/cameras/:id", anyAuthMiddleware, zValidator("json", UpdateCameraSchema, (result, c) => {
  if (!result.success) {
    console.error("[PATCH /api/cameras/:id] Validation failed:", JSON.stringify(result.error, null, 2));
    return c.json({ 
      error: "Validation failed", 
      details: result.error.issues 
    }, 400);
  }
}), async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const dataRaw = c.req.valid("json");
  const data: any = { ...dataRaw };

  const camera = await c.env.DB.prepare(
    "SELECT * FROM cameras WHERE id = ? AND user_id = ?"
  )
    .bind(id, user.id)
    .first();

  if (!camera) {
    return c.json({ error: "Camera not found" }, 404);
  }

  const existingCam: any = camera;
  const requestedConnectionMethod =
    typeof data.connection_method === "string" ? data.connection_method : null;
  const effectiveConnectionMethod = requestedConnectionMethod || existingCam.connection_method || "RTSP";
  const normalizedGeo = normalizeCameraGeography(
    data.state ?? existingCam.state,
    data.country ?? existingCam.country
  );
  if (effectiveConnectionMethod !== "WEBCAM") {
    const mergedRtspValues = {
      rtsp_port: data.rtsp_port ?? existingCam.rtsp_port,
      manufacturer: data.manufacturer ?? existingCam.manufacturer,
      username: data.username ?? existingCam.username,
      password: data.password ?? existingCam.password,
      connection_method: effectiveConnectionMethod,
    };
    const missingRtspFields = validateRequiredRtspCameraFields(mergedRtspValues);
    if (missingRtspFields.length > 0) {
      return c.json(
        {
          error: `Missing required RTSP fields: ${missingRtspFields.join(", ")}`,
          missing_fields: missingRtspFields,
        },
        400
      );
    }
  }

  // Don't apply webcam_index updates for RTSP cameras
  const cam: any = camera;
  if (cam.connection_method !== "WEBCAM") {
    delete data.webcam_index;
  }

  const updates: string[] = [];
  const values: any[] = [];

  // Process each field, normalizing store_frames and retention_days
  Object.entries(data).forEach(([key, value]) => {
    if (key === "store_frames") {
      // Always force store_frames to true
      updates.push(`${key} = ?`);
      values.push(1);
    } else if (key === "retention_days") {
      // Validate retention_days is one of the allowed values
      const validRetentionDays = [1, 3, 7, 15, 30, 90, 180];
      const normalizedRetention = validRetentionDays.includes(value as number) ? value : 1;
      updates.push(`${key} = ?`);
      values.push(normalizedRetention);
    } else if (key === "allowpublicaccess") {
      // Handle allowpublicaccess updates (boolean to integer)
      updates.push(`${key} = ?`);
      values.push(value ? 1 : 0);
    } else if (key === "webcam_index") {
      // Skip if value is null (don't write null redundantly)
      if (value === null) return;
      updates.push(`${key} = ?`);
      values.push(value);
    } else if (key === "ip_address") {
      updates.push(`${key} = ?`);
      values.push(normalizeCameraTransportField(value) ?? "");
    } else if (key === "name") {
      // Normalize name for webcam cameras: ensure "Webcam " prefix
      let normalizedName = (value as string).trim();
      const cam: any = camera;
      if (cam.connection_method === "WEBCAM") {
        const prefix = "Webcam ";
        if (!normalizedName.toLowerCase().startsWith(prefix.toLowerCase())) {
          normalizedName = prefix + normalizedName;
        }
      }
      updates.push(`${key} = ?`);
      values.push(normalizedName);
    } else if (key === "channel" || key === "subtype") {
      updates.push(`${key} = ?`);
      values.push(normalizeOptionalCameraField(value));
    } else if (key === "rtsp_port" || key === "manufacturer" || key === "username" || key === "password") {
      updates.push(`${key} = ?`);
      values.push(normalizeOptionalCameraField(value));
    } else if (key === "state") {
      updates.push("state = ?");
      values.push(normalizedGeo.stateText);
    } else if (key === "country") {
      updates.push("country = ?");
      values.push(normalizedGeo.countryText);
    } else if (key === "description") {
      const normalizedStructuredDescription = normalizeStructuredCameraDescription(value);
      const rawDescription =
        typeof value === "string" ? value.trim() : "";
      const persistedDescription = normalizedStructuredDescription ?? rawDescription;

      updates.push("description = ?");
      values.push(persistedDescription);

      if (normalizedStructuredDescription) {
        updates.push("description_first_check_successful = ?");
        values.push(1);
        updates.push("description_first_check_success_at = COALESCE(description_first_check_success_at, ?)");
        values.push(new Date().toISOString());
      } else {
        updates.push("description_first_check_successful = ?");
        values.push(0);
        updates.push("description_first_check_success_at = ?");
        values.push(null);
      }
    } else {
      updates.push(`${key} = ?`);
      values.push(value);
    }
  });

  updates.push("state_code = ?");
  values.push(normalizedGeo.stateCode);
  updates.push("country_code = ?");
  values.push(normalizedGeo.countryCode);

  if (updates.length > 0) {
    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id, user.id);

    await c.env.DB.prepare(
      `UPDATE cameras SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`
    )
      .bind(...values)
      .run();
  }

  const updatedCamera = await c.env.DB.prepare(
    "SELECT * FROM cameras WHERE id = ? AND user_id = ?"
  )
    .bind(id, user.id)
    .first();

  // Get subscription to determine analysis_speed and model_tier for update_camera command
  const activeSubscription = await c.env.DB.prepare(
    "SELECT * FROM subscriptions WHERE user_id = ? AND is_active = 1 LIMIT 1"
  )
    .bind(user.id)
    .first();

  const subscriptionModelTier = activeSubscription
    ? normalizeTier((activeSubscription as any).model_tier ?? (activeSubscription as any).plan_tier ?? "light")
    : "light";

  const subscriptionSecondsPerFrame = activeSubscription
    ? Number((activeSubscription as any).seconds_per_frame ?? 3)
    : 3;

  // Build payload with subscription-based analysis_speed and model_tier
  const updatePayload = {
    ...(updatedCamera as any),
    analysis_speed: subscriptionSecondsPerFrame,
    model_tier: subscriptionModelTier,
  };

  // Create command for EXE
  await c.env.DB.prepare(
    `INSERT INTO commands (user_id, camera_id, command_type, payload)
     VALUES (?, ?, 'update_camera', ?)`
  )
    .bind(user.id, id, JSON.stringify(updatePayload))
    .run();

  return c.json(updatedCamera);
});

app.delete("/api/cameras/:id", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");

  const camera = await c.env.DB.prepare(
    "SELECT * FROM cameras WHERE id = ? AND user_id = ?"
  )
    .bind(id, user.id)
    .first();

  if (!camera) {
    return c.json({ error: "Camera not found" }, 404);
  }

  await c.env.DB.prepare("DELETE FROM cameras WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .run();

  // Create command for EXE
  await c.env.DB.prepare(
    `INSERT INTO commands (user_id, camera_id, command_type, payload)
     VALUES (?, ?, 'delete_camera', ?)`
  )
    .bind(user.id, id, JSON.stringify({ camera_id: id }))
    .run();

  return c.json({ success: true });
});




// Helper function to enqueue start camera command
async function enqueueStartCameraCommand(
  env: Env,
  userId: string,
  cameraId: number
): Promise<{
  success: boolean;
  agents_disabled_no_subscription?: boolean;
  error?: string;
  error_code?: string;
}> {
  try {
    // Optional: ensure EXE is connected
    const pairing = await env.DB.prepare(
      "SELECT * FROM exe_pairings WHERE user_id = ? AND status = 'connected'"
    )
      .bind(userId)
      .first();

    if (!pairing) {
      return { success: false, error: "No EXE connected" };
    }

    // Fetch camera info
    const camera = await env.DB.prepare(
      "SELECT * FROM cameras WHERE id = ? AND user_id = ?"
    )
      .bind(cameraId, userId)
      .first();

    if (!camera) {
      return { success: false, error: "Camera not found" };
    }

    // Check camera license limit (only if camera is not already running)
    const cam: any = camera;
    
    // Fetch active subscription early - we'll need it for multiple checks
    const activeSubscription = await env.DB.prepare(
      "SELECT * FROM subscriptions WHERE user_id = ? AND is_active = 1 LIMIT 1"
    )
      .bind(userId)
      .first();

    const hasActiveSubscription = !!activeSubscription;

    if (cam.is_service_running !== 1) {
      const cameraLimit = activeSubscription
        ? ((activeSubscription as any).camera_count
           ?? (activeSubscription as any).max_cameras
           ?? 1)
        : 0;

      // Count currently running cameras
      const activeCountRow = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM cameras WHERE user_id = ? AND is_service_running = 1"
      )
        .bind(userId)
        .first();

      const activeCameras = activeCountRow ? Number((activeCountRow as any).count ?? 0) : 0;

      // Enforce camera limit
      if (cameraLimit > 0 && activeCameras >= cameraLimit) {
        return {
          success: false,
          error: `Camera limit reached (${activeCameras}/${cameraLimit})`
        };
      }
    }

    // Fetch enabled algorithms for this camera
    const { results: algos } = await env.DB.prepare(
      "SELECT id FROM camera_algorithms WHERE camera_id = ? AND is_enabled = 1"
    )
      .bind(cameraId)
      .all();

    // Check if user has subscription - if not and there are enabled algorithms, disable them
    let enabledAlgorithms: any[] = [];
    let agentsDisabledDueToNoSubscription = false;
    
    if (!hasActiveSubscription && (algos || []).length > 0) {
      // User has no subscription but has enabled algorithms - disable them all
      console.log(`[START CAMERA] No subscription found - disabling ${(algos || []).length} enabled algorithms`);
      
      agentsDisabledDueToNoSubscription = true;
      
      // Disable all algorithms in the database
      await env.DB.prepare(
        `UPDATE camera_algorithms 
         SET is_enabled = 0, updated_at = CURRENT_TIMESTAMP
         WHERE camera_id = ? AND is_enabled = 1`
      )
        .bind(cameraId)
        .run();
      
      // Create notification for user
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO notifications (user_id, camera_id, type, title, message, created_at, is_read)
         VALUES (?, ?, 'warning', 'Subscription Required', 'AI agents have been disabled for Camera #${cameraId}. You need an active subscription to use AI detection features.', ?, 0)`
      )
        .bind(userId, cameraId, now)
        .run();
      
      // enabled_algorithms remains empty array
      enabledAlgorithms = [];
    } else {
      // User has subscription or no enabled algorithms - proceed normally.
      enabledAlgorithms = await buildEnabledAlgorithmsPayloadForCamera(
        env.DB,
        userId,
        cameraId
      );
    }

    // Fetch user's frame_rate (default to 12 if not set)
    const frameRateData = await env.DB.prepare(
      "SELECT frame_rate FROM user_frame_rate WHERE user_id = ?"
    )
      .bind(userId)
      .first();

    const frameRate = frameRateData ? (frameRateData as any).frame_rate : 12;
    
    console.log(`[START CAMERA] Camera ID: ${cameraId}, User ID: ${userId}, Frame Rate: ${frameRate}`);

    const userOpenAiApiKey = await getUserOpenAIApiKey(env.DB, userId);
    const userZAiApiKey = await getUserZAIApiKey(env.DB, userId);
    const requiresOpenAiForEnabledCustomAgents = enabledAlgorithms.some((algo: any) => {
      const algorithmType = String(algo?.algorithm_type || "").trim().toLowerCase();
      if (!algorithmType.startsWith("custom_")) return false;
      const inferenceModel = String(algo?.inference_model || "ultra").trim().toLowerCase();
      return inferenceModel !== "core";
    });
    const requiresZAiForEnabledCustomAgents = enabledAlgorithms.some((algo: any) => {
      const algorithmType = String(algo?.algorithm_type || "").trim().toLowerCase();
      if (!algorithmType.startsWith("custom_")) return false;
      const inferenceModel = String(algo?.inference_model || "").trim().toLowerCase();
      return inferenceModel === "core";
    });
    if (requiresOpenAiForEnabledCustomAgents && !userOpenAiApiKey) {
      return {
        success: false,
        error: OPENAI_KEY_REQUIRED_MESSAGE,
        error_code: OPENAI_KEY_REQUIRED_ERROR,
      };
    }
    if (requiresZAiForEnabledCustomAgents && !userZAiApiKey) {
      return {
        success: false,
        error: ZAI_KEY_REQUIRED_MESSAGE,
        error_code: ZAI_KEY_REQUIRED_ERROR,
      };
    }
    const descriptionModelApiKey = userOpenAiApiKey;

    // Get subscription values - these are what we'll always use
    const subscriptionModelTier = hasActiveSubscription
      ? normalizeTier((activeSubscription as any).model_tier ?? (activeSubscription as any).plan_tier ?? "light")
      : "light";

    const subscriptionSecondsPerFrame = hasActiveSubscription
      ? Number((activeSubscription as any).seconds_per_frame ?? 3)
      : 3;

    // Effective values for this camera are now always the subscription values
    const effectiveAnalysisSpeed = subscriptionSecondsPerFrame;
    const effectiveModelTier = subscriptionModelTier;

    console.log(
      `[START CAMERA] Subscription limits (forced): speed=${effectiveAnalysisSpeed}, tier=${effectiveModelTier}`
    );

    // Fetch Telegram settings for this camera's owner
    const telegram = await getTelegramSettingsForUser(env.DB, cam.user_id);

    // Build payload for EXE including effective analysis_speed and model_tier
    const payload = {
      camera_id: cam.id,
      name: cam.name,
      ip: normalizeCameraTransportField(cam.ip_address) ?? "",
      port: normalizeCameraTransportField(cam.rtsp_port),
      username: normalizeCameraTransportField(cam.username) ?? "",
      password: cam.password,
      channel: normalizeCameraTransportField(cam.channel),
      subtype: normalizeCameraTransportField(cam.subtype),
      manufacturer: normalizeCameraTransportField(cam.manufacturer),
      connection_method: normalizeCameraTransportField(cam.connection_method),
      start_origin: "direct",
      enabled_algorithms: enabledAlgorithms,
      store_frames: cam.store_frames === 1,
      retention_days: cam.retention_days,
      frame_rate: frameRate,
      webcam_index: cam.webcam_index,
      analysis_speed: effectiveAnalysisSpeed,
      model_tier: effectiveModelTier,
      telegram_enabled: telegram.enabled,
      telegram_chat_id: telegram.chat_id,
      telegram_bot_token: telegram.bot_token,
      description_model_name: "gpt-5.1",
      description_model_api_key: descriptionModelApiKey,
    };

    const now = new Date().toISOString();

    // Update is_service_running and is_online to 1 BEFORE sending command
    await env.DB.prepare(
      "UPDATE cameras SET is_service_running = 1, is_online = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?"
    )
      .bind(cameraId, userId)
      .run();

    // Send start_camera command to EXE
    await env.DB.prepare(
      `INSERT INTO commands 
         (user_id, camera_id, command_type, payload, status, created_at, updated_at)
       VALUES (?, ?, 'start_camera', ?, 'pending', ?, ?)`
    )
      .bind(
        userId,
        cameraId,
        JSON.stringify(payload),
        now,
        now
      )
      .run();

    console.log(
      `[START CAMERA] Command enqueued with payload:`,
      JSON.stringify(redactSensitiveForLog(payload), null, 2)
    );

    return { 
      success: true,
      agents_disabled_no_subscription: agentsDisabledDueToNoSubscription,
    };
  } catch (error) {
    console.error(`[START CAMERA] Error for camera ${cameraId}:`, error);
    return { success: false, error: "Internal server error" };
  }
}

async function enqueueUpdateAlgorithmsIfCameraRunning(
  db: D1Database,
  userId: string,
  cameraId: number
): Promise<void> {
  const camera = await db
    .prepare("SELECT is_service_running FROM cameras WHERE id = ? AND user_id = ?")
    .bind(cameraId, userId)
    .first();

  if (!camera || Number((camera as any)?.is_service_running) !== 1) return;

  const enabledAlgorithms = await buildEnabledAlgorithmsPayloadForCamera(db, userId, cameraId);
  const requiresOpenAiForEnabledCustomAgents = enabledAlgorithms.some((algo: any) => {
    const algorithmType = String(algo?.algorithm_type || "").trim().toLowerCase();
    if (!algorithmType.startsWith("custom_")) return false;
    const inferenceModel = String(algo?.inference_model || "ultra").trim().toLowerCase();
    return inferenceModel !== "core";
  });
  const requiresZAiForEnabledCustomAgents = enabledAlgorithms.some((algo: any) => {
    const algorithmType = String(algo?.algorithm_type || "").trim().toLowerCase();
    if (!algorithmType.startsWith("custom_")) return false;
    const inferenceModel = String(algo?.inference_model || "").trim().toLowerCase();
    return inferenceModel === "core";
  });
  if (requiresOpenAiForEnabledCustomAgents) {
    const userOpenAiApiKey = await getUserOpenAIApiKey(db, userId);
    if (!userOpenAiApiKey) {
      console.log(
        `[UPDATE ALGORITHMS] Skipping command enqueue for camera ${cameraId}: missing user OpenAI API key`
      );
      return;
    }
  }
  if (requiresZAiForEnabledCustomAgents) {
    const userZAiApiKey = await getUserZAIApiKey(db, userId);
    if (!userZAiApiKey) {
      console.log(
        `[UPDATE ALGORITHMS] Skipping command enqueue for camera ${cameraId}: missing user Z.ai API key`
      );
      return;
    }
  }
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO commands (user_id, camera_id, command_type, payload, status, created_at, updated_at)
       VALUES (?, ?, 'update_algorithms', ?, 'pending', ?, ?)`
    )
    .bind(
      userId,
      cameraId,
      JSON.stringify({
        camera_id: cameraId,
        enabled_algorithms: enabledAlgorithms,
      }),
      now,
      now
    )
    .run();
}

// Start camera: enqueue command with full camera config
app.post("/api/cameras/:cameraId/start", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const cameraId = c.req.param("cameraId");

  const result = await enqueueStartCameraCommand(c.env, user.id, Number(cameraId));
  
  if (!result.success) {
    return c.json(
      result.error_code === OPENAI_KEY_REQUIRED_ERROR
        ? buildOpenAiKeyRequiredErrorBody()
        : result.error_code === ZAI_KEY_REQUIRED_ERROR
        ? buildZAiKeyRequiredErrorBody()
        : { error: result.error || "Unable to start camera" },
      400
    );
  }
  
  return c.json({ 
    success: true,
    agents_disabled_no_subscription: result.agents_disabled_no_subscription,
  });
});

// EXE bootstrap endpoint - enqueue start_camera commands for all cameras marked as running
app.post("/api/agent/bootstrap-cameras", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  // Read Bearer token from Authorization header
  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  // Find pairing for this client + token
  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = (pairing as any).user_id;

  console.log(`[BOOTSTRAP] Starting camera bootstrap for user ${userId}`);

  // Get all cameras that should be running
  const { results: cameras } = await c.env.DB.prepare(
    `SELECT id FROM cameras 
     WHERE user_id = ? AND is_service_running = 1 
     ORDER BY created_at ASC`
  )
    .bind(userId)
    .all();

  if (!cameras || cameras.length === 0) {
    console.log(`[BOOTSTRAP] No cameras to bootstrap for user ${userId}`);
    return c.json({ ok: true, enqueued_camera_ids: [] });
  }

  console.log(`[BOOTSTRAP] Found ${cameras.length} cameras to bootstrap`);

  const enqueuedCameraIds: number[] = [];

  for (const camera of cameras) {
    const cameraId = (camera as any).id;

    // Enqueue start command using the helper function
    const result = await enqueueStartCameraCommand(c.env, userId, cameraId);

    if (result.success) {
      enqueuedCameraIds.push(cameraId);
    } else {
      console.log(`[BOOTSTRAP] Failed to enqueue camera ${cameraId}: ${result.error}`);
    }
  }

  console.log(`[BOOTSTRAP] Enqueued start_camera for cameras`, enqueuedCameraIds);

  return c.json({
    ok: true,
    enqueued_camera_ids: enqueuedCameraIds,
  });
});





// Algorithm endpoints
app.get("/api/cameras/:cameraId/algorithms", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const cameraId = c.req.param("cameraId");

  // Verify camera ownership
  const camera = await c.env.DB.prepare(
    "SELECT * FROM cameras WHERE id = ? AND user_id = ?"
  )
    .bind(cameraId, user.id)
    .first();

  if (!camera) {
    return c.json({ error: "Camera not found" }, 404);
  }

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM camera_algorithms WHERE camera_id = ?"
  )
    .bind(cameraId)
    .all();

  const rows = (results || []).map((row: any) => ({ ...row }));
  const hasCustom = rows.some((row: any) =>
    String(row?.algorithm_type || "").startsWith("custom_")
  );
  if (!hasCustom) {
    return c.json(rows);
  }

  const customAgents = await listCustomCameraAgents(
    c.env.DB,
    user.id,
    Number(cameraId)
  );
  const customByType = new Map<string, any>();
  for (const agent of customAgents || []) {
    const type = String((agent as any)?.algorithm_type || "").trim();
    if (!type) continue;
    customByType.set(type, agent);
  }

  const merged = rows.map((row: any) => {
    const type = String(row?.algorithm_type || "").trim();
    if (!type.startsWith("custom_")) return row;
    const enriched = customByType.get(type);
    return enriched ? { ...row, ...enriched } : row;
  });

  return c.json(merged);
});

app.post("/api/cameras/:cameraId/algorithms", anyAuthMiddleware, zValidator("json", CreateAlgorithmSchema), async (c) => {
  const user = c.get("user")!;
  const cameraId = c.req.param("cameraId");
  const data = c.req.valid("json");

  try {
    // Verify camera ownership
    const camera = await c.env.DB.prepare(
      "SELECT * FROM cameras WHERE id = ? AND user_id = ?"
    )
      .bind(cameraId, user.id)
      .first();

    if (!camera) {
      return c.json({ error: "Camera not found" }, 404);
    }

    // TOKEN LIMIT ENFORCEMENT: Check subscription token limits before allowing algorithm enablement
    // Always allow disabling (is_enabled=0), but block enabling (is_enabled=1) if limits reached
    if (data.is_enabled === 1) {
      // Fetch active camera subscription for this user (plan-level)
      const subscription = await c.env.DB.prepare(
        `SELECT *
         FROM subscriptions
         WHERE user_id = ?
           AND subscription_type LIKE 'camera_monitoring%'
           AND is_active = 1
           AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
         ORDER BY started_at DESC
         LIMIT 1`
      )
        .bind(user.id)
        .first();

      if (!subscription) {
        return c.json({
          error: "TOKEN_LIMIT_REACHED",
          message: "Your subscription has no active camera monitoring plan. Please renew your subscription to enable AI agents."
        }, 403);
      }

      const sub = subscription as any;

      // Calculate token usage ratios
      const inputRatio = sub.InputTokensUsedM / sub.InputTokensM;
      const outputRatio = sub.OutputTokensUsedM / sub.OutputTokensM;

      // If either token type has reached or exceeded 100% of allowance, block enabling
      if (inputRatio >= 1.0 || outputRatio >= 1.0) {
        return c.json({
          error: "TOKEN_LIMIT_REACHED",
          message: "Your AI subscription token limit has been reached for the current period. You cannot enable AI agents until the subscription renews."
        }, 403);
      }
    }

    const algorithmType = String(data.algorithm_type || "").trim();
    const isCustomAgent = algorithmType.startsWith("custom_");
    const normalizedPromptParts = parsePromptTemplateParts(
      data.prompt_template ?? data.llm_prompt ?? "",
      data.alert_condition,
      data.negative_condition
    );
    const storedPromptTemplate = buildPromptTemplateFromParts(normalizedPromptParts);
    const normalizedInputType = normalizeJobStepInputType(data.input_type) || "video";
    const normalizedInferenceModel =
      normalizeJobStepInferenceModel(data.inference_model) || FIXED_JOB_STEP_INFERENCE_MODEL;
    const normalizedRunEvery = normalizeJobStepRunEverySeconds(
      data.run_every,
      FIXED_JOB_STEP_RUN_EVERY_SECONDS
    );
    const requestedModelFps =
      data.model_fps === undefined
        ? DEFAULT_ULTRA_VIDEO_MODEL_FPS
        : normalizeJobStepModelFps(
            data.model_fps,
            normalizedInferenceModel,
            normalizedInputType
          );
    const requestedRunningResolution =
      data.running_resolution === undefined || data.running_resolution === null
        ? null
        : parseJobStepRunningResolution(data.running_resolution);
    if (
      data.running_resolution !== undefined &&
      data.running_resolution !== null &&
      requestedRunningResolution === null
    ) {
      return c.json({ error: "Invalid running_resolution. Allowed values: 640, 1024" }, 400);
    }
    const executionSettings = isCustomAgent
      ? applyInferenceExecutionConstraints(
          normalizedInputType,
          normalizedInferenceModel,
          normalizedRunEvery,
          requestedRunningResolution,
          requestedModelFps
        )
      : null;
    const normalizedOnlyCaptureOnMotion = normalizeJobStepOnlyCaptureOnMotion(
      data.only_capture_on_motion,
      true
    );
    const requestedFaceTargetIds = normalizeFaceTargetIdsInput(data.face_target_ids);
    const requestedAnalysisRegions =
      data.analysis_regions === undefined
        ? undefined
        : data.analysis_regions === null
        ? []
        : data.analysis_regions;

    if (requestedAnalysisRegions !== undefined && !Array.isArray(requestedAnalysisRegions)) {
      return c.json({ error: "analysis_regions must be an array" }, 400);
    }

    if (requestedFaceTargetIds !== null && requestedFaceTargetIds.length > 0) {
      const placeholders = requestedFaceTargetIds.map(() => "?").join(", ");
      const { results: rows } = await c.env.DB
        .prepare(
          `SELECT ft.id, COUNT(fti.id) AS image_count
           FROM face_targets ft
           LEFT JOIN face_target_images fti ON fti.face_target_id = ft.id
           WHERE ft.user_id = ?
             AND ft.id IN (${placeholders})
           GROUP BY ft.id`
        )
        .bind(user.id, ...requestedFaceTargetIds)
        .all();

      const validated = new Map<number, number>();
      for (const row of rows || []) {
        const id = Number((row as any)?.id);
        const imageCount = Number((row as any)?.image_count || 0);
        if (!Number.isInteger(id) || id <= 0) continue;
        validated.set(id, imageCount);
      }

      const missing = requestedFaceTargetIds.filter((id) => !validated.has(id));
      if (missing.length > 0) {
        return c.json({ error: "Some selected face targets are invalid" }, 400);
      }

      const withoutImages = requestedFaceTargetIds.filter((id) => (validated.get(id) || 0) <= 0);
      if (withoutImages.length > 0) {
        return c.json({ error: "All selected face targets must have at least one image" }, 400);
      }
    }

    const configJsonObject = (() => {
      let cfg: any = {};
      if (typeof data.config_json === "string" && data.config_json.trim()) {
        try {
          const parsed = JSON.parse(data.config_json);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            cfg = parsed;
          }
        } catch {
          cfg = {};
        }
      }
      if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) cfg = {};
      if (typeof data.display_name === "string" && data.display_name.trim()) {
        cfg.display_name = data.display_name.trim();
      }
      if (!cfg.display_name) {
        cfg.display_name = ALGORITHM_DISPLAY_NAMES[algorithmType] || algorithmType;
      }
      return cfg;
    })();

    // Check if algorithm already exists
    const existing = await c.env.DB.prepare(
      "SELECT * FROM camera_algorithms WHERE camera_id = ? AND algorithm_type = ?"
    )
      .bind(cameraId, algorithmType)
      .first();

    const willEnableCoreCustomAgent =
      isCustomAgent &&
      Number(data.is_enabled || 0) !== 0 &&
      executionSettings?.inferenceModel === "core";
    if (willEnableCoreCustomAgent) {
      const existingAlgorithmId = Number((existing as any)?.id || 0);
      const existingInferenceModel =
        normalizeJobStepInferenceModel((existing as any)?.inference_model) ||
        FIXED_JOB_STEP_INFERENCE_MODEL;
      const existingWasCoreEnabled =
        !!existing &&
        Number((existing as any)?.is_enabled || 0) !== 0 &&
        existingInferenceModel === "core";

      if (!existingWasCoreEnabled) {
        const coreBusyState = await findCoreModelBusyStateForCameraEnable(c.env.DB, user.id, {
          excludeAlgorithmId:
            Number.isInteger(existingAlgorithmId) && existingAlgorithmId > 0
              ? existingAlgorithmId
              : undefined,
        });
        if (coreBusyState) {
          return c.json(buildCoreModelBusyErrorBody(coreBusyState), 409);
        }
      }
    }

    let algorithmId = 0;
    if (existing) {
      algorithmId = Number((existing as any).id || 0);
      let analysisRegionsToStore: string | null = (existing as any).analysis_regions ?? null;
      if (requestedAnalysisRegions !== undefined) {
        const existingNegativeImages = await loadNegativeReferenceImagesByCameraAlgorithmIds(
          c.env.DB,
          [algorithmId]
        );
        const negativeImageIds = (existingNegativeImages.get(algorithmId) || [])
          .map((img) => Number(img?.id))
          .filter((id) => Number.isInteger(id) && id > 0);
        const normalizedRegions = normalizeAnalysisRegionsInput(
          requestedAnalysisRegions,
          {
            promptParts: normalizedPromptParts,
            faceTargetIds: requestedFaceTargetIds || [],
            negativeImageIds,
          }
        );
        if (normalizedRegions.error) {
          return c.json({ error: normalizedRegions.error }, 400);
        }
        analysisRegionsToStore = JSON.stringify(normalizedRegions.regions);
      }

      await c.env.DB.prepare(
        `UPDATE camera_algorithms
         SET is_enabled = ?,
             llm_prompt = ?,
             image_region = ?,
             config_json = ?,
             prompt_template = ?,
             alert_condition = ?,
             negative_condition = ?,
             analysis_regions = ?,
             input_type = ?,
             inference_model = ?,
             model_fps = ?,
             run_every = ?,
             running_resolution = ?,
             only_capture_on_motion = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE camera_id = ? AND algorithm_type = ?`
      )
        .bind(
          data.is_enabled,
          data.llm_prompt || null,
          data.image_region || null,
          JSON.stringify(configJsonObject),
          isCustomAgent ? storedPromptTemplate : null,
          isCustomAgent ? normalizedPromptParts.alert_condition : null,
          isCustomAgent ? normalizedPromptParts.negative_condition : null,
          isCustomAgent ? analysisRegionsToStore : null,
          isCustomAgent ? executionSettings?.inputType ?? normalizedInputType : null,
          isCustomAgent
            ? executionSettings?.inferenceModel ?? normalizedInferenceModel
            : null,
          isCustomAgent ? executionSettings?.modelFps ?? requestedModelFps : null,
          isCustomAgent ? executionSettings?.runEvery ?? normalizedRunEvery : null,
          isCustomAgent ? executionSettings?.runningResolution ?? null : null,
          isCustomAgent ? (normalizedOnlyCaptureOnMotion ? 1 : 0) : null,
          cameraId,
          algorithmType
        )
        .run();
    } else {
      let analysisRegionsToStore: string | null = null;
      if (requestedAnalysisRegions !== undefined) {
        const normalizedRegions = normalizeAnalysisRegionsInput(
          requestedAnalysisRegions,
          {
            promptParts: normalizedPromptParts,
            faceTargetIds: requestedFaceTargetIds || [],
            negativeImageIds: [],
          }
        );
        if (normalizedRegions.error) {
          return c.json({ error: normalizedRegions.error }, 400);
        }
        analysisRegionsToStore = JSON.stringify(normalizedRegions.regions);
      }

      const insertResult = await c.env.DB.prepare(
        `INSERT INTO camera_algorithms (
           camera_id, algorithm_type, is_enabled, llm_prompt, image_region, config_json,
           prompt_template, alert_condition, negative_condition, analysis_regions,
           input_type, inference_model, model_fps, run_every, running_resolution, only_capture_on_motion
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          cameraId,
          algorithmType,
          data.is_enabled,
          data.llm_prompt || null,
          data.image_region || null,
          JSON.stringify(configJsonObject),
          isCustomAgent ? storedPromptTemplate : null,
          isCustomAgent ? normalizedPromptParts.alert_condition : null,
          isCustomAgent ? normalizedPromptParts.negative_condition : null,
          isCustomAgent ? analysisRegionsToStore : null,
          isCustomAgent ? executionSettings?.inputType ?? normalizedInputType : null,
          isCustomAgent
            ? executionSettings?.inferenceModel ?? normalizedInferenceModel
            : null,
          isCustomAgent ? executionSettings?.modelFps ?? requestedModelFps : null,
          isCustomAgent ? executionSettings?.runEvery ?? normalizedRunEvery : null,
          isCustomAgent ? executionSettings?.runningResolution ?? null : null,
          isCustomAgent ? (normalizedOnlyCaptureOnMotion ? 1 : 0) : null
        )
        .run();

      algorithmId = Number(insertResult.meta.last_row_id || 0);
    }

    if (isCustomAgent && Number.isInteger(algorithmId) && algorithmId > 0 && requestedFaceTargetIds !== null) {
      const now = new Date().toISOString();
      await c.env.DB
        .prepare("DELETE FROM camera_algorithm_face_targets WHERE algorithm_id = ?")
        .bind(algorithmId)
        .run();

      if (requestedFaceTargetIds.length > 0) {
        for (const faceTargetId of requestedFaceTargetIds) {
          await c.env.DB
            .prepare(
              `INSERT INTO camera_algorithm_face_targets (algorithm_id, face_target_id, created_at, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(algorithm_id, face_target_id) DO NOTHING`
            )
            .bind(algorithmId, faceTargetId, now, now)
            .run();
        }
      }
    }

    const algorithm = await c.env.DB.prepare(
      "SELECT * FROM camera_algorithms WHERE camera_id = ? AND algorithm_type = ?"
    )
      .bind(cameraId, algorithmType)
      .first();

    await enqueueUpdateAlgorithmsIfCameraRunning(c.env.DB, user.id, Number(cameraId));

    return c.json(algorithm || {});
  } catch (error) {
    console.error("Error in /api/cameras/:cameraId/algorithms:", error);
    return c.json({ error: "Failed to save algorithm configuration" }, 500);
  }
});

app.delete("/api/cameras/:cameraId/algorithms/:algorithmType", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const cameraId = c.req.param("cameraId");
  const algorithmType = c.req.param("algorithmType");

  try {
    // Verify camera ownership
    const camera = await c.env.DB.prepare(
      "SELECT * FROM cameras WHERE id = ? AND user_id = ?"
    )
      .bind(cameraId, user.id)
      .first();

    if (!camera) {
      return c.json({ error: "Camera not found" }, 404);
    }

    const existingAlgorithm = await c.env.DB
      .prepare("SELECT * FROM camera_algorithms WHERE camera_id = ? AND algorithm_type = ?")
      .bind(cameraId, algorithmType)
      .first();

    if (!existingAlgorithm) {
      return c.json({ error: "Algorithm not found" }, 404);
    }

    const algorithmId = Number((existingAlgorithm as any)?.id || 0);
    if (Number.isInteger(algorithmId) && algorithmId > 0) {
      const { results: imageRows } = await c.env.DB
        .prepare(
          "SELECT id, image_url FROM camera_algorithm_negative_images WHERE algorithm_id = ?"
        )
        .bind(algorithmId)
        .all();

      const storageKeys: string[] = [];
      for (const row of imageRows || []) {
        const imageUrl =
          typeof (row as any)?.image_url === "string" ? String((row as any).image_url).trim() : "";
        if (!imageUrl) continue;
        const storageKey = extractStorageKeyFromNegativeConditionImageUrl(imageUrl);
        if (!storageKey) {
          return c.json({ error: "Failed to delete algorithm negative image from storage" }, 500);
        }
        storageKeys.push(storageKey);
      }

      for (const storageKey of storageKeys) {
        try {
          await c.env.R2_BUCKET.delete(storageKey);
        } catch (error) {
          console.error("[CAMERA ALGORITHM] Failed to delete negative image from R2", {
            algorithmId,
            storageKey,
            error,
          });
          return c.json({ error: "Failed to delete algorithm negative image from storage" }, 502);
        }
      }

      await c.env.DB
        .prepare("DELETE FROM camera_algorithm_face_targets WHERE algorithm_id = ?")
        .bind(algorithmId)
        .run();
      await c.env.DB
        .prepare("DELETE FROM camera_algorithm_negative_images WHERE algorithm_id = ?")
        .bind(algorithmId)
        .run();
    }

    await c.env.DB.prepare("DELETE FROM camera_algorithms WHERE camera_id = ? AND algorithm_type = ?")
      .bind(cameraId, algorithmType)
      .run();

    await enqueueUpdateAlgorithmsIfCameraRunning(c.env.DB, user.id, Number(cameraId));

    return c.json({ success: true });
  } catch (error) {
    console.error("Error deleting algorithm:", error);
    return c.json({ error: "Failed to delete algorithm" }, 500);
  }
});

app.get("/api/cameras/:cameraId/custom-agents", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const cameraId = Number(c.req.param("cameraId"));
  if (!Number.isInteger(cameraId) || cameraId <= 0) {
    return c.json({ error: "Invalid camera id" }, 400);
  }

  const camera = await c.env.DB
    .prepare("SELECT id FROM cameras WHERE id = ? AND user_id = ?")
    .bind(cameraId, user.id)
    .first();
  if (!camera) {
    return c.json({ error: "Camera not found" }, 404);
  }

  const agents = await listCustomCameraAgents(c.env.DB, user.id, cameraId);
  return c.json({ agents });
});

app.post("/api/cameras/:cameraId/custom-agents", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const cameraId = Number(c.req.param("cameraId"));
  if (!Number.isInteger(cameraId) || cameraId <= 0) {
    return c.json({ error: "Invalid camera id" }, 400);
  }

  const camera = await c.env.DB
    .prepare("SELECT id FROM cameras WHERE id = ? AND user_id = ?")
    .bind(cameraId, user.id)
    .first();
  if (!camera) {
    return c.json({ error: "Camera not found" }, 404);
  }

  const body = await c.req
    .json<{
      algorithm_type?: string;
      display_name?: string;
      input_type?: string;
      inference_model?: string;
      model_fps?: unknown;
      running_resolution?: unknown;
      prompt_template?: string;
      alert_condition?: string;
      negative_condition?: string;
      analysis_regions?: unknown;
      face_target_ids?: unknown;
      is_enabled?: unknown;
      run_every?: unknown;
      only_capture_on_motion?: unknown;
      config_json?: unknown;
    }>()
    .catch(() => null);
  if (!body) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const candidateType =
    typeof body.algorithm_type === "string" ? body.algorithm_type.trim() : "";
  const algorithmType =
    candidateType && candidateType.startsWith("custom_")
      ? candidateType
      : `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const displayNameRaw =
    typeof body.display_name === "string" ? body.display_name.trim() : "";

  const promptParts = parsePromptTemplateParts(
    body.prompt_template,
    body.alert_condition,
    body.negative_condition
  );
  const promptTemplate = String(promptParts.prompt_template || "").trim();
  const alertCondition = String(promptParts.alert_condition || "").trim();
  const negativeCondition = normalizeOptionalPromptText(promptParts.negative_condition);
  if (!promptTemplate) {
    return c.json({ error: "prompt_template is required" }, 400);
  }
  if (!alertCondition) {
    return c.json({ error: "alert_condition is required" }, 400);
  }

  const requestedInputType = body.input_type === undefined
    ? "video"
    : normalizeJobStepInputType(body.input_type);
  if (body.input_type !== undefined && !requestedInputType) {
    return c.json({ error: "Invalid input_type. Allowed values: video, image" }, 400);
  }
  const inputType = requestedInputType || "video";
  const requestedInferenceModel = body.inference_model === undefined
    ? null
    : normalizeJobStepInferenceModel(body.inference_model);
  if (body.inference_model !== undefined && !requestedInferenceModel) {
    return c.json({ error: "Invalid inference_model. Allowed values: legacy, pro, ultra, core" }, 400);
  }
  const inferenceModel = requestedInferenceModel || FIXED_JOB_STEP_INFERENCE_MODEL;
  const runEvery = normalizeJobStepRunEverySeconds(
    body.run_every,
    FIXED_JOB_STEP_RUN_EVERY_SECONDS
  );
  const requestedModelFps =
    body.model_fps === undefined
      ? DEFAULT_ULTRA_VIDEO_MODEL_FPS
      : normalizeJobStepModelFps(body.model_fps, inferenceModel, inputType);
  const requestedRunningResolution =
    body.running_resolution === undefined || body.running_resolution === null
      ? null
      : parseJobStepRunningResolution(body.running_resolution);
  if (
    body.running_resolution !== undefined &&
    body.running_resolution !== null &&
    requestedRunningResolution === null
  ) {
    return c.json({ error: "Invalid running_resolution. Allowed values: 640, 1024" }, 400);
  }
  const executionSettings = applyInferenceExecutionConstraints(
    inputType,
    inferenceModel,
    runEvery,
    requestedRunningResolution,
    requestedModelFps
  );

  const requestedFaceTargetIds = normalizeFaceTargetIdsInput(body.face_target_ids) || [];
  if (requestedFaceTargetIds.length > 0) {
    const placeholders = requestedFaceTargetIds.map(() => "?").join(", ");
    const { results: rows } = await c.env.DB
      .prepare(
        `SELECT ft.id, COUNT(fti.id) AS image_count
         FROM face_targets ft
         LEFT JOIN face_target_images fti ON fti.face_target_id = ft.id
         WHERE ft.user_id = ?
           AND ft.id IN (${placeholders})
         GROUP BY ft.id`
      )
      .bind(user.id, ...requestedFaceTargetIds)
      .all();

    const validated = new Map<number, number>();
    for (const row of rows || []) {
      const id = Number((row as any)?.id);
      const imageCount = Number((row as any)?.image_count || 0);
      if (!Number.isInteger(id) || id <= 0) continue;
      validated.set(id, imageCount);
    }
    const missing = requestedFaceTargetIds.filter((id) => !validated.has(id));
    if (missing.length > 0) {
      return c.json({ error: "Some selected face targets are invalid" }, 400);
    }
    const withoutImages = requestedFaceTargetIds.filter((id) => (validated.get(id) || 0) <= 0);
    if (withoutImages.length > 0) {
      return c.json({ error: "All selected face targets must have at least one image" }, 400);
    }
  }

  const normalizedRegionsResult = normalizeAnalysisRegionsInput(
    body.analysis_regions === undefined ? [] : body.analysis_regions,
    {
      promptParts: {
        prompt_template: promptTemplate,
        alert_condition: alertCondition,
        negative_condition: negativeCondition,
      },
      faceTargetIds: requestedFaceTargetIds,
      negativeImageIds: [],
    }
  );
  if (normalizedRegionsResult.error) {
    return c.json({ error: normalizedRegionsResult.error }, 400);
  }

  const configJsonObject = (() => {
    let cfg: any = {};
    if (typeof body.config_json === "string" && body.config_json.trim()) {
      try {
        const parsed = JSON.parse(body.config_json);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) cfg = parsed;
      } catch {
        cfg = {};
      }
    } else if (
      body.config_json &&
      typeof body.config_json === "object" &&
      !Array.isArray(body.config_json)
    ) {
      cfg = { ...(body.config_json as Record<string, unknown>) };
    }
    if (displayNameRaw) cfg.display_name = displayNameRaw;
    else if (!cfg.display_name) cfg.display_name = algorithmType;
    return cfg;
  })();

  const now = new Date().toISOString();
  const isEnabled = normalizeJobStepOnlyCaptureOnMotion(body.is_enabled, false);
  if (isEnabled && executionSettings.inferenceModel === "core") {
    const coreBusyState = await findCoreModelBusyStateForCameraEnable(c.env.DB, user.id);
    if (coreBusyState) {
      return c.json(buildCoreModelBusyErrorBody(coreBusyState), 409);
    }
  }
  if (isEnabled) {
    if (executionSettings.requiresOpenAiKey) {
      const userOpenAiApiKey = await getUserOpenAIApiKey(c.env.DB, user.id);
      if (!userOpenAiApiKey) {
        return c.json(buildOpenAiKeyRequiredErrorBody(), 400);
      }
    }
    if (executionSettings.requiresZAiKey) {
      const userZAiApiKey = await getUserZAIApiKey(c.env.DB, user.id);
      if (!userZAiApiKey) {
        return c.json(buildZAiKeyRequiredErrorBody(), 400);
      }
    }
  }
  const inserted = await c.env.DB
    .prepare(
      `INSERT INTO camera_algorithms (
         camera_id, algorithm_type, is_enabled, llm_prompt, image_region, config_json,
         prompt_template, alert_condition, negative_condition, analysis_regions,
         input_type, inference_model, model_fps, run_every, running_resolution, only_capture_on_motion,
         created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      cameraId,
      algorithmType,
      isEnabled ? 1 : 0,
      promptTemplate,
      null,
      JSON.stringify(configJsonObject),
      buildPromptTemplateFromParts({
        prompt_template: promptTemplate,
        alert_condition: alertCondition,
        negative_condition: negativeCondition,
      }),
      alertCondition,
      negativeCondition,
      JSON.stringify(normalizedRegionsResult.regions),
      executionSettings.inputType,
      executionSettings.inferenceModel,
      executionSettings.modelFps,
      executionSettings.runEvery,
      executionSettings.runningResolution,
      normalizeJobStepOnlyCaptureOnMotion(body.only_capture_on_motion, true) ? 1 : 0,
      now,
      now
    )
    .run();

  const algorithmId = Number(inserted.meta.last_row_id || 0);
  if (!Number.isInteger(algorithmId) || algorithmId <= 0) {
    return c.json({ error: "Failed to create custom agent" }, 500);
  }

  if (requestedFaceTargetIds.length > 0) {
    for (const faceTargetId of requestedFaceTargetIds) {
      await c.env.DB
        .prepare(
          `INSERT INTO camera_algorithm_face_targets (algorithm_id, face_target_id, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(algorithm_id, face_target_id) DO NOTHING`
        )
        .bind(algorithmId, faceTargetId, now, now)
        .run();
    }
  }

  await enqueueUpdateAlgorithmsIfCameraRunning(c.env.DB, user.id, cameraId);
  const agents = await listCustomCameraAgents(c.env.DB, user.id, cameraId);
  const created = agents.find((agent) => Number((agent as any)?.id) === algorithmId) || null;
  return c.json({ agent: created }, 201);
});

app.patch("/api/cameras/:cameraId/custom-agents/:algorithmId", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const cameraId = Number(c.req.param("cameraId"));
  const algorithmId = Number(c.req.param("algorithmId"));
  if (!Number.isInteger(cameraId) || cameraId <= 0) {
    return c.json({ error: "Invalid camera id" }, 400);
  }
  if (!Number.isInteger(algorithmId) || algorithmId <= 0) {
    return c.json({ error: "Invalid algorithm id" }, 400);
  }

  const ownedAlgorithm = await resolveOwnedCameraAlgorithmForUser(
    c.env.DB,
    user.id,
    algorithmId
  );
  if (!ownedAlgorithm) {
    return c.json({ error: "Custom agent not found" }, 404);
  }
  if (Number((ownedAlgorithm as any).camera_id) !== cameraId) {
    return c.json({ error: "Custom agent not found for this camera" }, 404);
  }
  const algorithmType = String((ownedAlgorithm as any).algorithm_type || "");
  if (!algorithmType.startsWith("custom_")) {
    return c.json({ error: "Only custom agents support this endpoint" }, 400);
  }

  const body = await c.req
    .json<{
      display_name?: string;
      input_type?: string;
      inference_model?: string;
      model_fps?: unknown;
      running_resolution?: unknown;
      prompt_template?: string;
      alert_condition?: string;
      negative_condition?: string;
      analysis_regions?: unknown;
      face_target_ids?: unknown;
      is_enabled?: unknown;
      run_every?: unknown;
      only_capture_on_motion?: unknown;
      config_json?: unknown;
    }>()
    .catch(() => null);
  if (!body) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const existingPromptParts = parsePromptTemplateParts(
    (ownedAlgorithm as any).prompt_template ?? (ownedAlgorithm as any).llm_prompt,
    (ownedAlgorithm as any).alert_condition,
    (ownedAlgorithm as any).negative_condition
  );

  const nextPromptParts = parsePromptTemplateParts(
    body.prompt_template === undefined ? existingPromptParts.prompt_template : body.prompt_template,
    body.alert_condition === undefined ? existingPromptParts.alert_condition : body.alert_condition,
    body.negative_condition === undefined
      ? existingPromptParts.negative_condition
      : body.negative_condition
  );
  const promptTemplate = String(nextPromptParts.prompt_template || "").trim();
  const alertCondition = String(nextPromptParts.alert_condition || "").trim();
  const negativeCondition = normalizeOptionalPromptText(nextPromptParts.negative_condition);
  if (!promptTemplate) {
    return c.json({ error: "prompt_template is required" }, 400);
  }
  if (!alertCondition) {
    return c.json({ error: "alert_condition is required" }, 400);
  }

  const existingInputType = normalizeJobStepInputType((ownedAlgorithm as any).input_type) || "video";
  const requestedInputType = body.input_type === undefined
    ? existingInputType
    : normalizeJobStepInputType(body.input_type);
  if (body.input_type !== undefined && !requestedInputType) {
    return c.json({ error: "Invalid input_type. Allowed values: video, image" }, 400);
  }
  const inputType = requestedInputType || existingInputType;
  const existingInferenceModel =
    normalizeJobStepInferenceModel((ownedAlgorithm as any).inference_model) ||
    FIXED_JOB_STEP_INFERENCE_MODEL;
  const requestedInferenceModel = body.inference_model === undefined
    ? existingInferenceModel
    : normalizeJobStepInferenceModel(body.inference_model);
  if (body.inference_model !== undefined && !requestedInferenceModel) {
    return c.json({ error: "Invalid inference_model. Allowed values: legacy, pro, ultra, core" }, 400);
  }
  const inferenceModel = requestedInferenceModel || existingInferenceModel;
  const existingRunEvery = normalizeJobStepRunEverySeconds(
    (ownedAlgorithm as any).run_every,
    FIXED_JOB_STEP_RUN_EVERY_SECONDS
  );
  const existingModelFps = normalizeJobStepModelFps(
    (ownedAlgorithm as any).model_fps,
    existingInferenceModel,
    existingInputType
  );
  const requestedRunEvery = body.run_every === undefined
    ? existingRunEvery
    : normalizeJobStepRunEverySeconds(body.run_every, existingRunEvery);
  const requestedModelFps = body.model_fps === undefined
    ? existingModelFps
    : normalizeJobStepModelFps(body.model_fps, inferenceModel, inputType);
  const existingRunningResolution =
    parseJobStepRunningResolution((ownedAlgorithm as any).running_resolution) ??
    (existingInferenceModel === "core" ? DEFAULT_CORE_RUNNING_RESOLUTION : null);
  const requestedRunningResolution = body.running_resolution === undefined
    ? existingRunningResolution
    : body.running_resolution === null
    ? null
    : parseJobStepRunningResolution(body.running_resolution);
  if (
    body.running_resolution !== undefined &&
    body.running_resolution !== null &&
    requestedRunningResolution === null
  ) {
    return c.json({ error: "Invalid running_resolution. Allowed values: 640, 1024" }, 400);
  }
  const executionSettings = applyInferenceExecutionConstraints(
    inputType,
    inferenceModel,
    requestedRunEvery,
    requestedRunningResolution,
    requestedModelFps
  );

  const existingFaceTargetIdsByAlgo = await loadFaceTargetIdsByCameraAlgorithmIds(c.env.DB, [
    algorithmId,
  ]);
  const existingFaceTargetIds = existingFaceTargetIdsByAlgo.get(algorithmId) || [];
  const requestedFaceTargetIds =
    body.face_target_ids === undefined
      ? existingFaceTargetIds
      : normalizeFaceTargetIdsInput(body.face_target_ids) || [];

  if (requestedFaceTargetIds.length > 0) {
    const placeholders = requestedFaceTargetIds.map(() => "?").join(", ");
    const { results: rows } = await c.env.DB
      .prepare(
        `SELECT ft.id, COUNT(fti.id) AS image_count
         FROM face_targets ft
         LEFT JOIN face_target_images fti ON fti.face_target_id = ft.id
         WHERE ft.user_id = ?
           AND ft.id IN (${placeholders})
         GROUP BY ft.id`
      )
      .bind(user.id, ...requestedFaceTargetIds)
      .all();

    const validated = new Map<number, number>();
    for (const row of rows || []) {
      const id = Number((row as any)?.id);
      const imageCount = Number((row as any)?.image_count || 0);
      if (!Number.isInteger(id) || id <= 0) continue;
      validated.set(id, imageCount);
    }
    const missing = requestedFaceTargetIds.filter((id) => !validated.has(id));
    if (missing.length > 0) {
      return c.json({ error: "Some selected face targets are invalid" }, 400);
    }
    const withoutImages = requestedFaceTargetIds.filter((id) => (validated.get(id) || 0) <= 0);
    if (withoutImages.length > 0) {
      return c.json({ error: "All selected face targets must have at least one image" }, 400);
    }
  }

  const existingNegativeImages = await loadNegativeReferenceImagesByCameraAlgorithmIds(
    c.env.DB,
    [algorithmId]
  );
  const negativeImageIds = (existingNegativeImages.get(algorithmId) || [])
    .map((img) => Number(img?.id))
    .filter((id) => Number.isInteger(id) && id > 0);

  const analysisInputRaw =
    body.analysis_regions === undefined
      ? parseStoredAnalysisRegions((ownedAlgorithm as any).analysis_regions, {
          promptParts: {
            prompt_template: promptTemplate,
            alert_condition: alertCondition,
            negative_condition: negativeCondition,
          },
          faceTargetIds: requestedFaceTargetIds,
          negativeImageIds,
        }).map((region) => ({
          ...region,
          face_target_ids: requestedFaceTargetIds,
          negative_image_ids: negativeImageIds,
        }))
      : body.analysis_regions;
  const normalizedRegionsResult = normalizeAnalysisRegionsInput(analysisInputRaw, {
    promptParts: {
      prompt_template: promptTemplate,
      alert_condition: alertCondition,
      negative_condition: negativeCondition,
    },
    faceTargetIds: requestedFaceTargetIds,
    negativeImageIds,
  });
  if (normalizedRegionsResult.error) {
    return c.json({ error: normalizedRegionsResult.error }, 400);
  }

  let configJsonObject: any = {};
  if (
    typeof (ownedAlgorithm as any)?.config_json === "string" &&
    (ownedAlgorithm as any).config_json.trim()
  ) {
    try {
      const parsed = JSON.parse((ownedAlgorithm as any).config_json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        configJsonObject = parsed;
      }
    } catch {
      configJsonObject = {};
    }
  } else if (
    (ownedAlgorithm as any)?.config_json &&
    typeof (ownedAlgorithm as any).config_json === "object"
  ) {
    configJsonObject = { ...(ownedAlgorithm as any).config_json };
  }
  if (typeof body.config_json === "string" && body.config_json.trim()) {
    try {
      const parsed = JSON.parse(body.config_json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        configJsonObject = parsed;
      }
    } catch {
      configJsonObject = {};
    }
  } else if (body.config_json && typeof body.config_json === "object" && !Array.isArray(body.config_json)) {
    configJsonObject = { ...(body.config_json as Record<string, unknown>) };
  }
  const displayNameRaw = typeof body.display_name === "string" ? body.display_name.trim() : "";
  if (displayNameRaw) {
    configJsonObject.display_name = displayNameRaw;
  } else if (!configJsonObject.display_name) {
    configJsonObject.display_name = algorithmType;
  }

  const onlyCaptureOnMotion =
    body.only_capture_on_motion === undefined
      ? normalizeJobStepOnlyCaptureOnMotion((ownedAlgorithm as any).only_capture_on_motion, true)
      : normalizeJobStepOnlyCaptureOnMotion(body.only_capture_on_motion, true);
  const isEnabled =
    body.is_enabled === undefined
      ? normalizeJobStepOnlyCaptureOnMotion((ownedAlgorithm as any).is_enabled, false)
      : normalizeJobStepOnlyCaptureOnMotion(body.is_enabled, false);
  const existingIsEnabled = normalizeJobStepOnlyCaptureOnMotion(
    (ownedAlgorithm as any).is_enabled,
    false
  );
  const existingIsCoreEnabled = existingIsEnabled && existingInferenceModel === "core";
  const willBeCoreEnabled = isEnabled && executionSettings.inferenceModel === "core";
  if (willBeCoreEnabled && !existingIsCoreEnabled) {
    const coreBusyState = await findCoreModelBusyStateForCameraEnable(c.env.DB, user.id, {
      excludeAlgorithmId: algorithmId,
    });
    if (coreBusyState) {
      return c.json(buildCoreModelBusyErrorBody(coreBusyState), 409);
    }
  }
  if (isEnabled) {
    if (executionSettings.requiresOpenAiKey) {
      const userOpenAiApiKey = await getUserOpenAIApiKey(c.env.DB, user.id);
      if (!userOpenAiApiKey) {
        return c.json(buildOpenAiKeyRequiredErrorBody(), 400);
      }
    }
    if (executionSettings.requiresZAiKey) {
      const userZAiApiKey = await getUserZAIApiKey(c.env.DB, user.id);
      if (!userZAiApiKey) {
        return c.json(buildZAiKeyRequiredErrorBody(), 400);
      }
    }
  }

  await c.env.DB
    .prepare(
      `UPDATE camera_algorithms
       SET is_enabled = ?,
           llm_prompt = ?,
           config_json = ?,
           prompt_template = ?,
           alert_condition = ?,
           negative_condition = ?,
           analysis_regions = ?,
           input_type = ?,
           inference_model = ?,
           model_fps = ?,
           run_every = ?,
           running_resolution = ?,
           only_capture_on_motion = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(
      isEnabled ? 1 : 0,
      promptTemplate,
      JSON.stringify(configJsonObject),
      buildPromptTemplateFromParts({
        prompt_template: promptTemplate,
        alert_condition: alertCondition,
        negative_condition: negativeCondition,
      }),
      alertCondition,
      negativeCondition,
      JSON.stringify(normalizedRegionsResult.regions),
      executionSettings.inputType,
      executionSettings.inferenceModel,
      executionSettings.modelFps,
      executionSettings.runEvery,
      executionSettings.runningResolution,
      onlyCaptureOnMotion ? 1 : 0,
      algorithmId
    )
    .run();

  if (body.face_target_ids !== undefined) {
    const now = new Date().toISOString();
    await c.env.DB
      .prepare("DELETE FROM camera_algorithm_face_targets WHERE algorithm_id = ?")
      .bind(algorithmId)
      .run();
    for (const faceTargetId of requestedFaceTargetIds) {
      await c.env.DB
        .prepare(
          `INSERT INTO camera_algorithm_face_targets (algorithm_id, face_target_id, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(algorithm_id, face_target_id) DO NOTHING`
        )
        .bind(algorithmId, faceTargetId, now, now)
        .run();
    }
  }

  await enqueueUpdateAlgorithmsIfCameraRunning(c.env.DB, user.id, cameraId);
  const agents = await listCustomCameraAgents(c.env.DB, user.id, cameraId);
  const updated = agents.find((agent) => Number((agent as any)?.id) === algorithmId) || null;
  return c.json({ agent: updated });
});

app.delete("/api/cameras/:cameraId/custom-agents/:algorithmId", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const cameraId = Number(c.req.param("cameraId"));
  const algorithmId = Number(c.req.param("algorithmId"));
  if (!Number.isInteger(cameraId) || cameraId <= 0) {
    return c.json({ error: "Invalid camera id" }, 400);
  }
  if (!Number.isInteger(algorithmId) || algorithmId <= 0) {
    return c.json({ error: "Invalid algorithm id" }, 400);
  }

  const ownedAlgorithm = await resolveOwnedCameraAlgorithmForUser(
    c.env.DB,
    user.id,
    algorithmId
  );
  if (!ownedAlgorithm) {
    return c.json({ error: "Custom agent not found" }, 404);
  }
  if (Number((ownedAlgorithm as any).camera_id) !== cameraId) {
    return c.json({ error: "Custom agent not found for this camera" }, 404);
  }
  const algorithmType = String((ownedAlgorithm as any).algorithm_type || "");
  if (!algorithmType.startsWith("custom_")) {
    return c.json({ error: "Only custom agents support this endpoint" }, 400);
  }

  const { results: imageRows } = await c.env.DB
    .prepare(
      "SELECT id, image_url FROM camera_algorithm_negative_images WHERE algorithm_id = ?"
    )
    .bind(algorithmId)
    .all();
  for (const row of imageRows || []) {
    const imageUrl =
      typeof (row as any)?.image_url === "string" ? String((row as any).image_url).trim() : "";
    if (!imageUrl) continue;
    const storageKey = extractStorageKeyFromNegativeConditionImageUrl(imageUrl);
    if (!storageKey) {
      return c.json({ error: "Failed to delete algorithm negative image from storage" }, 500);
    }
    try {
      await c.env.R2_BUCKET.delete(storageKey);
    } catch (error) {
      console.error("[CAMERA ALGORITHM] Failed to delete negative image from R2", {
        algorithmId,
        storageKey,
        error,
      });
      return c.json({ error: "Failed to delete algorithm negative image from storage" }, 502);
    }
  }

  await c.env.DB
    .prepare("DELETE FROM camera_algorithm_face_targets WHERE algorithm_id = ?")
    .bind(algorithmId)
    .run();
  await c.env.DB
    .prepare("DELETE FROM camera_algorithm_negative_images WHERE algorithm_id = ?")
    .bind(algorithmId)
    .run();
  await c.env.DB
    .prepare("DELETE FROM camera_algorithms WHERE id = ?")
    .bind(algorithmId)
    .run();

  await enqueueUpdateAlgorithmsIfCameraRunning(c.env.DB, user.id, cameraId);
  return c.json({ success: true });
});

app.get("/api/camera-algorithms/:algorithmId/negative-images", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const algorithmId = Number(c.req.param("algorithmId"));
  if (!Number.isInteger(algorithmId) || algorithmId <= 0) {
    return c.json({ error: "Invalid algorithm id" }, 400);
  }

  const ownedAlgorithm = await resolveOwnedCameraAlgorithmForUser(
    c.env.DB,
    user.id,
    algorithmId
  );
  if (!ownedAlgorithm) {
    return c.json({ error: "Custom agent not found" }, 404);
  }
  if (!String((ownedAlgorithm as any).algorithm_type || "").startsWith("custom_")) {
    return c.json({ error: "Only custom agents support this endpoint" }, 400);
  }

  const imagesByAlgorithm = await loadNegativeReferenceImagesByCameraAlgorithmIds(c.env.DB, [
    algorithmId,
  ]);
  return c.json({ images: imagesByAlgorithm.get(algorithmId) || [] });
});

app.post("/api/camera-algorithms/:algorithmId/negative-images", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const algorithmId = Number(c.req.param("algorithmId"));
  if (!Number.isInteger(algorithmId) || algorithmId <= 0) {
    return c.json({ error: "Invalid algorithm id" }, 400);
  }

  const ownedAlgorithm = await resolveOwnedCameraAlgorithmForUser(
    c.env.DB,
    user.id,
    algorithmId
  );
  if (!ownedAlgorithm) {
    return c.json({ error: "Custom agent not found" }, 404);
  }
  if (!String((ownedAlgorithm as any).algorithm_type || "").startsWith("custom_")) {
    return c.json({ error: "Only custom agents support this endpoint" }, 400);
  }

  try {
    const formData = await c.req.formData();
    const imageFile = formData.get("image") as File | null;
    if (!imageFile) {
      return c.json({ error: "image is required" }, 400);
    }
    if (!String(imageFile.type || "").toLowerCase().startsWith("image/")) {
      return c.json({ error: "Only image uploads are allowed" }, 400);
    }
    if (
      typeof imageFile.size === "number" &&
      imageFile.size > NEGATIVE_CONDITION_MAX_UPLOAD_BYTES
    ) {
      return c.json({ error: "Image is too large. Maximum size is 10MB." }, 400);
    }

    const currentImageCount = await getCameraAlgorithmNegativeImageCount(c.env.DB, algorithmId);
    if (currentImageCount >= NEGATIVE_CONDITION_MAX_IMAGES) {
      return c.json(
        { error: `Maximum ${NEGATIVE_CONDITION_MAX_IMAGES} images per custom agent` },
        409
      );
    }

    const storageKey = buildCameraAlgorithmNegativeImageStorageKey(
      user.id,
      algorithmId,
      imageFile.type
    );
    const arrayBuffer = await imageFile.arrayBuffer();
    await c.env.R2_BUCKET.put(storageKey, arrayBuffer, {
      httpMetadata: { contentType: imageFile.type || "image/jpeg" },
    });
    const imageUrl = `/api/negative-condition-images/${encodeURIComponent(storageKey)}`;
    const now = new Date().toISOString();

    const inserted = await c.env.DB
      .prepare(
        `INSERT INTO camera_algorithm_negative_images (algorithm_id, image_url, created_at, updated_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(algorithmId, imageUrl, now, now)
      .run();

    const imageId = Number(inserted.meta.last_row_id || 0);
    if (Number.isInteger(imageId) && imageId > 0) {
      const faceTargetIdsByAlgo = await loadFaceTargetIdsByCameraAlgorithmIds(c.env.DB, [algorithmId]);
      const faceTargetIds = faceTargetIdsByAlgo.get(algorithmId) || [];
      const allNegativeImages = await loadNegativeReferenceImagesByCameraAlgorithmIds(c.env.DB, [algorithmId]);
      const negativeImageIds = (allNegativeImages.get(algorithmId) || [])
        .map((img) => Number(img?.id))
        .filter((id) => Number.isInteger(id) && id > 0);
      const promptParts = parsePromptTemplateParts(
        (ownedAlgorithm as any).prompt_template ?? (ownedAlgorithm as any).llm_prompt,
        (ownedAlgorithm as any).alert_condition,
        (ownedAlgorithm as any).negative_condition
      );
      const existingRegions = parseStoredAnalysisRegions((ownedAlgorithm as any).analysis_regions, {
        promptParts,
        faceTargetIds,
        negativeImageIds,
      }).map((region) => ({
        ...region,
        face_target_ids: faceTargetIds,
        negative_image_ids: negativeImageIds,
      }));
      const normalizedRegions = normalizeAnalysisRegionsInput(existingRegions, {
        promptParts,
        faceTargetIds,
        negativeImageIds,
      });
      if (!normalizedRegions.error) {
        await c.env.DB
          .prepare(
            "UPDATE camera_algorithms SET analysis_regions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          )
          .bind(JSON.stringify(normalizedRegions.regions), algorithmId)
          .run();
      }
    }

    await enqueueUpdateAlgorithmsIfCameraRunning(
      c.env.DB,
      user.id,
      Number((ownedAlgorithm as any).camera_id || 0)
    );

    return c.json(
      {
        image: {
          id: imageId,
          algorithm_id: algorithmId,
          image_url: imageUrl,
        },
      },
      201
    );
  } catch (error) {
    console.error("[CAMERA CUSTOM AGENT] Failed to upload negative image", {
      algorithmId,
      error,
    });
    return c.json({ error: "Failed to upload negative condition image" }, 500);
  }
});

app.delete(
  "/api/camera-algorithms/:algorithmId/negative-images/:imageId",
  anyAuthMiddleware,
  async (c) => {
    const user = c.get("user")!;
    const algorithmId = Number(c.req.param("algorithmId"));
    const imageId = Number(c.req.param("imageId"));
    if (!Number.isInteger(algorithmId) || algorithmId <= 0) {
      return c.json({ error: "Invalid algorithm id" }, 400);
    }
    if (!Number.isInteger(imageId) || imageId <= 0) {
      return c.json({ error: "Invalid image id" }, 400);
    }

    const ownedAlgorithm = await resolveOwnedCameraAlgorithmForUser(
      c.env.DB,
      user.id,
      algorithmId
    );
    if (!ownedAlgorithm) {
      return c.json({ error: "Custom agent not found" }, 404);
    }

    const row = await c.env.DB
      .prepare(
        `SELECT id, image_url
         FROM camera_algorithm_negative_images
         WHERE id = ? AND algorithm_id = ?`
      )
      .bind(imageId, algorithmId)
      .first();

    if (!row) {
      return c.json({ error: "Negative condition image not found" }, 404);
    }

    const imageUrl =
      typeof (row as any)?.image_url === "string" ? String((row as any).image_url).trim() : "";
    if (!imageUrl) {
      return c.json({ error: "Failed to delete image from storage" }, 500);
    }

    const storageKey = extractStorageKeyFromNegativeConditionImageUrl(imageUrl);
    if (!storageKey) {
      return c.json({ error: "Failed to delete image from storage" }, 500);
    }

    try {
      await c.env.R2_BUCKET.delete(storageKey);
    } catch (error) {
      console.error("[CAMERA CUSTOM AGENT] Failed to delete image from R2", {
        algorithmId,
        imageId,
        storageKey,
        error,
      });
      return c.json({ error: "Failed to delete image from storage" }, 502);
    }

    await c.env.DB
      .prepare("DELETE FROM camera_algorithm_negative_images WHERE id = ? AND algorithm_id = ?")
      .bind(imageId, algorithmId)
      .run();

    const faceTargetIdsByAlgo = await loadFaceTargetIdsByCameraAlgorithmIds(c.env.DB, [algorithmId]);
    const faceTargetIds = faceTargetIdsByAlgo.get(algorithmId) || [];
    const allNegativeImages = await loadNegativeReferenceImagesByCameraAlgorithmIds(c.env.DB, [algorithmId]);
    const negativeImageIds = (allNegativeImages.get(algorithmId) || [])
      .map((img) => Number(img?.id))
      .filter((id) => Number.isInteger(id) && id > 0);
    const promptParts = parsePromptTemplateParts(
      (ownedAlgorithm as any).prompt_template ?? (ownedAlgorithm as any).llm_prompt,
      (ownedAlgorithm as any).alert_condition,
      (ownedAlgorithm as any).negative_condition
    );
    const existingRegions = parseStoredAnalysisRegions((ownedAlgorithm as any).analysis_regions, {
      promptParts,
      faceTargetIds,
      negativeImageIds,
    }).map((region) => ({
      ...region,
      face_target_ids: faceTargetIds,
      negative_image_ids: negativeImageIds,
    }));
    const normalizedRegions = normalizeAnalysisRegionsInput(existingRegions, {
      promptParts,
      faceTargetIds,
      negativeImageIds,
    });
    if (!normalizedRegions.error) {
      await c.env.DB
        .prepare(
          "UPDATE camera_algorithms SET analysis_regions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        )
        .bind(JSON.stringify(normalizedRegions.regions), algorithmId)
        .run();
    }

    await enqueueUpdateAlgorithmsIfCameraRunning(
      c.env.DB,
      user.id,
      Number((ownedAlgorithm as any).camera_id || 0)
    );
    return c.json({ success: true });
  }
);

app.put("/api/camera-algorithms/:algorithmId/face-targets", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const algorithmId = Number(c.req.param("algorithmId"));
  if (!Number.isInteger(algorithmId) || algorithmId <= 0) {
    return c.json({ error: "Invalid algorithm id" }, 400);
  }

  const ownedAlgorithm = await resolveOwnedCameraAlgorithmForUser(
    c.env.DB,
    user.id,
    algorithmId
  );
  if (!ownedAlgorithm) {
    return c.json({ error: "Custom agent not found" }, 404);
  }
  if (!String((ownedAlgorithm as any).algorithm_type || "").startsWith("custom_")) {
    return c.json({ error: "Only custom agents support this endpoint" }, 400);
  }

  const body = await c.req
    .json<{ face_target_ids?: unknown }>()
    .catch(() => null);
  if (!body) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const requestedFaceTargetIds = normalizeFaceTargetIdsInput(body.face_target_ids) || [];
  if (requestedFaceTargetIds.length > 0) {
    const placeholders = requestedFaceTargetIds.map(() => "?").join(", ");
    const { results: rows } = await c.env.DB
      .prepare(
        `SELECT ft.id, COUNT(fti.id) AS image_count
         FROM face_targets ft
         LEFT JOIN face_target_images fti ON fti.face_target_id = ft.id
         WHERE ft.user_id = ?
           AND ft.id IN (${placeholders})
         GROUP BY ft.id`
      )
      .bind(user.id, ...requestedFaceTargetIds)
      .all();

    const validated = new Map<number, number>();
    for (const row of rows || []) {
      const id = Number((row as any)?.id);
      const imageCount = Number((row as any)?.image_count || 0);
      if (!Number.isInteger(id) || id <= 0) continue;
      validated.set(id, imageCount);
    }
    const missing = requestedFaceTargetIds.filter((id) => !validated.has(id));
    if (missing.length > 0) {
      return c.json({ error: "Some selected face targets are invalid" }, 400);
    }
    const withoutImages = requestedFaceTargetIds.filter((id) => (validated.get(id) || 0) <= 0);
    if (withoutImages.length > 0) {
      return c.json({ error: "All selected face targets must have at least one image" }, 400);
    }
  }

  const now = new Date().toISOString();
  await c.env.DB
    .prepare("DELETE FROM camera_algorithm_face_targets WHERE algorithm_id = ?")
    .bind(algorithmId)
    .run();
  for (const faceTargetId of requestedFaceTargetIds) {
    await c.env.DB
      .prepare(
        `INSERT INTO camera_algorithm_face_targets (algorithm_id, face_target_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(algorithm_id, face_target_id) DO NOTHING`
      )
      .bind(algorithmId, faceTargetId, now, now)
      .run();
  }

  const negativeImagesByAlgo = await loadNegativeReferenceImagesByCameraAlgorithmIds(c.env.DB, [
    algorithmId,
  ]);
  const negativeImageIds = (negativeImagesByAlgo.get(algorithmId) || [])
    .map((img) => Number(img?.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  const promptParts = parsePromptTemplateParts(
    (ownedAlgorithm as any).prompt_template ?? (ownedAlgorithm as any).llm_prompt,
    (ownedAlgorithm as any).alert_condition,
    (ownedAlgorithm as any).negative_condition
  );
  const existingRegions = parseStoredAnalysisRegions((ownedAlgorithm as any).analysis_regions, {
    promptParts,
    faceTargetIds: requestedFaceTargetIds,
    negativeImageIds,
  }).map((region) => ({
    ...region,
    face_target_ids: requestedFaceTargetIds,
    negative_image_ids: negativeImageIds,
  }));
  const normalizedRegions = normalizeAnalysisRegionsInput(existingRegions, {
    promptParts,
    faceTargetIds: requestedFaceTargetIds,
    negativeImageIds,
  });
  if (!normalizedRegions.error) {
    await c.env.DB
      .prepare(
        "UPDATE camera_algorithms SET analysis_regions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      )
      .bind(JSON.stringify(normalizedRegions.regions), algorithmId)
      .run();
  }

  await enqueueUpdateAlgorithmsIfCameraRunning(
    c.env.DB,
    user.id,
    Number((ownedAlgorithm as any).camera_id || 0)
  );
  return c.json({ success: true });
});

app.post("/api/cameras/:cameraId/custom-agents/enhance-prompt", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const cameraId = Number(c.req.param("cameraId"));
  if (!Number.isInteger(cameraId) || cameraId <= 0) {
    return c.json({ error: "Invalid camera id" }, 400);
  }

  const camera = await c.env.DB
    .prepare(
      `SELECT id, name, description, ip_address, rtsp_port, username, password, manufacturer,
              connection_method, webcam_index, channel, subtype
       FROM cameras
       WHERE id = ? AND user_id = ?`
    )
    .bind(cameraId, user.id)
    .first();
  if (!camera) {
    return c.json({ error: "Camera not found" }, 404);
  }

  const body = await c.req
    .json<{
      prompt_template?: string;
      alert_condition?: string;
      negative_condition?: string;
      language?: string;
      analysis_regions?: unknown;
    }>()
    .catch(() => null);
  if (!body) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const promptTemplate =
    typeof body.prompt_template === "string" ? body.prompt_template.trim() : "";
  const alertCondition =
    typeof body.alert_condition === "string" ? body.alert_condition.trim() : "";
  const negativeCondition =
    typeof body.negative_condition === "string" ? body.negative_condition.trim() : "";
  const languageHint = typeof body.language === "string" ? body.language.trim() : "";
  if (!promptTemplate) {
    return c.json({ error: "Prompt Core is required" }, 400);
  }
  if (!alertCondition) {
    return c.json({ error: "Alert Condition is required" }, 400);
  }

  let enhanceAnalysisRegions: AnalysisRegionPayload[] = [];
  if (body.analysis_regions !== undefined) {
    const normalizedEnhanceRegions = normalizeAnalysisRegionsInput(body.analysis_regions, {
      promptParts: {
        prompt_template: promptTemplate,
        alert_condition: alertCondition,
        negative_condition: normalizeOptionalPromptText(negativeCondition),
      },
      faceTargetIds: [],
      negativeImageIds: [],
    });
    if (normalizedEnhanceRegions.error) {
      return c.json({ error: normalizedEnhanceRegions.error }, 400);
    }
    enhanceAnalysisRegions = normalizedEnhanceRegions.regions;
  }

  const pairing = await c.env.DB.prepare(
    `SELECT *
     FROM exe_pairings
     WHERE user_id = ? AND status = 'connected'
     ORDER BY last_seen_at DESC
     LIMIT 1`
  )
    .bind(user.id)
    .first();
  if (!pairing) {
    return c.json({ error: "No EXE connected. Prompt enhancement requires the desktop agent online." }, 409);
  }

  const userOpenAiApiKey = await getUserOpenAIApiKey(c.env.DB, user.id);
  const modelApiKey = userOpenAiApiKey;
  if (!modelApiKey) {
    return c.json(buildOpenAiKeyRequiredErrorBody(), 400);
  }

  const cam = camera as any;
  const commandPayload = {
    camera_id: cameraId,
    camera_name: typeof cam.name === "string" ? cam.name : `Camera ${cameraId}`,
    camera_description: typeof cam.description === "string" ? cam.description : "",
    prompt_core: promptTemplate,
    alert_condition: alertCondition,
    negative_condition: negativeCondition,
    user_language: languageHint || "pt-BR",
    model_name: "gpt-5.1",
    model_api_key: modelApiKey,
    analysis_regions: enhanceAnalysisRegions,
    fallback_option: "A",
    snapshot_strategy: {
      prefer_running_session_snapshot: true,
      warmup_seconds: 6,
      target_second: 5,
      max_capture_seconds: 12,
      require_snapshot: true,
    },
    camera_payload: {
      camera_id: cameraId,
      name: typeof cam.name === "string" ? cam.name : `Camera ${cameraId}`,
      description: typeof cam.description === "string" ? cam.description : "",
      ip: normalizeCameraTransportField(cam.ip_address) ?? "",
      port: normalizeCameraTransportField(cam.rtsp_port),
      username: normalizeCameraTransportField(cam.username) ?? "",
      password: typeof cam.password === "string" ? cam.password : "",
      manufacturer: normalizeCameraTransportField(cam.manufacturer) ?? "",
      connection_method:
        normalizeCameraTransportField(cam.connection_method) ?? "",
      webcam_index:
        cam.webcam_index === null || cam.webcam_index === undefined
          ? null
          : Number(cam.webcam_index),
      channel: normalizeCameraTransportField(cam.channel),
      subtype: normalizeCameraTransportField(cam.subtype),
    },
  };

  const now = new Date().toISOString();
  const commandInsert = await c.env.DB.prepare(
    `INSERT INTO commands (user_id, camera_id, command_type, payload, status, created_at, updated_at)
     VALUES (?, ?, 'prompt_enhance', ?, 'pending', ?, ?)`
  )
    .bind(user.id, cameraId, JSON.stringify(commandPayload), now, now)
    .run();

  const commandId = Number(commandInsert.meta.last_row_id || 0);
  if (!Number.isInteger(commandId) || commandId <= 0) {
    return c.json({ error: "Failed to create enhancement command" }, 500);
  }

  return c.json({
    command_id: commandId,
    status: "pending",
  });
});

app.get(
  "/api/cameras/:cameraId/custom-agents/enhance-prompt/:commandId",
  anyAuthMiddleware,
  async (c) => {
    const user = c.get("user")!;
    const cameraId = Number(c.req.param("cameraId"));
    const commandId = Number(c.req.param("commandId"));
    if (!Number.isInteger(cameraId) || cameraId <= 0) {
      return c.json({ error: "Invalid camera id" }, 400);
    }
    if (!Number.isInteger(commandId) || commandId <= 0) {
      return c.json({ error: "Invalid command id" }, 400);
    }

    const camera = await c.env.DB
      .prepare("SELECT id FROM cameras WHERE id = ? AND user_id = ?")
      .bind(cameraId, user.id)
      .first();
    if (!camera) {
      return c.json({ error: "Camera not found" }, 404);
    }

    const command = await c.env.DB.prepare(
      `SELECT id, status, result, payload
       FROM commands
       WHERE id = ? AND user_id = ? AND command_type = 'prompt_enhance'
       LIMIT 1`
    )
      .bind(commandId, user.id)
      .first();
    if (!command) {
      return c.json({ error: "Enhancement command not found" }, 404);
    }

    const cmd = command as any;
    const status = String(cmd.status || "pending").trim().toLowerCase();

    let payloadObj: any = null;
    if (typeof cmd.payload === "string" && cmd.payload.trim()) {
      try {
        payloadObj = JSON.parse(cmd.payload);
      } catch {
        payloadObj = null;
      }
    }
    const commandCameraId = Number(payloadObj?.camera_id);
    if (Number.isInteger(commandCameraId) && commandCameraId > 0 && commandCameraId !== cameraId) {
      return c.json({ error: "Enhancement command not found for this camera" }, 404);
    }

    let resultObj: any = null;
    if (typeof cmd.result === "string" && cmd.result.trim()) {
      try {
        resultObj = JSON.parse(cmd.result);
      } catch {
        resultObj = { error: cmd.result };
      }
    }

    if (status === "failed") {
      const errorMessage =
        typeof resultObj?.error === "string" && resultObj.error.trim()
          ? resultObj.error.trim()
          : "Prompt enhancement failed";
      return c.json({ status: "failed", error: errorMessage });
    }

    if (status === "completed") {
      const rawResult =
        resultObj && typeof resultObj === "object" && resultObj.result
          ? resultObj.result
          : resultObj;
      const suggestionSource =
        rawResult && typeof rawResult === "object" && rawResult.suggestion
          ? rawResult.suggestion
          : rawResult;

      const promptTemplate =
        typeof suggestionSource?.prompt_template === "string"
          ? suggestionSource.prompt_template.trim()
          : "";
      const alertCondition =
        typeof suggestionSource?.alert_condition === "string"
          ? suggestionSource.alert_condition.trim()
          : "";
      const negativeCondition =
        typeof suggestionSource?.negative_condition === "string"
          ? suggestionSource.negative_condition.trim()
          : "";
      if (!promptTemplate || !alertCondition) {
        return c.json({ status: "failed", error: "Prompt enhancement returned invalid fields" });
      }

      return c.json({
        status: "completed",
        suggestion: {
          prompt_template: promptTemplate,
          alert_condition: alertCondition,
          negative_condition: negativeCondition,
        },
        snapshot_source:
          typeof rawResult?.snapshot_source === "string" ? rawResult.snapshot_source : null,
        snapshot_ts_utc_iso:
          typeof rawResult?.snapshot_ts_utc_iso === "string"
            ? rawResult.snapshot_ts_utc_iso
            : null,
      });
    }

    return c.json({ status: "pending" });
  }
);

// FaceID Target endpoints
app.get("/api/cameras/:cameraId/faceid-targets", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const cameraId = c.req.param("cameraId");

  // Verify camera ownership
  const camera = await c.env.DB.prepare(
    "SELECT * FROM cameras WHERE id = ? AND user_id = ?"
  )
    .bind(cameraId, user.id)
    .first();

  if (!camera) {
    return c.json({ error: "Camera not found" }, 404);
  }

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM faceid_targets WHERE camera_id = ? ORDER BY created_at DESC"
  )
    .bind(cameraId)
    .all();

  return c.json(results);
});

app.post("/api/cameras/:cameraId/faceid-targets", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const cameraId = c.req.param("cameraId");
  
  try {
    const formData = await c.req.formData();
    const personName = formData.get("person_name") as string;
    const personDescription = (formData.get("person_description") as string) || "";
    const imageFile = formData.get("image") as File | null;

    if (!personName) {
      return c.json({ error: "person_name is required" }, 400);
    }

    // Require at least description OR image
    if (!personDescription.trim() && !imageFile) {
      return c.json({ error: "Either person_description or image is required" }, 400);
    }

    // Verify camera ownership
    const camera = await c.env.DB.prepare(
      "SELECT * FROM cameras WHERE id = ? AND user_id = ?"
    )
      .bind(cameraId, user.id)
      .first();

    if (!camera) {
      return c.json({ error: "Camera not found" }, 404);
    }

    let imageUrl: string | null = null;

    // Handle image upload if provided
    if (imageFile) {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 15);
      const storageKey = `faceid/${user.id}/${timestamp}-${random}.jpg`;

      const arrayBuffer = await imageFile.arrayBuffer();
      await c.env.R2_BUCKET.put(storageKey, arrayBuffer, {
        httpMetadata: { contentType: "image/jpeg" },
      });

      imageUrl = `/api/faceid-images/${encodeURIComponent(storageKey)}`;
    }

    const result = await c.env.DB.prepare(
      `INSERT INTO faceid_targets (camera_id, person_name, person_description, image_url)
       VALUES (?, ?, ?, ?)`
    )
      .bind(cameraId, personName, personDescription, imageUrl)
      .run();

    const target = await c.env.DB.prepare(
      "SELECT * FROM faceid_targets WHERE id = ?"
    )
      .bind(result.meta.last_row_id)
      .first();

    return c.json(target, 201);
  } catch (error) {
    console.error("Failed to create FaceID target:", error);
    return c.json({ error: "Failed to create FaceID target" }, 500);
  }
});

app.patch("/api/cameras/:cameraId/faceid-targets/:id", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const cameraId = c.req.param("cameraId");
  const targetId = c.req.param("id");

  try {
    const formData = await c.req.formData();
    const personName = formData.get("person_name") as string;
    const personDescription = formData.get("person_description") as string;
    const imageFile = formData.get("image") as File | null;

    // Verify camera ownership and target exists
    const camera = await c.env.DB.prepare(
      "SELECT * FROM cameras WHERE id = ? AND user_id = ?"
    )
      .bind(cameraId, user.id)
      .first();

    if (!camera) {
      return c.json({ error: "Camera not found" }, 404);
    }

    const existingTarget = await c.env.DB.prepare(
      "SELECT * FROM faceid_targets WHERE id = ? AND camera_id = ?"
    )
      .bind(targetId, cameraId)
      .first();

    if (!existingTarget) {
      return c.json({ error: "FaceID target not found" }, 404);
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (personName) {
      updates.push("person_name = ?");
      values.push(personName);
    }

    if (personDescription) {
      updates.push("person_description = ?");
      values.push(personDescription);
    }

    // Handle image upload if provided
    if (imageFile) {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 15);
      const storageKey = `faceid/${user.id}/${timestamp}-${random}.jpg`;

      const arrayBuffer = await imageFile.arrayBuffer();
      await c.env.R2_BUCKET.put(storageKey, arrayBuffer, {
        httpMetadata: { contentType: "image/jpeg" },
      });

      const imageUrl = `/api/faceid-images/${encodeURIComponent(storageKey)}`;
      updates.push("image_url = ?");
      values.push(imageUrl);

      // Delete old image if exists
      const oldImageUrl = (existingTarget as any).image_url;
      if (oldImageUrl) {
        try {
          const oldKey = decodeURIComponent(oldImageUrl.replace("/api/faceid-images/", ""));
          await c.env.R2_BUCKET.delete(oldKey);
        } catch (err) {
          console.log("Failed to delete old FaceID image:", err);
        }
      }
    }

    if (updates.length > 0) {
      updates.push("updated_at = CURRENT_TIMESTAMP");
      values.push(targetId, cameraId);

      await c.env.DB.prepare(
        `UPDATE faceid_targets SET ${updates.join(", ")} WHERE id = ? AND camera_id = ?`
      )
        .bind(...values)
        .run();
    }

    const updatedTarget = await c.env.DB.prepare(
      "SELECT * FROM faceid_targets WHERE id = ?"
    )
      .bind(targetId)
      .first();

    return c.json(updatedTarget);
  } catch (error) {
    console.error("Failed to update FaceID target:", error);
    return c.json({ error: "Failed to update FaceID target" }, 500);
  }
});

app.delete("/api/cameras/:cameraId/faceid-targets/:id", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const cameraId = c.req.param("cameraId");
  const id = c.req.param("id");

  // Verify camera ownership
  const camera = await c.env.DB.prepare(
    "SELECT * FROM cameras WHERE id = ? AND user_id = ?"
  )
    .bind(cameraId, user.id)
    .first();

  if (!camera) {
    return c.json({ error: "Camera not found" }, 404);
  }

  // Get target to delete associated image
  const target = await c.env.DB.prepare(
    "SELECT * FROM faceid_targets WHERE id = ? AND camera_id = ?"
  )
    .bind(id, cameraId)
    .first();

  if (target) {
    const imageUrl = (target as any).image_url;
    if (imageUrl) {
      try {
        const storageKey = decodeURIComponent(imageUrl.replace("/api/faceid-images/", ""));
        await c.env.R2_BUCKET.delete(storageKey);
      } catch (err) {
        console.log("Failed to delete FaceID image:", err);
      }
    }
  }

  await c.env.DB.prepare(
    "DELETE FROM faceid_targets WHERE id = ? AND camera_id = ?"
  )
    .bind(id, cameraId)
    .run();

  return c.json({ success: true });
});

// FaceID images endpoint (R2) - for web UI
app.get("/api/faceid-images/:storageKey", anyAuthMiddleware, async (c) => {
  const storageKey = decodeURIComponent(c.req.param("storageKey"));

  try {
    const object = await c.env.R2_BUCKET.get(storageKey);

    if (!object) {
      return c.json({ error: "Image not found" }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "no-cache");
    headers.set("content-type", "image/jpeg");

    return c.body(object.body, { headers });
  } catch (error) {
    console.error("Failed to fetch FaceID image:", error);
    return c.json({ error: "Failed to fetch image" }, 500);
  }
});

// FaceID images endpoint (R2) - for EXE/Agent with Bearer token
app.get("/api/agent/faceid-images/:encodedPath", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const storageKey = decodeURIComponent(c.req.param("encodedPath"));

  try {
    const object = await c.env.R2_BUCKET.get(storageKey);

    if (!object) {
      return c.json({ error: "Image not found" }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "no-cache");
    headers.set("content-type", "image/jpeg");

    return c.body(object.body, { headers });
  } catch (error) {
    console.error("Failed to fetch FaceID image:", error);
    return c.json({ error: "Failed to fetch image" }, 500);
  }
});

const extractStorageKeyFromFaceTargetImageUrl = (imageUrl: string): string | null => {
  if (typeof imageUrl !== "string") return null;
  const trimmed = imageUrl.trim();
  if (!trimmed) return null;
  const prefix = "/api/face-target-images/";
  if (!trimmed.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(trimmed.slice(prefix.length));
  } catch {
    return null;
  }
};

const sanitizeStoragePathSegment = (value: unknown, fallback = "na"): string => {
  const raw = String(value ?? "").trim();
  const token = raw.length > 0 ? raw : fallback;
  return token.replace(/[^a-zA-Z0-9._-]/g, "_");
};

const buildFaceTargetStorageKey = (userId: string, targetId: number, mimeType: string): string => {
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
  };
  const normalizedMime = String(mimeType || "").toLowerCase();
  const ext = extMap[normalizedMime] || "jpg";
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  const safeUserId = sanitizeStoragePathSegment(userId, "user");
  const safeTargetId = sanitizeStoragePathSegment(targetId, "target");
  return `face-targets/${safeUserId}/${safeTargetId}/${timestamp}-${random}.${ext}`;
};

const FACE_TARGET_MAX_IMAGES = 4;
const FACE_TARGET_MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const NEGATIVE_CONDITION_MAX_IMAGES = 3;
const NEGATIVE_CONDITION_MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

async function getFaceTargetImageCount(db: D1Database, targetId: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS total FROM face_target_images WHERE face_target_id = ?")
    .bind(targetId)
    .first();

  const total = Number((row as any)?.total ?? 0);
  if (!Number.isFinite(total) || total < 0) return 0;
  return Math.floor(total);
}

const extractStorageKeyFromNegativeConditionImageUrl = (imageUrl: string): string | null => {
  if (typeof imageUrl !== "string") return null;
  const trimmed = imageUrl.trim();
  if (!trimmed) return null;
  const prefix = "/api/negative-condition-images/";
  if (!trimmed.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(trimmed.slice(prefix.length));
  } catch {
    return null;
  }
};

const buildJobStepAgentNegativeImageStorageKey = (
  userId: string,
  agentId: number,
  mimeType: string
): string => {
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
  };
  const normalizedMime = String(mimeType || "").toLowerCase();
  const ext = extMap[normalizedMime] || "jpg";
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  const safeUserId = sanitizeStoragePathSegment(userId, "user");
  const safeAgentId = sanitizeStoragePathSegment(agentId, "agent");
  return `negative-condition-images/${safeUserId}/${safeAgentId}/${timestamp}-${random}.${ext}`;
};

const buildCameraAlgorithmNegativeImageStorageKey = (
  userId: string,
  algorithmId: number,
  mimeType: string
): string => {
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
  };
  const normalizedMime = String(mimeType || "").toLowerCase();
  const ext = extMap[normalizedMime] || "jpg";
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  const safeUserId = sanitizeStoragePathSegment(userId, "user");
  const safeAlgorithmId = sanitizeStoragePathSegment(algorithmId, "algorithm");
  return `negative-condition-images/${safeUserId}/${safeAlgorithmId}/${timestamp}-${random}.${ext}`;
};

async function getAgentNegativeImageCount(db: D1Database, agentId: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS total FROM job_step_agent_negative_images WHERE agent_id = ?")
    .bind(agentId)
    .first();

  const total = Number((row as any)?.total ?? 0);
  if (!Number.isFinite(total) || total < 0) return 0;
  return Math.floor(total);
}

async function getCameraAlgorithmNegativeImageCount(
  db: D1Database,
  algorithmId: number
): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS total FROM camera_algorithm_negative_images WHERE algorithm_id = ?")
    .bind(algorithmId)
    .first();

  const total = Number((row as any)?.total ?? 0);
  if (!Number.isFinite(total) || total < 0) return 0;
  return Math.floor(total);
}

const resolveOwnedCameraAlgorithmForUser = async (
  db: D1Database,
  userId: string,
  algorithmId: number
): Promise<any | null> => {
  if (!Number.isInteger(algorithmId) || algorithmId <= 0) return null;
  const row = await db
    .prepare(
      `SELECT ca.*, c.user_id
       FROM camera_algorithms ca
       JOIN cameras c ON c.id = ca.camera_id
       WHERE ca.id = ? AND c.user_id = ?
       LIMIT 1`
    )
    .bind(algorithmId, userId)
    .first();
  return row || null;
};

const loadFaceTargetIdsByCameraAlgorithmIds = async (
  db: D1Database,
  algorithmIds: number[]
): Promise<Map<number, number[]>> => {
  const byAlgorithmId = new Map<number, number[]>();
  const normalizedIds = Array.from(
    new Set(algorithmIds.filter((id) => Number.isInteger(id) && id > 0))
  );
  if (normalizedIds.length === 0) return byAlgorithmId;

  const placeholders = normalizedIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT algorithm_id, face_target_id
       FROM camera_algorithm_face_targets
       WHERE algorithm_id IN (${placeholders})
       ORDER BY algorithm_id ASC, face_target_id ASC`
    )
    .bind(...normalizedIds)
    .all();

  for (const row of results || []) {
    const algorithmId = Number((row as any)?.algorithm_id);
    const faceTargetId = Number((row as any)?.face_target_id);
    if (!Number.isInteger(algorithmId) || algorithmId <= 0) continue;
    if (!Number.isInteger(faceTargetId) || faceTargetId <= 0) continue;
    if (!byAlgorithmId.has(algorithmId)) byAlgorithmId.set(algorithmId, []);
    byAlgorithmId.get(algorithmId)!.push(faceTargetId);
  }

  return byAlgorithmId;
};

const loadNegativeReferenceImagesByCameraAlgorithmIds = async (
  db: D1Database,
  algorithmIds: number[]
): Promise<Map<number, NegativeReferenceImagePayload[]>> => {
  const byAlgorithmId = new Map<number, NegativeReferenceImagePayload[]>();
  const normalizedIds = Array.from(
    new Set(algorithmIds.filter((id) => Number.isInteger(id) && id > 0))
  );
  if (normalizedIds.length === 0) return byAlgorithmId;

  const placeholders = normalizedIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT algorithm_id, id, image_url
       FROM camera_algorithm_negative_images
       WHERE algorithm_id IN (${placeholders})
       ORDER BY algorithm_id ASC, id ASC`
    )
    .bind(...normalizedIds)
    .all();

  for (const row of results || []) {
    const algorithmId = Number((row as any)?.algorithm_id);
    const imageId = Number((row as any)?.id);
    const imageUrl =
      typeof (row as any)?.image_url === "string" ? String((row as any).image_url).trim() : "";
    if (!Number.isInteger(algorithmId) || algorithmId <= 0) continue;
    if (!Number.isInteger(imageId) || imageId <= 0 || !imageUrl) continue;
    if (!byAlgorithmId.has(algorithmId)) byAlgorithmId.set(algorithmId, []);
    byAlgorithmId.get(algorithmId)!.push({
      id: imageId,
      image_url: imageUrl,
    });
  }

  return byAlgorithmId;
};

const listCustomCameraAgents = async (
  db: D1Database,
  userId: string,
  cameraId: number
): Promise<any[]> => {
  const { results } = await db
    .prepare(
      `SELECT ca.*
       FROM camera_algorithms ca
       JOIN cameras c ON c.id = ca.camera_id
       WHERE ca.camera_id = ?
         AND c.user_id = ?
         AND ca.algorithm_type LIKE 'custom_%'
       ORDER BY ca.updated_at DESC, ca.id DESC`
    )
    .bind(cameraId, userId)
    .all();

  const rows = (results || []).map((row: any) => ({ ...row }));
  const algorithmIds = rows
    .map((row: any) => Number(row?.id))
    .filter((id: number) => Number.isInteger(id) && id > 0);
  const faceTargetIdsByAlgorithm = await loadFaceTargetIdsByCameraAlgorithmIds(db, algorithmIds);
  const negativeImagesByAlgorithm = await loadNegativeReferenceImagesByCameraAlgorithmIds(
    db,
    algorithmIds
  );

  return rows.map((agent: any) => {
    const algorithmId = Number(agent?.id);
    const faceTargetIds = faceTargetIdsByAlgorithm.get(algorithmId) || [];
    const negativeImages = negativeImagesByAlgorithm.get(algorithmId) || [];
    const promptParts = parsePromptTemplateParts(
      agent?.prompt_template ?? agent?.llm_prompt,
      agent?.alert_condition,
      agent?.negative_condition
    );

    let configJsonObj: any = {};
    if (typeof agent?.config_json === "string" && agent.config_json.trim()) {
      try {
        const parsed = JSON.parse(agent.config_json);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          configJsonObj = parsed;
        }
      } catch {
        configJsonObj = {};
      }
    } else if (agent?.config_json && typeof agent.config_json === "object") {
      configJsonObj = agent.config_json;
    }

    return {
      ...agent,
      config_json: configJsonObj,
      prompt_template: promptParts.prompt_template,
      alert_condition: promptParts.alert_condition,
      negative_condition: promptParts.negative_condition,
      ...(() => {
        const rawInputType = normalizeJobStepInputType(agent?.input_type) || "video";
        const rawInferenceModel =
          normalizeJobStepInferenceModel(agent?.inference_model) || FIXED_JOB_STEP_INFERENCE_MODEL;
        const rawRunEvery = normalizeJobStepRunEverySeconds(
          agent?.run_every,
          FIXED_JOB_STEP_RUN_EVERY_SECONDS
        );
        const rawRunningResolution = normalizeJobStepRunningResolution(
          agent?.running_resolution,
          DEFAULT_CORE_RUNNING_RESOLUTION
        );
        const execution = applyInferenceExecutionConstraints(
          rawInputType,
          rawInferenceModel,
          rawRunEvery,
          rawRunningResolution,
          agent?.model_fps
        );
        return {
          input_type: execution.inputType,
          inference_model: execution.inferenceModel,
          model_fps: execution.modelFps,
          run_every: execution.runEvery,
          running_resolution: execution.runningResolution,
        };
      })(),
      only_capture_on_motion: normalizeJobStepOnlyCaptureOnMotion(
        agent?.only_capture_on_motion,
        true
      ),
      face_target_ids: faceTargetIds,
      negative_reference_images: negativeImages,
      analysis_regions: parseStoredAnalysisRegions(agent?.analysis_regions, {
        promptParts,
        faceTargetIds,
        negativeImageIds: negativeImages
          .map((img) => Number(img?.id))
          .filter((id) => Number.isInteger(id) && id > 0),
      }),
    };
  });
};

const loadNegativeReferenceImagesByAgentId = async (
  db: D1Database,
  agentIds: number[]
): Promise<Map<number, NegativeReferenceImagePayload[]>> => {
  const byAgentId = new Map<number, NegativeReferenceImagePayload[]>();
  const normalizedAgentIds = Array.from(
    new Set(agentIds.filter((id) => Number.isInteger(id) && id > 0))
  );
  if (normalizedAgentIds.length === 0) {
    return byAgentId;
  }

  const placeholders = normalizedAgentIds.map(() => "?").join(", ");
  try {
    const { results } = await db
      .prepare(
        `SELECT agent_id, id, image_url
         FROM job_step_agent_negative_images
         WHERE agent_id IN (${placeholders})
         ORDER BY agent_id ASC, id ASC`
      )
      .bind(...normalizedAgentIds)
      .all();

    for (const row of results || []) {
      const agentId = Number((row as any)?.agent_id);
      const imageId = Number((row as any)?.id);
      const imageUrl =
        typeof (row as any)?.image_url === "string" ? String((row as any).image_url).trim() : "";
      if (!Number.isInteger(agentId) || agentId <= 0) continue;
      if (!Number.isInteger(imageId) || imageId <= 0 || !imageUrl) continue;
      if (!byAgentId.has(agentId)) byAgentId.set(agentId, []);
      byAgentId.get(agentId)!.push({
        id: imageId,
        image_url: imageUrl,
      });
    }
  } catch (error) {
    console.log("[NEGATIVE CONDITION] Warning: failed to load mappings for agents", error);
  }

  return byAgentId;
};

async function fetchFaceTargetsForUser(
  db: D1Database,
  userId: string
): Promise<Array<{
  id: number;
  user_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  images: FaceTargetImagePayload[];
  image_count: number;
}>> {
  const { results: targetRows } = await db
    .prepare(
      `SELECT id, user_id, name, description, created_at, updated_at
       FROM face_targets
       WHERE user_id = ?
       ORDER BY updated_at DESC, id DESC`
    )
    .bind(userId)
    .all();

  const targets: Array<
    FaceTargetPayload & {
      user_id: string;
      created_at: string;
      updated_at: string;
      image_count: number;
    }
  > = (targetRows || []).map((row: any) => ({
    id: Number(row.id),
    user_id: String(row.user_id || ""),
    name: String(row.name || ""),
    description: String(row.description || ""),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    images: [] as FaceTargetImagePayload[],
    image_count: 0,
  }));

  const targetIds = targets
    .map((row: { id: number }) => Number(row.id))
    .filter((id: number) => Number.isInteger(id) && id > 0);

  if (targetIds.length === 0) return targets;

  const placeholders = targetIds.map(() => "?").join(", ");
  const { results: imageRows } = await db
    .prepare(
      `SELECT id, face_target_id, image_url
       FROM face_target_images
       WHERE face_target_id IN (${placeholders})
       ORDER BY face_target_id ASC, id ASC`
    )
    .bind(...targetIds)
    .all();

  const imageMap = new Map<number, FaceTargetImagePayload[]>();
  for (const row of imageRows || []) {
    const targetId = Number((row as any)?.face_target_id);
    const imageId = Number((row as any)?.id);
    const imageUrl =
      typeof (row as any)?.image_url === "string" ? String((row as any).image_url).trim() : "";
    if (!Number.isInteger(targetId) || targetId <= 0) continue;
    if (!Number.isInteger(imageId) || imageId <= 0 || !imageUrl) continue;
    if (!imageMap.has(targetId)) imageMap.set(targetId, []);
    imageMap.get(targetId)!.push({
      id: imageId,
      image_url: imageUrl,
    });
  }

  return targets.map((target) => {
    const images = imageMap.get(target.id) || [];
    return {
      ...target,
      images,
      image_count: images.length,
    };
  });
}

app.get("/api/face-targets", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  try {
    const targets = await fetchFaceTargetsForUser(c.env.DB, user.id);
    return c.json({ targets });
  } catch (error) {
    console.error("Failed to list face targets:", error);
    return c.json({ error: "Failed to list face targets" }, 500);
  }
});

app.post("/api/face-targets", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  try {
    const formData = await c.req.formData();
    const name = typeof formData.get("name") === "string" ? String(formData.get("name")).trim() : "";
    const description =
      typeof formData.get("description") === "string" ? String(formData.get("description")).trim() : "";
    const imageFile = formData.get("image") as File | null;

    if (!name) {
      return c.json({ error: "name is required" }, 400);
    }
    if (!imageFile) {
      return c.json({ error: "image is required" }, 400);
    }
    if (!String(imageFile.type || "").toLowerCase().startsWith("image/")) {
      return c.json({ error: "Only image uploads are allowed" }, 400);
    }
    if (typeof imageFile.size === "number" && imageFile.size > FACE_TARGET_MAX_UPLOAD_BYTES) {
      return c.json({ error: "Image is too large. Maximum size is 10MB." }, 400);
    }

    const now = new Date().toISOString();
    const targetInsert = await c.env.DB
      .prepare(
        `INSERT INTO face_targets (user_id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(user.id, name, description, now, now)
      .run();

    const targetId = Number(targetInsert.meta.last_row_id || 0);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return c.json({ error: "Failed to create face target" }, 500);
    }

    const storageKey = buildFaceTargetStorageKey(user.id, targetId, imageFile.type);
    const arrayBuffer = await imageFile.arrayBuffer();
    await c.env.R2_BUCKET.put(storageKey, arrayBuffer, {
      httpMetadata: { contentType: imageFile.type || "image/jpeg" },
    });
    const imageUrl = `/api/face-target-images/${encodeURIComponent(storageKey)}`;

    await c.env.DB
      .prepare(
        `INSERT INTO face_target_images (face_target_id, image_url, created_at, updated_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(targetId, imageUrl, now, now)
      .run();

    const targets = await fetchFaceTargetsForUser(c.env.DB, user.id);
    const target = targets.find((row) => row.id === targetId);
    return c.json({ target: target || null }, 201);
  } catch (error) {
    console.error("Failed to create face target:", error);
    return c.json({ error: "Failed to create face target" }, 500);
  }
});

app.patch("/api/face-targets/:targetId", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const targetId = Number(c.req.param("targetId"));
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return c.json({ error: "Invalid target id" }, 400);
  }

  const body = await c.req
    .json<{ name?: string; description?: string }>()
    .catch((): { name?: string; description?: string } => ({}));

  const existing = await c.env.DB
    .prepare("SELECT id FROM face_targets WHERE id = ? AND user_id = ?")
    .bind(targetId, user.id)
    .first();

  if (!existing) {
    return c.json({ error: "Face target not found" }, 404);
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (typeof body.name === "string") {
    const normalizedName = body.name.trim();
    if (!normalizedName) {
      return c.json({ error: "name cannot be empty" }, 400);
    }
    updates.push("name = ?");
    values.push(normalizedName);
  }

  if (typeof body.description === "string") {
    updates.push("description = ?");
    values.push(body.description.trim());
  }

  if (updates.length === 0) {
    const targets = await fetchFaceTargetsForUser(c.env.DB, user.id);
    const target = targets.find((row) => row.id === targetId);
    return c.json({ target: target || null });
  }

  updates.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(targetId, user.id);

  await c.env.DB
    .prepare(
      `UPDATE face_targets
       SET ${updates.join(", ")}
       WHERE id = ? AND user_id = ?`
    )
    .bind(...values)
    .run();

  const targets = await fetchFaceTargetsForUser(c.env.DB, user.id);
  const target = targets.find((row) => row.id === targetId);
  return c.json({ target: target || null });
});

app.delete("/api/face-targets/:targetId", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const targetId = Number(c.req.param("targetId"));
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return c.json({ error: "Invalid target id" }, 400);
  }

  const existing = await c.env.DB
    .prepare("SELECT id FROM face_targets WHERE id = ? AND user_id = ?")
    .bind(targetId, user.id)
    .first();
  if (!existing) {
    return c.json({ error: "Face target not found" }, 404);
  }

  try {
    const { results: imageRows } = await c.env.DB
      .prepare("SELECT id, image_url FROM face_target_images WHERE face_target_id = ?")
      .bind(targetId)
      .all();

    const storageKeys: string[] = [];
    for (const row of imageRows || []) {
      const imageId = Number((row as any)?.id ?? 0);
      const imageUrl =
        typeof (row as any)?.image_url === "string" ? String((row as any).image_url).trim() : "";
      if (!imageUrl) continue;
      const storageKey = extractStorageKeyFromFaceTargetImageUrl(imageUrl);
      if (!storageKey) {
        console.error("[FACE TARGET] Invalid storage path while deleting target", {
          targetId,
          imageId,
          imageUrl,
        });
        return c.json({ error: "Failed to delete face target image from storage" }, 500);
      }
      storageKeys.push(storageKey);
    }

    for (const storageKey of storageKeys) {
      try {
        await c.env.R2_BUCKET.delete(storageKey);
      } catch (error) {
        console.error("[FACE TARGET] Failed to delete image from R2 while deleting target", {
          targetId,
          storageKey,
          error,
        });
        return c.json({ error: "Failed to delete face target image from storage" }, 502);
      }
    }

    await c.env.DB
      .prepare("DELETE FROM job_step_agent_face_targets WHERE face_target_id = ?")
      .bind(targetId)
      .run();

    await c.env.DB
      .prepare("DELETE FROM face_target_images WHERE face_target_id = ?")
      .bind(targetId)
      .run();

    await c.env.DB
      .prepare("DELETE FROM face_targets WHERE id = ? AND user_id = ?")
      .bind(targetId, user.id)
      .run();
  } catch (error) {
    console.error("[FACE TARGET] Failed to delete target", { targetId, error });
    return c.json({ error: "Failed to delete face target" }, 500);
  }

  return c.json({ success: true });
});

app.post("/api/face-targets/:targetId/images", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const targetId = Number(c.req.param("targetId"));
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return c.json({ error: "Invalid target id" }, 400);
  }

  const existing = await c.env.DB
    .prepare("SELECT id FROM face_targets WHERE id = ? AND user_id = ?")
    .bind(targetId, user.id)
    .first();
  if (!existing) {
    return c.json({ error: "Face target not found" }, 404);
  }

  try {
    const formData = await c.req.formData();
    const imageFile = formData.get("image") as File | null;
    if (!imageFile) {
      return c.json({ error: "image is required" }, 400);
    }
    if (!String(imageFile.type || "").toLowerCase().startsWith("image/")) {
      return c.json({ error: "Only image uploads are allowed" }, 400);
    }
    if (typeof imageFile.size === "number" && imageFile.size > FACE_TARGET_MAX_UPLOAD_BYTES) {
      return c.json({ error: "Image is too large. Maximum size is 10MB." }, 400);
    }

    const currentImageCount = await getFaceTargetImageCount(c.env.DB, targetId);
    if (currentImageCount >= FACE_TARGET_MAX_IMAGES) {
      return c.json(
        { error: `Maximum ${FACE_TARGET_MAX_IMAGES} images per target` },
        409
      );
    }

    const storageKey = buildFaceTargetStorageKey(user.id, targetId, imageFile.type);
    const arrayBuffer = await imageFile.arrayBuffer();
    await c.env.R2_BUCKET.put(storageKey, arrayBuffer, {
      httpMetadata: { contentType: imageFile.type || "image/jpeg" },
    });
    const imageUrl = `/api/face-target-images/${encodeURIComponent(storageKey)}`;
    const now = new Date().toISOString();

    const inserted = await c.env.DB
      .prepare(
        `INSERT INTO face_target_images (face_target_id, image_url, created_at, updated_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(targetId, imageUrl, now, now)
      .run();

    const imageId = Number(inserted.meta.last_row_id || 0);
    return c.json(
      {
        image: {
          id: imageId,
          face_target_id: targetId,
          image_url: imageUrl,
        },
      },
      201
    );
  } catch (error) {
    console.error("Failed to upload face target image:", error);
    return c.json({ error: "Failed to upload face target image" }, 500);
  }
});

app.delete("/api/face-targets/:targetId/images/:imageId", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const targetId = Number(c.req.param("targetId"));
  const imageId = Number(c.req.param("imageId"));
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return c.json({ error: "Invalid target id" }, 400);
  }
  if (!Number.isInteger(imageId) || imageId <= 0) {
    return c.json({ error: "Invalid image id" }, 400);
  }

  const row = await c.env.DB
    .prepare(
      `SELECT fti.id, fti.image_url
       FROM face_target_images fti
       JOIN face_targets ft ON ft.id = fti.face_target_id
       WHERE fti.id = ? AND fti.face_target_id = ? AND ft.user_id = ?`
    )
    .bind(imageId, targetId, user.id)
    .first();

  if (!row) {
    return c.json({ error: "Face target image not found" }, 404);
  }

  const imageUrl =
    typeof (row as any)?.image_url === "string" ? String((row as any).image_url).trim() : "";
  if (!imageUrl) {
    console.error("[FACE TARGET] Missing image_url while deleting image", { targetId, imageId });
    return c.json({ error: "Failed to delete face target image from storage" }, 500);
  }

  const storageKey = extractStorageKeyFromFaceTargetImageUrl(imageUrl);
  if (!storageKey) {
    console.error("[FACE TARGET] Invalid image_url while deleting image", {
      targetId,
      imageId,
      imageUrl,
    });
    return c.json({ error: "Failed to delete face target image from storage" }, 500);
  }

  try {
    await c.env.R2_BUCKET.delete(storageKey);
  } catch (error) {
    console.error("[FACE TARGET] Failed to delete image from R2", {
      targetId,
      imageId,
      storageKey,
      error,
    });
    return c.json({ error: "Failed to delete face target image from storage" }, 502);
  }

  try {
    await c.env.DB
      .prepare("DELETE FROM face_target_images WHERE id = ? AND face_target_id = ?")
      .bind(imageId, targetId)
      .run();
  } catch (error) {
    console.error("[FACE TARGET] Failed to delete face_target_images row", {
      targetId,
      imageId,
      error,
    });
    return c.json({ error: "Failed to delete face target image" }, 500);
  }

  return c.json({ success: true });
});

// Face target images endpoint (R2) - for web UI
app.get("/api/face-target-images/:storageKey", anyAuthMiddleware, async (c) => {
  const storageKey = decodeURIComponent(c.req.param("storageKey"));
  try {
    const object = await c.env.R2_BUCKET.get(storageKey);
    if (!object) {
      return c.json({ error: "Image not found" }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "no-cache");
    if (!headers.has("content-type")) {
      headers.set("content-type", "image/jpeg");
    }
    return c.body(object.body, { headers });
  } catch (error) {
    console.error("Failed to fetch face target image:", error);
    return c.json({ error: "Failed to fetch image" }, 500);
  }
});

// Face target images endpoint (R2) - for EXE/Agent with Bearer token
app.get("/api/agent/face-target-images/:encodedPath", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const storageKey = decodeURIComponent(c.req.param("encodedPath"));
  try {
    const object = await c.env.R2_BUCKET.get(storageKey);
    if (!object) {
      return c.json({ error: "Image not found" }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "no-cache");
    if (!headers.has("content-type")) {
      headers.set("content-type", "image/jpeg");
    }
    return c.body(object.body, { headers });
  } catch (error) {
    console.error("Failed to fetch face target image:", error);
    return c.json({ error: "Failed to fetch image" }, 500);
  }
});

// Negative condition images endpoint (R2) - for web UI
app.get("/api/negative-condition-images/:storageKey", anyAuthMiddleware, async (c) => {
  const storageKey = decodeURIComponent(c.req.param("storageKey"));
  try {
    const object = await c.env.R2_BUCKET.get(storageKey);
    if (!object) {
      return c.json({ error: "Image not found" }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "no-cache");
    if (!headers.has("content-type")) {
      headers.set("content-type", "image/jpeg");
    }
    return c.body(object.body, { headers });
  } catch (error) {
    console.error("Failed to fetch negative condition image:", error);
    return c.json({ error: "Failed to fetch image" }, 500);
  }
});

// Negative condition images endpoint (R2) - for EXE/Agent with Bearer token
app.get("/api/agent/negative-condition-images/:encodedPath", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const storageKey = decodeURIComponent(c.req.param("encodedPath"));
  try {
    const object = await c.env.R2_BUCKET.get(storageKey);
    if (!object) {
      return c.json({ error: "Image not found" }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "no-cache");
    if (!headers.has("content-type")) {
      headers.set("content-type", "image/jpeg");
    }
    return c.body(object.body, { headers });
  } catch (error) {
    console.error("Failed to fetch negative condition image:", error);
    return c.json({ error: "Failed to fetch image" }, 500);
  }
});

// ReID Target endpoints
app.get("/api/cameras/:cameraId/reid-targets", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const cameraId = c.req.param("cameraId");

  // Verify camera ownership
  const camera = await c.env.DB.prepare(
    "SELECT * FROM cameras WHERE id = ? AND user_id = ?"
  )
    .bind(cameraId, user.id)
    .first();

  if (!camera) {
    return c.json({ error: "Camera not found" }, 404);
  }

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM reid_targets WHERE camera_id = ? ORDER BY created_at DESC"
  )
    .bind(cameraId)
    .all();

  return c.json(results);
});

app.post("/api/cameras/:cameraId/reid-targets", anyAuthMiddleware, zValidator("json", CreateReIDTargetSchema), async (c) => {
  const user = c.get("user")!;
  const cameraId = c.req.param("cameraId");
  const data = c.req.valid("json");

  // Verify camera ownership
  const camera = await c.env.DB.prepare(
    "SELECT * FROM cameras WHERE id = ? AND user_id = ?"
  )
    .bind(cameraId, user.id)
    .first();

  if (!camera) {
    return c.json({ error: "Camera not found" }, 404);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO reid_targets (camera_id, person_name, person_description)
     VALUES (?, ?, ?)`
  )
    .bind(data.camera_id, data.person_name, data.person_description)
    .run();

  const target = await c.env.DB.prepare(
    "SELECT * FROM reid_targets WHERE id = ?"
  )
    .bind(result.meta.last_row_id)
    .first();

  return c.json(target, 201);
});

app.delete("/api/cameras/:cameraId/reid-targets/:id", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const cameraId = c.req.param("cameraId");
  const id = c.req.param("id");

  // Verify camera ownership
  const camera = await c.env.DB.prepare(
    "SELECT * FROM cameras WHERE id = ? AND user_id = ?"
  )
    .bind(cameraId, user.id)
    .first();

  if (!camera) {
    return c.json({ error: "Camera not found" }, 404);
  }

  await c.env.DB.prepare(
    "DELETE FROM reid_targets WHERE id = ? AND camera_id = ?"
  )
    .bind(id, cameraId)
    .run();

  return c.json({ success: true });
});

app.get("/api/drakon-find/targets", anyAuthMiddleware, async (c) => {
  const disabled = requireDrakonFindEnabled(c);
  if (disabled) return disabled;

  const user = c.get("user")!;
  try {
    const targets = await fetchDrakonFindTargetsForUser(c.env.DB, user.id);
    return c.json({ targets });
  } catch (error) {
    console.error("[DRAKON FIND] Failed to list targets", error);
    return c.json({ error: "Failed to list Drakon Find targets" }, 500);
  }
});

app.post(
  "/api/drakon-find/targets",
  anyAuthMiddleware,
  zValidator("json", CreateDrakonFindTargetSchema),
  async (c) => {
    const disabled = requireDrakonFindEnabled(c);
    if (disabled) return disabled;

    const user = c.get("user")!;
    const data = c.req.valid("json");
    const entityType = normalizeDrakonFindText(data.entity_type, 40);
    const name = normalizeDrakonFindText(data.name, 120);
    const description = normalizeDrakonFindText(data.description, 2000);
    const traits = normalizeDrakonFindTraits(data.traits);

    if (!entityType || !name || !description) {
      return c.json({ error: "entity_type, name, and description are required" }, 400);
    }

    try {
      const now = new Date().toISOString();
      const inserted = await c.env.DB
        .prepare(
          `INSERT INTO drakon_find_targets (
             user_id,
             entity_type,
             name,
             description,
             traits_json,
             created_at,
             updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(user.id, entityType, name, description, JSON.stringify(traits), now, now)
        .run();

      const targetId = Number(inserted.meta.last_row_id || 0);
      if (!Number.isInteger(targetId) || targetId <= 0) {
        return c.json({ error: "Failed to create Drakon Find target" }, 500);
      }

      await createDrakonFindAuditLog(c.env.DB, {
        actorUserId: user.id,
        actionType: "target_created",
        targetId,
        message: `Target "${name}" registered for Drakon Find`,
        metadata: {
          entity_type: entityType,
          name,
          traits,
        },
      });

      const targets = await fetchDrakonFindTargetsForUser(c.env.DB, user.id);
      const target = targets.find((item: any) => item.id === targetId) || null;
      return c.json({ target }, 201);
    } catch (error) {
      console.error("[DRAKON FIND] Failed to create target", error);
      return c.json({ error: "Failed to create Drakon Find target" }, 500);
    }
  }
);

app.post("/api/drakon-find/targets/:targetId/images", anyAuthMiddleware, async (c) => {
  const disabled = requireDrakonFindEnabled(c);
  if (disabled) return disabled;

  const user = c.get("user")!;
  const targetId = Number(c.req.param("targetId"));
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return c.json({ error: "Invalid target id" }, 400);
  }

  const target = await c.env.DB
    .prepare("SELECT id, name FROM drakon_find_targets WHERE id = ? AND user_id = ? LIMIT 1")
    .bind(targetId, user.id)
    .first();
  if (!target) {
    return c.json({ error: "Drakon Find target not found" }, 404);
  }

  try {
    const countRow = await c.env.DB
      .prepare(
        `SELECT COUNT(*) AS image_count
         FROM drakon_find_target_images
         WHERE target_id = ?`
      )
      .bind(targetId)
      .first();
    const currentCount = clampInteger((countRow as any)?.image_count);
    if (currentCount >= DRAKON_FIND_MAX_TARGET_IMAGES) {
      return c.json(
        {
          error: `Cada target suporta ate ${DRAKON_FIND_MAX_TARGET_IMAGES} imagens de referencia.`,
        },
        400
      );
    }

    const formData = await c.req.formData();
    const imageEntry = formData.get("image");
    if (!(imageEntry instanceof File)) {
      return c.json({ error: "image is required" }, 400);
    }
    const imageFile = imageEntry;
    if (!String(imageFile.type || "").toLowerCase().startsWith("image/")) {
      return c.json({ error: "Only image uploads are allowed" }, 400);
    }
    if (
      typeof imageFile.size === "number" &&
      imageFile.size > DRAKON_FIND_MAX_TARGET_IMAGE_BYTES
    ) {
      return c.json(
        {
          error: `Image is too large. Maximum size is ${(
            DRAKON_FIND_MAX_TARGET_IMAGE_BYTES / 1_000_000
          ).toFixed(1)}MB.`,
        },
        400
      );
    }

    const storageKey = buildDrakonFindTargetImageStorageKey(
      user.id,
      targetId,
      imageFile.type || "image/jpeg"
    );
    const arrayBuffer = await imageFile.arrayBuffer();
    if (!c.env.R2_BUCKET || typeof c.env.R2_BUCKET.put !== "function") {
      return c.json({ error: "R2 bucket is not configured for Drakon Find image uploads" }, 500);
    }
    await c.env.R2_BUCKET.put(storageKey, arrayBuffer, {
      httpMetadata: { contentType: imageFile.type || "image/jpeg" },
    });

    const imageUrl = buildDrakonFindTargetImageUrl(storageKey);
    const now = new Date().toISOString();
    await c.env.DB
      .prepare(
        `INSERT INTO drakon_find_target_images (
           target_id,
           storage_key,
           image_url,
           content_type,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(targetId, storageKey, imageUrl, imageFile.type || "image/jpeg", now, now)
      .run();

    await createDrakonFindAuditLog(c.env.DB, {
      actorUserId: user.id,
      actionType: "target_image_added",
      targetId,
      message: `Imagem de referencia adicionada ao target "${String((target as any)?.name || "").trim()}".`,
    });

    const targets = await fetchDrakonFindTargetsForUser(c.env.DB, user.id);
    const updatedTarget = targets.find((item: any) => item.id === targetId) || null;
    return c.json({ target: updatedTarget });
  } catch (error) {
    console.error("[DRAKON FIND] Failed to upload target image", error);
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Failed to upload Drakon Find target image";
    return c.json({ error: message }, 500);
  }
});

app.delete("/api/drakon-find/targets/:targetId", anyAuthMiddleware, async (c) => {
  const disabled = requireDrakonFindEnabled(c);
  if (disabled) return disabled;

  const user = c.get("user")!;
  const targetId = Number(c.req.param("targetId"));
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return c.json({ error: "Invalid target id" }, 400);
  }

  try {
    const result = await deleteDrakonFindTarget(c.env, user.id, targetId);
    if (!result.ok) {
      return c.json(
        { error: result.error || "Failed to delete target" },
        (result.status || 500) as any
      );
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("[DRAKON FIND] Failed to delete target", error);
    return c.json({ error: "Failed to delete Drakon Find target" }, 500);
  }
});

app.delete(
  "/api/drakon-find/targets/:targetId/images/:imageId",
  anyAuthMiddleware,
  async (c) => {
    const disabled = requireDrakonFindEnabled(c);
    if (disabled) return disabled;

    const user = c.get("user")!;
    const targetId = Number(c.req.param("targetId"));
    const imageId = Number(c.req.param("imageId"));
    if (!Number.isInteger(targetId) || targetId <= 0 || !Number.isInteger(imageId) || imageId <= 0) {
      return c.json({ error: "Invalid target image id" }, 400);
    }

    const imageRow = await c.env.DB
      .prepare(
        `SELECT
           i.id,
           i.storage_key,
           t.name AS target_name
         FROM drakon_find_target_images i
         JOIN drakon_find_targets t ON t.id = i.target_id
         WHERE i.id = ? AND i.target_id = ? AND t.user_id = ?
         LIMIT 1`
      )
      .bind(imageId, targetId, user.id)
      .first();

    if (!imageRow) {
      return c.json({ error: "Drakon Find target image not found" }, 404);
    }

    const storageKey = String((imageRow as any)?.storage_key || "");
    if (storageKey) {
      try {
        await c.env.R2_BUCKET.delete(storageKey);
      } catch (error) {
        console.warn("[DRAKON FIND] Failed to delete target image from R2", {
          targetId,
          imageId,
          storageKey,
          error,
        });
      }
    }

    await c.env.DB
      .prepare("DELETE FROM drakon_find_target_images WHERE id = ? AND target_id = ?")
      .bind(imageId, targetId)
      .run();

    await createDrakonFindAuditLog(c.env.DB, {
      actorUserId: user.id,
      actionType: "target_image_removed",
      targetId,
      message: `Imagem de referencia removida do target "${String((imageRow as any)?.target_name || "").trim()}".`,
    });

    const targets = await fetchDrakonFindTargetsForUser(c.env.DB, user.id);
    const updatedTarget = targets.find((item: any) => item.id === targetId) || null;
    return c.json({ target: updatedTarget });
  }
);

app.post(
  "/api/drakon-find/scope/resolve",
  anyAuthMiddleware,
  zValidator("json", ResolveDrakonFindScopeSchema),
  async (c) => {
    const disabled = requireDrakonFindEnabled(c);
    if (disabled) return disabled;

    const data = c.req.valid("json");
    try {
      const scope = await resolveDrakonFindScope(
        c.env.DB,
        data.selected_states,
        data.country_code
      );

      if (scope.selected_states.length === 0) {
        return c.json({ error: "At least one valid Brazilian state is required" }, 400);
      }

      const { eligible_cameras: _eligibleCameras, ...publicScope } = scope;
      return c.json({ scope: publicScope });
    } catch (error) {
      console.error("[DRAKON FIND] Failed to resolve scope", error);
      return c.json({ error: "Failed to resolve Drakon Find scope" }, 500);
    }
  }
);

app.get("/api/drakon-find/searches", anyAuthMiddleware, async (c) => {
  const disabled = requireDrakonFindEnabled(c);
  if (disabled) return disabled;

  const user = c.get("user")!;
  try {
    const searches = await fetchDrakonFindSearchesForUser(c.env.DB, user.id);
    return c.json({ searches });
  } catch (error) {
    console.error("[DRAKON FIND] Failed to list searches", error);
    return c.json({ error: "Failed to list Drakon Find searches" }, 500);
  }
});

app.get("/api/drakon-find/hits", anyAuthMiddleware, async (c) => {
  const disabled = requireDrakonFindEnabled(c);
  if (disabled) return disabled;

  const user = c.get("user")!;
  const searchId = Number(c.req.query("search_id") || 0);
  const limit = Number(c.req.query("limit") || 60);
  try {
    const hits = await fetchDrakonFindHitsForUser(c.env.DB, user.id, {
      searchId: Number.isInteger(searchId) && searchId > 0 ? searchId : null,
      limit,
    });
    return c.json({ hits });
  } catch (error) {
    console.error("[DRAKON FIND] Failed to list hits", error);
    return c.json({ error: "Failed to list Drakon Find hits" }, 500);
  }
});

app.delete("/api/drakon-find/hits/:hitId", anyAuthMiddleware, async (c) => {
  const disabled = requireDrakonFindEnabled(c);
  if (disabled) return disabled;

  const user = c.get("user")!;
  const hitId = Number(c.req.param("hitId"));
  if (!Number.isInteger(hitId) || hitId <= 0) {
    return c.json({ error: "Invalid hit id" }, 400);
  }

  try {
    const result = await deleteDrakonFindHit(c.env, user.id, hitId);
    if (!result.ok) {
      return c.json(
        { error: result.error || "Failed to delete hit" },
        (result.status || 500) as any
      );
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("[DRAKON FIND] Failed to delete hit", error);
    return c.json({ error: "Failed to delete Drakon Find hit" }, 500);
  }
});

app.post(
  "/api/drakon-find/searches",
  anyAuthMiddleware,
  zValidator("json", CreateDrakonFindSearchSchema),
  async (c) => {
    const disabled = requireDrakonFindEnabled(c);
    if (disabled) return disabled;

    const user = c.get("user")!;
    const data = c.req.valid("json");

    const targetRow = await c.env.DB
      .prepare(
        `SELECT id, entity_type, name, description
         FROM drakon_find_targets
         WHERE id = ? AND user_id = ?
         LIMIT 1`
      )
      .bind(data.target_id, user.id)
      .first();

    if (!targetRow) {
      return c.json({ error: "Drakon Find target not found" }, 404);
    }

    try {
      try {
        await chooseDrakonFindModelConfig(c.env.DB, user.id);
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : OPENAI_KEY_REQUIRED_MESSAGE;
        return c.json({ error: message }, 400);
      }

      const scope = await resolveDrakonFindScope(
        c.env.DB,
        data.selected_states,
        data.country_code
      );
      const filteredScope = applyDrakonFindCameraExclusions(
        scope,
        (data as { excluded_camera_ids?: number[] }).excluded_camera_ids
      );

      if (filteredScope.selected_states.length === 0) {
        return c.json({ error: "At least one valid Brazilian state is required" }, 400);
      }

      if (filteredScope.eligible_camera_count <= 0) {
        return c.json(
          {
            error:
              "No public-access cameras remain after applying the selected Drakon Find filters",
          },
          409
        );
      }

      const { eligible_cameras: eligibleCameras, ...scopeSnapshot } = filteredScope;
      const now = new Date().toISOString();
      const durationSeconds = normalizeDrakonFindDurationSeconds(data.duration_seconds);
      const runUntil = new Date(Date.now() + durationSeconds * 1000).toISOString();

      const inserted = await c.env.DB
        .prepare(
          `INSERT INTO drakon_find_searches (
             user_id,
             target_id,
             status,
             runtime_mode,
             input_type,
             window_seconds,
             duration_seconds,
             run_until,
             country_code,
             selected_states_json,
             scope_snapshot_json,
             eligible_camera_count,
             eligible_owner_count,
             created_at,
             updated_at
           )
           VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
           user.id,
           data.target_id,
           DRAKON_FIND_RUNTIME_MODE,
           "video",
           DRAKON_FIND_WINDOW_SECONDS,
           durationSeconds,
           runUntil,
           filteredScope.country_code,
           JSON.stringify(filteredScope.selected_states),
           JSON.stringify(scopeSnapshot),
           filteredScope.eligible_camera_count,
           filteredScope.eligible_owner_count,
           now,
           now
         )
        .run();

      const searchId = Number(inserted.meta.last_row_id || 0);
      if (!Number.isInteger(searchId) || searchId <= 0) {
        return c.json({ error: "Failed to create Drakon Find search" }, 500);
      }

      for (const camera of eligibleCameras) {
        await c.env.DB
          .prepare(
            `INSERT INTO drakon_find_search_cameras (
               search_id,
               camera_id,
               camera_owner_user_id,
               camera_name,
               city,
               state_code,
               country_code,
               is_public_access,
               created_at,
               updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(search_id, camera_id) DO NOTHING`
          )
          .bind(
            searchId,
            camera.id,
            camera.user_id,
            camera.name,
            camera.city,
            camera.state_code,
            camera.country_code,
            camera.allowpublicaccess ? 1 : 0,
            now,
            now
          )
          .run();
      }

      await createDrakonFindAuditLog(c.env.DB, {
        actorUserId: user.id,
        actionType: "search_created",
        searchId,
        targetId: Number((targetRow as any)?.id || 0),
          message: `Search queued for "${String((targetRow as any)?.name || "").trim()}"`,
          metadata: {
            target_name: String((targetRow as any)?.name || ""),
            entity_type: String((targetRow as any)?.entity_type || ""),
            selected_states: filteredScope.selected_states,
            eligible_camera_count: filteredScope.eligible_camera_count,
            eligible_owner_count: filteredScope.eligible_owner_count,
            excluded_camera_ids: filteredScope.excluded_camera_ids || [],
            country_code: filteredScope.country_code,
            runtime_mode: DRAKON_FIND_RUNTIME_MODE,
            input_type: "video",
            window_seconds: DRAKON_FIND_WINDOW_SECONDS,
          duration_seconds: durationSeconds,
          run_until: runUntil,
        },
      });

      await dispatchQueuedDrakonFindSearches(c.env);
      const searches = await fetchDrakonFindSearchesForUser(c.env.DB, user.id);
      const search = searches.find((item: any) => item.id === searchId) || null;
      return c.json({ search }, 201);
    } catch (error) {
      console.error("[DRAKON FIND] Failed to create search", error);
      return c.json({ error: "Failed to create Drakon Find search" }, 500);
    }
  }
);

app.post("/api/drakon-find/searches/:searchId/cancel", anyAuthMiddleware, async (c) => {
  const disabled = requireDrakonFindEnabled(c);
  if (disabled) return disabled;

  const user = c.get("user")!;
  const searchId = Number(c.req.param("searchId"));
  if (!Number.isInteger(searchId) || searchId <= 0) {
    return c.json({ error: "Invalid search id" }, 400);
  }

  try {
    const result = await requestDrakonFindSearchCancellation(c.env, user.id, searchId);
    if (!result.ok) {
      return c.json(
        { error: result.error || "Failed to cancel search" },
        (result.status || 500) as any
      );
    }

    const searches = await fetchDrakonFindSearchesForUser(c.env.DB, user.id);
    const search = searches.find((item: any) => item.id === searchId) || null;
    return c.json({ search });
  } catch (error) {
    console.error("[DRAKON FIND] Failed to cancel search", error);
    return c.json({ error: "Failed to cancel Drakon Find search" }, 500);
  }
});

app.post("/api/drakon-find/searches/:searchId/retry", anyAuthMiddleware, async (c) => {
  const disabled = requireDrakonFindEnabled(c);
  if (disabled) return disabled;

  const user = c.get("user")!;
  const searchId = Number(c.req.param("searchId"));
  if (!Number.isInteger(searchId) || searchId <= 0) {
    return c.json({ error: "Invalid search id" }, 400);
  }

  try {
    const result = await retryDrakonFindSearch(c.env, user.id, searchId);
    if (!result.ok) {
      return c.json(
        { error: result.error || "Failed to retry search" },
        (result.status || 500) as any
      );
    }

    const searches = await fetchDrakonFindSearchesForUser(c.env.DB, user.id);
    const search = searches.find((item: any) => item.id === searchId) || null;
    return c.json({ search });
  } catch (error) {
    console.error("[DRAKON FIND] Failed to retry search", error);
    return c.json({ error: "Failed to retry Drakon Find search" }, 500);
  }
});

app.delete("/api/drakon-find/searches/:searchId", anyAuthMiddleware, async (c) => {
  const disabled = requireDrakonFindEnabled(c);
  if (disabled) return disabled;

  const user = c.get("user")!;
  const searchId = Number(c.req.param("searchId"));
  if (!Number.isInteger(searchId) || searchId <= 0) {
    return c.json({ error: "Invalid search id" }, 400);
  }

  try {
    const result = await deleteDrakonFindSearch(c.env, user.id, searchId);
    if (!result.ok) {
      return c.json(
        { error: result.error || "Failed to delete search" },
        (result.status || 500) as any
      );
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("[DRAKON FIND] Failed to delete search", error);
    return c.json({ error: "Failed to delete Drakon Find search" }, 500);
  }
});

app.patch(
  "/api/drakon-find/searches/:searchId/status",
  anyAuthMiddleware,
  zValidator("json", UpdateDrakonFindSearchStatusSchema),
  async (c) => {
    const disabled = requireDrakonFindEnabled(c);
    if (disabled) return disabled;

    const user = c.get("user")!;
    const searchId = Number(c.req.param("searchId"));
    if (!Number.isInteger(searchId) || searchId <= 0) {
      return c.json({ error: "Invalid search id" }, 400);
    }

    const data = c.req.valid("json");
    const existing = await c.env.DB
      .prepare(
        `SELECT s.*, t.name AS target_name
         FROM drakon_find_searches s
         JOIN drakon_find_targets t ON t.id = s.target_id
         WHERE s.id = ? AND s.user_id = ?
         LIMIT 1`
      )
      .bind(searchId, user.id)
      .first();

    if (!existing) {
      return c.json({ error: "Drakon Find search not found" }, 404);
    }

    const nextStatus = data.status;
    const now = new Date().toISOString();
    const startedAt =
      nextStatus === "running"
        ? String((existing as any)?.started_at || now)
        : (existing as any)?.started_at || null;
    const completedAt = nextStatus === "completed" ? now : null;
    const cancelledAt = nextStatus === "cancelled" ? now : null;

    try {
      await c.env.DB
        .prepare(
          `UPDATE drakon_find_searches
           SET status = ?,
               started_at = ?,
               completed_at = ?,
               cancelled_at = ?,
               updated_at = ?
           WHERE id = ? AND user_id = ?`
        )
        .bind(nextStatus, startedAt, completedAt, cancelledAt, now, searchId, user.id)
        .run();

      await createDrakonFindAuditLog(c.env.DB, {
        actorUserId: user.id,
        actionType: "search_status_changed",
        searchId,
        targetId:
          (existing as any)?.target_id === null || (existing as any)?.target_id === undefined
            ? null
            : Number((existing as any).target_id),
        message: `Search "${String((existing as any)?.target_name || "").trim()}" moved to ${nextStatus}`,
        metadata: {
          previous_status: String((existing as any)?.status || ""),
          next_status: nextStatus,
        },
      });

      const searches = await fetchDrakonFindSearchesForUser(c.env.DB, user.id);
      const search = searches.find((item: any) => item.id === searchId) || null;
      return c.json({ search });
    } catch (error) {
      console.error("[DRAKON FIND] Failed to update search status", error);
      return c.json({ error: "Failed to update Drakon Find search" }, 500);
    }
  }
);

app.get("/api/drakon-find/audit", anyAuthMiddleware, async (c) => {
  const disabled = requireDrakonFindEnabled(c);
  if (disabled) return disabled;

  const user = c.get("user")!;
  const limit = Number(c.req.query("limit") || 50);
  try {
    const audit = await fetchDrakonFindAuditForUser(c.env.DB, user.id, limit);
    return c.json({ audit });
  } catch (error) {
    console.error("[DRAKON FIND] Failed to list audit logs", error);
    return c.json({ error: "Failed to list Drakon Find audit logs" }, 500);
  }
});

app.get("/api/drakon-find-target-images/:storageKey", anyAuthMiddleware, async (c) => {
  const disabled = requireDrakonFindEnabled(c);
  if (disabled) return disabled;

  const user = c.get("user")!;
  const storageKey = decodeURIComponent(c.req.param("storageKey"));
  const owned = await c.env.DB
    .prepare(
      `SELECT i.id
       FROM drakon_find_target_images i
       JOIN drakon_find_targets t ON t.id = i.target_id
       WHERE i.storage_key = ? AND t.user_id = ?
       LIMIT 1`
    )
    .bind(storageKey, user.id)
    .first();
  if (!owned) {
    return c.json({ error: "Image not found" }, 404);
  }

  try {
    const object = await c.env.R2_BUCKET.get(storageKey);
    if (!object) {
      return c.json({ error: "Image not found" }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "no-cache");
    if (!headers.has("content-type")) {
      headers.set("content-type", "image/jpeg");
    }
    return c.body(object.body, { headers });
  } catch (error) {
    console.error("[DRAKON FIND] Failed to fetch target image", error);
    return c.json({ error: "Failed to fetch image" }, 500);
  }
});

app.get("/api/drakon-find-hit-images/:storageKey", anyAuthMiddleware, async (c) => {
  const disabled = requireDrakonFindEnabled(c);
  if (disabled) return disabled;

  const user = c.get("user")!;
  const storageKey = decodeURIComponent(c.req.param("storageKey"));
  const owned = await c.env.DB
    .prepare(
      `SELECT h.id
       FROM drakon_find_hits h
       JOIN drakon_find_searches s ON s.id = h.search_id
       WHERE h.image_key = ? AND s.user_id = ?
       LIMIT 1`
    )
    .bind(storageKey, user.id)
    .first();
  if (!owned) {
    return c.json({ error: "Image not found" }, 404);
  }

  try {
    const object = await c.env.R2_BUCKET.get(storageKey);
    if (!object) {
      return c.json({ error: "Image not found" }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "no-cache");
    if (!headers.has("content-type")) {
      headers.set("content-type", "image/jpeg");
    }
    return c.body(object.body, { headers });
  } catch (error) {
    console.error("[DRAKON FIND] Failed to fetch hit image", error);
    return c.json({ error: "Failed to fetch image" }, 500);
  }
});

app.get("/api/drakon-find-hit-videos/:storageKey", anyAuthMiddleware, async (c) => {
  const disabled = requireDrakonFindEnabled(c);
  if (disabled) return disabled;

  const user = c.get("user")!;
  const storageKey = decodeURIComponent(c.req.param("storageKey"));
  const owned = await c.env.DB
    .prepare(
      `SELECT h.id
       FROM drakon_find_hits h
       JOIN drakon_find_searches s ON s.id = h.search_id
       WHERE h.video_key = ? AND s.user_id = ?
       LIMIT 1`
    )
    .bind(storageKey, user.id)
    .first();
  if (!owned) {
    return c.json({ error: "Video not found" }, 404);
  }

  try {
    const object = await c.env.R2_BUCKET.get(storageKey);
    if (!object) {
      return c.json({ error: "Video not found" }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "no-cache");
    if (!headers.has("content-type")) {
      headers.set("content-type", "video/mp4");
    }
    return c.body(object.body, { headers });
  } catch (error) {
    console.error("[DRAKON FIND] Failed to fetch hit video", error);
    return c.json({ error: "Failed to fetch video" }, 500);
  }
});

// Command endpoints
app.post("/api/commands", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json();

  await c.env.DB.prepare(
    `INSERT INTO commands (user_id, camera_id, command_type, payload)
     VALUES (?, ?, ?, ?)`
  )
    .bind(user.id, body.camera_id || null, body.command_type, body.payload)
    .run();

  return c.json({ success: true }, 201);
});

app.get("/api/commands", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const status = c.req.query("status");

  let query = "SELECT * FROM commands WHERE user_id = ?";
  const bindings: any[] = [user.id];

  if (status) {
    query += " AND status = ?";
    bindings.push(status);
  }

  query += " ORDER BY created_at DESC LIMIT 100";

  const { results } = await c.env.DB.prepare(query).bind(...bindings).all();

  return c.json(results);
});

// Events endpoints
app.get("/api/events", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const cameraId = c.req.query("camera_id");
  const eventType = c.req.query("event_type");
  const onlyUnread = c.req.query("only_unread");
  const afterId = c.req.query("after_id");
  const limitParam = c.req.query("limit");

  // Parse and clamp limit between 1 and 100, default to 100
  let limit = 100;
  if (limitParam) {
    const parsedLimit = parseInt(limitParam, 10);
    if (!isNaN(parsedLimit)) {
      limit = Math.max(1, Math.min(100, parsedLimit));
    }
  }

  let query = "SELECT * FROM events WHERE user_id = ?";
  const bindings: any[] = [user.id];

  if (cameraId) {
    query += " AND camera_id = ?";
    bindings.push(cameraId);
  }

  if (eventType) {
    query += " AND event_type = ?";
    bindings.push(eventType);
  }

  if (onlyUnread === "true") {
    query += " AND is_unread = 1";
  }

  if (afterId) {
    query += " AND id > ?";
    bindings.push(parseInt(afterId, 10));
  }

  query += " ORDER BY created_at DESC LIMIT ?";
  bindings.push(limit);

  const { results } = await c.env.DB.prepare(query).bind(...bindings).all();

  // Parse details_json defensively so one malformed row does not break polling.
  const eventsWithDetails = results.map((row: any) => {
    let details: unknown = null;
    if (row.details_json) {
      try {
        details = JSON.parse(row.details_json);
      } catch {
        details = null;
      }
    }
    return {
      ...row,
      details,
    };
  });

  return c.json(eventsWithDetails);
});

app.delete("/api/events/:id", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const rawId = c.req.param("id");
  const eventId = parseInt(rawId, 10);

  if (!Number.isInteger(eventId) || eventId <= 0) {
    return c.json({ error: "Invalid event id" }, 400);
  }

  // Safety: only allow deleting THIS user's own alert events.
  const eventRow = await c.env.DB.prepare(
    `SELECT id, event_type, details_json
     FROM events
     WHERE id = ? AND user_id = ?
     LIMIT 1`
  )
    .bind(eventId, user.id)
    .first();

  if (!eventRow) {
    return c.json({ error: "Event not found" }, 404);
  }

  const eventType = String((eventRow as any)?.event_type || "").trim().toLowerCase();
  if (eventType !== "job_alert_triggered" && eventType !== "ai_detection") {
    return c.json({ error: "Only dashboard alert events can be deleted from this action" }, 400);
  }

  let details: Record<string, any> | null = null;
  if ((eventRow as any)?.details_json) {
    try {
      const parsed = JSON.parse((eventRow as any).details_json);
      details = parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      details = null;
    }
  }

  if (eventType === "ai_detection") {
    const readString = (...values: any[]): string | null => {
      for (const value of values) {
        if (typeof value !== "string") continue;
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
      return null;
    };

    const extractFilename = (value: string | null): string | null => {
      if (!value) return null;
      let raw = value.trim();
      if (!raw) return null;
      try {
        if (/^https?:\/\//i.test(raw)) {
          raw = new URL(raw).pathname || raw;
        }
      } catch {
        // Keep raw path if URL parsing fails.
      }
      raw = raw.split("?")[0]?.split("#")[0] || raw;
      const tokens = raw.split(/[\\/]/).filter(Boolean);
      if (tokens.length === 0) return null;
      const name = tokens[tokens.length - 1].trim();
      return name || null;
    };

    const r2DeleteKeys = new Set<string>();
    const addR2Key = (value: string | null, kind: "image" | "video") => {
      const filename = extractFilename(value);
      if (!filename) return;
      if (kind === "video") {
        r2DeleteKeys.add(`detections_videos/${filename}`);
      } else {
        r2DeleteKeys.add(`detections/${filename}`);
      }
    };

    addR2Key(
      readString(
        details?.video_key,
        details?.videoKey,
        details?.clip_path,
        details?.clipPath,
        details?.video_url,
        details?.videoUrl
      ),
      "video"
    );
    addR2Key(
      readString(
        details?.image_key,
        details?.imageKey,
        details?.image_path,
        details?.imagePath,
        details?.image_url,
        details?.imageUrl
      ),
      "image"
    );
    if (Array.isArray(details?.group_image_urls)) {
      for (const entry of details.group_image_urls) {
        if (!entry || typeof entry !== "object") continue;
        addR2Key(
          readString(
            (entry as any)?.image_key,
            (entry as any)?.imageKey,
            (entry as any)?.image_url,
            (entry as any)?.imageUrl
          ),
          "image"
        );
      }
    }

    const { results: linkedDetections } = await c.env.DB.prepare(
      `SELECT id, image_key, video_key
       FROM detections
       WHERE event_id = ? AND user_id = ?`
    )
      .bind(eventId, user.id)
      .all();

    for (const row of linkedDetections || []) {
      addR2Key(readString((row as any)?.image_key), "image");
      addR2Key(readString((row as any)?.video_key), "video");
    }

    for (const key of r2DeleteKeys) {
      try {
        await c.env.R2_BUCKET.delete(key);
      } catch (error) {
        console.warn("[DELETE EVENT] Failed to delete R2 object:", key, error);
      }
    }

    const localPathCandidates = new Set<string>();
    const addLocalPath = (value: string | null) => {
      if (!value) return;
      const trimmed = value.trim();
      if (!trimmed) return;
      localPathCandidates.add(trimmed);
    };

    addLocalPath(readString(details?.backend_image_path, details?.backendImagePath));
    addLocalPath(readString(details?.backend_clip_path, details?.backendClipPath));
    addLocalPath(readString(details?.image_path, details?.imagePath));
    addLocalPath(readString(details?.clip_path, details?.clipPath));
    addLocalPath(readString(details?.image_url, details?.imageUrl));
    addLocalPath(readString(details?.video_url, details?.videoUrl));

    if (localPathCandidates.size > 0) {
      try {
        const fs = await import("node:fs");
        const pathMod = await import("node:path");

        const allowedRoots = [
          ...brand.dataPaths.mediaBaseDirCandidates,
          String(c.env.LOCAL_MEDIA_BASE_DIR || "").trim(),
        ].filter((entry) => !!entry);

        const resolvedRoots = allowedRoots.map((root) => pathMod.resolve(root));
        const preferredRelativeRoot = resolvedRoots.length > 0 ? resolvedRoots[0] : null;
        for (const candidate of localPathCandidates) {
          const resolvedCandidate = pathMod.isAbsolute(candidate)
            ? pathMod.resolve(candidate)
            : preferredRelativeRoot
            ? pathMod.resolve(preferredRelativeRoot, candidate)
            : "";
          if (!resolvedCandidate) continue;
          const allowed = resolvedRoots.some((rootPath) => {
            const normalizedRoot = rootPath.toLowerCase();
            const normalizedCandidate = resolvedCandidate.toLowerCase();
            return (
              normalizedCandidate === normalizedRoot ||
              normalizedCandidate.startsWith(normalizedRoot + pathMod.sep.toLowerCase())
            );
          });
          if (!allowed) continue;
          try {
            const stat = fs.statSync(resolvedCandidate);
            if (stat.isFile()) {
              fs.unlinkSync(resolvedCandidate);
            }
          } catch {
            // Ignore missing or inaccessible local files.
          }
        }
      } catch {
        // Ignore if filesystem API is unavailable in this runtime.
      }
    }

    await c.env.DB.prepare(
      `DELETE FROM detections
       WHERE event_id = ? AND user_id = ?`
    )
      .bind(eventId, user.id)
      .run();

    await c.env.DB.prepare(
      `DELETE FROM notifications
       WHERE event_id = ? AND user_id = ?`
    )
      .bind(eventId, user.id)
      .run();
  }

  const deleteResult = await c.env.DB.prepare(
    `DELETE FROM events
     WHERE id = ? AND user_id = ?
       AND event_type IN ('job_alert_triggered', 'ai_detection')`
  )
    .bind(eventId, user.id)
    .run();

  const deletedCount = Number((deleteResult as any)?.meta?.changes ?? 0);
  if (deletedCount < 1) {
    return c.json({ error: "Event could not be deleted" }, 409);
  }

  return c.json({ success: true, deleted_id: eventId, deleted_event_type: eventType });
});

app.post("/api/events/mark-read", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  
  let body: { event_type?: string; ids?: number[] } = {};
  try {
    body = await c.req.json<{ event_type?: string; ids?: number[] }>();
  } catch {
    // Empty body is fine - will mark all as read
  }

  if (body.ids && Array.isArray(body.ids) && body.ids.length > 0) {
    // Mark specific events by IDs
    const placeholders = body.ids.map(() => "?").join(", ");
    await c.env.DB.prepare(
      `UPDATE events
       SET is_unread = 0, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND id IN (${placeholders})`
    )
      .bind(user.id, ...body.ids)
      .run();
  } else if (body.event_type) {
    // Mark all events of specific type
    await c.env.DB.prepare(
      `UPDATE events
       SET is_unread = 0, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND event_type = ? AND is_unread = 1`
    )
      .bind(user.id, body.event_type)
      .run();
  } else {
    // Mark all unread events
    await c.env.DB.prepare(
      `UPDATE events
       SET is_unread = 0, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND is_unread = 1`
    )
      .bind(user.id)
      .run();
  }

  return c.json({ success: true });
});

// Notification endpoints
app.get("/api/notifications/unread-count", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  const result = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`
  )
    .bind(user.id)
    .first();

  const count = (result as any)?.count || 0;
  const etag = `"unread-${user.id}-${count}"`;
  
  // Check If-None-Match for conditional GET
  const ifNoneMatch = c.req.header("if-none-match");
  if (ifNoneMatch === etag) {
    return c.body(null, {
      status: 304,
      headers: {
        "etag": etag,
        "cache-control": "private, no-cache, max-age=0, must-revalidate",
      },
    });
  }

  return c.json({ count }, {
    headers: {
      "etag": etag,
      "cache-control": "private, no-cache, max-age=0, must-revalidate",
    },
  });
});

app.get("/api/notifications", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
  )
    .bind(user.id)
    .all();

  return c.json(results);
});

app.post("/api/notifications/mark-read", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<{ ids?: number[]; all?: boolean }>();

  if (body.all) {
    // Mark all notifications as read
    await c.env.DB.prepare(
      `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`
    )
      .bind(user.id)
      .run();
  } else if (body.ids && body.ids.length > 0) {
    // Mark specific notifications as read
    const placeholders = body.ids.map(() => "?").join(", ");
    await c.env.DB.prepare(
      `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${placeholders})`
    )
      .bind(user.id, ...body.ids)
      .run();
  }

  return c.json({ success: true });
});

// Detections endpoints
app.get("/api/detections", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM detections WHERE user_id = ? ORDER BY detected_at DESC LIMIT ? OFFSET ?`
  )
    .bind(user.id, limit, offset)
    .all();

  const detections = (results || []).map((row: any) => {
    const detection: any = {
      id: row.id,
      camera_id: row.camera_id,
      camera_name: row.camera_name,
      algo_type: row.algo_type,
      detected_at: row.detected_at,
      event_id: row.event_id,
      media_type: row.media_type || "image",
    };
    
    // Add media URLs based on what's available
    if (row.video_key) {
      detection.video_url = `/api/detections/${row.video_key}`;
    }
    if (row.image_key) {
      detection.image_url = `/api/detections/${row.image_key}`;
    }
    
    return detection;
  });

  return c.json({ detections });
});

// Share detection via email
app.post("/api/detections/:id/share", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const detectionId = c.req.param("id");

  try {
    // Fetch detection record
    const detection = await c.env.DB.prepare(
      `SELECT * FROM detections WHERE id = ? AND user_id = ?`
    )
      .bind(detectionId, user.id)
      .first();

    if (!detection) {
      return c.json({ error: "Detection not found" }, 404);
    }

    const det = detection as any;

    // Format detection details for email
    const subject = `${brand.emailSubjectPrefix} AI Detection "${det.algo_type}" on camera "${det.camera_name}"`;
    const detectionUrl = `${c.req.header("origin")}/events?type=detection&eventId=${det.event_id}`;
    const imageUrl = `${c.req.header("origin")}/api/detections/${det.image_key}`;

    const emailBody = `
Here's your AI detection from ${brand.displayName}:

Detection Details:
- Camera Name: ${det.camera_name}
- Camera ID: #${det.camera_id}
- Algorithm/Detection Type: ${det.algo_type}
- Detection Result: YES
- Timestamp: ${new Date(det.detected_at).toLocaleString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    })}
- Event ID: #${det.event_id}

View this detection in your dashboard: ${detectionUrl}

Detection frame image: ${imageUrl}
`;

    // TODO: Integrate with email service (SendGrid, AWS SES, etc.)
    // For now, we'll log the email details
    console.log("[EMAIL] Would send email to:", user.email);
    console.log("[EMAIL] Subject:", subject);
    console.log("[EMAIL] Body:", emailBody);

    // Since no email service is configured, return error with helpful message
    return c.json({
      error:
        "Email service not configured. Please use the download feature instead.",
    }, 501);
  } catch (error) {
    console.error("Failed to share detection:", error);
    return c.json({ error: "Failed to share detection" }, 500);
  }
});

// Export detection for download as ZIP
app.get("/api/detections/:id/export", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const detectionId = c.req.param("id");

  try {
    // Fetch detection record
    const detection = await c.env.DB.prepare(
      `SELECT * FROM detections WHERE id = ? AND user_id = ?`
    )
      .bind(detectionId, user.id)
      .first();

    if (!detection) {
      return c.json({ error: "Detection not found" }, 404);
    }

    const det = detection as any;

    // Fetch the JPEG frame from R2
    const imageObject = await c.env.R2_BUCKET.get(`detections/${det.image_key}`);
    
    if (!imageObject) {
      return c.json({ error: "Detection frame not found" }, 404);
    }

    const imageBytes = await imageObject.arrayBuffer();

    // Build metadata object
    const metadata = {
      camera_name: det.camera_name,
      camera_id: det.camera_id,
      algorithm: det.algo_type,
      detection_result: "YES",
      timestamp: det.detected_at,
      event_id: det.event_id,
    };

    // Import JSZip dynamically
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    // Add files to ZIP
    zip.file("frame.jpg", imageBytes);
    zip.file("metadata.json", JSON.stringify(metadata, null, 2));

    // Generate ZIP buffer
    const zipBuffer = await zip.generateAsync({ type: "arraybuffer" });

    // Return ZIP file
    return c.body(zipBuffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="detection_${detectionId}.zip"`,
      },
    });
  } catch (error) {
    console.error("Failed to export detection:", error);
    return c.json({ error: "Failed to export detection" }, 500);
  }
});

// User preferences endpoints
app.get("/api/preferences", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  let prefs = await c.env.DB.prepare(
    "SELECT * FROM user_preferences WHERE user_id = ?"
  )
    .bind(user.id)
    .first();

  if (!prefs) {
    await c.env.DB.prepare(
      "INSERT INTO user_preferences (user_id, theme, language) VALUES (?, 'dark', 'en')"
    )
      .bind(user.id)
      .run();

    prefs = await c.env.DB.prepare(
      "SELECT * FROM user_preferences WHERE user_id = ?"
    )
      .bind(user.id)
      .first();
  }

  return c.json(prefs);
});

app.patch("/api/preferences", anyAuthMiddleware, zValidator("json", UpdatePreferencesSchema), async (c) => {
  const user = c.get("user")!;
  const data = c.req.valid("json");

  const updates: string[] = [];
  const values: any[] = [];

  Object.entries(data).forEach(([key, value]) => {
    updates.push(`${key} = ?`);
    values.push(value);
  });

  if (updates.length > 0) {
    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(user.id);

    await c.env.DB.prepare(
      `UPDATE user_preferences SET ${updates.join(", ")} WHERE user_id = ?`
    )
      .bind(...values)
      .run();
  }

  const prefs = await c.env.DB.prepare(
    "SELECT * FROM user_preferences WHERE user_id = ?"
  )
    .bind(user.id)
    .first();

  return c.json(prefs);
});

// OpenAI settings endpoints
app.get("/api/openai-settings", anyAuthMiddleware, async (c) => {
  await ensureSchema(c.env.DB);

  const user = c.get("user")!;
  const apiKey = await getUserOpenAIApiKey(c.env.DB, user.id);

  return c.json({
    has_key: apiKey.length > 0,
    api_key_preview: maskOpenAIApiKeyPreview(apiKey),
  });
});

app.post("/api/openai-settings", anyAuthMiddleware, async (c) => {
  await ensureSchema(c.env.DB);

  const user = c.get("user")!;
  const body = await c.req
    .json<{
      api_key?: string;
      clear?: boolean;
    }>()
    .catch(() => null);

  if (!body) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const clear = Boolean(body.clear);
  const apiKey = clear ? "" : normalizeOpenAIApiKeyInput(body.api_key);
  if (!clear && !apiKey) {
    return c.json({ error: "api_key is required" }, 400);
  }

  const now = new Date().toISOString();
  const existing = await c.env.DB
    .prepare("SELECT id FROM openai_settings WHERE user_id = ?")
    .bind(user.id)
    .first();

  if (existing) {
    await c.env.DB
      .prepare(
        `UPDATE openai_settings
         SET api_key = ?, updated_at = ?
         WHERE user_id = ?`
      )
      .bind(apiKey, now, user.id)
      .run();
  } else {
    const id = generateUUID();
    await c.env.DB
      .prepare(
        `INSERT INTO openai_settings (id, user_id, api_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, user.id, apiKey, now, now)
      .run();
  }

  return c.json({
    has_key: apiKey.length > 0,
    api_key_preview: maskOpenAIApiKeyPreview(apiKey),
  });
});

// Z.ai settings endpoints
app.get("/api/zai-settings", anyAuthMiddleware, async (c) => {
  await ensureSchema(c.env.DB);

  const user = c.get("user")!;
  const apiKey = await getUserZAIApiKey(c.env.DB, user.id);

  return c.json({
    has_key: apiKey.length > 0,
    api_key_preview: maskZAIApiKeyPreview(apiKey),
  });
});

app.post("/api/zai-settings", anyAuthMiddleware, async (c) => {
  await ensureSchema(c.env.DB);

  const user = c.get("user")!;
  const body = await c.req
    .json<{
      api_key?: string;
      clear?: boolean;
    }>()
    .catch(() => null);

  if (!body) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const clear = Boolean(body.clear);
  const apiKey = clear ? "" : normalizeZAIApiKeyInput(body.api_key);
  if (!clear && !apiKey) {
    return c.json({ error: "api_key is required" }, 400);
  }

  const now = new Date().toISOString();
  const existing = await c.env.DB
    .prepare("SELECT id FROM zai_settings WHERE user_id = ?")
    .bind(user.id)
    .first();

  if (existing) {
    await c.env.DB
      .prepare(
        `UPDATE zai_settings
         SET api_key = ?, updated_at = ?
         WHERE user_id = ?`
      )
      .bind(apiKey, now, user.id)
      .run();
  } else {
    const id = generateUUID();
    await c.env.DB
      .prepare(
        `INSERT INTO zai_settings (id, user_id, api_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, user.id, apiKey, now, now)
      .run();
  }

  return c.json({
    has_key: apiKey.length > 0,
    api_key_preview: maskZAIApiKeyPreview(apiKey),
  });
});

// Telegram settings endpoints
app.get("/api/telegram-settings", anyAuthMiddleware, async (c) => {
  await ensureSchema(c.env.DB);
  
  const user = c.get("user")!;

  const settings = await c.env.DB.prepare(
    "SELECT * FROM telegram_settings WHERE user_id = ?"
  )
    .bind(user.id)
    .first();

  if (!settings) {
    // Return default values if no settings exist yet
    return c.json({
      enabled: 0,
      chat_id: "",
      bot_token: "",
    });
  }

  const s = settings as any;
  return c.json({
    enabled: s.enabled || 0,
    chat_id: s.chat_id || "",
    bot_token: s.bot_token || "",
  });
});

app.post("/api/telegram-settings", anyAuthMiddleware, async (c) => {
  await ensureSchema(c.env.DB);
  
  const user = c.get("user")!;
  const body = await c.req.json<{
    enabled: boolean;
    chat_id: string;
    bot_token: string;
  }>();

  const now = new Date().toISOString();
  const enabled = body.enabled ? 1 : 0;
  const chatId = (body.chat_id || "").trim();
  const botToken = (body.bot_token || "").trim();

  // Check if settings exist
  const existing = await c.env.DB.prepare(
    "SELECT * FROM telegram_settings WHERE user_id = ?"
  )
    .bind(user.id)
    .first();

  if (existing) {
    // Update existing settings
    await c.env.DB.prepare(
      `UPDATE telegram_settings 
       SET enabled = ?, chat_id = ?, bot_token = ?, updated_at = ?
       WHERE user_id = ?`
    )
      .bind(enabled, chatId, botToken, now, user.id)
      .run();
  } else {
    // Insert new settings
    const id = generateUUID();
    await c.env.DB.prepare(
      `INSERT INTO telegram_settings (id, user_id, enabled, profile, chat_id, bot_token, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, ?, ?, ?)`
    )
      .bind(id, user.id, enabled, chatId, botToken, now, now)
      .run();
  }

  // Return the saved settings
  return c.json({
    enabled,
    chat_id: chatId,
    bot_token: botToken,
  });
});

// Billing status endpoint
app.get("/api/billing/status", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  // Check for active subscription
  const activeSubscription = await c.env.DB.prepare(
    "SELECT * FROM subscriptions WHERE user_id = ? AND is_active = 1 LIMIT 1"
  )
    .bind(user.id)
    .first();

  // Check for active card
  const activeCard = await c.env.DB.prepare(
    "SELECT * FROM active_cards WHERE user_id = ? LIMIT 1"
  )
    .bind(user.id)
    .first();

  // Count currently running cameras
  const activeCountRow = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM cameras WHERE user_id = ? AND is_service_running = 1"
  )
    .bind(user.id)
    .first();

  const activeCamerasCount = activeCountRow ? Number((activeCountRow as any).count ?? 0) : 0;

  // Build subscription metadata if available
  let subscriptionData = null;
  if (activeSubscription) {
    const sub = activeSubscription as any;
    subscriptionData = {
      model_tier: sub.model_tier ?? sub.plan_tier ?? "light",
      camera_limit: sub.camera_count ?? sub.max_cameras ?? 1,
      seconds_per_frame: sub.seconds_per_frame ?? 3,
    };
  }

  return c.json({
    hasActiveSubscription: !!activeSubscription,
    hasActiveCard: !!activeCard,
    canAddCameras: !!activeSubscription || !!activeCard,
    subscription: subscriptionData,
    active_cameras: activeCamerasCount,
  });
});

// Token balance endpoints
app.get("/api/token-balance", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  let balance = await c.env.DB.prepare(
    "SELECT * FROM token_balances WHERE user_id = ?"
  )
    .bind(user.id)
    .first();

  if (!balance) {
    await c.env.DB.prepare(
      "INSERT INTO token_balances (user_id, balance, input_balance, output_balance, total_spent) VALUES (?, 0, 0, 0, 0)"
    )
      .bind(user.id)
      .run();

    balance = await c.env.DB.prepare(
      "SELECT * FROM token_balances WHERE user_id = ?"
    )
      .bind(user.id)
      .first();
  }

  const b = balance as any;
  const etag = `"balance-${user.id}-${b.input_balance}-${b.output_balance}"`;
  
  // Check If-None-Match for conditional GET
  const ifNoneMatch = c.req.header("if-none-match");
  if (ifNoneMatch === etag) {
    return c.body(null, {
      status: 304,
      headers: {
        "etag": etag,
        "cache-control": "private, no-cache, max-age=0, must-revalidate",
      },
    });
  }

  return c.json(balance, {
    headers: {
      "etag": etag,
      "cache-control": "private, no-cache, max-age=0, must-revalidate",
    },
  });
});

// Authenticated hit image streaming endpoint
app.get("/api/chat/hit-image", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const key = c.req.query("key");

  if (!key) {
    return c.json({ error: "key parameter is required" }, 400);
  }

  // Verify ownership and load stored media metadata.
  const record = await c.env.DB.prepare(
    `SELECT media_type, mime_type
       FROM chat_hit_images
      WHERE user_id = ? AND r2_key = ?
      LIMIT 1`
  )
    .bind(user.id, key)
    .first();

  if (!record) {
    return c.json({ error: "Media not found or access denied" }, 404);
  }

  try {
    const object = await c.env.R2_BUCKET.get(key);

    if (!object) {
      return c.json({ error: "Media not found in storage" }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    // Keep R2 mime when available; fallback to DB metadata if missing.
    if (!headers.get("content-type")) {
      const mimeType = (record as any)?.mime_type as string | undefined;
      const mediaType = (record as any)?.media_type as string | undefined;
      const fallbackMime =
        mimeType ||
        (mediaType === "video" ? "video/mp4" : "image/jpeg");
      headers.set("content-type", fallbackMime);
    }
    headers.set("cache-control", "private, max-age=3600");
    headers.set("etag", object.httpEtag);

    return c.body(object.body, { headers });
  } catch (error) {
    console.error("Failed to fetch hit media:", error);
    return c.json({ error: "Failed to fetch media" }, 500);
  }
});

// Chat hit media endpoint - NEW unified endpoint
app.get("/api/chat/sessions/:sessionId/hit-media", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const sessionId = c.req.param("sessionId");

  const session = await c.env.DB.prepare(
    "SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?"
  )
    .bind(sessionId, user.id)
    .first();

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT r2_key, time_in_video, media_type, mime_type, camera_id, created_at 
     FROM chat_hit_images 
     WHERE user_id = ? AND chat_session_id = ? 
     ORDER BY created_at ASC, id ASC`
  )
    .bind(user.id, sessionId)
    .all();

  const items = (results || []).map((row: any) => {
    const url = c.env.R2_PUBLIC_BASE_URL 
      ? `${c.env.R2_PUBLIC_BASE_URL}/${row.r2_key}`
      : `/api/chat/hit-image?key=${encodeURIComponent(row.r2_key)}`;
    
    return {
      media_type: row.media_type || "image",
      mime_type: row.mime_type,
      key: row.r2_key,
      url,
      time_in_video: row.time_in_video,
      camera_id: row.camera_id,
    };
  });

  return c.json({ ok: true, items });
});

// Chat hit images endpoint - LEGACY - kept for backwards compatibility, returns only images
app.get("/api/chat/sessions/:sessionId/hit-images", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const sessionId = c.req.param("sessionId");

  const session = await c.env.DB.prepare(
    "SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?"
  )
    .bind(sessionId, user.id)
    .first();

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT r2_key, time_in_video, created_at 
     FROM chat_hit_images 
     WHERE user_id = ? AND chat_session_id = ? AND media_type = 'image'
     ORDER BY created_at ASC, id ASC`
  )
    .bind(user.id, sessionId)
    .all();

  const images = (results || []).map((row: any) => {
    const url = c.env.R2_PUBLIC_BASE_URL 
      ? `${c.env.R2_PUBLIC_BASE_URL}/${row.r2_key}`
      : `/api/chat/hit-image?key=${encodeURIComponent(row.r2_key)}`;
    
    return {
      key: row.r2_key,
      url,
      time_in_video: row.time_in_video,
    };
  });

  return c.json({ ok: true, images });
});

// Chat session endpoints
app.get("/api/chat/sessions", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY created_at DESC"
  )
    .bind(user.id)
    .all();

  return c.json(results);
});

app.post("/api/chat/sessions", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<{ title?: string }>();
  
  const now = new Date().toISOString();
  const explicitTitle = typeof body.title === "string" ? body.title.trim() : "";

  // If no explicit title is provided, reuse the newest empty session instead of creating another.
  // This prevents infinite accumulation of empty chats when users open/close Chat repeatedly.
  if (!explicitTitle) {
    const newestEmptySession = await c.env.DB.prepare(
      `SELECT s.*
       FROM chat_sessions s
       WHERE s.user_id = ?
         AND NOT EXISTS (
           SELECT 1
           FROM chat_messages m
           WHERE m.session_id = s.id
             AND m.user_id = s.user_id
         )
       ORDER BY s.created_at DESC
       LIMIT 1`
    )
      .bind(user.id)
      .first();

    if (newestEmptySession) {
      // Keep only the newest empty session; remove any older empty duplicates.
      await c.env.DB.prepare(
        `DELETE FROM chat_sessions
         WHERE user_id = ?
           AND id <> ?
           AND NOT EXISTS (
             SELECT 1
             FROM chat_messages m
             WHERE m.session_id = chat_sessions.id
               AND m.user_id = chat_sessions.user_id
           )`
      )
        .bind(user.id, (newestEmptySession as any).id)
        .run();

      return c.json(newestEmptySession, 200);
    }
  }
  
  // If no title provided, generate "New chat X" with auto-incrementing number
  let title = explicitTitle || body.title;
  if (!title) {
    // Count existing "New chat" sessions for this user
    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM chat_sessions 
       WHERE user_id = ? AND title LIKE 'New chat%'`
    )
      .bind(user.id)
      .first();
    
    const count = (countResult as any)?.count || 0;
    title = `New chat ${count + 1}`;
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO chat_sessions (user_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?)`
  )
    .bind(user.id, title, now, now)
    .run();

  const session = await c.env.DB.prepare(
    "SELECT * FROM chat_sessions WHERE id = ?"
  )
    .bind(result.meta.last_row_id)
    .first();

  return c.json(session, 201);
});

app.patch("/api/chat/sessions/:id", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const sessionId = c.req.param("id");
  const body = await c.req.json<{ title: string }>();

  const session = await c.env.DB.prepare(
    "SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?"
  )
    .bind(sessionId, user.id)
    .first();

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  const title = body.title?.trim() || "Untitled chat";

  await c.env.DB.prepare(
    `UPDATE chat_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`
  )
    .bind(title, sessionId, user.id)
    .run();

  const updatedSession = await c.env.DB.prepare(
    "SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?"
  )
    .bind(sessionId, user.id)
    .first();

  return c.json(updatedSession);
});

app.delete("/api/chat/sessions/:id", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const sessionId = c.req.param("id");

  const session = await c.env.DB.prepare(
    "SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?"
  )
    .bind(sessionId, user.id)
    .first();

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  // Delete all messages for this session
  await c.env.DB.prepare(
    "DELETE FROM chat_messages WHERE session_id = ? AND user_id = ?"
  )
    .bind(sessionId, user.id)
    .run();

  // Delete the session
  await c.env.DB.prepare(
    "DELETE FROM chat_sessions WHERE id = ? AND user_id = ?"
  )
    .bind(sessionId, user.id)
    .run();

  return c.json({ success: true });
});

app.get("/api/chat/sessions/:id/messages", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const sessionId = c.req.param("id");

  const session = await c.env.DB.prepare(
    "SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?"
  )
    .bind(sessionId, user.id)
    .first();

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM chat_messages WHERE user_id = ? AND session_id = ? ORDER BY id ASC"
  )
    .bind(user.id, sessionId)
    .all();

  return c.json(results);
});

app.post("/api/chat/sessions/:id/messages", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const sessionId = c.req.param("id");
  const body = await c.req.json<{
    content: string;
    camera_id?: number;
    uploaded_image_base64?: string | null;
    uploaded_video_id?: number | null;
    model_tier?: string;
    model_fps?: number;
    running_resolution?: number | null;
    chat_mode?: string | null;
  }>();

  const session = await c.env.DB.prepare(
    "SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?"
  )
    .bind(sessionId, user.id)
    .first();

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  const normalizedChatModelTier = normalizeChatModelTier(body.model_tier);
  const userOpenAiApiKey = await getUserOpenAIApiKey(c.env.DB, user.id);
  const userZAiApiKey = await getUserZAIApiKey(c.env.DB, user.id);
  const chatRouterRuntimeConfig = await loadChatModelRuntimeConfig(c.env.DB, "legacy");
  const chatModelApiKey = normalizedChatModelTier === "core" ? userZAiApiKey : userOpenAiApiKey;
  const normalizedChatModelFps = normalizeChatModelFps(body.model_fps, normalizedChatModelTier);
  const normalizedChatRunningResolution =
    normalizedChatModelTier === "core"
      ? normalizeChatRunningResolution(body.running_resolution)
      : null;
  const chatV2Enabled = isChatV2EnabledForRequest(c.env, body.chat_mode);

  if (!chatV2Enabled && !chatModelApiKey) {
    return c.json(
      normalizedChatModelTier === "core"
        ? buildZAiKeyRequiredErrorBody()
        : buildOpenAiKeyRequiredErrorBody(),
      400
    );
  }

  if (!chatV2Enabled && !chatRouterRuntimeConfig.apiKey) {
    return c.json(
      {
        error: "Router Gemini API key is not configured in model_api_keys for tier 'legacy'.",
      },
      400
    );
  }

  // Check if user can use chat (has subscription OR tokens OR active payment method)
  const activeSubscription = await c.env.DB.prepare(
    "SELECT * FROM subscriptions WHERE user_id = ? AND is_active = 1 LIMIT 1"
  )
    .bind(user.id)
    .first();

  const balance = await c.env.DB.prepare(
    "SELECT * FROM token_balances WHERE user_id = ?"
  )
    .bind(user.id)
    .first();

  const activeCard = await c.env.DB.prepare(
    "SELECT * FROM active_cards WHERE user_id = ? LIMIT 1"
  )
    .bind(user.id)
    .first();

  const hasSubscription = !!activeSubscription;
  const hasTokens = balance && (balance as any).balance > 0;
  const hasActiveCard = !!activeCard;

  if (!chatV2Enabled && !hasSubscription && !hasTokens && !hasActiveCard) {
    return c.json({ error: `You need either a subscription, chat tokens, or an active payment method to use ${brand.chatName}.` }, 402);
  }

  let videoSearchBlockReason: string | null = null;
  let videoSearchBlockMessage: string | null = null;
  if (!chatModelApiKey) {
    videoSearchBlockReason = normalizedChatModelTier === "core" ? "ZAI_KEY_REQUIRED" : "OPENAI_KEY_REQUIRED";
    videoSearchBlockMessage =
      normalizedChatModelTier === "core"
        ? "Z.ai API key is required in Settings before using video search."
        : "OpenAI API key is required in Settings before using video search.";
  } else if (!chatRouterRuntimeConfig.apiKey) {
    videoSearchBlockReason = "ROUTER_API_KEY_REQUIRED";
    videoSearchBlockMessage =
      "Router Gemini API key is not configured in model_api_keys for tier 'legacy'.";
  } else if (!hasSubscription && !hasTokens && !hasActiveCard) {
    videoSearchBlockReason = "VIDEO_SEARCH_ACCESS_REQUIRED";
    videoSearchBlockMessage = `You need either a subscription, chat tokens, or an active payment method to use ${brand.chatName} video search.`;
  }
  const videoSearchAllowed = !videoSearchBlockReason;

  const now = new Date().toISOString();

  // Handle uploaded video reference
  let uploadedVideoUrl: string | null = null;
  if (body.uploaded_video_id) {
    console.log("[CHAT MESSAGE] Looking up video upload ID:", body.uploaded_video_id);
    
    const videoUpload = await c.env.DB.prepare(
      "SELECT * FROM video_uploads WHERE id = ? AND user_id = ?"
    )
      .bind(body.uploaded_video_id, user.id)
      .first();

    if (videoUpload) {
      uploadedVideoUrl = (videoUpload as any).public_url;
      console.log("[CHAT MESSAGE] ✓ Found video upload. URL:", uploadedVideoUrl);
    } else {
      console.log("[CHAT MESSAGE] WARNING: Video upload not found for ID:", body.uploaded_video_id);
    }
  }

  // Store user message with video metadata
  const videoMetadata = body.uploaded_video_id ? JSON.stringify({
    uploaded_video_id: body.uploaded_video_id,
    uploaded_video_url: uploadedVideoUrl,
  }) : null;

  await c.env.DB.prepare(
    `INSERT INTO chat_messages (user_id, session_id, role, content, camera_ids, tokens_used, message_type, uploaded_image_base64, camera_selection_json, created_at, updated_at)
     VALUES (?, ?, 'user', ?, ?, 0, 'final', ?, ?, ?, ?)`
  )
    .bind(
      user.id, 
      sessionId, 
      body.content, 
      body.camera_id ? String(body.camera_id) : null, 
      body.uploaded_image_base64 || null,
      videoMetadata,
      now, 
      now
    )
    .run();

  // Auto-rename session using the first user message snippet
  const sess = session as any;
  if (isAutoGeneratedChatTitle(sess.title)) {
    // Check if this is the first user message in this session
    const messageCount = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM chat_messages 
       WHERE session_id = ? AND role = 'user'`
    )
      .bind(sessionId)
      .first();
    
    const count = Number((messageCount as any)?.count ?? 0);
    
    if (count <= 1) {
      // This is the first message, auto-rename based on content snippet
      const titleFromMessage = buildChatSessionTitleFromFirstMessage(body.content);
      
      await c.env.DB.prepare(
        `UPDATE chat_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      )
        .bind(titleFromMessage, sessionId)
        .run();
    }
  }

  // Fetch user's language preference
  const userPrefs = await c.env.DB.prepare(
    "SELECT language FROM user_preferences WHERE user_id = ?"
  )
    .bind(user.id)
    .first();
  
  const appLanguage = normalizeSupportedChatLanguage((userPrefs as any)?.language || "en", "en");
  const queryLanguageInfo = detectChatMessageLanguage(body.content, "en");
  const queryLanguage = queryLanguageInfo.language;
  const latestConnectedPairing = await c.env.DB.prepare(
    `SELECT *
     FROM exe_pairings
     WHERE user_id = ? AND status = 'connected'
     ORDER BY COALESCE(last_seen_at, paired_at) DESC
     LIMIT 1`
  )
    .bind(user.id)
    .first();
  const chatDesktopAgentAvailability = buildChatDesktopAgentAvailability(latestConnectedPairing || null);

  if (!chatDesktopAgentAvailability.is_available_for_chat) {
    const desktopAgentStatus =
      chatDesktopAgentAvailability.chat_effective_status === "stale" ? "stale" : "offline";
    const unavailableMessage = buildChatCancellationMessage(queryLanguage, desktopAgentStatus);

    await c.env.DB.prepare(
      `INSERT INTO chat_messages (
         user_id,
         session_id,
         role,
         content,
         camera_ids,
         tokens_used,
         message_type,
         is_pending,
         created_at,
         updated_at
       )
       VALUES (?, ?, 'assistant', ?, NULL, 0, 'final', 0, ?, ?)`
    )
      .bind(user.id, sessionId, unavailableMessage, now, now)
      .run();

    await c.env.DB.prepare(
      `UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    )
      .bind(sessionId)
      .run();

    const { results } = await c.env.DB.prepare(
      "SELECT * FROM chat_messages WHERE user_id = ? AND session_id = ? ORDER BY id ASC"
    )
      .bind(user.id, sessionId)
      .all();

    return c.json({
      messages: results,
      warning: unavailableMessage,
      warning_code:
        desktopAgentStatus === "stale" ? "DESKTOP_AGENT_STALE" : "DESKTOP_AGENT_OFFLINE",
      warning_details: {
        status: desktopAgentStatus,
        last_seen_at: chatDesktopAgentAvailability.last_seen_at,
        last_seen_age_seconds: chatDesktopAgentAvailability.last_seen_age_seconds,
      },
      desktop_agent_status: desktopAgentStatus,
    });
  }

  let coreModelContentionWarning:
    | {
        code: string;
        message: string;
        details: {
          camera_agent_busy: boolean;
          running_job_busy: boolean;
          camera_id: number | null;
          camera_name: string | null;
          job_id: number | null;
          job_name: string | null;
        };
      }
    | null = null;
  if (normalizedChatModelTier === "core") {
    const activeCoreCameraAgent = await findEnabledCoreCameraAgentForUser(c.env.DB, user.id, {
      requireRunningCamera: true,
    });
    const runningCoreJob = await findRunningCoreJobForUser(c.env.DB, user.id);
    if (activeCoreCameraAgent || runningCoreJob) {
      coreModelContentionWarning = {
        code: CORE_MODEL_CHAT_CONTENTION_WARNING,
        message: buildCoreModelChatContentionWarning(queryLanguage, {
          cameraBusy: !!activeCoreCameraAgent,
          jobBusy: !!runningCoreJob,
        }),
        details: {
          camera_agent_busy: !!activeCoreCameraAgent,
          running_job_busy: !!runningCoreJob,
          camera_id: activeCoreCameraAgent?.camera_id ?? null,
          camera_name: activeCoreCameraAgent?.camera_name ?? null,
          job_id: runningCoreJob?.job_id ?? null,
          job_name: runningCoreJob?.job_name ?? null,
        },
      };
    }
  }

  // Create command for EXE to process with chat_session_id
  const chatQueryPayload = {
    query: body.content,
    chat_session_id: parseInt(sessionId),
    chat_mode: chatV2Enabled ? "v2" : "v1",
    camera_id: body.camera_id || null,
    app_language: appLanguage,
    ui_languages: ["en", "es", "pt", "fr", "zh", "ar"],
    uploaded_image_base64: body.uploaded_image_base64 || null,
    uploaded_video_id: body.uploaded_video_id || null,
    uploaded_video_url: uploadedVideoUrl,
    model_tier: normalizedChatModelTier,
    model_fps: normalizedChatModelFps,
    running_resolution: normalizedChatRunningResolution,
    model_api_key: chatModelApiKey || null,
    router_api_key: chatRouterRuntimeConfig.apiKey || null,
    video_search_allowed: videoSearchAllowed,
    video_search_block_reason: videoSearchBlockReason,
    video_search_block_message: videoSearchBlockMessage,
    registered_skills: [
      "video_search",
      "explain_app",
      "create_camera",
      "create_job",
      "create_camera_agent",
      "read_state",
    ],
  };
  const commandType = chatV2Enabled ? "orchestrator_query" : "chat_query";

  if (body.uploaded_video_id) {
    console.log(
      "[CHAT MESSAGE] Creating",
      commandType,
      "command with video. Video ID:",
      body.uploaded_video_id,
      "URL:",
      uploadedVideoUrl
    );
  }

  await c.env.DB.prepare(
    `INSERT INTO commands (user_id, camera_id, command_type, payload, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  )
    .bind(
      user.id,
      null,
      commandType,
      JSON.stringify(chatQueryPayload),
      now,
      now
    )
    .run();

  // Insert placeholder loading message (will be updated when pre-answer arrives from exe)
  await c.env.DB.prepare(
    `INSERT INTO chat_messages (user_id, session_id, role, content, camera_ids, tokens_used, message_type, is_pending, created_at, updated_at)
     VALUES (?, ?, 'assistant', 'Analyzing your request...', NULL, 0, 'pre_answer', 1, ?, ?)`
  )
    .bind(user.id, sessionId, now, now)
    .run();

  // Update session timestamp
  await c.env.DB.prepare(
    `UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  )
    .bind(sessionId)
    .run();

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM chat_messages WHERE user_id = ? AND session_id = ? ORDER BY id ASC"
  )
    .bind(user.id, sessionId)
    .all();

  return c.json({
    messages: results,
    warning: coreModelContentionWarning?.message || null,
    warning_code: coreModelContentionWarning?.code || null,
    warning_details: coreModelContentionWarning?.details || null,
  });
});

app.post("/api/chat/sessions/:sessionId/cancel", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const sessionId = parseInt(c.req.param("sessionId"), 10);
  const body = (await c.req.json<{ reason?: string }>().catch(() => ({}))) as {
    reason?: string;
  };

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return c.json({ error: "Invalid session id" }, 400);
  }

  const session = await c.env.DB.prepare(
    "SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?"
  )
    .bind(sessionId, user.id)
    .first();

  if (!session) {
    return c.json({ error: "Chat session not found" }, 404);
  }

  const now = new Date().toISOString();

  const languageRow = await c.env.DB.prepare(
    "SELECT language FROM user_preferences WHERE user_id = ?"
  )
    .bind(user.id)
    .first();
  const language = String((languageRow as any)?.language || "en").toLowerCase();
  const normalizedReason =
    typeof body?.reason === "string" ? body.reason.trim().toLowerCase() : "manual";
  const cancelledMessage =
    normalizedReason === "offline"
      ? language.startsWith("pt")
        ? "Nao consegui me comunicar com o aplicativo desktop nesta maquina. Abra o EXE e tente novamente."
        : language.startsWith("es")
        ? "No pude comunicarme con la app de escritorio en esta maquina. Abre el EXE e intentalo de nuevo."
        : language.startsWith("fr")
        ? "Impossible de communiquer avec l'application desktop sur cette machine. Ouvrez l'EXE et reessayez."
        : "I couldn't communicate with the desktop app on this machine. Open the EXE and try again."
      : normalizedReason === "stale"
      ? language.startsWith("pt")
        ? "A conexao com o aplicativo desktop parece desatualizada. Verifique se o EXE esta aberto e conectado e tente novamente."
        : language.startsWith("es")
        ? "La conexion con la app de escritorio parece desactualizada. Verifica que el EXE siga abierto y conectado, y vuelve a intentarlo."
        : language.startsWith("fr")
        ? "La connexion avec l'application desktop semble expirée. Verifiez que l'EXE est ouvert et connecte, puis reessayez."
        : "The desktop app connection looks stale. Make sure the EXE is open and connected, then try again."
      : language.startsWith("pt")
      ? "Resposta interrompida."
      : language.startsWith("es")
      ? "Respuesta detenida."
      : language.startsWith("fr")
      ? "Reponse interrompue."
      : "Response stopped.";

  const { results: pendingAssistantMessages } = await c.env.DB.prepare(
    `SELECT id
     FROM chat_messages
     WHERE user_id = ? AND session_id = ? AND role = 'assistant' AND is_pending = 1
     ORDER BY id DESC`
  )
    .bind(user.id, sessionId)
    .all();

  for (const row of (pendingAssistantMessages || []) as any[]) {
    await c.env.DB.prepare(
      `UPDATE chat_messages
       SET content = ?,
           message_type = 'final',
           is_pending = 0,
           progress_json = NULL,
           updated_at = ?
       WHERE id = ?`
    )
      .bind(cancelledMessage, now, Number(row?.id || 0))
      .run();
  }

  const { results: commandResults } = await c.env.DB.prepare(
    `SELECT id, status, payload, target_client_id, target_exe_id
     FROM commands
     WHERE user_id = ?
       AND command_type IN ('chat_query', 'orchestrator_query')
       AND status IN ('pending', 'sent')
     ORDER BY id DESC
     LIMIT 40`
  )
    .bind(user.id)
    .all();

  const activeCommands: Array<{
    id: number;
    status: string;
    targetClientId: string | null;
    targetExeId: string | null;
  }> = [];

  for (const row of (commandResults || []) as any[]) {
    let payload: any = null;
    try {
      payload = row?.payload ? JSON.parse(row.payload) : null;
    } catch {
      payload = null;
    }

    const payloadSessionId = Number(payload?.chat_session_id || 0);
    if (payloadSessionId !== sessionId) {
      continue;
    }

    activeCommands.push({
      id: Number(row?.id || 0),
      status: String(row?.status || ""),
      targetClientId:
        typeof row?.target_client_id === "string" && row.target_client_id.trim()
          ? row.target_client_id.trim()
          : null,
      targetExeId:
        typeof row?.target_exe_id === "string" && row.target_exe_id.trim()
          ? row.target_exe_id.trim()
          : null,
    });
  }

  for (const activeCommand of activeCommands) {
    await c.env.DB.prepare(
      `UPDATE commands
       SET status = 'cancelled',
           result = ?,
           updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
      .bind(
        JSON.stringify({
          status: "cancelled",
          result: {
            cancelled: true,
            chat_session_id: sessionId,
          },
          error: null,
          reported_at: now,
        }),
        now,
        activeCommand.id,
        user.id
      )
      .run();

    let targetClientId = activeCommand.targetClientId;
    let targetExeId = activeCommand.targetExeId;

    if (!targetClientId) {
      const pairing = await c.env.DB.prepare(
        `SELECT client_id, exe_id
         FROM exe_pairings
         WHERE user_id = ? AND status = 'connected'
         ORDER BY COALESCE(last_seen_at, paired_at) DESC
         LIMIT 1`
      )
        .bind(user.id)
        .first();

      targetClientId =
        typeof (pairing as any)?.client_id === "string" && (pairing as any).client_id.trim()
          ? String((pairing as any).client_id).trim()
          : null;
      targetExeId =
        typeof (pairing as any)?.exe_id === "string" && (pairing as any).exe_id.trim()
          ? String((pairing as any).exe_id).trim()
          : null;
    }

    if (activeCommand.status === "sent" && targetClientId) {
      await c.env.DB.prepare(
        `INSERT INTO commands (
           user_id,
           camera_id,
           command_type,
           payload,
           status,
           created_at,
           updated_at,
           target_client_id,
           target_exe_id
         )
         VALUES (?, NULL, 'chat_cancel', ?, 'pending', ?, ?, ?, ?)`
      )
        .bind(
          user.id,
          JSON.stringify({
            chat_session_id: sessionId,
            command_id: activeCommand.id,
          }),
          now,
          now,
          targetClientId,
          targetExeId
        )
        .run();
    }
  }

  await c.env.DB.prepare(
    `UPDATE chat_sessions
     SET updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(sessionId)
    .run();

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM chat_messages WHERE user_id = ? AND session_id = ? ORDER BY id ASC"
  )
    .bind(user.id, sessionId)
    .all();

  wsHandler.broadcast(sessionId, {
    type: "message_update",
    messages: results,
  });

  return c.json({
    ok: true,
    cancelled: Boolean((pendingAssistantMessages || []).length || activeCommands.length),
    messages: results,
  });
});

// Legacy chat endpoints (for backwards compatibility)
app.get("/api/chat/messages", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
  )
    .bind(user.id)
    .all();

  return c.json(results.reverse());
});

app.post("/api/chat/messages", anyAuthMiddleware, zValidator("json", SendChatMessageSchema), async (c) => {
  const user = c.get("user")!;
  const data = c.req.valid("json");
  const userOpenAiApiKey = await getUserOpenAIApiKey(c.env.DB, user.id);
  const routerRuntime = await loadChatModelRuntimeConfig(c.env.DB, "legacy");
  const modelApiKey = userOpenAiApiKey;

  if (!modelApiKey) {
    return c.json(buildOpenAiKeyRequiredErrorBody(), 400);
  }

  if (!routerRuntime.apiKey) {
    return c.json(
      { error: "Router Gemini API key is not configured in model_api_keys for tier 'legacy'." },
      400
    );
  }

  // Check token balance
  const balance = await c.env.DB.prepare(
    "SELECT * FROM token_balances WHERE user_id = ?"
  )
    .bind(user.id)
    .first();

  if (!balance || (balance as any).balance <= 0) {
    return c.json({ error: "Insufficient token balance" }, 402);
  }

  // Store user message
  await c.env.DB.prepare(
    `INSERT INTO chat_messages (user_id, role, content, camera_ids, tokens_used)
     VALUES (?, 'user', ?, ?, 0)`
  )
    .bind(user.id, data.content, data.camera_id ? String(data.camera_id) : null)
    .run();

  // Create command for EXE to process
  await c.env.DB.prepare(
    `INSERT INTO commands (user_id, camera_id, command_type, payload)
     VALUES (?, ?, 'chat_query', ?)`
  )
    .bind(
      user.id,
      data.camera_id || null,
      JSON.stringify({
        query: data.content,
        camera_id: data.camera_id,
        model_tier: "ultra",
        model_fps: normalizeChatModelFps(undefined, "ultra"),
        model_api_key: modelApiKey,
        router_api_key: routerRuntime.apiKey,
      })
    )
    .run();

  // Placeholder response
  const mockResponse = "Processing your query. The local executable will analyze the camera feed and respond shortly.";
  const tokensUsed = 10;

  await c.env.DB.prepare(
    `INSERT INTO chat_messages (user_id, role, content, camera_ids, tokens_used)
     VALUES (?, 'assistant', ?, ?, ?)`
  )
    .bind(user.id, mockResponse, data.camera_id ? String(data.camera_id) : null, tokensUsed)
    .run();

  // Deduct tokens
  await c.env.DB.prepare(
    `UPDATE token_balances SET balance = balance - ?, total_spent = total_spent + ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`
  )
    .bind(tokensUsed, tokensUsed, user.id)
    .run();

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
  )
    .bind(user.id)
    .all();

  return c.json(results.reverse());
});

// Stripe billing endpoints
app.post("/api/stripe/create-checkout-session", anyAuthMiddleware, zValidator("json", CreateCheckoutSessionSchema), async (c) => {
  const user = c.get("user")!;
  const data = c.req.valid("json");

  // --- Currency + FX detection ---
  // Try user.country_code, payload country_code, then Cloudflare headers.
  const cfRaw = (c.req.raw as any).cf as { country?: string } | undefined;
  const cfCountry = cfRaw?.country || c.req.header("CF-IPCountry") || null;

  const buyerCountryRaw =
    (user as any).country_code ||
    (data as any).country_code ||
    cfCountry ||
    "US";

  const buyerCountry = buyerCountryRaw.toString().toUpperCase();
  const isBrazil = buyerCountry === "BR";

  const usdToBrl = Number(c.env.USD_TO_BRL || "5.5");
  const fx = isBrazil ? usdToBrl : 1;

  // Currency we'll send to Stripe Checkout
  const checkoutCurrency: "usd" | "brl" = isBrazil ? "brl" : "usd";

  console.log("[STRIPE CHECKOUT] buyerCountry:", buyerCountry,
              "cfCountry:", cfCountry,
              "checkoutCurrency:", checkoutCurrency,
              "fx:", fx);

  console.log("[STRIPE CHECKOUT] Request from user:", user.id, "type:", data.type);

  if (!c.env.STRIPE_SECRET_KEY) {
    console.error("[STRIPE CHECKOUT] STRIPE_SECRET_KEY not configured");
    return c.json({ error: "Stripe not configured" }, 500);
  }

  // Log Stripe key type (test vs live)
  const keyType = c.env.STRIPE_SECRET_KEY.startsWith("sk_test_") ? "test" : 
                  c.env.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "live" : "unknown";
  console.log("[STRIPE CHECKOUT] Using Stripe key type:", keyType);

  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-01-28.clover",
  });

  try {
    // Get or create Stripe customer
    let stripeCustomer = await c.env.DB.prepare(
      "SELECT * FROM stripe_customers WHERE user_id = ?"
    )
      .bind(user.id)
      .first();

    let customerId: string;

    if (!stripeCustomer) {
      console.log("[STRIPE CHECKOUT] Creating new Stripe customer for user:", user.id);
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id },
      });

      await c.env.DB.prepare(
        "INSERT INTO stripe_customers (user_id, stripe_customer_id) VALUES (?, ?)"
      )
        .bind(user.id, customer.id)
        .run();

      customerId = customer.id;
      console.log("[STRIPE CHECKOUT] Created customer:", customerId);
    } else {
      customerId = (stripeCustomer as any).stripe_customer_id;
      console.log("[STRIPE CHECKOUT] Using existing customer:", customerId);
    }

    let session;

    if (data.type === "subscription" && data.camera_id) {
      // Camera subscription with new configurable pricing
      const planTierRaw = (data as any).plan_tier ?? "plus";
      const planTier = typeof planTierRaw === "string" ? planTierRaw.toLowerCase() : "plus";

      // Ensure we always have at least 1 camera and a numeric value
      const cameraCountRaw = (data as any).camera_count ?? 1;
      const cameraCount = Math.max(1, Number(cameraCountRaw) || 1);

      // Seconds per frame can come either from the payload or metadata
      const secondsPerFrameRaw =
        (data as any).seconds_per_frame ??
        (data.metadata as any)?.seconds_per_frame ??
        3;

      const secondsPerFrameNum = Number(secondsPerFrameRaw) || 3;
      const allowedSpf = [1, 3, 5, 10];
      const validSecondsPerFrame = (allowedSpf.includes(secondsPerFrameNum)
        ? secondsPerFrameNum
        : 3) as SecondsPerFrame;

      // Pricing always calculated in USD internally
      const normalizedTier = normalizeTier(planTier); // maps "light"/"plus"/"pro" correctly
      const pricing = getSubscriptionPricingForCamera(
        normalizedTier,
        validSecondsPerFrame
      );

      const pricePerCameraUSD = pricing.pricePerCameraUSD;
      const totalPriceUSD = pricePerCameraUSD * cameraCount;

      // Apply FX for Brazilian buyers (fx is defined earlier in the handler)
      const totalPrice = totalPriceUSD * fx;
      // Stripe requires an integer number of the smallest currency unit
      const totalPriceCents = Math.max(1, Math.round(totalPrice * 100));

      const tierLabels: Record<string, string> = {
        light: "Light",
        plus: "Plus",
        pro: "Pro",
      };

      console.log("[STRIPE CHECKOUT] Creating subscription:", {
        planTier,
        normalizedTier,
        secondsPerFrameRaw,
        secondsPerFrameNum,
        validSecondsPerFrame,
        cameraCount,
        pricePerCameraUSD,
        totalPriceUSD,
        totalPriceConverted: totalPrice,
        totalPriceCents,
        checkoutCurrency,
        buyerCountry,
      });

      session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [
          {
            price_data: {
              currency: checkoutCurrency,
              product_data: {
                name: `AI Agent Subscription - ${
                  tierLabels[normalizedTier]
                } (${validSecondsPerFrame}/1)`,
                description: `${cameraCount} camera${
                  cameraCount > 1 ? "s" : ""
                } • 1 frame every ${validSecondsPerFrame} seconds`,
              },
              unit_amount: totalPriceCents,
              recurring: { interval: "month" },
            },
            quantity: 1,
          },
        ],
        success_url: `${c.req.header(
          "origin"
        )}/billing?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${c.req.header("origin")}/billing`,
        metadata: {
          user_id: user.id,
          camera_id: String(data.camera_id),
          // store normalized values to simplify webhook handling
          plan_tier: normalizedTier,
          seconds_per_frame: String(validSecondsPerFrame),
          camera_count: String(cameraCount),
        },
      });
    } else if (data.type === "credits" && data.credits_amount) {
      // Token credits with tiered pricing
      const tokens = data.credits_amount;
      const tokenType = (data as any).token_type || "both";
      
      // Base costs per 1M tokens
      const INPUT_BASE_COST = 0.075;
      const OUTPUT_BASE_COST = 0.30;
      
      // Calculate markup based on total tokens
      let markupMultiplier: number;
      if (tokens <= 49_000_000) {
        markupMultiplier = 1.40; // 40% markup
      } else if (tokens <= 200_000_000) {
        markupMultiplier = 1.30; // 30% markup
      } else {
        markupMultiplier = 1.20; // 20% markup
      }
      
      // Calculate price based on token type
      let pricePerMillion: number;
      let description: string;
      
      if (tokenType === "both") {
        pricePerMillion = (INPUT_BASE_COST + OUTPUT_BASE_COST) * markupMultiplier;
        description = "Input + Output tokens";
      } else if (tokenType === "input") {
        pricePerMillion = INPUT_BASE_COST * markupMultiplier;
        description = "Input tokens";
      } else {
        pricePerMillion = OUTPUT_BASE_COST * markupMultiplier;
        description = "Output tokens";
      }
      
      const totalPriceUSD = (tokens / 1_000_000) * pricePerMillion;

      // Apply BRL conversion for Brazilian users
      const totalPrice = totalPriceUSD * fx;
      const unitAmountInCents = Math.round(totalPrice * 100);

      console.log("[STRIPE CHECKOUT] Creating credits session for tokens:", {
        tokens,
        tokenType,
        pricePerMillion,
        totalPriceUSD,
        totalPriceConverted: totalPrice,
        unitAmountInCents,
        checkoutCurrency,
        buyerCountry,
      });

      session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "payment",
        // no adaptive_pricing here; we control currency explicitly
        line_items: [
          {
            price_data: {
              currency: checkoutCurrency,
              product_data: {
                name: `${tokens.toLocaleString()} AI Tokens`,
                description: `${description} • One-time purchase`,
              },
              unit_amount: unitAmountInCents,
            },
            quantity: 1,
          },
        ],
        success_url: `${c.req.header("origin")}/billing?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${c.req.header("origin")}/billing`,
        metadata: {
          user_id: user.id,
          credits_amount: String(tokens),
          token_type: tokenType,
        },
      });
    } else {
      console.error("[STRIPE CHECKOUT] Invalid checkout request:", data);
      return c.json({ error: "Invalid checkout request" }, 400);
    }

    console.log("[STRIPE CHECKOUT] ✓ Session created successfully:", session.id);
    console.log("[STRIPE CHECKOUT] Checkout URL:", session.url);

    return c.json({ url: session.url });
  } catch (error: any) {
    console.error("[STRIPE CHECKOUT] ✗ Failed to create checkout session");
    console.error("[STRIPE CHECKOUT] Error type:", error.type);
    console.error("[STRIPE CHECKOUT] Error message:", error.message);
    console.error("[STRIPE CHECKOUT] Error code:", error.code);
    
    if (error.raw) {
      console.error("[STRIPE CHECKOUT] Error raw:", JSON.stringify(error.raw, null, 2));
    }
    
    console.error("[STRIPE CHECKOUT] Full error:", JSON.stringify(error, null, 2));

    return c.json({ 
      error: "Stripe checkout creation failed",
      details: error.message 
    }, 500);
  }
});

app.post("/api/stripe/webhook", async (c) => {
  console.log("[STRIPE WEBHOOK] Received webhook request");
  
  if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_WEBHOOK_SECRET) {
    console.error("[STRIPE WEBHOOK] Missing Stripe configuration");
    return c.json({ error: "Stripe not configured" }, 500);
  }

  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-01-28.clover",
  });

  const sig = c.req.header("stripe-signature");
  if (!sig) {
    console.error("[STRIPE WEBHOOK] Missing stripe-signature header");
    return c.json({ error: "No signature" }, 400);
  }

  try {
    const rawBody = await c.req.text();
    console.log("[STRIPE WEBHOOK] Constructing event from raw body");
    
    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      c.env.STRIPE_WEBHOOK_SECRET
    );

    console.log(`[STRIPE WEBHOOK] Event type: ${event.type}, ID: ${event.id}`);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id;

      console.log(`[STRIPE WEBHOOK] checkout.session.completed for user: ${userId}`);
      console.log(`[STRIPE WEBHOOK] Session ID: ${session.id}`);
      console.log(`[STRIPE WEBHOOK] Mode: ${session.mode}`);
      console.log(`[STRIPE WEBHOOK] Amount: ${session.amount_total} ${session.currency}`);
      console.log(`[STRIPE WEBHOOK] Metadata:`, JSON.stringify(session.metadata));

      if (!userId) {
        console.warn("[STRIPE WEBHOOK] No user_id in metadata, skipping");
        return c.json({ received: true });
      }

      // Record payment
      try {
        console.log(`[STRIPE WEBHOOK] Inserting payment record for user ${userId}`);
        
        // Determine description based on metadata
        let description = "Checkout session";
        if (session.metadata?.credits_amount) {
          description = `${session.metadata.credits_amount} tokens`;
        } else if (session.metadata?.billing_type === "chat_payg") {
          description = "Chat pay-as-you-go subscription";
        } else if (session.metadata?.camera_id) {
          const cameraCount = session.metadata.camera_count || "1";
          const planTier = session.metadata.plan_tier || "plus";
          const secondsPerFrame = session.metadata.seconds_per_frame || "3";
          
          const tierLabels: Record<string, string> = {
            light: "Light",
            plus: "Plus",
            pro: "Pro",
          };
          
          const tierLabel = tierLabels[planTier] || planTier;
          const cameraText = parseInt(cameraCount) === 1 ? "camera" : "cameras";
          
          description = `AI Subscription: ${cameraCount} ${cameraText} • ${tierLabel} model • ${secondsPerFrame}/1 analysis speed`;
        }
        
        await c.env.DB.prepare(
          `INSERT INTO payments (user_id, stripe_payment_id, amount, currency, payment_type, status, description)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            userId,
            session.id,
            session.amount_total || 0,
            session.currency || "usd",
            session.mode,
            "completed",
            description
          )
          .run();
        console.log(`[STRIPE WEBHOOK] ✓ Payment record inserted`);
      } catch (paymentErr) {
        console.error("[STRIPE WEBHOOK] Failed to insert payment:", paymentErr);
        throw paymentErr;
      }

      // Add tokens if it's a credit purchase
      if (session.mode === "payment" && session.metadata?.credits_amount) {
        const credits = parseInt(session.metadata.credits_amount);
        const tokenType = session.metadata.token_type || "both";
        console.log(`[STRIPE WEBHOOK] Processing credit purchase: ${credits} ${tokenType} tokens for user ${userId}`);
        
        try {
          // Check if token_balances row exists
          const existingBalance = await c.env.DB.prepare(
            `SELECT * FROM token_balances WHERE user_id = ?`
          )
            .bind(userId)
            .first();

          if (existingBalance) {
            console.log(`[STRIPE WEBHOOK] Updating existing token balance`);
            
            if (tokenType === "both") {
              await c.env.DB.prepare(
                `UPDATE token_balances SET input_balance = input_balance + ?, output_balance = output_balance + ?, balance = balance + ?, updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = ?`
              )
                .bind(credits, credits, credits, userId)
                .run();
              console.log(`[STRIPE WEBHOOK] ✓ Token balance updated (+${credits} input, +${credits} output)`);
            } else if (tokenType === "input") {
              await c.env.DB.prepare(
                `UPDATE token_balances SET input_balance = input_balance + ?, balance = balance + ?, updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = ?`
              )
                .bind(credits, credits, userId)
                .run();
              console.log(`[STRIPE WEBHOOK] ✓ Token balance updated (+${credits} input)`);
            } else {
              await c.env.DB.prepare(
                `UPDATE token_balances SET output_balance = output_balance + ?, balance = balance + ?, updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = ?`
              )
                .bind(credits, credits, userId)
                .run();
              console.log(`[STRIPE WEBHOOK] ✓ Token balance updated (+${credits} output)`);
            }
          } else {
            console.log(`[STRIPE WEBHOOK] Creating new token balance record`);
            
            if (tokenType === "both") {
              await c.env.DB.prepare(
                `INSERT INTO token_balances (user_id, balance, input_balance, output_balance, total_spent)
                 VALUES (?, ?, ?, ?, 0)`
              )
                .bind(userId, credits, credits, credits)
                .run();
            } else if (tokenType === "input") {
              await c.env.DB.prepare(
                `INSERT INTO token_balances (user_id, balance, input_balance, output_balance, total_spent)
                 VALUES (?, ?, ?, 0, 0)`
              )
                .bind(userId, credits, credits)
                .run();
            } else {
              await c.env.DB.prepare(
                `INSERT INTO token_balances (user_id, balance, input_balance, output_balance, total_spent)
                 VALUES (?, ?, 0, ?, 0)`
              )
                .bind(userId, credits, credits)
                .run();
            }
            console.log(`[STRIPE WEBHOOK] ✓ Token balance created with ${credits} ${tokenType} tokens`);
          }
        } catch (tokenErr) {
          console.error("[STRIPE WEBHOOK] Failed to update token balance:", tokenErr);
          throw tokenErr;
        }
      }

      // Activate subscription if it's a camera subscription
      if (session.mode === "subscription" && session.metadata?.camera_id) {
        const cameraId = session.metadata.camera_id;
        const planTier = session.metadata.plan_tier || "plus";
        const cameraCount = parseInt(session.metadata.camera_count || "1", 10);
        const secondsPerFrame = parseInt(session.metadata.seconds_per_frame || "3", 10);
        
        console.log(`[STRIPE WEBHOOK] Processing subscription for camera ${cameraId}, plan: ${planTier}, cameras: ${cameraCount}, seconds/frame: ${secondsPerFrame}`);

        // Calculate token allowances based on pricing formulas
        const normalizedTier = normalizeTier(planTier);
        const validSecondsPerFrame = [1, 3, 5, 10].includes(secondsPerFrame) ? secondsPerFrame : 3;
        const pricing = getSubscriptionPricingForCamera(normalizedTier, validSecondsPerFrame as SecondsPerFrame);
        
        // Total tokens for all cameras
        const totalInputTokensM = pricing.inputTokensM * cameraCount;
        const totalOutputTokensM = pricing.outputTokensM * cameraCount;
        
        // Compute price in cents for subscription_type
        const priceCents = Math.round(pricing.pricePerCameraUSD * cameraCount * 100);
        const subscriptionType = `camera_monitoring_${priceCents}`;

        const stripeSubscriptionId =
          typeof session.subscription === "string" && session.subscription.length > 0
            ? session.subscription
            : session.id;
        const subscriptionStatus = "active";
        const planId = normalizedTier;
        
        console.log(`[STRIPE WEBHOOK] Token allowances: ${totalInputTokensM}M input, ${totalOutputTokensM}M output`);
        
        try {
          const existingSub = await c.env.DB.prepare(
            `SELECT id FROM subscriptions WHERE user_id = ? AND stripe_subscription_id = ? LIMIT 1`
          )
            .bind(userId, stripeSubscriptionId)
            .first();

          console.log(`[STRIPE WEBHOOK] Inserting subscription record with type ${subscriptionType}`);
          
          // Deactivate all existing active subscriptions for this user first
          const nowTs = new Date().toISOString();
          await c.env.DB.prepare(
            `UPDATE subscriptions 
             SET is_active = 0, updated_at = ?
             WHERE user_id = ? AND is_active = 1`
          )
            .bind(nowTs, userId)
            .run();
          
          if (existingSub) {
            await c.env.DB.prepare(
              `UPDATE subscriptions
               SET is_active = 1, updated_at = ?
               WHERE id = ?`
            )
              .bind(nowTs, (existingSub as any).id)
              .run();
          } else {
            await c.env.DB.prepare(
              `INSERT INTO subscriptions (
                 user_id,
                 stripe_subscription_id,
                 plan_id,
                 status,
                 camera_id,
                 subscription_type,
                 is_active,
                 camera_count,
                 seconds_per_frame,
                 model_tier,
                 "InputTokensM",
                 "OutputTokensM",
                 "InputTokensUsedM",
                 "OutputTokensUsedM",
                 started_at,
                 expires_at,
                 created_at,
                 updated_at
               )
               VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 0, 0, CURRENT_TIMESTAMP, datetime(CURRENT_TIMESTAMP, '+1 month'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
            )
              .bind(
                userId,
                stripeSubscriptionId,
                planId,
                subscriptionStatus,
                cameraId,
                subscriptionType,
                cameraCount,
                secondsPerFrame,
                planTier,
                totalInputTokensM,
                totalOutputTokensM
              )
              .run();
            console.log(`[STRIPE WEBHOOK] ✓ Subscription record inserted with camera_count=${cameraCount}, seconds_per_frame=${secondsPerFrame}, model_tier=${planTier}, InputTokensM=${totalInputTokensM}, OutputTokensM=${totalOutputTokensM}`);
          }
        } catch (subErr) {
          console.error("[STRIPE WEBHOOK] Failed to insert subscription:", subErr);
          throw subErr;
        }

        // Set frame_rate based on plan_tier
        const frameRates: Record<string, number> = {
          basic: 12,
          standard: 8,
          premium: 1,
        };
        const frameRate = frameRates[planTier] || 12;
        const now = new Date().toISOString();

        console.log(`[STRIPE WEBHOOK] Setting frame_rate to ${frameRate} for plan ${planTier}`);

        try {
          // Upsert frame_rate for user
          const existingFrameRate = await c.env.DB.prepare(
            `SELECT * FROM user_frame_rate WHERE user_id = ?`
          )
            .bind(userId)
            .first();

          if (existingFrameRate) {
            console.log(`[STRIPE WEBHOOK] Updating existing frame_rate`);
            await c.env.DB.prepare(
              `UPDATE user_frame_rate SET frame_rate = ?, updated_at = ? WHERE user_id = ?`
            )
              .bind(frameRate, now, userId)
              .run();
            console.log(`[STRIPE WEBHOOK] ✓ frame_rate updated to ${frameRate}`);
          } else {
            console.log(`[STRIPE WEBHOOK] Inserting new frame_rate record`);
            await c.env.DB.prepare(
              `INSERT INTO user_frame_rate (user_id, frame_rate, updated_at) VALUES (?, ?, ?)`
            )
              .bind(userId, frameRate, now)
              .run();
            console.log(`[STRIPE WEBHOOK] ✓ frame_rate inserted as ${frameRate}`);
          }
        } catch (frameErr) {
          console.error("[STRIPE WEBHOOK] Failed to upsert frame_rate:", frameErr);
          throw frameErr;
        }
      }

      // Capture card for chat pay-as-you-go subscription
      if (session.mode === "subscription" && session.metadata?.billing_type === "chat_payg") {
        const customerId = session.customer as string;

        try {
          console.log(`[STRIPE WEBHOOK] Capturing card for chat_payg subscription, user ${userId}`);

          // Get default payment method for the subscription or customer
          let paymentMethod: Stripe.PaymentMethod | null = null;

          if (session.subscription) {
            const subscription = await stripe.subscriptions.retrieve(
              session.subscription as string
            );
            let defaultPmId = subscription.default_payment_method as string | null;
            
            // If no default PM on subscription, try to get it from the latest invoice
            if (!defaultPmId && subscription.latest_invoice && typeof subscription.latest_invoice !== "string") {
              const invoice = subscription.latest_invoice as any;
              if (invoice.payment_intent && typeof invoice.payment_intent !== "string") {
                const pi = invoice.payment_intent as any;
                defaultPmId = pi.payment_method as string | null;
              }
            }

            if (defaultPmId) {
              paymentMethod = await stripe.paymentMethods.retrieve(defaultPmId);
            }
          }

          // Fallback: if no subscription default PM, list customer's card PMs and take the first
          if (!paymentMethod) {
            const pms = await stripe.paymentMethods.list({
              customer: customerId,
              type: "card",
              limit: 1,
            });
            paymentMethod = pms.data[0] ?? null;
          }

          if (paymentMethod) {
            await upsertActiveCard(c.env.DB, userId, customerId, paymentMethod);
            console.log(
              `[STRIPE WEBHOOK] ✓ Saved active card for user ${userId}:`,
              paymentMethod.id
            );
          } else {
            console.warn(
              "[STRIPE WEBHOOK] No card payment method found for chat_payg subscription"
            );
          }
        } catch (cardErr) {
          console.error("[STRIPE WEBHOOK] Failed to capture card for chat_payg:", cardErr);
          // Don't throw - card capture is non-critical
        }
      }

      console.log(`[STRIPE WEBHOOK] ✓ Successfully processed checkout.session.completed for user ${userId}`);
    } else if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      
      console.log(`[STRIPE WEBHOOK] customer.subscription.deleted for subscription: ${subscription.id}`);
      
      // Find user_id from stripe_customers table
      const stripeCustomer = await c.env.DB.prepare(
        "SELECT user_id FROM stripe_customers WHERE stripe_customer_id = ?"
      )
        .bind(customerId)
        .first();
      
      if (!stripeCustomer) {
        console.warn(`[STRIPE WEBHOOK] No user found for Stripe customer ${customerId}`);
        return c.json({ received: true });
      }
      
      const userId = (stripeCustomer as any).user_id;
      const now = new Date().toISOString();
      
      // Deactivate the subscription in our database
      await c.env.DB.prepare(
        `UPDATE subscriptions
         SET is_active = 0, updated_at = ?
         WHERE user_id = ? AND is_active = 1`
      )
        .bind(now, userId)
        .run();
      
      console.log(`[STRIPE WEBHOOK] ✓ Deactivated subscription for user ${userId}`);
    } else if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      
      console.log(`[STRIPE WEBHOOK] customer.subscription.updated for subscription: ${subscription.id}, status: ${subscription.status}`);
      
      // Find user_id from stripe_customers table
      const stripeCustomer = await c.env.DB.prepare(
        "SELECT user_id FROM stripe_customers WHERE stripe_customer_id = ?"
      )
        .bind(customerId)
        .first();
      
      if (!stripeCustomer) {
        console.warn(`[STRIPE WEBHOOK] No user found for Stripe customer ${customerId}`);
        return c.json({ received: true });
      }
      
      const userId = (stripeCustomer as any).user_id;
      
      // Only deactivate if subscription is actually canceled (not just scheduled for cancellation)
      // Don't deactivate when cancel_at_period_end=true but status=active (user still has access)
      if (subscription.status === "canceled" || subscription.status === "unpaid" || subscription.status === "incomplete_expired") {
        const now = new Date().toISOString();
        
        await c.env.DB.prepare(
          `UPDATE subscriptions
           SET is_active = 0, updated_at = ?
           WHERE user_id = ? AND is_active = 1`
        )
          .bind(now, userId)
          .run();
        
        console.log(`[STRIPE WEBHOOK] ✓ Deactivated subscription for user ${userId} (status: ${subscription.status})`);
      } else {
        console.log(`[STRIPE WEBHOOK] Subscription status is ${subscription.status}, keeping active`);
      }
    } else {
      console.log(`[STRIPE WEBHOOK] Ignoring event type: ${event.type}`);
    }

    return c.json({ received: true });
  } catch (err) {
    console.error("[STRIPE WEBHOOK] Error processing webhook:", err);
    console.error("[STRIPE WEBHOOK] Error details:", JSON.stringify(err, null, 2));
    return c.json({ error: "Webhook error" }, 400);
  }
});

app.post("/api/stripe/confirm-session", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<{ session_id?: string }>();
  const { session_id } = body;

  if (!session_id) {
    return c.json({ error: "session_id required" }, 400);
  }

  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: "Stripe not configured" }, 500);
  }

  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-01-28.clover",
  });

  try {
    // Retrieve the checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(session_id);

    // Verify this session belongs to the current user
    if (!session.metadata?.user_id || session.metadata.user_id !== user.id) {
      return c.json({ error: "Session does not belong to this user" }, 403);
    }

    // Check if already processed (to avoid duplicates from webhook + confirm)
    const existingPayment = await c.env.DB.prepare(
      "SELECT id FROM payments WHERE stripe_payment_id = ?"
    )
      .bind(session.id)
      .first();

    let didWork = false;
    const alreadyProcessedPayment = !!existingPayment;

    if (!alreadyProcessedPayment) {
    // Insert payment record
    let description = "Checkout session";
    if (session.metadata?.credits_amount) {
      description = `${session.metadata.credits_amount} tokens`;
    } else if (session.metadata?.billing_type === "chat_payg") {
      description = "Chat pay-as-you-go subscription";
    } else if (session.metadata?.camera_id) {
      const cameraCount = session.metadata.camera_count || "1";
      const planTier = session.metadata.plan_tier || "plus";
      const secondsPerFrame = session.metadata.seconds_per_frame || "3";
      
      const tierLabels: Record<string, string> = {
        light: "Light",
        plus: "Plus",
        pro: "Pro",
      };
      
      const tierLabel = tierLabels[planTier] || planTier;
      const cameraText = parseInt(cameraCount) === 1 ? "camera" : "cameras";
      
      description = `AI Subscription: ${cameraCount} ${cameraText} • ${tierLabel} model • ${secondsPerFrame}/1 analysis speed`;
    }
    
    await c.env.DB.prepare(
      `INSERT INTO payments (user_id, stripe_payment_id, amount, currency, payment_type, status, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        user.id,
        session.id,
        session.amount_total || 0,
        session.currency || "usd",
        session.mode,
        "completed",
        description
      )
      .run();

      didWork = true;
    }

    // Handle credit purchase
    if (session.mode === "payment" && session.metadata?.credits_amount && !alreadyProcessedPayment) {
      const credits = parseInt(session.metadata.credits_amount, 10);
      const tokenType = session.metadata.token_type || "both";

      const existingBalance = await c.env.DB.prepare(
        "SELECT * FROM token_balances WHERE user_id = ?"
      )
        .bind(user.id)
        .first();

      if (existingBalance) {
        if (tokenType === "both") {
          await c.env.DB.prepare(
            `UPDATE token_balances 
             SET input_balance = input_balance + ?, 
                 output_balance = output_balance + ?, 
                 balance = balance + ?, 
                 updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ?`
          )
            .bind(credits, credits, credits, user.id)
            .run();
        } else if (tokenType === "input") {
          await c.env.DB.prepare(
            `UPDATE token_balances 
             SET input_balance = input_balance + ?, 
                 balance = balance + ?, 
                 updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ?`
          )
            .bind(credits, credits, user.id)
            .run();
        } else {
          await c.env.DB.prepare(
            `UPDATE token_balances 
             SET output_balance = output_balance + ?, 
                 balance = balance + ?, 
                 updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ?`
          )
            .bind(credits, credits, user.id)
            .run();
        }
      } else {
        if (tokenType === "both") {
          await c.env.DB.prepare(
            `INSERT INTO token_balances (user_id, balance, input_balance, output_balance, total_spent)
             VALUES (?, ?, ?, ?, 0)`
          )
            .bind(user.id, credits, credits, credits)
            .run();
        } else if (tokenType === "input") {
          await c.env.DB.prepare(
            `INSERT INTO token_balances (user_id, balance, input_balance, output_balance, total_spent)
             VALUES (?, ?, ?, 0, 0)`
          )
            .bind(user.id, credits, credits)
            .run();
        } else {
          await c.env.DB.prepare(
            `INSERT INTO token_balances (user_id, balance, input_balance, output_balance, total_spent)
             VALUES (?, ?, 0, ?, 0)`
          )
            .bind(user.id, credits, credits)
            .run();
        }
      }

      didWork = true;
    }

    // Handle camera subscription
    if (session.mode === "subscription" && session.metadata?.camera_id) {
      const cameraId = session.metadata.camera_id;
      const planTier = session.metadata.plan_tier || "plus";
      const cameraCount = parseInt(session.metadata.camera_count || "1", 10);
      const secondsPerFrame = parseInt(session.metadata.seconds_per_frame || "3", 10);

      // Calculate token allowances based on pricing formulas
      const normalizedTier = normalizeTier(planTier);
      const validSecondsPerFrame = [1, 3, 5, 10].includes(secondsPerFrame) ? secondsPerFrame : 3;
      const pricing = getSubscriptionPricingForCamera(normalizedTier, validSecondsPerFrame as SecondsPerFrame);
      
      // Total tokens for all cameras
      const totalInputTokensM = pricing.inputTokensM * cameraCount;
      const totalOutputTokensM = pricing.outputTokensM * cameraCount;
      
      // Compute price in cents for subscription_type
      const priceCents = Math.round(pricing.pricePerCameraUSD * cameraCount * 100);
      const subscriptionType = `camera_monitoring_${priceCents}`;

      const stripeSubscriptionId =
        typeof session.subscription === "string" && session.subscription.length > 0
          ? session.subscription
          : session.id;
      const subscriptionStatus = "active";
      const planId = normalizedTier;

      // Check if this subscription already exists (idempotency)
      const existingSub = await c.env.DB.prepare(
        `SELECT id FROM subscriptions WHERE user_id = ? AND stripe_subscription_id = ? LIMIT 1`
      )
        .bind(user.id, stripeSubscriptionId)
        .first();

      const nowTs = new Date().toISOString();

      // Deactivate all existing active subscriptions for this user
      await c.env.DB.prepare(
        `UPDATE subscriptions 
         SET is_active = 0, updated_at = ?
         WHERE user_id = ? AND is_active = 1`
      )
        .bind(nowTs, user.id)
        .run();

      if (existingSub) {
        await c.env.DB.prepare(
          `UPDATE subscriptions
           SET is_active = 1, updated_at = ?
           WHERE id = ?`
        )
          .bind(nowTs, (existingSub as any).id)
          .run();
        didWork = true;
      } else {
        // Insert new subscription row with token allowances (fresh usage counters for new billing period)
        await c.env.DB.prepare(
          `INSERT INTO subscriptions (
             user_id,
             stripe_subscription_id,
             plan_id,
             status,
             camera_id,
             subscription_type,
             is_active,
             camera_count,
             seconds_per_frame,
             model_tier,
             "InputTokensM",
             "OutputTokensM",
             "InputTokensUsedM",
             "OutputTokensUsedM",
             started_at,
             expires_at,
             created_at,
             updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 0, 0, CURRENT_TIMESTAMP, datetime(CURRENT_TIMESTAMP, '+1 month'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
          .bind(
            user.id,
            stripeSubscriptionId,
            planId,
            subscriptionStatus,
            cameraId,
            subscriptionType,
            cameraCount,
            secondsPerFrame,
            planTier,
            totalInputTokensM,
            totalOutputTokensM
          )
          .run();

        didWork = true;
      }

      // Map plan_tier to frame_rate
      const frameRates: Record<string, number> = {
        basic: 12,
        standard: 8,
        premium: 1,
      };
      const frameRate = frameRates[planTier] ?? 12;

      // Upsert into user_frame_rate
      const existingFR = await c.env.DB.prepare(
        "SELECT * FROM user_frame_rate WHERE user_id = ?"
      )
        .bind(user.id)
        .first();

      if (existingFR) {
        await c.env.DB.prepare(
          "UPDATE user_frame_rate SET frame_rate = ?, updated_at = ? WHERE user_id = ?"
        )
          .bind(frameRate, nowTs, user.id)
          .run();
      } else {
        await c.env.DB.prepare(
          "INSERT INTO user_frame_rate (user_id, frame_rate, updated_at) VALUES (?, ?, ?)"
        )
          .bind(user.id, frameRate, nowTs)
          .run();
      }
    }

    // Capture card for chat pay-as-you-go subscription in confirm-session
    if (session.mode === "subscription" && session.metadata?.billing_type === "chat_payg") {
      const customerId = session.customer as string;

      try {
        // Get default payment method for the subscription or customer
        let paymentMethod: Stripe.PaymentMethod | null = null;

        if (session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription as string
          );
          let defaultPmId = subscription.default_payment_method as string | null;
          
          // If no default PM on subscription, try to get it from the latest invoice
          if (!defaultPmId && subscription.latest_invoice && typeof subscription.latest_invoice !== "string") {
            const invoice = subscription.latest_invoice as any;
            if (invoice.payment_intent && typeof invoice.payment_intent !== "string") {
              const pi = invoice.payment_intent as any;
              defaultPmId = pi.payment_method as string | null;
            }
          }

          if (defaultPmId) {
            paymentMethod = await stripe.paymentMethods.retrieve(defaultPmId);
          }
        }

        // Fallback: if no subscription default PM, list customer's card PMs and take the first
        if (!paymentMethod) {
          const pms = await stripe.paymentMethods.list({
            customer: customerId,
            type: "card",
            limit: 1,
          });
          paymentMethod = pms.data[0] ?? null;
        }

        if (paymentMethod) {
          await upsertActiveCard(c.env.DB, user.id, customerId, paymentMethod);
          console.log(
            `[CONFIRM SESSION] Saved active card for user ${user.id}:`,
            paymentMethod.id
          );
        }
      } catch (cardErr) {
        console.error("[CONFIRM SESSION] Failed to capture card for chat_payg:", cardErr);
        // Don't throw - card capture is non-critical
      }
    }

    return c.json({ ok: true, alreadyProcessed: !didWork });
  } catch (error) {
    console.error("Failed to confirm session:", error);
    return c.json({ error: "Failed to confirm session" }, 500);
  }
});

app.get("/api/payments", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
  )
    .bind(user.id)
    .all();

  return c.json(results);
});

app.get("/api/subscriptions/me", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM subscriptions
     WHERE user_id = ? AND is_active = 1
     ORDER BY started_at DESC
     LIMIT 1`
  )
    .bind(user.id)
    .all();

  // Return either the latest active subscription or null
  return c.json(results[0] || null);
});

// Get active cards for user
app.get("/api/billing/cards", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM active_cards WHERE user_id = ? ORDER BY is_default DESC, created_at DESC"
  )
    .bind(user.id)
    .all();

  return c.json(results);
});

// Cancel subscription
app.post("/api/billing/cancel-subscription", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: "Stripe not configured" }, 500);
  }

  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-01-28.clover",
  });

  try {
    // Find active subscription
    const subscription = await c.env.DB.prepare(
      "SELECT * FROM subscriptions WHERE user_id = ? AND is_active = 1 LIMIT 1"
    )
      .bind(user.id)
      .first();

    if (!subscription) {
      return c.json({ error: "No active subscription found" }, 404);
    }

    // Get Stripe customer
    const stripeCustomer = await c.env.DB.prepare(
      "SELECT * FROM stripe_customers WHERE user_id = ?"
    )
      .bind(user.id)
      .first();

    if (!stripeCustomer) {
      return c.json({ error: "Stripe customer not found" }, 404);
    }

    const customerId = (stripeCustomer as any).stripe_customer_id;

    // List subscriptions for this customer
    const stripeSubscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 10,
    });

    const now = new Date().toISOString();
    let latestPeriodEndIso: string | null = null;

    for (const stripeSub of stripeSubscriptions.data) {
      await stripe.subscriptions.update(stripeSub.id, {
        cancel_at_period_end: true,
      });

      // current_period_end is the real "access until" moment
      // Use the original subscription object from the list (it has current_period_end)
      const sub = stripeSub as any;
      if (sub.current_period_end) {
        const iso = new Date(sub.current_period_end * 1000).toISOString();
        // keep the latest one if multiple exist (defensive)
        if (!latestPeriodEndIso || iso > latestPeriodEndIso) latestPeriodEndIso = iso;
      }
    }

    // Keep DB subscription active; only align expires_at to Stripe's period end
    if (latestPeriodEndIso) {
      await c.env.DB.prepare(
        `UPDATE subscriptions
         SET expires_at = ?, updated_at = ?
         WHERE user_id = ? AND is_active = 1`
      )
        .bind(latestPeriodEndIso, now, user.id)
        .run();
    } else {
      // If for some reason Stripe didn't return period end, do NOT deactivate.
      // Keep current expires_at as-is.
      await c.env.DB.prepare(
        `UPDATE subscriptions
         SET updated_at = ?
         WHERE user_id = ? AND is_active = 1`
      )
        .bind(now, user.id)
        .run();
    }

    return c.json({ success: true, access_until: latestPeriodEndIso });
  } catch (error) {
    console.error("Failed to cancel subscription:", error);
    return c.json({ error: "Failed to cancel subscription" }, 500);
  }
});

// Remove card
app.post("/api/billing/remove-card", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<{ card_id: number }>();

  if (!body.card_id) {
    return c.json({ error: "card_id is required" }, 400);
  }

  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: "Stripe not configured" }, 500);
  }

  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-01-28.clover",
  });

  try {
    // Get the card from database
    const card = await c.env.DB.prepare(
      "SELECT * FROM active_cards WHERE id = ? AND user_id = ?"
    )
      .bind(body.card_id, user.id)
      .first();

    if (!card) {
      return c.json({ error: "Card not found" }, 404);
    }

    const cardData = card as any;

    // Detach payment method from Stripe
    try {
      await stripe.paymentMethods.detach(cardData.stripe_payment_method_id);
    } catch (stripeError) {
      console.error("Failed to detach payment method from Stripe:", stripeError);
      // Continue anyway to clean up our database
    }

    // Delete from our database
    await c.env.DB.prepare(
      "DELETE FROM active_cards WHERE id = ? AND user_id = ?"
    )
      .bind(body.card_id, user.id)
      .run();

    return c.json({ success: true });
  } catch (error) {
    console.error("Failed to remove card:", error);
    return c.json({ error: "Failed to remove card" }, 500);
  }
});

// EXE Pairing endpoints
app.post("/api/pairing/generate", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  
  // Delete any existing pending pair codes for this user
  await c.env.DB.prepare(
    `DELETE FROM pair_codes WHERE user_id = ?`
  )
    .bind(user.id)
    .run();

  const pairCode = generatePairCode();
  const pairingId = generateUUID();
  // Keep a stable client identity per account (e.g. "local:1") so
  // re-pairing the EXE does not mint a random new client_id.
  const clientId = String(user.id || "").trim();
  if (!clientId) {
    return c.json({ error: "Unable to resolve client id for current account" }, 400);
  }
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes
  const createdAt = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO pair_codes (id, user_id, client_id, pair_code, code, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(pairingId, user.id, clientId, pairCode, pairCode, expiresAt, createdAt)
    .run();

  return c.json({
    pair_code: pairCode,
    expires_at: expiresAt,
  });
});

app.post("/api/pairing/pair", zValidator("json", ClaimPairingSchema), async (c) => {
  const data = c.req.valid("json");
  const pairingTimezoneInput = data.timezone_iana;
  const normalizedPairingTimezone = normalizeTimezoneInput(pairingTimezoneInput);
  if (!normalizedPairingTimezone) {
    return c.json(
      { error: "Invalid timezone. Expected IANA timezone like America/Sao_Paulo." },
      400
    );
  }

  const pairCodeData = await c.env.DB.prepare(
    `SELECT * FROM pair_codes WHERE pair_code = ?`
  )
    .bind(data.pair_code)
    .first();

  if (!pairCodeData) {
    return c.json({ error: "Invalid or expired pair code" }, 400);
  }

  const expiresAt = new Date((pairCodeData as any).expires_at);
  if (expiresAt < new Date()) {
    await c.env.DB.prepare(
      `DELETE FROM pair_codes WHERE pair_code = ?`
    )
      .bind(data.pair_code)
      .run();

    return c.json({ error: "Pair code expired" }, 400);
  }

  // Generate EXE token
  const exeToken = generateUUID();
  const exeTokenHash = await hashToken(exeToken);
  const pairedAt = new Date().toISOString();
  const userId = (pairCodeData as any).user_id;
  // Canonical client id is always the account id (stable across re-pair).
  const clientId = String(userId || "").trim();
  if (!clientId) {
    return c.json({ error: "Invalid pair code user context" }, 400);
  }

  // Ensure single active EXE session per account by revoking any previously
  // connected rows that might have old/random client ids from legacy behavior.
  await c.env.DB.prepare(
    `UPDATE exe_pairings
     SET status = 'revoked',
         exe_token_hash = '',
         last_seen_at = ?
     WHERE user_id = ?
       AND status = 'connected'
       AND client_id <> ?`
  )
    .bind(pairedAt, userId, clientId)
    .run();

  // Upsert by (user_id, client_id) for stable account-scoped EXE pairing.
  await c.env.DB.prepare(
    `INSERT INTO exe_pairings (
       user_id, client_id, exe_id, exe_token_hash,
       paired_at, last_seen_at, status, timezone_iana, timezone_updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, 'connected', ?, ?)
     ON CONFLICT(user_id, client_id) DO UPDATE SET
       exe_id = excluded.exe_id,
       exe_token_hash = excluded.exe_token_hash,
       last_seen_at = excluded.last_seen_at,
       status = 'connected',
       timezone_iana = excluded.timezone_iana,
       timezone_updated_at = excluded.timezone_updated_at`
  )
    .bind(
      userId,
      clientId,
      data.exe_id,
      exeTokenHash,
      pairedAt,
      pairedAt,
      normalizedPairingTimezone,
      pairedAt
    )
    .run();

  // Delete used pair code
  await c.env.DB.prepare(
    `DELETE FROM pair_codes WHERE pair_code = ?`
  )
    .bind(data.pair_code)
    .run();

  const globalTimezone = await setUserGlobalTimezone(
    c.env.DB,
    userId,
    normalizedPairingTimezone,
    "exe_pairing"
  );

  return c.json({
    client_id: clientId,
    exe_id: data.exe_id,
    exe_token: exeToken, // Return raw token only this once
    timezone_iana: globalTimezone,
  });
});

app.get("/api/pairing/status", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  const pairingsResult = await c.env.DB.prepare(
    `SELECT *
     FROM exe_pairings
     WHERE user_id = ? AND status = 'connected'
     ORDER BY COALESCE(last_seen_at, paired_at) DESC`
  )
    .bind(user.id)
    .all();
  const connectedPairings = (pairingsResult.results || []) as any[];
  const pairing = connectedPairings.length > 0 ? connectedPairings[0] : null;

  if (pairing && pairing.client_id) {
    await syncTimezoneFromExeSignal(c.env.DB, {
      userId: user.id,
      clientId: (pairing as any).client_id,
      timezoneInput: (pairing as any).timezone_iana,
    });
  }

  const timezoneIana = await resolveUserGlobalTimezone(c.env.DB, user.id);
  const timezoneMeta = await c.env.DB.prepare(
    "SELECT timezone_source, timezone_updated_at FROM app_users WHERE id = ? LIMIT 1"
  )
    .bind(user.id)
    .first();

  if (!pairing) {
    const heartbeat = buildChatDesktopAgentAvailability(null);
    return c.json({
      status: "not_connected",
      effective_status: heartbeat.effective_status,
      chat_effective_status: heartbeat.chat_effective_status,
      is_available_for_chat: heartbeat.is_available_for_chat,
      is_heartbeat_fresh: heartbeat.is_heartbeat_fresh,
      last_seen_at: heartbeat.last_seen_at,
      last_seen_age_seconds: heartbeat.last_seen_age_seconds,
      connections: [],
      timezone_iana: timezoneIana,
      timezone_source: (timezoneMeta as any)?.timezone_source || null,
      timezone_updated_at: (timezoneMeta as any)?.timezone_updated_at || null,
    });
  }

  const heartbeat = buildChatDesktopAgentAvailability(pairing);

  return c.json({
    status: "connected",
    effective_status: heartbeat.effective_status,
    chat_effective_status: heartbeat.chat_effective_status,
    is_available_for_chat: heartbeat.is_available_for_chat,
    is_heartbeat_fresh: heartbeat.is_heartbeat_fresh,
    client_id: (pairing as any).client_id,
    exe_id: (pairing as any).exe_id,
    paired_at: (pairing as any).paired_at,
    last_seen_at: heartbeat.last_seen_at,
    last_seen_age_seconds: heartbeat.last_seen_age_seconds,
    connections: connectedPairings.map((row: any) => ({
      ...buildChatDesktopAgentAvailability(row),
      client_id: row.client_id,
      exe_id: row.exe_id,
      paired_at: row.paired_at,
      last_seen_at: row.last_seen_at,
      status: row.status,
      timezone_iana: row.timezone_iana ?? null,
      timezone_updated_at: row.timezone_updated_at ?? null,
    })),
    timezone_iana: timezoneIana,
    timezone_source: (timezoneMeta as any)?.timezone_source || null,
    timezone_updated_at: (timezoneMeta as any)?.timezone_updated_at || null,
  });
});

app.post("/api/pairing/disconnect", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  await c.env.DB.prepare(
    `UPDATE exe_pairings SET status = 'revoked', exe_token_hash = '', last_seen_at = ?
     WHERE user_id = ? AND status = 'connected'`
  )
    .bind(new Date().toISOString(), user.id)
    .run();

  return c.json({ success: true });
});




// EXE hit media upload endpoint (called by desktop agent) - NEW unified endpoint
app.post("/api/agent/hit-media", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = (pairing as any).user_id;

  const body = await c.req.json<{
    camera_id: number;
    chat_session_id: number;
    images?: Array<{ jpeg_base64: string; time_in_video?: string }>;
    videos?: Array<{ mp4_base64: string; time_in_video?: string }>;
  }>();

  if (!body.camera_id || !body.chat_session_id) {
    return c.json({ error: "camera_id and chat_session_id are required" }, 400);
  }

  const images = body.images || [];
  const videos = body.videos || [];

  if (images.length === 0 && videos.length === 0) {
    return c.json({ error: "At least one image or video is required" }, 400);
  }

  // Enforce size limits
  const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB
  const MAX_VIDEO_SIZE = 15 * 1024 * 1024; // 15MB
  const MAX_ITEMS_PER_REQUEST = 50;

  if (images.length + videos.length > MAX_ITEMS_PER_REQUEST) {
    return c.json({ error: `Maximum ${MAX_ITEMS_PER_REQUEST} items per request` }, 400);
  }

  const uploaded: Array<{ media_type: string; key: string; url: string; time_in_video?: string }> = [];

  // Process images
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    
    if (!img.jpeg_base64) {
      continue;
    }

    try {
      // Decode base64 to bytes
      const base64Data = img.jpeg_base64.replace(/^data:image\/jpeg;base64,/, '');
      const binaryString = atob(base64Data);
      
      // Check size
      if (binaryString.length > MAX_IMAGE_SIZE) {
        console.error(`[HIT MEDIA] Image ${i} exceeds size limit`);
        continue;
      }

      const bytes = new Uint8Array(binaryString.length);
      for (let j = 0; j < binaryString.length; j++) {
        bytes[j] = binaryString.charCodeAt(j);
      }

      // Build safe time string
      const safeTime = img.time_in_video 
        ? img.time_in_video.replace(/:/g, '_')
        : 'na';

      // Create unique R2 key
      const uuid = generateUUID();
      const key = `hit_media/${userId}/sessions/${body.chat_session_id}/camera_${body.camera_id}/${uuid}_${safeTime}.jpg`;

      // Upload to R2
      await c.env.R2_BUCKET.put(key, bytes, {
        httpMetadata: { contentType: "image/jpeg" },
      });

      // Insert into database with media_type
      await c.env.DB.prepare(
        `INSERT INTO chat_hit_images (user_id, chat_session_id, camera_id, r2_key, time_in_video, media_type, mime_type)
         VALUES (?, ?, ?, ?, ?, 'image', 'image/jpeg')`
      )
        .bind(userId, body.chat_session_id, body.camera_id, key, img.time_in_video || null)
        .run();

      // Build public URL
      const publicUrl = c.env.R2_PUBLIC_BASE_URL 
        ? `${c.env.R2_PUBLIC_BASE_URL}/${key}`
        : `/api/chat/hit-image?key=${encodeURIComponent(key)}`;

      uploaded.push({
        media_type: "image",
        key,
        url: publicUrl,
        time_in_video: img.time_in_video,
      });
    } catch (err) {
      console.error(`[HIT MEDIA] Failed to process image ${i}:`, err);
    }
  }

  // Process videos
  for (let i = 0; i < videos.length; i++) {
    const vid = videos[i];
    
    if (!vid.mp4_base64) {
      continue;
    }

    try {
      // Decode base64 to bytes
      const base64Data = vid.mp4_base64.replace(/^data:video\/mp4;base64,/, '');
      const binaryString = atob(base64Data);
      
      // Check size
      if (binaryString.length > MAX_VIDEO_SIZE) {
        console.error(`[HIT MEDIA] Video ${i} exceeds size limit`);
        continue;
      }

      const bytes = new Uint8Array(binaryString.length);
      for (let j = 0; j < binaryString.length; j++) {
        bytes[j] = binaryString.charCodeAt(j);
      }

      // Build safe time string
      const safeTime = vid.time_in_video 
        ? vid.time_in_video.replace(/:/g, '_')
        : 'na';

      // Create unique R2 key
      const uuid = generateUUID();
      const key = `hit_media/${userId}/sessions/${body.chat_session_id}/camera_${body.camera_id}/${uuid}_${safeTime}.mp4`;

      // Upload to R2
      await c.env.R2_BUCKET.put(key, bytes, {
        httpMetadata: { contentType: "video/mp4" },
      });

      // Insert into database with media_type
      await c.env.DB.prepare(
        `INSERT INTO chat_hit_images (user_id, chat_session_id, camera_id, r2_key, time_in_video, media_type, mime_type)
         VALUES (?, ?, ?, ?, ?, 'video', 'video/mp4')`
      )
        .bind(userId, body.chat_session_id, body.camera_id, key, vid.time_in_video || null)
        .run();

      // Build public URL
      const publicUrl = c.env.R2_PUBLIC_BASE_URL 
        ? `${c.env.R2_PUBLIC_BASE_URL}/${key}`
        : `/api/chat/hit-image?key=${encodeURIComponent(key)}`;

      uploaded.push({
        media_type: "video",
        key,
        url: publicUrl,
        time_in_video: vid.time_in_video,
      });
    } catch (err) {
      console.error(`[HIT MEDIA] Failed to process video ${i}:`, err);
    }
  }

  return c.json({ ok: true, items: uploaded });
});

app.post("/api/agent/drakon-find-hit-media", async (c) => {
  const url = new URL(c.req.url);
  const clientId = (url.searchParams.get("client_id") || "").trim();
  const searchId = clampInteger(url.searchParams.get("search_id"));
  const cameraId = clampInteger(url.searchParams.get("camera_id"));
  const attemptCount = Math.max(1, clampInteger(url.searchParams.get("attempt_count"), 1));
  const rawMediaType = normalizeDrakonFindText(url.searchParams.get("media_type"), 16).toLowerCase();
  const mediaType = rawMediaType === "image" ? "image" : "video";
  const timeInVideo = normalizeDrakonFindText(url.searchParams.get("time_in_video"), 32);

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }
  if (searchId <= 0 || cameraId <= 0) {
    return c.json({ error: "search_id and camera_id are required" }, 400);
  }

  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  const pairing = await c.env.DB.prepare(
    `SELECT user_id, exe_id
     FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const pairingExeId = String((pairing as any)?.exe_id || "");
  const assignment = await c.env.DB
    .prepare(
      `SELECT s.user_id AS operator_user_id,
              sc.assigned_client_id,
              sc.assigned_exe_id
       FROM drakon_find_searches s
       JOIN drakon_find_search_cameras sc
         ON sc.search_id = s.id
       WHERE s.id = ?
         AND sc.camera_id = ?
       LIMIT 1`
    )
    .bind(searchId, cameraId)
    .first();

  if (!assignment) {
    return c.json({ error: "Drakon Find assignment not found" }, 404);
  }

  const assignedClientId = String((assignment as any)?.assigned_client_id || "").trim();
  const assignedExeId = String((assignment as any)?.assigned_exe_id || "").trim();
  if (assignedClientId && assignedClientId !== clientId) {
    return c.json({ error: "Client is not assigned to this Drakon Find camera" }, 403);
  }
  if (assignedExeId && pairingExeId && assignedExeId !== pairingExeId) {
    return c.json({ error: "EXE is not assigned to this Drakon Find camera" }, 403);
  }

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength === 0) {
    return c.json({ error: "Request body is empty" }, 400);
  }
  if (bytes.byteLength > DRAKON_FIND_AGENT_MEDIA_MAX_BYTES) {
    return c.json({ error: "Drakon Find hit media exceeds the allowed size" }, 413);
  }

  const contentTypeHeader = (c.req.header("content-type") || "application/octet-stream")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const fallbackContentType = mediaType === "image" ? "image/jpeg" : "video/mp4";
  const contentType =
    mediaType === "image"
      ? contentTypeHeader.startsWith("image/")
        ? contentTypeHeader
        : fallbackContentType
      : contentTypeHeader.startsWith("video/")
      ? contentTypeHeader
      : fallbackContentType;

  const operatorUserId = String((assignment as any)?.operator_user_id || "").trim();
  const storageKey = buildDrakonFindHitStorageKey(
    operatorUserId,
    searchId,
    cameraId,
    contentType
  );

  await c.env.R2_BUCKET.put(storageKey, bytes, {
    httpMetadata: { contentType },
  });

  const mediaUrl =
    mediaType === "image"
      ? buildDrakonFindHitImageUrl(storageKey)
      : buildDrakonFindHitVideoUrl(storageKey);

  return c.json({
    success: true,
    key: storageKey,
    url: mediaUrl,
    media_type: mediaType,
    search_id: searchId,
    camera_id: cameraId,
    attempt_count: attemptCount,
    time_in_video: timeInVideo || null,
  });
});

// EXE hit images upload endpoint (called by desktop agent) - LEGACY - kept for backwards compatibility
app.post("/api/agent/hit-images", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = (pairing as any).user_id;

  const body = await c.req.json<{
    camera_id: number;
    chat_session_id: number;
    images: Array<{ jpeg_base64: string; time_in_video?: string }>;
  }>();

  if (!body.camera_id || !body.chat_session_id) {
    return c.json({ error: "camera_id and chat_session_id are required" }, 400);
  }

  if (!Array.isArray(body.images) || body.images.length === 0) {
    return c.json({ error: "images must be a non-empty array" }, 400);
  }

  const uploaded: Array<{ key: string; url: string; time_in_video?: string }> = [];
  const now = Date.now();

  for (let i = 0; i < body.images.length; i++) {
    const img = body.images[i];
    
    if (!img.jpeg_base64) {
      continue;
    }

    try {
      // Decode base64 to bytes
      const base64Data = img.jpeg_base64.replace(/^data:image\/jpeg;base64,/, '');
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let j = 0; j < binaryString.length; j++) {
        bytes[j] = binaryString.charCodeAt(j);
      }

      // Build safe time string
      const safeTime = img.time_in_video 
        ? img.time_in_video.replace(/:/g, '_')
        : 'na';

      // Create unique R2 key
      const key = `hits/user_${userId}/cam_${body.camera_id}/chat_${body.chat_session_id}/${now}_${i}_${safeTime}.jpg`;

      // Upload to R2
      await c.env.R2_BUCKET.put(key, bytes, {
        httpMetadata: { contentType: "image/jpeg" },
      });

      // Insert into database with media_type='image' for backwards compatibility
      await c.env.DB.prepare(
        `INSERT INTO chat_hit_images (user_id, chat_session_id, camera_id, r2_key, time_in_video, media_type, mime_type)
         VALUES (?, ?, ?, ?, ?, 'image', 'image/jpeg')`
      )
        .bind(userId, body.chat_session_id, body.camera_id, key, img.time_in_video || null)
        .run();

      // Build public URL - use R2_PUBLIC_BASE_URL if available, else use authenticated endpoint
      const publicUrl = c.env.R2_PUBLIC_BASE_URL 
        ? `${c.env.R2_PUBLIC_BASE_URL}/${key}`
        : `/api/chat/hit-image?key=${encodeURIComponent(key)}`;

      uploaded.push({
        key,
        url: publicUrl,
        time_in_video: img.time_in_video,
      });
    } catch (err) {
      console.error(`[HIT IMAGES] Failed to process image ${i}:`, err);
      // Continue with other images
    }
  }

  return c.json({ ok: true, uploaded });
});

// EXE thumbnail upload endpoint (called by desktop agent)
app.post("/api/agent/thumbnails", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  const authHeader =
    c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = (pairing as any).user_id;

  const body = await c.req.json<{
    camera_id: number;
    jpeg_base64: string;
  }>();

  if (!body.camera_id || !body.jpeg_base64) {
    return c.json({ error: "camera_id and jpeg_base64 are required" }, 400);
  }

  // Get old thumbnail URL to delete it
  const camera = await c.env.DB.prepare(
    `SELECT thumbnail_url FROM cameras WHERE id = ? AND user_id = ?`
  )
    .bind(body.camera_id, userId)
    .first();

  const oldThumbnailUrl = camera ? (camera as any).thumbnail_url : null;

  // Decode base64 to bytes
  const base64Data = body.jpeg_base64.replace(/^data:image\/jpeg;base64,/, '');
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Create unique filename with timestamp to avoid caching issues
  const timestamp = Date.now();
  const filename = `user_${userId}_camera_${body.camera_id}_${timestamp}.jpg`;

  // Upload new thumbnail to R2
  await c.env.R2_BUCKET.put(`thumbs/${filename}`, bytes, {
    httpMetadata: { contentType: "image/jpeg" },
  });

  const now = new Date().toISOString();

  // Update camera table - also set is_online=1 as a heartbeat since we're receiving frames
  await c.env.DB.prepare(
    `UPDATE cameras
     SET thumbnail_url = ?, is_online = 1, last_thumbnail_update = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  )
    .bind(filename, now, now, body.camera_id, userId)
    .run();

  // Delete old thumbnail from R2 to avoid unbounded storage
  if (oldThumbnailUrl) {
    try {
      await c.env.R2_BUCKET.delete(`thumbs/${oldThumbnailUrl}`);
    } catch (err) {
      console.log(`Failed to delete old thumbnail: ${oldThumbnailUrl}`, err);
    }
  }

  return c.json({ ok: true, filename });
});

app.post("/api/agent/job-alert-media", async (c) => {
  const url = new URL(c.req.url);
  const clientId = (url.searchParams.get("client_id") || "").trim();
  const cameraId = Number(url.searchParams.get("camera_id"));
  const jobId = (url.searchParams.get("job_id") || "").trim();
  const stepId = (url.searchParams.get("step_id") || "").trim();

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }
  if (!Number.isInteger(cameraId) || cameraId <= 0) {
    return c.json({ error: "camera_id is required" }, 400);
  }
  if (!jobId || !stepId) {
    return c.json({ error: "job_id and step_id are required" }, 400);
  }

  const authHeader =
    c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  const pairing = await c.env.DB.prepare(
    `SELECT user_id
     FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength === 0) {
    return c.json({ error: "video body is required" }, 400);
  }
  if (bytes.byteLength > JOB_ALERT_MEDIA_MAX_VIDEO_BYTES) {
    return c.json(
      {
        error: "video exceeds max upload budget",
        max_bytes: JOB_ALERT_MEDIA_MAX_VIDEO_BYTES,
        received_bytes: bytes.byteLength,
      },
      413
    );
  }

  const sanitizeKeyToken = (value: unknown, fallback = "na") => {
    const raw = String(value ?? fallback).trim();
    const token = raw.length > 0 ? raw : fallback;
    return token.replace(/[^a-zA-Z0-9._-]/g, "_");
  };
  const mediaPublicBase = String(c.env.R2_PUBLIC_BASE_URL || "/media").replace(/\/+$/, "");
  const buildMediaUrl = (key: string) => {
    const encodedKey = key
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `${mediaPublicBase}/${encodedKey}`;
  };
  const safeUser = sanitizeKeyToken((pairing as any).user_id, "user");
  const safeJob = sanitizeKeyToken(jobId, "job");
  const safeStep = sanitizeKeyToken(stepId, "step");
  const safeCamera = sanitizeKeyToken(cameraId, "cam");
  const key = `job_alert_media/${safeUser}/jobs/${safeJob}/steps/${safeStep}/cam_${safeCamera}/${Date.now()}_${generateUUID()}.mp4`;

  await c.env.R2_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: "video/mp4" },
  });

  return c.json({
    ok: true,
    media_type: "video",
    size_bytes: bytes.byteLength,
    video_key: key,
    video_url: buildMediaUrl(key),
  });
});

// WebSocket endpoint for chat sessions
app.get("/ws/chat/:sessionId", anyAuthMiddleware, upgradeWebSocket((c) => {
  const sessionId = parseInt(c.req.param("sessionId")!, 10);
  const user = c.get("user")!;

  return {
    onOpen(_event: any, ws: any) {
      console.log(`[WS] Client connected to session ${sessionId} for user ${user.id}`);
      wsHandler.handleUpgrade(sessionId, ws.raw);
    },
    onMessage(event: any) {
      console.log(`[WS] Message from client:`, event.data);
    },
    onClose() {
      console.log(`[WS] Client disconnected from session ${sessionId}`);
    },
    onError(event: any) {
      console.error(`[WS] Error:`, event);
    },
  };
}));

// EXE capture thread metrics endpoint (called by desktop agent)
app.post("/api/agent/capture-thread-metrics", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await ensureSchema(c.env.DB);

  const pairingRow = pairing as any;
  const userId = String(pairingRow.user_id || "");
  const resolvedClientId = String(pairingRow.client_id || clientId);
  const resolvedExeId = String(pairingRow.exe_id || "unknown_exe");
  const now = new Date().toISOString();

  type CaptureThreadMetricsRequestBody = {
    samples?: Array<{
      camera_id?: number | string | null;
      thread_name?: string | null;
      cpu_percent?: number | string | null;
      capture_mem_estimated_bytes?: number | string | null;
      process_working_set_bytes?: number | string | null;
      process_private_bytes?: number | string | null;
      queue_depth?: number | string | null;
      sampled_at?: string | null;
    }>;
  };
  const body: CaptureThreadMetricsRequestBody =
    await c.req.json<CaptureThreadMetricsRequestBody>()
      .catch((): CaptureThreadMetricsRequestBody => ({}));

  const inputSamples = Array.isArray(body.samples) ? body.samples : [];
  if (inputSamples.length === 0) {
    return c.json({ ok: true, received: 0, upserted: 0, dropped: 0 });
  }

  if (inputSamples.length > 512) {
    return c.json({ error: "Too many samples. Maximum is 512 per request." }, 400);
  }

  const toNonNegativeInt = (value: unknown): number => {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return 0;
    if (numeric <= 0) return 0;
    const clipped = Math.floor(numeric);
    return clipped > 9_223_372_036_854_775_000 ? 9_223_372_036_854_775_000 : clipped;
  };

  const toCpuPercent = (value: unknown): number => {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    if (numeric > 10000) return 10000;
    return numeric;
  };

  const normalizeSampledAt = (value: unknown): string => {
    if (typeof value !== "string" || !value.trim()) return now;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return now;
    return new Date(parsed).toISOString();
  };

  let upserted = 0;
  let dropped = 0;

  for (const rawSample of inputSamples) {
    const rawCameraId = rawSample?.camera_id;
    const cameraIdNum = typeof rawCameraId === "string"
      ? parseInt(rawCameraId, 10)
      : typeof rawCameraId === "number"
      ? rawCameraId
      : NaN;

    if (!Number.isInteger(cameraIdNum) || cameraIdNum <= 0) {
      dropped += 1;
      continue;
    }

    const threadNameRaw = typeof rawSample?.thread_name === "string"
      ? rawSample.thread_name.trim()
      : "";
    if (!threadNameRaw) {
      dropped += 1;
      continue;
    }
    const threadName = threadNameRaw.slice(0, 80);

    const cpuPercent = toCpuPercent(rawSample?.cpu_percent);
    const captureMemEstimatedBytes = toNonNegativeInt(rawSample?.capture_mem_estimated_bytes);
    const processWorkingSetBytes = toNonNegativeInt(rawSample?.process_working_set_bytes);
    const processPrivateBytes = toNonNegativeInt(rawSample?.process_private_bytes);
    const queueDepth = toNonNegativeInt(rawSample?.queue_depth);
    const sampledAt = normalizeSampledAt(rawSample?.sampled_at);

    try {
      await c.env.DB.prepare(
        `INSERT INTO capture_thread_metrics_latest (
           user_id,
           client_id,
           exe_id,
           camera_id,
           thread_name,
           cpu_percent,
           capture_mem_estimated_bytes,
           process_working_set_bytes,
           process_private_bytes,
           queue_depth,
           sampled_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, client_id, camera_id, thread_name) DO UPDATE SET
           exe_id = excluded.exe_id,
           cpu_percent = excluded.cpu_percent,
           capture_mem_estimated_bytes = excluded.capture_mem_estimated_bytes,
           process_working_set_bytes = excluded.process_working_set_bytes,
           process_private_bytes = excluded.process_private_bytes,
           queue_depth = excluded.queue_depth,
           sampled_at = excluded.sampled_at,
           updated_at = excluded.updated_at`
      )
        .bind(
          userId,
          resolvedClientId,
          resolvedExeId,
          cameraIdNum,
          threadName,
          cpuPercent,
          captureMemEstimatedBytes,
          processWorkingSetBytes,
          processPrivateBytes,
          queueDepth,
          sampledAt,
          now
        )
        .run();

      upserted += 1;
    } catch (error) {
      console.error("[CAPTURE THREAD METRICS] Upsert failed:", error);
      dropped += 1;
    }
  }

  return c.json({
    ok: true,
    received: inputSamples.length,
    upserted,
    dropped,
  });
});

app.post("/api/agent/open-monitor-snapshot", async (c) => {
  const url = new URL(c.req.url);
  const clientId = String(url.searchParams.get("client_id") || "").trim();
  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  const pairing = await resolveAgentPairingForClient(c.env.DB, clientId, authHeader);
  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await ensureSchema(c.env.DB);

  type OpenMonitorSnapshotRequestBody = {
    snapshot_id?: string | null;
    sampled_at?: string | null;
    host?: Record<string, unknown> | null;
    process?: Record<string, unknown> | null;
    cameras?: Array<Record<string, unknown>> | null;
    threads?: Array<Record<string, unknown>> | null;
    job_steps?: Array<Record<string, unknown>> | null;
  };

  const now = openMonitorNowIso();
  const body: OpenMonitorSnapshotRequestBody =
    await c.req.json<OpenMonitorSnapshotRequestBody>().catch(() => ({}));
  const hasCamerasField = Array.isArray(body.cameras);
  const hasThreadsField = Array.isArray(body.threads);
  const hasJobStepsField = Array.isArray(body.job_steps);
  const sampledAtDefault = openMonitorNormalizeIso(body.sampled_at, now);
  const snapshotId = openMonitorNormalizeSnapshotId(
    body.snapshot_id,
    openMonitorBuildSnapshotId(now)
  );
  const hostPayload = openMonitorParseObject(body.host);
  const processPayload = openMonitorParseObject(body.process);
  const cameraPayloads = openMonitorParseArray(body.cameras);
  const threadPayloads = openMonitorParseArray(body.threads);
  const jobStepPayloads = openMonitorParseArray(body.job_steps);

  if (cameraPayloads.length > 512 || threadPayloads.length > 1024 || jobStepPayloads.length > 1024) {
    return c.json({ error: "Too many open monitor samples in a single request." }, 400);
  }

  let upserted = 0;
  let dropped = 0;
  let cameraLatestWriteFailed = false;
  let threadLatestWriteFailed = false;
  let jobStepLatestWriteFailed = false;

  if (Object.keys(hostPayload).length > 0) {
    const sampledAt = openMonitorNormalizeIso(hostPayload.sampled_at, sampledAtDefault);
    try {
      await c.env.DB.prepare(
        `INSERT INTO open_monitor_host_latest (
           user_id,
           client_id,
           exe_id,
           sampled_at,
           updated_at,
           snapshot_id,
           cpu_total_percent,
           cpu_hottest_core_percent,
           logical_cores,
           ram_total_bytes,
           ram_used_bytes,
           ram_available_bytes,
           disk_total_bytes,
           disk_free_bytes,
           net_rx_bytes_per_sec,
           net_tx_bytes_per_sec,
           payload_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, client_id) DO UPDATE SET
           exe_id = excluded.exe_id,
           sampled_at = excluded.sampled_at,
           updated_at = excluded.updated_at,
           snapshot_id = excluded.snapshot_id,
           cpu_total_percent = excluded.cpu_total_percent,
           cpu_hottest_core_percent = excluded.cpu_hottest_core_percent,
           logical_cores = excluded.logical_cores,
           ram_total_bytes = excluded.ram_total_bytes,
           ram_used_bytes = excluded.ram_used_bytes,
           ram_available_bytes = excluded.ram_available_bytes,
           disk_total_bytes = excluded.disk_total_bytes,
           disk_free_bytes = excluded.disk_free_bytes,
           net_rx_bytes_per_sec = excluded.net_rx_bytes_per_sec,
           net_tx_bytes_per_sec = excluded.net_tx_bytes_per_sec,
           payload_json = excluded.payload_json`
      )
        .bind(
          pairing.userId,
          pairing.clientId,
          pairing.exeId,
          sampledAt,
          now,
          snapshotId,
          openMonitorToFiniteNumber(hostPayload.cpu_total_percent),
          openMonitorToFiniteNumber(hostPayload.cpu_hottest_core_percent),
          openMonitorToNonNegativeInt(hostPayload.logical_cores),
          openMonitorToNonNegativeInt(hostPayload.ram_total_bytes),
          openMonitorToNonNegativeInt(hostPayload.ram_used_bytes),
          openMonitorToNonNegativeInt(hostPayload.ram_available_bytes),
          openMonitorToNonNegativeInt(hostPayload.disk_total_bytes),
          openMonitorToNonNegativeInt(hostPayload.disk_free_bytes),
          openMonitorToFiniteNumber(hostPayload.net_rx_bytes_per_sec),
          openMonitorToFiniteNumber(hostPayload.net_tx_bytes_per_sec),
          openMonitorSafeJson(hostPayload)
        )
        .run();

      upserted += 1;
    } catch (error) {
      console.error("[OPEN MONITOR] Failed to persist host snapshot:", error);
      dropped += 1;
    }
  }

  if (Object.keys(processPayload).length > 0) {
    const sampledAt = openMonitorNormalizeIso(processPayload.sampled_at, sampledAtDefault);
    try {
      await c.env.DB.prepare(
        `INSERT INTO open_monitor_process_latest (
           user_id,
           client_id,
           exe_id,
           sampled_at,
           updated_at,
           snapshot_id,
           process_cpu_percent,
           working_set_bytes,
           private_bytes,
           handle_count,
           thread_count,
           uptime_seconds,
           active_cameras,
           unique_streams,
           total_consumers,
           payload_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, client_id) DO UPDATE SET
           exe_id = excluded.exe_id,
           sampled_at = excluded.sampled_at,
           updated_at = excluded.updated_at,
           snapshot_id = excluded.snapshot_id,
           process_cpu_percent = excluded.process_cpu_percent,
           working_set_bytes = excluded.working_set_bytes,
           private_bytes = excluded.private_bytes,
           handle_count = excluded.handle_count,
           thread_count = excluded.thread_count,
           uptime_seconds = excluded.uptime_seconds,
           active_cameras = excluded.active_cameras,
           unique_streams = excluded.unique_streams,
           total_consumers = excluded.total_consumers,
           payload_json = excluded.payload_json`
      )
        .bind(
          pairing.userId,
          pairing.clientId,
          pairing.exeId,
          sampledAt,
          now,
          snapshotId,
          openMonitorToFiniteNumber(processPayload.process_cpu_percent),
          openMonitorToNonNegativeInt(processPayload.working_set_bytes),
          openMonitorToNonNegativeInt(processPayload.private_bytes),
          openMonitorToNonNegativeInt(processPayload.handle_count),
          openMonitorToNonNegativeInt(processPayload.thread_count),
          openMonitorToNonNegativeInt(processPayload.uptime_seconds),
          openMonitorToNonNegativeInt(processPayload.active_cameras),
          openMonitorToNonNegativeInt(processPayload.unique_streams),
          openMonitorToNonNegativeInt(processPayload.total_consumers),
          openMonitorSafeJson(processPayload)
        )
        .run();

      upserted += 1;
    } catch (error) {
      console.error("[OPEN MONITOR] Failed to persist process snapshot:", error);
      dropped += 1;
    }
  }

  for (const cameraPayload of cameraPayloads) {
    const cameraId = openMonitorToNonNegativeInt(cameraPayload.camera_id);
    if (cameraId <= 0) {
      dropped += 1;
      continue;
    }

    const sampledAt = openMonitorNormalizeIso(cameraPayload.sampled_at, sampledAtDefault);
    try {
      await c.env.DB.prepare(
        `INSERT INTO open_monitor_camera_latest (
           user_id,
           client_id,
           exe_id,
           camera_id,
           sampled_at,
           updated_at,
           snapshot_id,
           actual_fps,
           expected_fps,
           last_frame_age_ms,
           queue_depth,
           overwritten_frames,
           reconnect_count,
           consumer_count,
           payload_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, client_id, camera_id) DO UPDATE SET
           exe_id = excluded.exe_id,
           sampled_at = excluded.sampled_at,
           updated_at = excluded.updated_at,
           snapshot_id = excluded.snapshot_id,
           actual_fps = excluded.actual_fps,
           expected_fps = excluded.expected_fps,
           last_frame_age_ms = excluded.last_frame_age_ms,
           queue_depth = excluded.queue_depth,
           overwritten_frames = excluded.overwritten_frames,
           reconnect_count = excluded.reconnect_count,
           consumer_count = excluded.consumer_count,
           payload_json = excluded.payload_json`
      )
        .bind(
          pairing.userId,
          pairing.clientId,
          pairing.exeId,
          cameraId,
          sampledAt,
          now,
          snapshotId,
          openMonitorToFiniteNumber(cameraPayload.actual_fps),
          openMonitorToFiniteNumber(cameraPayload.expected_fps),
          openMonitorToNonNegativeInt(cameraPayload.last_frame_age_ms),
          openMonitorToNonNegativeInt(cameraPayload.queue_depth),
          openMonitorToNonNegativeInt(cameraPayload.overwritten_frames),
          openMonitorToNonNegativeInt(cameraPayload.reconnect_count),
          openMonitorToNonNegativeInt(cameraPayload.consumer_count),
          openMonitorSafeJson(cameraPayload)
        )
        .run();

      upserted += 1;
    } catch (error) {
      console.error("[OPEN MONITOR] Failed to persist camera snapshot:", error);
      cameraLatestWriteFailed = true;
      dropped += 1;
    }
  }

  for (const threadPayload of threadPayloads) {
    const cameraId = openMonitorToNonNegativeInt(threadPayload.camera_id);
    const threadName = typeof threadPayload.thread_name === "string" ? threadPayload.thread_name.trim().slice(0, 80) : "";
    if (cameraId <= 0 || !threadName) {
      dropped += 1;
      continue;
    }

    const sampledAt = openMonitorNormalizeIso(threadPayload.sampled_at, sampledAtDefault);
    try {
      await c.env.DB.prepare(
        `INSERT INTO open_monitor_thread_latest (
           user_id,
           client_id,
           exe_id,
           camera_id,
           thread_name,
           sampled_at,
           updated_at,
           snapshot_id,
           thread_cpu_percent,
           queue_depth,
           dropped_items,
           payload_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, client_id, camera_id, thread_name) DO UPDATE SET
           exe_id = excluded.exe_id,
           sampled_at = excluded.sampled_at,
           updated_at = excluded.updated_at,
           snapshot_id = excluded.snapshot_id,
           thread_cpu_percent = excluded.thread_cpu_percent,
           queue_depth = excluded.queue_depth,
           dropped_items = excluded.dropped_items,
           payload_json = excluded.payload_json`
      )
        .bind(
          pairing.userId,
          pairing.clientId,
          pairing.exeId,
          cameraId,
          threadName,
          sampledAt,
          now,
          snapshotId,
          openMonitorToFiniteNumber(threadPayload.thread_cpu_percent),
          openMonitorToNonNegativeInt(threadPayload.queue_depth),
          openMonitorToNonNegativeInt(threadPayload.dropped_items),
          openMonitorSafeJson(threadPayload)
        )
        .run();

      upserted += 1;
    } catch (error) {
      console.error("[OPEN MONITOR] Failed to persist thread snapshot:", error);
      threadLatestWriteFailed = true;
      dropped += 1;
    }
  }

  for (const jobStepPayload of jobStepPayloads) {
    const jobId = openMonitorToNonNegativeInt(jobStepPayload.job_id);
    const stepId = openMonitorToNonNegativeInt(jobStepPayload.step_id);
    if (jobId <= 0 || stepId <= 0) {
      dropped += 1;
      continue;
    }

    const sampledAt = openMonitorNormalizeIso(jobStepPayload.sampled_at, sampledAtDefault);
    const status =
      typeof jobStepPayload.status === "string" && jobStepPayload.status.trim()
        ? jobStepPayload.status.trim().slice(0, 32)
        : null;
    try {
      await c.env.DB.prepare(
        `INSERT INTO open_monitor_job_step_latest (
           user_id,
           client_id,
           exe_id,
           job_id,
           step_id,
           sampled_at,
           updated_at,
           snapshot_id,
           status,
           camera_count,
           total_consumers,
           queue_depth,
           retry_count,
           timeout_count,
           error_count,
           payload_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, client_id, job_id, step_id) DO UPDATE SET
           exe_id = excluded.exe_id,
           sampled_at = excluded.sampled_at,
           updated_at = excluded.updated_at,
           snapshot_id = excluded.snapshot_id,
           status = excluded.status,
           camera_count = excluded.camera_count,
           total_consumers = excluded.total_consumers,
           queue_depth = excluded.queue_depth,
           retry_count = excluded.retry_count,
           timeout_count = excluded.timeout_count,
           error_count = excluded.error_count,
           payload_json = excluded.payload_json`
      )
        .bind(
          pairing.userId,
          pairing.clientId,
          pairing.exeId,
          jobId,
          stepId,
          sampledAt,
          now,
          snapshotId,
          status,
          openMonitorToNonNegativeInt(jobStepPayload.camera_count),
          openMonitorToNonNegativeInt(jobStepPayload.total_consumers),
          openMonitorToNonNegativeInt(jobStepPayload.queue_depth),
          openMonitorToNonNegativeInt(jobStepPayload.retry_count),
          openMonitorToNonNegativeInt(jobStepPayload.timeout_count),
          openMonitorToNonNegativeInt(jobStepPayload.error_count),
          openMonitorSafeJson(jobStepPayload)
        )
        .run();

      upserted += 1;
    } catch (error) {
      console.error("[OPEN MONITOR] Failed to persist job-step snapshot:", error);
      jobStepLatestWriteFailed = true;
      dropped += 1;
    }
  }

  if (hasCamerasField && !cameraLatestWriteFailed) {
    await openMonitorPruneLatestRowsBySnapshot(
      c.env.DB,
      "open_monitor_camera_latest",
      pairing.userId,
      pairing.clientId,
      snapshotId
    );
  }

  if (hasThreadsField && !threadLatestWriteFailed) {
    await openMonitorPruneLatestRowsBySnapshot(
      c.env.DB,
      "open_monitor_thread_latest",
      pairing.userId,
      pairing.clientId,
      snapshotId
    );
  }

  if (hasJobStepsField && !jobStepLatestWriteFailed) {
    await openMonitorPruneLatestRowsBySnapshot(
      c.env.DB,
      "open_monitor_job_step_latest",
      pairing.userId,
      pairing.clientId,
      snapshotId
    );
  }

  return c.json({
    ok: true,
    snapshot_id: snapshotId,
    received: {
      host: Object.keys(hostPayload).length > 0 ? 1 : 0,
      process: Object.keys(processPayload).length > 0 ? 1 : 0,
      cameras: cameraPayloads.length,
      threads: threadPayloads.length,
      job_steps: jobStepPayloads.length,
    },
    upserted,
    dropped,
  });
});

// EXE error logs endpoint (called by desktop agent logger worker)
app.post("/api/agent/error-logs", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await ensureSchema(c.env.DB);

  const pairingRow = pairing as any;
  const userId = String(pairingRow.user_id || "");
  const resolvedClientId = String(pairingRow.client_id || clientId);
  const resolvedExeId = String(pairingRow.exe_id || "unknown_exe");
  const now = new Date().toISOString();

  type AgentErrorLogsRequestBody = {
    logs?: Array<{
      source_id?: string | null;
      level?: string | null;
      message?: string | null;
      flow?: string | null;
      function_name?: string | null;
      operation?: string | null;
      context_json?: string | Record<string, unknown> | null;
      occurred_at?: string | null;
      client_id?: string | null;
      exe_id?: string | null;
    }>;
  };

  const body: AgentErrorLogsRequestBody =
    await c.req.json<AgentErrorLogsRequestBody>()
      .catch((): AgentErrorLogsRequestBody => ({}));

  const inputLogs = Array.isArray(body.logs) ? body.logs : [];
  if (inputLogs.length === 0) {
    return c.json({ ok: true, received: 0, inserted: 0, dropped: 0 });
  }

  if (inputLogs.length > 512) {
    return c.json({ error: "Too many logs. Maximum is 512 per request." }, 400);
  }

  const normalizeOccurredAt = (value: unknown): string => {
    if (typeof value !== "string" || !value.trim()) return now;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return now;
    return new Date(parsed).toISOString();
  };

  const normalizeLevel = (value: unknown): string => {
    const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (raw === "WARN" || raw === "WARNING") return "WARN";
    if (raw === "INFO") return "INFO";
    if (raw === "DEBUG") return "DEBUG";
    return "ERROR";
  };

  const normalizeOptionalText = (
    value: unknown,
    maxLen: number,
    transform?: (value: string) => string
  ): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = transform ? transform(trimmed) : trimmed;
    if (!normalized) return null;
    return normalized.slice(0, maxLen);
  };

  const normalizeContextJson = (value: unknown): string | null => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      return trimmed.slice(0, 8000);
    }
    if (value && typeof value === "object") {
      try {
        const serialized = JSON.stringify(value);
        if (!serialized) return null;
        return serialized.slice(0, 8000);
      } catch {
        return null;
      }
    }
    return null;
  };

  let inserted = 0;
  let dropped = 0;

  for (const rawLog of inputLogs) {
    const message = typeof rawLog?.message === "string"
      ? rawLog.message.trim()
      : "";

    if (!message) {
      dropped += 1;
      continue;
    }

    const sourceIdRaw = typeof rawLog?.source_id === "string"
      ? rawLog.source_id.trim()
      : "";
    const sourceId = (sourceIdRaw || "agent").slice(0, 128);
    const level = normalizeLevel(rawLog?.level);
    const flow = normalizeOptionalText(rawLog?.flow, 64, (value) => value.toLowerCase());
    const functionName = normalizeOptionalText(rawLog?.function_name, 256);
    const operation = normalizeOptionalText(rawLog?.operation, 128);
    const contextJson = normalizeContextJson(rawLog?.context_json);
    const occurredAt = normalizeOccurredAt(rawLog?.occurred_at);
    const messageTrimmed = message.slice(0, 4000);

    try {
      await c.env.DB.prepare(
        `INSERT INTO agent_error_logs (
           user_id,
           client_id,
           exe_id,
           source_id,
           level,
           message,
           flow,
           function_name,
           operation,
           context_json,
           occurred_at,
           created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          userId,
          resolvedClientId,
          resolvedExeId,
          sourceId,
          level,
          messageTrimmed,
          flow,
          functionName,
          operation,
          contextJson,
          occurredAt,
          now
        )
        .run();

      inserted += 1;
    } catch (error) {
      console.error("[AGENT ERROR LOGS] Insert failed:", error);
      dropped += 1;
    }
  }

  return c.json({
    ok: true,
    received: inputLogs.length,
    inserted,
    dropped,
  });
});

// EXE token usage endpoint (called by desktop agent to report AI inference token usage)
app.post("/api/agent/token-usage", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const pairingRow = pairing as any;
  const userId = pairingRow.user_id;

  const body = await c.req.json<{
    camera_id: number | string;
    prompt_tokens: number;
    output_tokens: number;
    total_tokens: number;
    source?: string;
    algo_type?: string;
  }>();

  let { camera_id, prompt_tokens, output_tokens, total_tokens, source, algo_type } = body;

  const cameraIdNum =
    typeof camera_id === "string" ? parseInt(camera_id, 10) : camera_id;

  if (!cameraIdNum || Number.isNaN(cameraIdNum) ||
      prompt_tokens === undefined || output_tokens === undefined ||
      total_tokens === undefined) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  // Find active camera subscription for this user (plan-level, not per camera_id)
  const subscription = await c.env.DB.prepare(
    `SELECT *
     FROM subscriptions
     WHERE user_id = ?
       AND subscription_type LIKE 'camera_monitoring%'
       AND is_active = 1
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
     ORDER BY started_at DESC
     LIMIT 1`
  )
    .bind(userId)
    .first();

  if (!subscription) {
    return c.json({
      status: "stop",
      reason: "no_active_subscription"
    });
  }

  // Convert tokens to millions
  const promptTokensM = prompt_tokens / 1_000_000;
  const outputTokensM = output_tokens / 1_000_000;

  const nowIso = new Date().toISOString();

  try {
    // Insert usage record
    await c.env.DB.prepare(
      `INSERT INTO subscription_token_usage (
        subscription_id,
        camera_id,
        event_time,
        prompt_tokens,
        output_tokens,
        total_tokens,
        source,
        algo_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        (subscription as any).id,
        cameraIdNum,
        nowIso,
        prompt_tokens,
        output_tokens,
        total_tokens,
        source || null,
        algo_type || null
      )
      .run();

    // Update subscription running totals
    await c.env.DB.prepare(
      `UPDATE subscriptions
       SET "InputTokensUsedM" = "InputTokensUsedM" + ?,
           "OutputTokensUsedM" = "OutputTokensUsedM" + ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(promptTokensM, outputTokensM, (subscription as any).id)
      .run();

    // Re-fetch subscription to get updated totals
    const updatedSubscription = await c.env.DB.prepare(
      `SELECT * FROM subscriptions WHERE id = ?`
    )
      .bind((subscription as any).id)
      .first();

    const sub = updatedSubscription as any;

    // Calculate remaining tokens and ratios
    const remainingInputM = sub.InputTokensM - sub.InputTokensUsedM;
    const remainingOutputM = sub.OutputTokensM - sub.OutputTokensUsedM;

    const inputRatio = sub.InputTokensUsedM / sub.InputTokensM;
    const outputRatio = sub.OutputTokensUsedM / sub.OutputTokensM;

    const HARD_LIMIT = 1.0;
    const SOFT_LIMIT = 0.9;

    // Check limits
    if (inputRatio >= HARD_LIMIT || outputRatio >= HARD_LIMIT) {
      return c.json({
        status: "stop",
        reason: "token_limit_reached",
        remaining_input_m: Math.max(remainingInputM, 0),
        remaining_output_m: Math.max(remainingOutputM, 0)
      });
    } else if (inputRatio >= SOFT_LIMIT || outputRatio >= SOFT_LIMIT) {
      return c.json({
        status: "warn",
        reason: "token_usage_high",
        remaining_input_m: remainingInputM,
        remaining_output_m: remainingOutputM
      });
    } else {
      return c.json({
        status: "ok",
        reason: null,
        remaining_input_m: remainingInputM,
        remaining_output_m: remainingOutputM
      });
    }
  } catch (error) {
    console.error("Error in /api/agent/token-usage:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

function normalizeChatProgressPayload(progress: any) {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) {
    return null;
  }

  const toPositiveInt = (value: unknown): number => {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.floor(numeric);
  };

  const normalized = {
    skill: typeof progress.skill === "string" ? progress.skill.trim() : "",
    phase: typeof progress.phase === "string" ? progress.phase.trim() : "",
    sequence: toPositiveInt(progress.sequence),
    headline: typeof progress.headline === "string" ? progress.headline.trim() : "",
    detail: typeof progress.detail === "string" ? progress.detail.trim() : "",
    step_index: toPositiveInt(progress.step_index),
    step_count: toPositiveInt(progress.step_count),
  };

  if (
    !normalized.skill &&
    !normalized.phase &&
    !normalized.headline &&
    !normalized.detail &&
    normalized.sequence === 0
  ) {
    return null;
  }

  return normalized;
}

function parseChatProgressSequence(progressJson: unknown): number {
  if (typeof progressJson !== "string" || !progressJson.trim()) {
    return 0;
  }

  try {
    const parsed = JSON.parse(progressJson);
    const numeric =
      typeof parsed?.sequence === "number" ? parsed.sequence : Number(parsed?.sequence);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return 0;
    }
    return Math.floor(numeric);
  } catch {
    return 0;
  }
}

app.post("/api/agent/chat-progress", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = (pairing as any).user_id;
  const body = await c.req.json<{
    chat_session_id?: number;
    command_id?: number;
    progress?: any;
  }>();

  const chatSessionId = Number(body?.chat_session_id || 0);
  if (!Number.isInteger(chatSessionId) || chatSessionId <= 0) {
    return c.json({ error: "chat_session_id is required" }, 400);
  }

  const commandIdRaw = typeof body?.command_id === "number" ? body.command_id : Number(body?.command_id);
  const commandId = Number.isInteger(commandIdRaw) && commandIdRaw > 0 ? commandIdRaw : null;
  const normalizedProgress = normalizeChatProgressPayload(body?.progress);
  if (!normalizedProgress) {
    return c.json({ error: "progress payload is required" }, 400);
  }

  const session = await c.env.DB.prepare(
    "SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?"
  )
    .bind(chatSessionId, userId)
    .first();

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  if (commandId) {
    const command = await c.env.DB.prepare(
      `SELECT status
       FROM commands
       WHERE id = ? AND user_id = ?
       LIMIT 1`
    )
      .bind(commandId, userId)
      .first();

    const commandStatus =
      typeof (command as any)?.status === "string"
        ? String((command as any).status).trim().toLowerCase()
        : "";
    if (commandStatus === "cancelled") {
      return c.json({ ok: true, ignored: true, reason: "cancelled" });
    }
  }

  const pendingMessage = await c.env.DB.prepare(
    `SELECT id, progress_json
     FROM chat_messages
     WHERE user_id = ? AND session_id = ? AND role = 'assistant' AND is_pending = 1
     ORDER BY id DESC
     LIMIT 1`
  )
    .bind(userId, chatSessionId)
    .first();

  if (!pendingMessage) {
    return c.json({ ok: true, ignored: true, reason: "no_pending_message" });
  }

  const existingSequence = parseChatProgressSequence((pendingMessage as any)?.progress_json);
  if (
    normalizedProgress.sequence > 0 &&
    existingSequence > 0 &&
    normalizedProgress.sequence < existingSequence
  ) {
    return c.json({ ok: true, ignored: true, reason: "out_of_order_progress" });
  }

  const now = new Date().toISOString();
  const progressJson = JSON.stringify({
    ...normalizedProgress,
    updated_at: now,
  });

  await c.env.DB.prepare(
    `UPDATE chat_messages
     SET progress_json = ?,
         updated_at = ?
     WHERE id = ?`
  )
    .bind(progressJson, now, Number((pendingMessage as any).id || 0))
    .run();

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM chat_messages WHERE user_id = ? AND session_id = ? ORDER BY id ASC"
  )
    .bind(userId, chatSessionId)
    .all();

  wsHandler.broadcast(chatSessionId, {
    type: "message_update",
    messages: results,
  });

  return c.json({ ok: true });
});

// EXE chat router result endpoint (called by desktop agent)
app.post("/api/agent/chat-router-result", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = (pairing as any).user_id;

  const body = await c.req.json<{
    command_id?: number;
    chat_session_id: number;
    original_query?: string;
    query?: string;
    camera_ids: number[];
    camera_names: string[];
    all_cameras: boolean;
    time_window_minutes_before_now: number;
    answer: string;
    tokens_prompt?: number;
    tokens_output?: number;
    tokens_total?: number;
    model_prompt_tokens?: number;
    model_output_tokens?: number;
    model_total_tokens?: number;
  }>();

  const {
    chat_session_id,
    camera_ids,
    camera_names,
    all_cameras,
    time_window_minutes_before_now,
    answer,
  } = body;
  const commandIdRaw = typeof body.command_id === "number" ? body.command_id : Number(body.command_id);
  const commandId = Number.isInteger(commandIdRaw) && commandIdRaw > 0 ? commandIdRaw : null;

  const toNonNegativeInt = (value: unknown): number => {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.floor(numeric));
  };

  // Support both naming conventions: prefer model_ prefix, fall back to tokens_.
  const tokens_prompt = toNonNegativeInt(body.model_prompt_tokens ?? body.tokens_prompt);
  const tokens_output = toNonNegativeInt(body.model_output_tokens ?? body.tokens_output);
  const providedTotal = body.model_total_tokens ?? body.tokens_total;
  const tokens_total =
    providedTotal === undefined || providedTotal === null
      ? tokens_prompt + tokens_output
      : toNonNegativeInt(providedTotal);
  
  // Support both 'query' and 'original_query' field names
  const query = body.original_query || body.query || "";

  if (!chat_session_id || typeof answer !== "string") {
    return c.json({ error: "chat_session_id and answer are required" }, 400);
  }

  const now = new Date().toISOString();

  // Verify session belongs to this user
  const session = await c.env.DB.prepare(
    "SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?"
  )
    .bind(chat_session_id, userId)
    .first();

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  if (commandId) {
    const command = await c.env.DB.prepare(
      `SELECT status
       FROM commands
       WHERE id = ? AND user_id = ?
       LIMIT 1`
    )
      .bind(commandId, userId)
      .first();

    const commandStatus =
      typeof (command as any)?.status === "string"
        ? String((command as any).status).trim().toLowerCase()
        : "";
    if (commandStatus === "cancelled") {
      return c.json({ ok: true, ignored: true, reason: "cancelled" });
    }
  }

  // Detect if this is a "no frames" response
  const lowerAnswer = (answer || "").toLowerCase();
  const isNoFramesAnswer =
    lowerAnswer.includes("no stored frames") ||
    lowerAnswer.includes("no frames to analyze") ||
    lowerAnswer.includes("no frames available");

  // Determine if we actually have frames to analyze
  const hasFramesToAnalyze =
    !isNoFramesAnswer &&
    Array.isArray(camera_ids) &&
    camera_ids.length > 0 &&
    (time_window_minutes_before_now || 0) > 0;

  // Build metadata JSON
  const metadata = {
    type: "router_ack",
    query: query || "",
    camera_ids: camera_ids || [],
    camera_names: camera_names || [],
    all_cameras: all_cameras || false,
    time_window_minutes_before_now: time_window_minutes_before_now || 0,
    tokens_prompt: tokens_prompt || 0,
    tokens_output: tokens_output || 0,
    tokens_total: tokens_total || 0,
  };

  const cameraIdsStr = camera_ids && camera_ids.length > 0 ? camera_ids.join(",") : null;

  // Find and update the pending pre_answer message
  const pendingMessage = await c.env.DB.prepare(
    `SELECT * FROM chat_messages
     WHERE user_id = ? AND session_id = ? AND message_type = 'pre_answer' AND is_pending = 1
     ORDER BY id DESC LIMIT 1`
  )
    .bind(userId, chat_session_id)
    .first();

  if (pendingMessage) {
    // Update the existing pending message with router answer
    // If no frames to analyze, this becomes the final message
    await c.env.DB.prepare(
    `UPDATE chat_messages
     SET content = ?,
         camera_ids = ?,
         camera_selection_json = ?,
         tokens_used = ?,
         model_prompt_tokens = ?,
         model_output_tokens = ?,
         model_total_tokens = ?,
         message_type = ?,
         is_pending = 0,
         progress_json = NULL,
         updated_at = ?
     WHERE id = ?`
    )
      .bind(
        answer,
        cameraIdsStr,
        JSON.stringify(metadata),
        tokens_total || 0,
        tokens_prompt || 0,
        tokens_output || 0,
        tokens_total || 0,
        hasFramesToAnalyze ? "router_ack" : "final",
        now,
        (pendingMessage as any).id
      )
      .run();

    if (!hasFramesToAnalyze) {
      const inputTokens = tokens_prompt || 0;
      const outputTokens = tokens_output || 0;
      const totalTokens = tokens_total || (inputTokens + outputTokens);

      console.log(
        "[CHAT ROUTER RESULT] Deducting router-only tokens for no-frames response:",
        { userId, inputTokens, outputTokens, totalTokens }
      );

      await c.env.DB.prepare(
        `UPDATE token_balances 
         SET input_balance = input_balance - ?, 
             output_balance = output_balance - ?,
             balance = balance - ?, 
             total_spent = total_spent + ?, 
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?`
      )
        .bind(inputTokens, outputTokens, totalTokens, totalTokens, userId)
        .run();
    }

    // Only insert the loading placeholder when we REALLY will analyze frames
    if (hasFramesToAnalyze) {
      await c.env.DB.prepare(
        `INSERT INTO chat_messages (user_id, session_id, role, content, camera_ids, tokens_used, message_type, is_pending, created_at, updated_at)
         VALUES (?, ?, 'assistant', 'Analyzing camera feed...', NULL, 0, 'final_answer_pending', 1, ?, ?)`
      )
        .bind(userId, chat_session_id, now, now)
        .run();
    }
  }

  // Update session timestamp
  await c.env.DB.prepare(
    `UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  )
    .bind(chat_session_id)
    .run();

  // Fetch all messages for this session
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM chat_messages WHERE user_id = ? AND session_id = ? ORDER BY id ASC"
  )
    .bind(userId, chat_session_id)
    .all();

  // Broadcast to WebSocket clients
  wsHandler.broadcast(chat_session_id, {
    type: "message_update",
    messages: results,
  });

  return c.json({ ok: true, message: results[results.length - 2] });
});

// EXE chat response endpoint (called by desktop agent)
app.post("/api/agent/chat-response", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  console.log("[CHAT RESPONSE] Received request from client:", clientId);

  try {
    if (!clientId) {
      console.log("[CHAT RESPONSE] Error: client_id is required");
      return c.json({ error: "client_id is required" }, 400);
    }

    const authHeader = c.req.header("authorization") || c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("[CHAT RESPONSE] Error: Missing or invalid Authorization header");
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const exeToken = authHeader.slice("Bearer ".length).trim();
    const exeTokenHash = await hashToken(exeToken);

    console.log("[CHAT RESPONSE] Looking up pairing for client:", clientId);
    const pairing = await c.env.DB.prepare(
      `SELECT * FROM exe_pairings
       WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
    )
      .bind(clientId, exeTokenHash)
      .first();

    if (!pairing) {
      console.log("[CHAT RESPONSE] Error: Unauthorized - pairing not found");
      return c.json({ error: "Unauthorized" }, 401);
    }

    const userId = (pairing as any).user_id;
    console.log("[CHAT RESPONSE] Authenticated user:", userId);

    // Parse request body with flexible typing to handle extra fields from EXE
    let body: any;
    try {
      body = await c.req.json();
      console.log("[CHAT RESPONSE] Received payload keys:", Object.keys(body));
    } catch (parseErr) {
      console.error("[CHAT RESPONSE] Failed to parse request body:", parseErr);
      return c.json({ error: "Invalid JSON in request body" }, 400);
    }

    // Extract required fields
    const chat_session_id = body.chat_session_id;
    const commandIdRaw = typeof body.command_id === "number" ? body.command_id : Number(body.command_id);
    const commandId = Number.isInteger(commandIdRaw) && commandIdRaw > 0 ? commandIdRaw : null;
    const answer = stripTemporalEngineDiagnosticsFromChatAnswer(body.answer);

    // Extract optional fields with safe defaults
    const response_type = body.response_type; // May be undefined
    const camera_ids = Array.isArray(body.camera_ids) ? body.camera_ids : undefined;
    const camera_names = Array.isArray(body.camera_names) ? body.camera_names : undefined;
    const all_cameras = body.all_cameras || false;
    const time_window_minutes_before_now = body.time_window_minutes_before_now || 0;
    const toNonNegativeInt = (value: unknown): number => {
      const numeric = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(numeric)) return 0;
      return Math.max(0, Math.floor(numeric));
    };
    const model_prompt_tokens = toNonNegativeInt(body.model_prompt_tokens ?? body.tokens_prompt);
    const model_output_tokens = toNonNegativeInt(body.model_output_tokens ?? body.tokens_output);
    const providedModelTotal = body.model_total_tokens ?? body.tokens_total;
    const model_total_tokens =
      providedModelTotal === undefined || providedModelTotal === null
        ? model_prompt_tokens + model_output_tokens
        : toNonNegativeInt(providedModelTotal);
    const vision_hits = Array.isArray(body.vision_hits) ? body.vision_hits : [];
    const hit_images = Array.isArray(body.hit_images) ? body.hit_images : undefined;

    // Extra fields from EXE that we ignore (but don't cause errors):
    // - original_query, query, start_timestamp, end_timestamp, search_paths, status

    console.log("[CHAT RESPONSE] Processing:", {
      userId,
      chat_session_id,
      response_type_provided: response_type,
      answer_length: answer?.length,
      camera_ids: camera_ids?.length || 0,
      vision_hits_count: vision_hits.length,
      model_total_tokens,
    });

    // Validate required fields
    if (!chat_session_id || typeof chat_session_id !== "number") {
      console.log("[CHAT RESPONSE] Error: chat_session_id is missing or not a number");
      return c.json({ error: "chat_session_id (number) is required" }, 400);
    }

    if (!answer || typeof answer !== "string") {
      console.log("[CHAT RESPONSE] Error: answer is missing or not a string");
      return c.json({ error: "answer (string) is required" }, 400);
    }

    const now = new Date().toISOString();

    // Verify session belongs to this user
    console.log("[CHAT RESPONSE] Verifying session ownership...");
    const session = await c.env.DB.prepare(
      "SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?"
    )
      .bind(chat_session_id, userId)
      .first();

    if (!session) {
      console.log("[CHAT RESPONSE] Error: Session not found:", chat_session_id);
      return c.json({ error: "Session not found" }, 404);
    }

    if (commandId) {
      const command = await c.env.DB.prepare(
        `SELECT status
         FROM commands
         WHERE id = ? AND user_id = ?
         LIMIT 1`
      )
        .bind(commandId, userId)
        .first();

      const commandStatus =
        typeof (command as any)?.status === "string"
          ? String((command as any).status).trim().toLowerCase()
          : "";
      if (commandStatus === "cancelled") {
        console.log("[CHAT RESPONSE] Ignoring cancelled chat command:", commandId);
        return c.json({ ok: true, ignored: true, reason: "cancelled" });
      }
    }

    console.log("[CHAT RESPONSE] Session verified:", chat_session_id);

    // Build camera_selection_json if we have camera data
    const cameraSelectionJson = camera_ids
      ? JSON.stringify({
          camera_ids,
          camera_names: camera_names || [],
          all_cameras,
          time_window_minutes_before_now,
          vision_hits,
          hit_images: hit_images || undefined,
        })
      : null;

    const cameraIdsStr = camera_ids && camera_ids.length > 0 ? camera_ids.join(",") : null;
    const tokensUsed = model_total_tokens || (model_prompt_tokens + model_output_tokens);

    console.log("[CHAT RESPONSE] Built message data:", {
      cameraIdsStr,
      tokensUsed,
      has_camera_selection: !!cameraSelectionJson,
    });

    const getRouterTokenUsageBeforeMessage = async (beforeMessageId?: number | null) => {
      const parsedBeforeId = Number(beforeMessageId);
      const safeBeforeId =
        Number.isInteger(parsedBeforeId) && parsedBeforeId > 0
          ? parsedBeforeId
          : Number.MAX_SAFE_INTEGER;

      const routerRow = await c.env.DB.prepare(
        `SELECT model_prompt_tokens, model_output_tokens, model_total_tokens
         FROM chat_messages
         WHERE user_id = ? AND session_id = ? AND message_type = 'router_ack' AND id < ?
         ORDER BY id DESC LIMIT 1`
      )
        .bind(userId, chat_session_id, safeBeforeId)
        .first();

      const routerInputTokens = toNonNegativeInt((routerRow as any)?.model_prompt_tokens);
      const routerOutputTokens = toNonNegativeInt((routerRow as any)?.model_output_tokens);
      const routerTotalTokensRaw = toNonNegativeInt((routerRow as any)?.model_total_tokens);
      const routerTotalTokens =
        routerTotalTokensRaw > 0
          ? routerTotalTokensRaw
          : routerInputTokens + routerOutputTokens;

      return {
        inputTokens: routerInputTokens,
        outputTokens: routerOutputTokens,
        totalTokens: routerTotalTokens,
      };
    };

    const deductFromTokenBalances = async (
      inputTokens: number,
      outputTokens: number,
      totalTokens: number
    ) => {
      console.log("[CHAT RESPONSE] Deducting tokens from user", userId, {
        inputTokens,
        outputTokens,
        totalTokens,
      });

      await c.env.DB.prepare(
        `UPDATE token_balances 
         SET input_balance = input_balance - ?, 
             output_balance = output_balance - ?,
             balance = balance - ?, 
             total_spent = total_spent + ?, 
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?`
      )
        .bind(inputTokens, outputTokens, totalTokens, totalTokens, userId)
        .run();
    };

    // Auto-detect response type if not provided by checking for pending messages
    let detectedResponseType = response_type;
    
    if (!detectedResponseType) {
      console.log("[CHAT RESPONSE] response_type not provided, auto-detecting...");
      
      // Check for final_answer_pending message first (most common case for VISION results)
      console.log("[CHAT RESPONSE] Querying for final_answer_pending message...");
      const finalPending = await c.env.DB.prepare(
        `SELECT * FROM chat_messages
         WHERE user_id = ? AND session_id = ? AND message_type = 'final_answer_pending' AND is_pending = 1
         ORDER BY id DESC LIMIT 1`
      )
        .bind(userId, chat_session_id)
        .first();
      
      if (finalPending) {
        detectedResponseType = "final_answer";
        console.log("[CHAT RESPONSE] Detected final_answer (found final_answer_pending message id:", (finalPending as any).id, ")");
      } else {
        // Check for pre_answer pending message
        console.log("[CHAT RESPONSE] Querying for pre_answer message...");
        const prePending = await c.env.DB.prepare(
          `SELECT * FROM chat_messages
           WHERE user_id = ? AND session_id = ? AND message_type = 'pre_answer' AND is_pending = 1
           ORDER BY id DESC LIMIT 1`
        )
          .bind(userId, chat_session_id)
          .first();
        
        if (prePending) {
          detectedResponseType = "pre_answer";
          console.log("[CHAT RESPONSE] Detected pre_answer (found pre_answer message id:", (prePending as any).id, ")");
        } else {
          // Default to final_answer if no pending messages found
          detectedResponseType = "final_answer";
          console.log("[CHAT RESPONSE] No pending messages found, defaulting to final_answer");
        }
      }
    } else {
      console.log("[CHAT RESPONSE] Using provided response_type:", response_type);
    }

    if (detectedResponseType === "pre_answer") {
      console.log("[CHAT RESPONSE] Handling pre_answer flow");
      
      // Find and update the pending message
      console.log("[CHAT RESPONSE] Querying for pre_answer message to update...");
      const pendingMessage = await c.env.DB.prepare(
        `SELECT * FROM chat_messages
         WHERE user_id = ? AND session_id = ? AND message_type = 'pre_answer' AND is_pending = 1
         ORDER BY id DESC LIMIT 1`
      )
        .bind(userId, chat_session_id)
        .first();

      if (pendingMessage) {
        console.log("[CHAT RESPONSE] Found pre_answer message to update, id:", (pendingMessage as any).id);
        console.log("[CHAT RESPONSE] Executing UPDATE on pre_answer message...");
        
        await c.env.DB.prepare(
          `UPDATE chat_messages
           SET content = ?,
               camera_ids = ?,
               camera_selection_json = ?,
               model_prompt_tokens = ?,
               model_output_tokens = ?,
               model_total_tokens = ?,
               is_pending = 0,
               progress_json = NULL,
               updated_at = ?
           WHERE id = ?`
        )
          .bind(
            answer,
            cameraIdsStr,
            cameraSelectionJson,
            model_prompt_tokens,
            model_output_tokens,
            model_total_tokens,
            now,
            (pendingMessage as any).id
          )
          .run();

        console.log("[CHAT RESPONSE] ✓ Updated pre_answer message");

        // Insert new loading message for final answer
        console.log("[CHAT RESPONSE] Inserting final_answer_pending message...");
        await c.env.DB.prepare(
          `INSERT INTO chat_messages (user_id, session_id, role, content, camera_ids, tokens_used, message_type, is_pending, created_at, updated_at)
           VALUES (?, ?, 'assistant', 'Analyzing camera feed...', NULL, 0, 'final_answer_pending', 1, ?, ?)`
        )
          .bind(userId, chat_session_id, now, now)
          .run();
        
        console.log("[CHAT RESPONSE] ✓ Created final_answer_pending message");
      } else {
        console.log("[CHAT RESPONSE] WARNING: No pre_answer message found to update!");
      }
    } else if (detectedResponseType === "final_answer") {
      console.log("[CHAT RESPONSE] Handling final_answer flow");
      
      // Find and update the final_answer_pending message
      console.log("[CHAT RESPONSE] Querying for final_answer_pending message to update...");
      const pendingMessage = await c.env.DB.prepare(
        `SELECT * FROM chat_messages
         WHERE user_id = ? AND session_id = ? AND message_type = 'final_answer_pending' AND is_pending = 1
         ORDER BY id DESC LIMIT 1`
      )
        .bind(userId, chat_session_id)
        .first();

      console.log("[CHAT RESPONSE] Found final_answer_pending message:", pendingMessage ? (pendingMessage as any).id : "NONE");

      if (pendingMessage) {
        console.log("[CHAT RESPONSE] Executing UPDATE on final_answer_pending message...");
        
        await c.env.DB.prepare(
          `UPDATE chat_messages
           SET content = ?,
               camera_ids = ?,
               camera_selection_json = ?,
               tokens_used = ?,
               model_prompt_tokens = ?,
               model_output_tokens = ?,
               model_total_tokens = ?,
               message_type = 'final',
               is_pending = 0,
               progress_json = NULL,
               updated_at = ?
           WHERE id = ?`
        )
          .bind(
            answer,
            cameraIdsStr,
            cameraSelectionJson,
            tokensUsed,
            model_prompt_tokens,
            model_output_tokens,
            model_total_tokens,
            now,
            (pendingMessage as any).id
          )
          .run();

        console.log("[CHAT RESPONSE] ✓ Updated final_answer_pending message to final");

        const pendingMessageId = Number((pendingMessage as any)?.id || 0);
        const routerUsage = await getRouterTokenUsageBeforeMessage(pendingMessageId);
        const inputTokens = (model_prompt_tokens || 0) + routerUsage.inputTokens;
        const outputTokens = (model_output_tokens || 0) + routerUsage.outputTokens;
        const totalTokens = (tokensUsed || 0) + routerUsage.totalTokens;
        await deductFromTokenBalances(inputTokens, outputTokens, totalTokens);
        
        console.log("[CHAT RESPONSE] ✓ Tokens deducted");
      } else {
        console.log("[CHAT RESPONSE] WARNING: No final_answer_pending message found! Creating new final message instead.");
        console.log("[CHAT RESPONSE] Executing INSERT for new final message...");
        
        // If no pending message found, create a new final message anyway
        const insertResult = await c.env.DB.prepare(
          `INSERT INTO chat_messages (user_id, session_id, role, content, camera_ids, camera_selection_json, tokens_used, model_prompt_tokens, model_output_tokens, model_total_tokens, message_type, is_pending, created_at, updated_at)
           VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?, 'final', 0, ?, ?)`
        )
          .bind(
            userId,
            chat_session_id,
            answer,
            cameraIdsStr,
            cameraSelectionJson,
            tokensUsed,
            model_prompt_tokens,
            model_output_tokens,
            model_total_tokens,
            now,
            now
          )
          .run();
          
        console.log("[CHAT RESPONSE] ✓ Created new final message directly");

        const insertedFinalMessageId = Number((insertResult as any)?.meta?.last_row_id || 0);
        const routerUsage = await getRouterTokenUsageBeforeMessage(
          insertedFinalMessageId > 0 ? insertedFinalMessageId : null
        );
        const inputTokens = (model_prompt_tokens || 0) + routerUsage.inputTokens;
        const outputTokens = (model_output_tokens || 0) + routerUsage.outputTokens;
        const totalTokens = (tokensUsed || 0) + routerUsage.totalTokens;
        await deductFromTokenBalances(inputTokens, outputTokens, totalTokens);
        
        console.log("[CHAT RESPONSE] ✓ Tokens deducted");
      }
    }

    // Update session timestamp
    console.log("[CHAT RESPONSE] Updating session timestamp...");
    await c.env.DB.prepare(
      `UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    )
      .bind(chat_session_id)
      .run();
    
    console.log("[CHAT RESPONSE] ✓ Session timestamp updated");

    // Fetch all messages for this session
    console.log("[CHAT RESPONSE] Fetching all messages for session...");
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM chat_messages WHERE user_id = ? AND session_id = ? ORDER BY id ASC"
    )
      .bind(userId, chat_session_id)
      .all();

    console.log("[CHAT RESPONSE] Fetched", results.length, "messages");

    // Broadcast to WebSocket clients
    console.log("[CHAT RESPONSE] Broadcasting to WebSocket clients...");
    wsHandler.broadcast(chat_session_id, {
      type: "message_update",
      messages: results,
    });
    
    console.log("[CHAT RESPONSE] ✓ Broadcast complete");

    console.log("[CHAT RESPONSE] ✓✓ Successfully processed chat response");

    return c.json({ ok: true });
  } catch (error: any) {
    console.error("[CHAT RESPONSE] ✗✗ Internal error occurred:");
    console.error("[CHAT RESPONSE] Error name:", error?.name);
    console.error("[CHAT RESPONSE] Error message:", error?.message);
    console.error("[CHAT RESPONSE] Error stack:", error?.stack);
    
    // Log additional error details if available
    if (error?.cause) {
      console.error("[CHAT RESPONSE] Error cause:", error.cause);
    }
    
    // Try to extract D1 database error details if present
    if (error?.message?.includes("D1_ERROR") || error?.message?.includes("SQL")) {
      console.error("[CHAT RESPONSE] Looks like a database error - check SQL syntax and column names");
    }
    
    return c.json({ 
      error: "Internal server error in /api/agent/chat-response",
      details: error?.message || "Unknown error"
    }, 500);
  }
});

// EXE events endpoint (called by desktop agent)
app.post("/api/agent/events", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  // Same auth logic as /api/agent/commands:
  const authHeader =
    c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  // Look up the pairing to derive user_id
  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    // Unpaired or invalid token: reject
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = (pairing as any).user_id;
  const pairingExeId = String((pairing as any).exe_id || "");

  const body = await c.req.json<{
    camera_id?: number | string | null;
    event_type: string;
    message?: string;
    details?: any;
  }>();

  const parsedCameraId =
    typeof body.camera_id === "string"
      ? parseInt(body.camera_id, 10)
      : typeof body.camera_id === "number"
      ? body.camera_id
      : null;
  const cameraId =
    Number.isInteger(parsedCameraId) && Number(parsedCameraId) > 0
      ? Number(parsedCameraId)
      : null;
  const eventType = body.event_type ?? "agent_event";
  let message = body.message ?? "";
  let details = body.details || null;
  const now = new Date().toISOString();
  const detailsObject =
    details && typeof details === "object" && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : {};
  const eventStartOrigin =
    typeof detailsObject.start_origin === "string"
      ? detailsObject.start_origin.trim().toLowerCase()
      : "";
  const isTemporarySession =
    detailsObject.temporary_session === true ||
    detailsObject.temporary_session === 1 ||
    detailsObject.temporary_session === "1" ||
    detailsObject.temporary_session === "true";
  const isDrakonFindTemporaryConnectionFailure =
    !!cameraId &&
    eventType === "camera_connection_failed" &&
    eventStartOrigin === "drakon_find" &&
    isTemporarySession;

  if (typeof eventType === "string" && eventType.startsWith("drakon_find_")) {
    try {
      const outcome = await handleDrakonFindAgentEvent(c.env, {
        eventType,
        clientId,
        exeId: pairingExeId,
        cameraId,
        message: typeof message === "string" ? message : "",
        details: details && typeof details === "object" ? (details as Record<string, unknown>) : {},
        receivedAt: now,
      });
      return c.json({ success: true, ...outcome });
    } catch (error) {
      console.error("[DRAKON FIND] Failed to process agent event", {
        clientId,
        exeId: pairingExeId,
        eventType,
        cameraId,
        error,
      });
      return c.json({ error: "Failed to process Drakon Find event" }, 500);
    }
  }

  const toNonNegativeInt = (value: unknown): number => {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.floor(numeric));
  };

  const normalizePriorityLevel = (value: unknown): "CRITIC" | "HIGH" | "MEDIUM" | "LOW" | null => {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toUpperCase();
    if (!normalized) return null;
    if (normalized === "MEDUIM") return "MEDIUM";
    if (normalized === "CRITIC" || normalized === "HIGH" || normalized === "MEDIUM" || normalized === "LOW") {
      return normalized;
    }
    return null;
  };

  if (eventType === "job_token_usage") {
    const tokenDetails = details && typeof details === "object" ? details : {};
    const promptTokens = toNonNegativeInt(
      (tokenDetails as any).prompt_tokens ?? (tokenDetails as any).model_prompt_tokens
    );
    const outputTokens = toNonNegativeInt(
      (tokenDetails as any).output_tokens ?? (tokenDetails as any).model_output_tokens
    );
    const providedTotal =
      (tokenDetails as any).total_tokens ?? (tokenDetails as any).model_total_tokens;
    const totalTokens =
      providedTotal === undefined || providedTotal === null
        ? promptTokens + outputTokens
        : toNonNegativeInt(providedTotal);

    if (promptTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) {
      return c.json({ success: true, recorded: false, reason: "empty_token_usage" });
    }

    const usageCameraRaw =
      (tokenDetails as any).camera_id ?? (tokenDetails as any).cameraId ?? cameraId;
    const parsedUsageCamera =
      typeof usageCameraRaw === "string"
        ? parseInt(usageCameraRaw, 10)
        : typeof usageCameraRaw === "number"
        ? usageCameraRaw
        : null;
    const usageCameraId =
      Number.isInteger(parsedUsageCamera) && Number(parsedUsageCamera) > 0
        ? Number(parsedUsageCamera)
        : null;

    const sourceRaw =
      typeof (tokenDetails as any).source === "string"
        ? (tokenDetails as any).source.trim()
        : "";
    const source = sourceRaw || "job";

    const algoTypeRaw =
      typeof (tokenDetails as any).algo_type === "string"
        ? (tokenDetails as any).algo_type.trim()
        : "";
    const inferredAlgoType = [
      typeof (tokenDetails as any).inference_model === "string"
        ? (tokenDetails as any).inference_model.trim()
        : "",
      typeof (tokenDetails as any).agent_key === "string"
        ? (tokenDetails as any).agent_key.trim()
        : "",
      Number.isInteger(Number((tokenDetails as any).step_id))
        ? `step:${Number((tokenDetails as any).step_id)}`
        : Number.isInteger(Number((tokenDetails as any).stepId))
        ? `step:${Number((tokenDetails as any).stepId)}`
        : "",
    ]
      .filter((v) => !!v)
      .join("|");
    const algoType = algoTypeRaw || inferredAlgoType || "job_step_inference";

    const subscription = await c.env.DB.prepare(
      `SELECT *
       FROM subscriptions
       WHERE user_id = ?
         AND subscription_type LIKE 'camera_monitoring%'
         AND is_active = 1
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       ORDER BY started_at DESC
       LIMIT 1`
    )
      .bind(userId)
      .first();

    if (!subscription) {
      return c.json({ success: true, recorded: false, reason: "no_active_subscription" });
    }

    const promptTokensM = promptTokens / 1_000_000;
    const outputTokensM = outputTokens / 1_000_000;

    try {
      await c.env.DB.prepare(
        `INSERT INTO subscription_token_usage (
          subscription_id,
          camera_id,
          event_time,
          prompt_tokens,
          output_tokens,
          total_tokens,
          source,
          algo_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          (subscription as any).id,
          usageCameraId,
          now,
          promptTokens,
          outputTokens,
          totalTokens,
          source,
          algoType
        )
        .run();

      await c.env.DB.prepare(
        `UPDATE subscriptions
         SET "InputTokensUsedM" = "InputTokensUsedM" + ?,
             "OutputTokensUsedM" = "OutputTokensUsedM" + ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
        .bind(promptTokensM, outputTokensM, (subscription as any).id)
        .run();
    } catch (error) {
      console.error("[JOB TOKEN USAGE] Failed to persist token usage:", error);
      return c.json({ error: "Failed to persist token usage" }, 500);
    }

    return c.json({ success: true, recorded: true });
  }

  if (eventType === "temporal_compile_result") {
    const compileDetails = details && typeof details === "object" ? details : {};
    const sourceTypeRaw =
      typeof (compileDetails as any).source_type === "string"
        ? (compileDetails as any).source_type.trim().toLowerCase()
        : "";
    const sourceType =
      sourceTypeRaw === "camera_algorithm" ||
      sourceTypeRaw === "job_step_agent" ||
      sourceTypeRaw === "chat_session"
        ? sourceTypeRaw
        : "";
    const sourceId = Number((compileDetails as any).source_id ?? (compileDetails as any).sourceId);
    const compileStatusRaw =
      typeof (compileDetails as any).compile_status === "string"
        ? (compileDetails as any).compile_status.trim()
        : typeof (compileDetails as any).compileStatus === "string"
        ? (compileDetails as any).compileStatus.trim()
        : "";
    const compileStatus = compileStatusRaw || "ok";
    const compileModelRaw =
      typeof (compileDetails as any).compile_model === "string"
        ? (compileDetails as any).compile_model.trim()
        : typeof (compileDetails as any).compileModel === "string"
        ? (compileDetails as any).compileModel.trim()
        : "";
    const compileModel = compileModelRaw || null;
    const compiledAtRaw =
      typeof (compileDetails as any).compiled_at === "string"
        ? (compileDetails as any).compiled_at.trim()
        : typeof (compileDetails as any).compiledAt === "string"
        ? (compileDetails as any).compiledAt.trim()
        : "";
    const compiledAt = compiledAtRaw || now;

    const planEnvelope = (() => {
      const candidate = (compileDetails as any).plan_envelope ?? (compileDetails as any).planEnvelope;
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        return candidate;
      }
      const planJson = (compileDetails as any).plan_json ?? (compileDetails as any).planJson;
      const planExplain =
        (compileDetails as any).plan_explain_json ?? (compileDetails as any).planExplainJson;
      const fallback: Record<string, unknown> = {
        compile_status: compileStatus,
        plan_json: planJson && typeof planJson === "object" ? planJson : {},
        plan_explain_json:
          planExplain && typeof planExplain === "object" ? planExplain : {},
      };
      if ((compileDetails as any).compile_confidence !== undefined) {
        fallback.compile_confidence = (compileDetails as any).compile_confidence;
      }
      if ((compileDetails as any).missing_operator_types !== undefined) {
        fallback.missing_operator_types = (compileDetails as any).missing_operator_types;
      }
      if ((compileDetails as any).blockers !== undefined) {
        fallback.blockers = (compileDetails as any).blockers;
      }
      return fallback;
    })();

    const planJson = (() => {
      if (planEnvelope && typeof planEnvelope === "object" && !Array.isArray(planEnvelope)) {
        const nested = (planEnvelope as any).plan_json;
        if (nested && typeof nested === "object" && !Array.isArray(nested)) {
          return nested;
        }
      }
      return {};
    })();
    const planExplainJson = (() => {
      if (planEnvelope && typeof planEnvelope === "object" && !Array.isArray(planEnvelope)) {
        const nested = (planEnvelope as any).plan_explain_json;
        if (nested && typeof nested === "object" && !Array.isArray(nested)) {
          return nested;
        }
      }
      const direct = (compileDetails as any).plan_explain_json;
      if (direct && typeof direct === "object" && !Array.isArray(direct)) {
        return direct;
      }
      return {};
    })();
    const planHashRaw =
      typeof (compileDetails as any).plan_hash === "string"
        ? (compileDetails as any).plan_hash.trim()
        : typeof (planJson as any).plan_hash === "string"
        ? String((planJson as any).plan_hash).trim()
        : "";
    const planHash = planHashRaw || null;
    const planVersionRaw =
      typeof (compileDetails as any).plan_version === "string"
        ? (compileDetails as any).plan_version.trim()
        : typeof (planJson as any).schema_version === "string"
        ? String((planJson as any).schema_version).trim()
        : "";
    const planVersion = planVersionRaw || null;
    const planEnvelopeJson = JSON.stringify(planEnvelope || {});
    const planExplainJsonText = JSON.stringify(planExplainJson || {});

    if (sourceType === "chat_session") {
      return c.json({ success: true, recorded: true, persisted: false });
    }

    if (!sourceType || !Number.isInteger(sourceId) || sourceId <= 0) {
      return c.json({ success: true, recorded: false, reason: "invalid_temporal_compile_source" });
    }

    if (sourceType === "camera_algorithm") {
      const owned = await c.env.DB.prepare(
        `SELECT ca.id
         FROM camera_algorithms ca
         JOIN cameras c ON c.id = ca.camera_id
         WHERE ca.id = ? AND c.user_id = ?
         LIMIT 1`
      )
        .bind(sourceId, userId)
        .first();
      if (!owned) {
        return c.json({ success: true, recorded: false, reason: "source_not_found_or_forbidden" });
      }

      await c.env.DB.prepare(
        `UPDATE camera_algorithms
         SET temporal_plan_json = ?,
             temporal_plan_hash = ?,
             temporal_plan_version = ?,
             temporal_compiled_at = ?,
             temporal_compile_model = ?,
             temporal_explain_json = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
        .bind(
          planEnvelopeJson,
          planHash,
          planVersion,
          compiledAt,
          compileModel,
          planExplainJsonText,
          sourceId
        )
        .run();

      return c.json({ success: true, recorded: true, persisted: true });
    }

    if (sourceType === "job_step_agent") {
      const owned = await c.env.DB.prepare(
        `SELECT jsa.id,
                COALESCE(jsa.use_temporal_context, 1) AS use_temporal_context
         FROM job_step_agents jsa
         JOIN job_steps js ON js.id = jsa.step_id
         JOIN jobs j ON j.id = js.job_id
         WHERE jsa.id = ? AND j.user_id = ?
         LIMIT 1`
      )
        .bind(sourceId, userId)
        .first();
      if (!owned) {
        return c.json({ success: true, recorded: false, reason: "source_not_found_or_forbidden" });
      }
      if (
        !normalizeJobStepUseTemporalContext((owned as any)?.use_temporal_context, true)
      ) {
        return c.json({
          success: true,
          recorded: true,
          persisted: false,
          reason: "temporal_context_disabled",
        });
      }

      await c.env.DB.prepare(
        `UPDATE job_step_agents
         SET temporal_plan_json = ?,
             temporal_plan_hash = ?,
             temporal_plan_version = ?,
             temporal_compiled_at = ?,
             temporal_compile_model = ?,
             temporal_explain_json = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
        .bind(
          planEnvelopeJson,
          planHash,
          planVersion,
          compiledAt,
          compileModel,
          planExplainJsonText,
          sourceId
        )
        .run();

      return c.json({ success: true, recorded: true, persisted: true });
    }
  }

  if ((!message || !String(message).trim()) && details && typeof details === "object") {
    if (eventType.startsWith("job_step_")) {
      const stepLabel = details.step_name
        ? `Step #${details.step_order ?? "?"}: ${details.step_name}`
        : details.step_id
        ? `Step ${details.step_id}`
        : "Step";
      let action = eventType.replace("job_step_", "").replace(/_/g, " ");
      if (eventType === "job_step_started") action = "started";
      if (eventType === "job_step_completed") action = "completed";
      if (eventType === "job_step_skipped") action = "skipped";
      message = `${stepLabel} ${action}`.trim();
    } else if (eventType === "job_staled") {
      const jobLabel = details.job_name
        ? `Job ${details.job_name}`
        : details.job_id
        ? `Job #${details.job_id}`
        : "Job";
      message = `${jobLabel} stalled and was stopped automatically`;
    }
  }

  // Handle AI detection events with temporal album preference over trigger video.
  let imageKey: string | null = null;
  let videoKey: string | null = null;
  let mediaType: string = "image";
  let eventId: number | null = null;
  const sanitizeKeyToken = (value: unknown, fallback = "na") => {
    const raw = String(value ?? fallback).trim();
    const token = raw.length > 0 ? raw : fallback;
    return token.replace(/[^a-zA-Z0-9._-]/g, "_");
  };
  const mediaPublicBase = String(c.env.R2_PUBLIC_BASE_URL || "/media").replace(/\/+$/, "");
  const buildMediaUrl = (key: string) => {
    const encodedKey = key
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `${mediaPublicBase}/${encodedKey}`;
  };
  
  const hasTemporalContributingAlbum = (payloadDetails: any, rawGroupImages: any[]) => {
    if (!Array.isArray(rawGroupImages) || rawGroupImages.length === 0) return false;
    return countTemporalContributingEvents(payloadDetails) > 0;
  };
  const clearVideoMediaFields = (payloadDetails: Record<string, any>) => {
    delete payloadDetails.video_mp4_base64;
    delete payloadDetails.video_key;
    delete payloadDetails.videoKey;
    delete payloadDetails.video_url;
    delete payloadDetails.videoUrl;
    delete payloadDetails.clip_path;
    delete payloadDetails.clipPath;
    delete payloadDetails.clip_url;
    delete payloadDetails.backend_clip_path;
  };

  if (eventType === "ai_detection" && details) {
    const rawGroupImages = Array.isArray(details.group_images) ? details.group_images : [];
    details.contributing_events_count = countTemporalContributingEvents(details);
    const prefersTemporalAlbum = hasTemporalContributingAlbum(details, rawGroupImages);
    const decodeBase64Image = (rawValue: string) => {
      let base64Data = rawValue;
      let contentType = "image/jpeg";
      let extension = ".jpg";

      if (/^data:image\/png;base64,/i.test(rawValue)) {
        base64Data = rawValue.replace(/^data:image\/png;base64,/i, "");
        contentType = "image/png";
        extension = ".png";
      } else if (/^data:image\/webp;base64,/i.test(rawValue)) {
        base64Data = rawValue.replace(/^data:image\/webp;base64,/i, "");
        contentType = "image/webp";
        extension = ".webp";
      } else if (/^data:image\/gif;base64,/i.test(rawValue)) {
        base64Data = rawValue.replace(/^data:image\/gif;base64,/i, "");
        contentType = "image/gif";
        extension = ".gif";
      } else if (/^data:image\/bmp;base64,/i.test(rawValue)) {
        base64Data = rawValue.replace(/^data:image\/bmp;base64,/i, "");
        contentType = "image/bmp";
        extension = ".bmp";
      } else {
        base64Data = rawValue
          .replace(/^data:image\/jpeg;base64,/i, "")
          .replace(/^data:image\/jpg;base64,/i, "");
      }

      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      return { bytes, contentType, extension };
    };
    let temporalAlbumWon = false;

    // Non-temporal detections keep the legacy video-first path.
    if (details.video_mp4_base64 && !prefersTemporalAlbum) {
      try {
        console.log("[AI DETECTION] Processing video clip for camera", cameraId);
        
        // Decode base64 to bytes
        const base64Data = details.video_mp4_base64.replace(/^data:video\/mp4;base64,/, '');
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Create filename with timestamp
        const filename = `user_${userId}_camera_${cameraId}_${Date.now()}.mp4`;
        videoKey = filename;
        mediaType = "video";

        // Upload to R2
        await c.env.R2_BUCKET.put(`detections_videos/${filename}`, bytes, {
          httpMetadata: { contentType: "video/mp4" },
        });

        console.log("[AI DETECTION] ✓ Video uploaded successfully:", filename);

        // Remove video_mp4_base64 from details and add video_key
        const { video_mp4_base64, frame_jpeg_base64, ...restDetails } = details;
        details = {
          ...restDetails,
          video_key: filename,
          media_type: "video",
        };
      } catch (err) {
        console.error("[AI DETECTION] Failed to process video:", err);
        // Video processing failed - fall through to try image instead
        videoKey = null;
        mediaType = "image";
      }
    }
    
    // Non-temporal detections fall back to a single image when video is absent or fails.
    if (!videoKey && details.frame_jpeg_base64 && !prefersTemporalAlbum) {
      try {
        console.log("[AI DETECTION] Processing image frame for camera", cameraId);
        
        // Decode base64 to bytes
        const base64Data = details.frame_jpeg_base64.replace(/^data:image\/jpeg;base64,/, '');
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Create filename with timestamp
        const filename = `user_${userId}_camera_${cameraId}_${Date.now()}.jpg`;
        imageKey = filename;
        mediaType = "image";

        // Upload to R2
        await c.env.R2_BUCKET.put(`detections/${filename}`, bytes, {
          httpMetadata: { contentType: "image/jpeg" },
        });

        console.log("[AI DETECTION] ✓ Image uploaded successfully:", filename);

        // Remove frame_jpeg_base64 from details and add image_key
        const { frame_jpeg_base64, ...restDetails } = details;
        details = {
          ...restDetails,
          image_key: filename,
          media_type: "image",
        };
      } catch (err) {
        console.error("[AI DETECTION] Failed to process image:", err);
        // Continue without media if processing fails
      }
    }

    if (rawGroupImages.length > 0) {
      const uploadedGroupImages: Array<Record<string, any>> = [];

      for (let index = 0; index < rawGroupImages.length; index++) {
        const item = rawGroupImages[index];
        const entry = item && typeof item === "object" ? (item as Record<string, any>) : null;
        if (!entry) continue;

        const isOfflinePlaceholder =
          entry.is_offline_placeholder === true ||
          entry.isOfflinePlaceholder === true ||
          entry.offline_placeholder === true ||
          entry.offlinePlaceholder === true;

        if (isOfflinePlaceholder) {
          uploadedGroupImages.push({
            camera_id: entry.camera_id ?? entry.cameraId ?? cameraId ?? null,
            camera_name:
              typeof entry.camera_name === "string"
                ? entry.camera_name
                : typeof entry.cameraName === "string"
                ? entry.cameraName
                : details?.camera_name || null,
            snapshot_ts_utc_iso:
              typeof entry.snapshot_ts_utc_iso === "string"
                ? entry.snapshot_ts_utc_iso
                : typeof entry.snapshotTsUtcIso === "string"
                ? entry.snapshotTsUtcIso
                : null,
            timestamp_name:
              typeof entry.timestamp_name === "string"
                ? entry.timestamp_name
                : typeof entry.timestampName === "string"
                ? entry.timestampName
                : null,
            frame_index:
              Number.isFinite(Number(entry.frame_index ?? entry.frameIndex))
                ? Number(entry.frame_index ?? entry.frameIndex)
                : null,
            frame_timestamp_in_segment:
              typeof entry.frame_timestamp_in_segment === "string"
                ? entry.frame_timestamp_in_segment
                : typeof entry.frameTimestampInSegment === "string"
                ? entry.frameTimestampInSegment
                : null,
            event: typeof entry.event === "string" ? entry.event : null,
            entity_id:
              typeof entry.entity_id === "string"
                ? entry.entity_id
                : typeof entry.entityId === "string"
                ? entry.entityId
                : null,
            reason: typeof entry.reason === "string" ? entry.reason : null,
            zone: typeof entry.zone === "string" ? entry.zone : null,
            temporal_evidence_key:
              typeof entry.temporal_evidence_key === "string"
                ? entry.temporal_evidence_key
                : typeof entry.temporalEvidenceKey === "string"
                ? entry.temporalEvidenceKey
                : null,
            is_offline_placeholder: true,
            image_key: null,
            image_url: null,
          });
          continue;
        }

        const entryImageBase64 =
          typeof entry.image_jpeg_b64 === "string"
            ? entry.image_jpeg_b64
            : typeof entry.frame_jpeg_base64 === "string"
            ? entry.frame_jpeg_base64
            : "";
        if (!entryImageBase64.trim()) continue;

        try {
          const { bytes, contentType, extension } = decodeBase64Image(entryImageBase64);
          const filename = `user_${userId}_camera_${cameraId}_group_${Date.now()}_${index}${extension}`;
          await c.env.R2_BUCKET.put(`detections/${filename}`, bytes, {
            httpMetadata: { contentType },
          });

          uploadedGroupImages.push({
            camera_id: entry.camera_id ?? entry.cameraId ?? cameraId ?? null,
            camera_name:
              typeof entry.camera_name === "string"
                ? entry.camera_name
                : typeof entry.cameraName === "string"
                ? entry.cameraName
                : details?.camera_name || null,
            snapshot_ts_utc_iso:
              typeof entry.snapshot_ts_utc_iso === "string"
                ? entry.snapshot_ts_utc_iso
                : typeof entry.snapshotTsUtcIso === "string"
                ? entry.snapshotTsUtcIso
                : null,
            snapshot_ts_local_iso:
              typeof entry.snapshot_ts_local_iso === "string"
                ? entry.snapshot_ts_local_iso
                : typeof entry.snapshotTsLocalIso === "string"
                ? entry.snapshotTsLocalIso
                : null,
            timestamp_name:
              typeof entry.timestamp_name === "string"
                ? entry.timestamp_name
                : typeof entry.timestampName === "string"
                ? entry.timestampName
                : null,
            frame_index:
              Number.isFinite(Number(entry.frame_index ?? entry.frameIndex))
                ? Number(entry.frame_index ?? entry.frameIndex)
                : null,
            frame_timestamp_in_segment:
              typeof entry.frame_timestamp_in_segment === "string"
                ? entry.frame_timestamp_in_segment
                : typeof entry.frameTimestampInSegment === "string"
                ? entry.frameTimestampInSegment
                : null,
            event: typeof entry.event === "string" ? entry.event : null,
            entity_id:
              typeof entry.entity_id === "string"
                ? entry.entity_id
                : typeof entry.entityId === "string"
                ? entry.entityId
                : null,
            reason: typeof entry.reason === "string" ? entry.reason : null,
            zone: typeof entry.zone === "string" ? entry.zone : null,
            temporal_evidence_key:
              typeof entry.temporal_evidence_key === "string"
                ? entry.temporal_evidence_key
                : typeof entry.temporalEvidenceKey === "string"
                ? entry.temporalEvidenceKey
                : null,
            image_key: filename,
            image_url: buildMediaUrl(`detections/${filename}`),
          });
        } catch (err) {
          console.error("[AI DETECTION] Failed to process group image:", err);
        }
      }

      if (uploadedGroupImages.length > 0) {
        details.group_image_urls = uploadedGroupImages;
        details.group_image_count = uploadedGroupImages.length;

        const firstGroupImageWithMedia = uploadedGroupImages.find(
          (entry) =>
            typeof entry?.image_key === "string" &&
            entry.image_key.trim() &&
            typeof entry?.image_url === "string" &&
            entry.image_url.trim()
        );

        if (!details.image_key && firstGroupImageWithMedia?.image_key) {
          details.image_key = firstGroupImageWithMedia.image_key;
        }
        if (!details.image_url && firstGroupImageWithMedia?.image_url) {
          details.image_url = firstGroupImageWithMedia.image_url;
        }
        if (!videoKey && !imageKey && firstGroupImageWithMedia?.image_key) {
          imageKey = firstGroupImageWithMedia.image_key;
          mediaType = "image";
          details.media_type = "image";
        }
        if (prefersTemporalAlbum && firstGroupImageWithMedia?.image_key) {
          temporalAlbumWon = true;
          videoKey = null;
          mediaType = "image";
          details.media_type = "image";
          clearVideoMediaFields(details);
        }
      }
    }

    if (!temporalAlbumWon && prefersTemporalAlbum && details.video_mp4_base64) {
      try {
        console.log("[AI DETECTION] Processing deferred video clip for camera", cameraId);

        const base64Data = details.video_mp4_base64.replace(/^data:video\/mp4;base64,/, "");
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const filename = `user_${userId}_camera_${cameraId}_${Date.now()}.mp4`;
        videoKey = filename;
        mediaType = "video";

        await c.env.R2_BUCKET.put(`detections_videos/${filename}`, bytes, {
          httpMetadata: { contentType: "video/mp4" },
        });

        console.log("[AI DETECTION] Deferred video uploaded successfully:", filename);

        const { video_mp4_base64, frame_jpeg_base64, ...restDetails } = details;
        details = {
          ...restDetails,
          video_key: filename,
          media_type: "video",
        };
      } catch (err) {
        console.error("[AI DETECTION] Failed to process deferred video:", err);
        videoKey = null;
        mediaType = "image";
      }
    }

    if (!videoKey && !temporalAlbumWon && prefersTemporalAlbum && details.frame_jpeg_base64) {
      try {
        console.log("[AI DETECTION] Processing deferred image frame for camera", cameraId);

        const base64Data = details.frame_jpeg_base64.replace(/^data:image\/jpeg;base64,/, "");
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const filename = `user_${userId}_camera_${cameraId}_${Date.now()}.jpg`;
        imageKey = filename;
        mediaType = "image";

        await c.env.R2_BUCKET.put(`detections/${filename}`, bytes, {
          httpMetadata: { contentType: "image/jpeg" },
        });

        console.log("[AI DETECTION] Deferred image uploaded successfully:", filename);

        const { frame_jpeg_base64, ...restDetails } = details;
        details = {
          ...restDetails,
          image_key: filename,
          media_type: "image",
        };
      } catch (err) {
        console.error("[AI DETECTION] Failed to process deferred image:", err);
      }
    }

    if ("video_mp4_base64" in details) delete details.video_mp4_base64;
    if ("frame_jpeg_base64" in details) delete details.frame_jpeg_base64;
    if ("image_jpeg_b64" in details) delete details.image_jpeg_b64;
    if ("group_images" in details) delete details.group_images;
    
    console.log("[AI DETECTION] Final media state:", { 
      mediaType, 
      hasVideo: !!videoKey, 
      hasImage: !!imageKey,
      groupImages: Array.isArray(details.group_image_urls) ? details.group_image_urls.length : 0,
      temporalAlbumWon
    });
  }

  if (eventType === "job_alert_triggered" && details && typeof details === "object") {
    details.contributing_events_count = countTemporalContributingEvents(details);
    const payloadPriority = normalizePriorityLevel(
      details.priority_level ?? details.priorityLevel ?? details.priority
    );

    if (payloadPriority) {
      details.priority_level = payloadPriority;
    } else {
      const stepId = Number(details.step_id ?? details.stepId);
      const resolvedCameraId = Number(cameraId ?? details.camera_id ?? details.cameraId);
      const agentKey = typeof details.agent_key === "string"
        ? details.agent_key.trim()
        : typeof details.agentKey === "string"
        ? details.agentKey.trim()
        : "";

      if (Number.isInteger(stepId) && stepId > 0 && agentKey) {
        let agentRow: any = null;

        if (Number.isInteger(resolvedCameraId) && resolvedCameraId > 0) {
          agentRow = await c.env.DB.prepare(
            `SELECT priority_level
             FROM job_step_agents
             WHERE step_id = ? AND agent_key = ? AND is_active = 1
               AND (camera_id = ? OR camera_id IS NULL)
             ORDER BY CASE WHEN camera_id = ? THEN 0 ELSE 1 END, id DESC
             LIMIT 1`
          )
            .bind(stepId, agentKey, resolvedCameraId, resolvedCameraId)
            .first();
        } else {
          agentRow = await c.env.DB.prepare(
            `SELECT priority_level
             FROM job_step_agents
             WHERE step_id = ? AND agent_key = ? AND is_active = 1
             ORDER BY CASE WHEN camera_id IS NULL THEN 0 ELSE 1 END, id DESC
             LIMIT 1`
          )
            .bind(stepId, agentKey)
            .first();
        }

        const resolvedPriority = normalizePriorityLevel((agentRow as any)?.priority_level);
        if (resolvedPriority) {
          details.priority_level = resolvedPriority;
        }
      }
    }

    const providedVideoKey =
      typeof details.video_key === "string" ? details.video_key.trim() : "";
    const providedVideoUrl =
      typeof details.video_url === "string" ? details.video_url.trim() : "";
    const rawVideoBase64 = typeof details.video_mp4_base64 === "string" ? details.video_mp4_base64 : "";
    const rawImageBase64 =
      typeof details.frame_jpeg_base64 === "string"
        ? details.frame_jpeg_base64
        : typeof details.image_jpeg_b64 === "string"
        ? details.image_jpeg_b64
        : "";
    const rawGroupImages = Array.isArray(details.group_images) ? details.group_images : [];
    const rawRegionResults = Array.isArray(details.region_results) ? details.region_results : [];
    const rawGroupRegionResults = Array.isArray(details.group_region_results)
      ? details.group_region_results
      : [];

    const sanitizeRegionResultItem = (entry: any): Record<string, any> | null => {
      if (!entry || typeof entry !== "object") return null;
      const out: Record<string, any> = {};
      if (Number.isFinite(Number(entry.camera_id ?? entry.cameraId))) {
        out.camera_id = Number(entry.camera_id ?? entry.cameraId);
      }
      if (typeof entry.region_id === "string") out.region_id = entry.region_id;
      if (typeof entry.region_label === "string") out.region_label = entry.region_label;
      if (typeof entry.alert_condition === "boolean") out.alert_condition = entry.alert_condition;
      if (Array.isArray(entry.alert_region_ids)) out.alert_region_ids = entry.alert_region_ids;
      if (Array.isArray(entry.alert_region_names)) out.alert_region_names = entry.alert_region_names;
      if (Array.isArray(entry.motion_trigger_region_ids)) {
        out.motion_trigger_region_ids = entry.motion_trigger_region_ids;
      }
      if (Array.isArray(entry.motion_trigger_region_names)) {
        out.motion_trigger_region_names = entry.motion_trigger_region_names;
      }
      if (Array.isArray(entry.overlay_region_ids)) out.overlay_region_ids = entry.overlay_region_ids;
      return Object.keys(out).length > 0 ? out : null;
    };

    if (rawRegionResults.length > 0) {
      const sanitized = rawRegionResults
        .map((entry: any) => sanitizeRegionResultItem(entry))
        .filter(Boolean) as Array<Record<string, any>>;
      if (sanitized.length > 0) {
        details.region_results = sanitized;
      } else {
        delete details.region_results;
      }
    }

    if (rawGroupRegionResults.length > 0) {
      const sanitized = rawGroupRegionResults
        .map((entry: any) => sanitizeRegionResultItem(entry))
        .filter(Boolean) as Array<Record<string, any>>;
      if (sanitized.length > 0) {
        details.group_region_results = sanitized;
      } else {
        delete details.group_region_results;
      }
    }

    const safeUser = sanitizeKeyToken(userId, "user");
    const safeJob = sanitizeKeyToken(details.job_id, "job");
    const safeStep = sanitizeKeyToken(details.step_id, "step");
    const safeCamera = sanitizeKeyToken(cameraId ?? details.camera_id, "cam");
    const prefersTemporalAlbum = hasTemporalContributingAlbum(details, rawGroupImages);

    let jobVideoKey: string | null = prefersTemporalAlbum ? null : (providedVideoKey || null);
    let jobImageKey: string | null = null;
    let temporalAlbumWon = false;
    const uploadedGroupImages: Array<Record<string, any>> = [];

    const decodeBase64Image = (rawValue: string) => {
      let base64Data = rawValue;
      let contentType = "image/jpeg";
      let extension = ".jpg";

      if (/^data:image\/png;base64,/i.test(rawValue)) {
        base64Data = rawValue.replace(/^data:image\/png;base64,/i, "");
        contentType = "image/png";
        extension = ".png";
      } else if (/^data:image\/webp;base64,/i.test(rawValue)) {
        base64Data = rawValue.replace(/^data:image\/webp;base64,/i, "");
        contentType = "image/webp";
        extension = ".webp";
      } else if (/^data:image\/gif;base64,/i.test(rawValue)) {
        base64Data = rawValue.replace(/^data:image\/gif;base64,/i, "");
        contentType = "image/gif";
        extension = ".gif";
      } else if (/^data:image\/bmp;base64,/i.test(rawValue)) {
        base64Data = rawValue.replace(/^data:image\/bmp;base64,/i, "");
        contentType = "image/bmp";
        extension = ".bmp";
      } else {
        base64Data = rawValue
          .replace(/^data:image\/jpeg;base64,/i, "")
          .replace(/^data:image\/jpg;base64,/i, "");
      }

      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      return { bytes, contentType, extension };
    };

    if (jobVideoKey) {
      details.video_key = jobVideoKey;
      details.video_url = providedVideoUrl || buildMediaUrl(jobVideoKey);
      details.media_type = "video";
    } else if (rawVideoBase64.trim() && !prefersTemporalAlbum) {
      try {
        const base64Data = rawVideoBase64.replace(/^data:video\/mp4;base64,/i, "");
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const key = `job_alert_media/${safeUser}/jobs/${safeJob}/steps/${safeStep}/cam_${safeCamera}/${Date.now()}_${generateUUID()}.mp4`;
        await c.env.R2_BUCKET.put(key, bytes, {
          httpMetadata: { contentType: "video/mp4" },
        });

        jobVideoKey = key;
        details.video_key = key;
        details.video_url = buildMediaUrl(key);
        details.media_type = "video";
      } catch (err) {
        console.error("[JOB ALERT] Failed to process video:", err);
      }
    }

    if (rawGroupImages.length > 0) {
      for (let index = 0; index < rawGroupImages.length; index++) {
        const item = rawGroupImages[index];
        const entry = item && typeof item === "object" ? (item as Record<string, any>) : null;
        if (!entry) continue;

        const isOfflinePlaceholder =
          entry.is_offline_placeholder === true ||
          entry.isOfflinePlaceholder === true ||
          entry.offline_placeholder === true ||
          entry.offlinePlaceholder === true;

        if (isOfflinePlaceholder) {
          uploadedGroupImages.push({
            camera_id: entry.camera_id ?? entry.cameraId ?? null,
            camera_name:
              typeof entry.camera_name === "string"
                ? entry.camera_name
                : typeof entry.cameraName === "string"
                ? entry.cameraName
                : null,
            snapshot_ts_utc_iso:
              typeof entry.snapshot_ts_utc_iso === "string"
                ? entry.snapshot_ts_utc_iso
                : typeof entry.snapshotTsUtcIso === "string"
                ? entry.snapshotTsUtcIso
                : null,
            is_offline_placeholder: true,
            image_key: null,
            image_url: null,
          });
          continue;
        }

        const entryImageBase64 =
          typeof entry.image_jpeg_b64 === "string"
            ? entry.image_jpeg_b64
            : typeof entry.frame_jpeg_base64 === "string"
            ? entry.frame_jpeg_base64
            : "";
        if (!entryImageBase64.trim()) continue;

        try {
          const { bytes, contentType, extension } = decodeBase64Image(entryImageBase64);
          const entryCameraToken = sanitizeKeyToken(
            entry.camera_id ?? entry.cameraId ?? `${safeCamera}_${index}`,
            `cam_${index}`
          );
          const key = `job_alert_media/${safeUser}/jobs/${safeJob}/steps/${safeStep}/cam_${entryCameraToken}/${Date.now()}_${generateUUID()}${extension}`;
          await c.env.R2_BUCKET.put(key, bytes, {
            httpMetadata: { contentType },
          });

          uploadedGroupImages.push({
            camera_id: entry.camera_id ?? entry.cameraId ?? null,
            camera_name:
              typeof entry.camera_name === "string"
                ? entry.camera_name
                : typeof entry.cameraName === "string"
                ? entry.cameraName
                : null,
            snapshot_ts_utc_iso:
              typeof entry.snapshot_ts_utc_iso === "string"
                ? entry.snapshot_ts_utc_iso
                : typeof entry.snapshotTsUtcIso === "string"
                ? entry.snapshotTsUtcIso
                : null,
            image_key: key,
            image_url: buildMediaUrl(key),
          });
        } catch (err) {
          console.error("[JOB ALERT] Failed to process group image:", err);
        }
      }
    }

    if (uploadedGroupImages.length > 0) {
      details.group_image_urls = uploadedGroupImages;
      details.group_image_count = uploadedGroupImages.length;

      const firstGroupImageWithMedia = uploadedGroupImages.find(
        (entry) =>
          typeof entry?.image_key === "string" &&
          entry.image_key.trim() &&
          typeof entry?.image_url === "string" &&
          entry.image_url.trim()
      );

      if (!details.image_key && firstGroupImageWithMedia?.image_key) {
        details.image_key = firstGroupImageWithMedia.image_key;
        jobImageKey = firstGroupImageWithMedia.image_key;
      }
      if (!details.image_url && firstGroupImageWithMedia?.image_url) {
        details.image_url = firstGroupImageWithMedia.image_url;
      }
      if (!jobVideoKey) {
        details.media_type = "image";
      }
      if (prefersTemporalAlbum && firstGroupImageWithMedia?.image_key) {
        temporalAlbumWon = true;
        jobVideoKey = null;
        details.media_type = "image";
        clearVideoMediaFields(details);
      }
    }

    if (!temporalAlbumWon && prefersTemporalAlbum) {
      if (providedVideoKey) {
        const resolvedVideoKey = providedVideoKey;
        jobVideoKey = resolvedVideoKey;
        details.video_key = resolvedVideoKey;
        details.video_url = providedVideoUrl || buildMediaUrl(resolvedVideoKey);
        details.media_type = "video";
      } else if (rawVideoBase64.trim()) {
        try {
          const base64Data = rawVideoBase64.replace(/^data:video\/mp4;base64,/i, "");
          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          const key = `job_alert_media/${safeUser}/jobs/${safeJob}/steps/${safeStep}/cam_${safeCamera}/${Date.now()}_${generateUUID()}.mp4`;
          await c.env.R2_BUCKET.put(key, bytes, {
            httpMetadata: { contentType: "video/mp4" },
          });

          jobVideoKey = key;
          details.video_key = key;
          details.video_url = buildMediaUrl(key);
          details.media_type = "video";
        } catch (err) {
          console.error("[JOB ALERT] Failed to process deferred video:", err);
        }
      }
    }

    if (rawImageBase64.trim() && uploadedGroupImages.length === 0) {
      try {
        const { bytes, contentType, extension } = decodeBase64Image(rawImageBase64);

        const key = `job_alert_media/${safeUser}/jobs/${safeJob}/steps/${safeStep}/cam_${safeCamera}/${Date.now()}_${generateUUID()}${extension}`;
        await c.env.R2_BUCKET.put(key, bytes, {
          httpMetadata: { contentType },
        });

        jobImageKey = key;
        details.image_key = key;
        details.image_url = buildMediaUrl(key);
        if (!jobVideoKey) {
          details.media_type = "image";
        }
      } catch (err) {
        console.error("[JOB ALERT] Failed to process image:", err);
      }
    }

    if ("video_mp4_base64" in details) delete details.video_mp4_base64;
    if ("frame_jpeg_base64" in details) delete details.frame_jpeg_base64;
    if ("image_jpeg_b64" in details) delete details.image_jpeg_b64;
    if ("group_images" in details) delete details.group_images;

    if (jobVideoKey) {
      details.backend_clip_path = null;
      details.clip_url = details.video_url;
    }

    if (jobImageKey) {
      details.backend_image_path = null;
    }

    console.log("[JOB ALERT] Media processed:", {
      hasVideo: !!jobVideoKey,
      hasImage: !!jobImageKey,
      groupImages: uploadedGroupImages.length,
      temporalAlbumWon,
      cameraId,
      jobId: details.job_id ?? null,
      stepId: details.step_id ?? null,
    });
  }

  const detailsJson = details ? JSON.stringify(details) : null;

  const eventResult = await c.env.DB.prepare(
    `INSERT INTO events (user_id, camera_id, event_type, message, details_json, is_unread, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  )
    .bind(userId, cameraId, eventType, message, detailsJson, now, now)
    .run();

  eventId = eventResult.meta.last_row_id;

  // Insert notification for AI detections
  if (eventType === "ai_detection" && cameraId) {
    const algoType = details?.algo_type || "Detection";
    const cameraName = details?.camera_name || `Camera #${cameraId}`;
    const notificationMessage = message || `${algoType} on ${cameraName}`;
    const detectedAt = details?.timestamp_iso || now;

    await c.env.DB.prepare(
      `INSERT INTO notifications (user_id, camera_id, type, title, message, image_key, video_key, media_type, event_id, created_at, is_read)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    )
      .bind(
        userId,
        cameraId,
        "ai_detection",
        "AI Detection",
        notificationMessage,
        imageKey,
        videoKey,
        mediaType,
        eventId,
        now
      )
      .run();

    // Insert detection record
    if (imageKey || videoKey) {
      await c.env.DB.prepare(
        `INSERT INTO detections (user_id, camera_id, camera_name, algo_type, detected_at, image_key, video_key, media_type, event_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          userId,
          cameraId,
          cameraName,
          algoType,
          detectedAt,
          imageKey || videoKey || "",  // Fallback to videoKey or empty string if imageKey is null
          videoKey,
          mediaType,
          eventId,
          now
      )
        .run();
    }
  }

  // Insert notification for stalled jobs so it appears in the bell dropdown.
  if (eventType === "job_staled") {
    const detailsObj = details && typeof details === "object" ? details : {};
    const parsedJobId = Number(
      (detailsObj as any).job_id ??
        (detailsObj as any).job?.id ??
        (detailsObj as any).jobId
    );
    const jobNameRaw =
      typeof (detailsObj as any).job_name === "string"
        ? (detailsObj as any).job_name
        : typeof (detailsObj as any).job?.name === "string"
        ? (detailsObj as any).job?.name
        : "";
    const jobName = jobNameRaw.trim();
    const hasJobId = Number.isInteger(parsedJobId) && parsedJobId > 0;
    const title = jobName ? `Job Stalled: ${jobName}` : "Job Stalled";
    const fallbackMessage = jobName
      ? `Job ${jobName} stalled and was stopped automatically.`
      : hasJobId
      ? `Job #${parsedJobId} stalled and was stopped automatically.`
      : "A job stalled and was stopped automatically.";
    const notificationMessage =
      typeof message === "string" && message.trim() ? message.trim() : fallbackMessage;

    await c.env.DB.prepare(
      `INSERT INTO notifications (user_id, camera_id, type, title, message, event_id, created_at, is_read)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    )
      .bind(
        userId,
        cameraId,
        "job_staled",
        title,
        notificationMessage,
        eventId,
        now
      )
      .run();
  }

  // Handle job runtime state updates based on event type
  if (
    eventType === "job_started" ||
    eventType === "job_stopped" ||
    eventType === "job_failed" ||
    eventType === "job_completed" ||
    eventType === "job_staled"
  ) {
    // Extract job_id from details (support multiple shapes)
    let jobId: number | null = null;
    let jobName: string | null = null;
    
    if (details) {
      jobId = details.job_id || details.job?.id || details.jobId || null;
      jobName = details.job_name || details.job?.name || null;
    }
    
    if (jobId) {
      const now = new Date().toISOString();
      
      if (eventType === "job_started") {
        // Upsert: status=running, set started_at_utc, clear stopped_at_utc
        await c.env.DB.prepare(
          `INSERT INTO job_runtime_states (job_id, user_id, job_name, status, started_at_utc, stopped_at_utc, last_event_at_utc, created_at, updated_at)
           VALUES (?, ?, ?, 'running', ?, NULL, ?, ?, ?)
           ON CONFLICT(job_id) DO UPDATE SET
             status = 'running',
             started_at_utc = ?,
             stopped_at_utc = NULL,
             last_event_at_utc = ?,
             updated_at = ?`
        )
          .bind(jobId, userId, jobName, now, now, now, now, now, now, now)
          .run();
      } else if (eventType === "job_stopped") {
        await c.env.DB.prepare(
          `INSERT INTO job_runtime_states (job_id, user_id, job_name, status, stopped_at_utc, last_event_at_utc, created_at, updated_at)
           VALUES (?, ?, ?, 'stopped', ?, ?, ?, ?)
           ON CONFLICT(job_id) DO UPDATE SET
             status = 'stopped',
             stopped_at_utc = ?,
             last_event_at_utc = ?,
             updated_at = ?`
        )
          .bind(jobId, userId, jobName, now, now, now, now, now, now, now)
          .run();
      } else if (eventType === "job_failed") {
        await c.env.DB.prepare(
          `INSERT INTO job_runtime_states (job_id, user_id, job_name, status, stopped_at_utc, last_event_at_utc, created_at, updated_at)
           VALUES (?, ?, ?, 'failed', ?, ?, ?, ?)
           ON CONFLICT(job_id) DO UPDATE SET
             status = 'failed',
             stopped_at_utc = ?,
             last_event_at_utc = ?,
             updated_at = ?`
        )
          .bind(jobId, userId, jobName, now, now, now, now, now, now, now)
          .run();
      } else if (eventType === "job_completed") {
        await c.env.DB.prepare(
          `INSERT INTO job_runtime_states (job_id, user_id, job_name, status, stopped_at_utc, last_event_at_utc, created_at, updated_at)
           VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)
           ON CONFLICT(job_id) DO UPDATE SET
             status = 'completed',
             stopped_at_utc = ?,
             last_event_at_utc = ?,
             updated_at = ?`
        )
          .bind(jobId, userId, jobName, now, now, now, now, now, now, now)
          .run();
      } else if (eventType === "job_staled") {
        await c.env.DB.prepare(
          `INSERT INTO job_runtime_states (job_id, user_id, job_name, status, stopped_at_utc, last_event_at_utc, created_at, updated_at)
           VALUES (?, ?, ?, 'staled', ?, ?, ?, ?)
           ON CONFLICT(job_id) DO UPDATE SET
             status = 'staled',
             stopped_at_utc = ?,
             last_event_at_utc = ?,
             updated_at = ?`
        )
          .bind(jobId, userId, jobName, now, now, now, now, now, now, now)
          .run();
      }
    }
  }

  // Set camera online when it starts successfully
  if (cameraId && (eventType === "camera_started" || eventType === "camera_online")) {
    await c.env.DB.prepare(
      `UPDATE cameras
       SET is_online = 1, is_service_running = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`
    )
      .bind(cameraId, userId)
      .run();
  }

  // Auto-stop camera if connection failed.
  if (cameraId && eventType === "camera_connection_failed") {
    if (isDrakonFindTemporaryConnectionFailure) {
      console.log(
        `[COMMAND] Skipped stop_camera and camera state mutation for temporary Drakon Find session on camera ${cameraId}`
      );
      return c.json({
        success: true,
        skipped_stop_camera: true,
        temporary_session: true,
        start_origin: eventStartOrigin,
      });
    }

    // Get current thumbnail URL from database to delete the correct file
    const camera = await c.env.DB.prepare(
      `SELECT thumbnail_url FROM cameras WHERE id = ? AND user_id = ?`
    )
      .bind(cameraId, userId)
      .first();

    const currentThumbnailUrl = camera ? (camera as any).thumbnail_url : null;

    // Update camera status: set offline, stop service, and clear thumbnail
    await c.env.DB.prepare(
      `UPDATE cameras
       SET is_online = 0, is_service_running = 0, thumbnail_url = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`
    )
      .bind(cameraId, userId)
      .run();

    // Delete actual thumbnail from R2 using the URL from database
    if (currentThumbnailUrl) {
      try {
        await c.env.R2_BUCKET.delete(`thumbs/${currentThumbnailUrl}`);
        console.log(`[THUMBNAIL DELETE] Deleted thumbnail: thumbs/${currentThumbnailUrl}`);
      } catch (err) {
        console.log(`[THUMBNAIL DELETE] Failed to delete thumbnail: ${currentThumbnailUrl}`, err);
      }
    }

    // Check if we already have a pending stop_camera command to avoid duplicates
    const pendingStopCommand = await c.env.DB.prepare(
      `SELECT id FROM commands
       WHERE user_id = ? AND camera_id = ? AND command_type = 'stop_camera' AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`
    )
      .bind(userId, cameraId)
      .first();

    if (!pendingStopCommand) {
      // Send stop_camera command to EXE (only if no pending stop exists)
      await c.env.DB.prepare(
        `INSERT INTO commands (user_id, camera_id, command_type, payload, status, created_at, updated_at)
         VALUES (?, ?, 'stop_camera', ?, 'pending', ?, ?)`
      )
        .bind(
          userId,
          cameraId,
          JSON.stringify({ camera_id: cameraId }),
          now,
          now
        )
        .run();
      
      console.log(`[COMMAND] Enqueued stop_camera for camera ${cameraId}`);
    } else {
      console.log(`[COMMAND] Skipped duplicate stop_camera command for camera ${cameraId}`);
    }
  }

  return c.json({ success: true });
});

// EXE orchestrator aggregated state endpoint (for desktop agent)
app.get("/api/agent/orchestrator/state", async (c) => {
  await ensureSchema(c.env.DB);

  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  const pairing = await c.env.DB.prepare(
    `SELECT *
     FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = String((pairing as any).user_id || "");
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const timezoneIana = await resolveUserGlobalTimezone(c.env.DB, userId);
  const timezoneMeta = await c.env.DB.prepare(
    "SELECT timezone_source, timezone_updated_at FROM app_users WHERE id = ? LIMIT 1"
  )
    .bind(userId)
    .first();

  const [
    camerasResult,
    jobsResult,
    cameraAgentsResult,
    jobAgentsResult,
    activeSubscription,
    activeCardRow,
    tokenBalanceRow,
    userOpenAiApiKey,
    userZAiApiKey,
    routerRuntimeConfig,
  ] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name, description, is_online, is_service_running, created_at, updated_at
       FROM cameras
       WHERE user_id = ?
       ORDER BY created_at ASC`
    )
      .bind(userId)
      .all(),
    c.env.DB.prepare(
      `SELECT
         j.id,
         j.name,
         j.schedule_mode,
         j.status,
         j.is_active,
         j.timezone,
         j.start_at,
         j.end_at,
         j.created_at,
         j.updated_at,
         jrs.status AS runtime_status,
         jrs.started_at_utc AS runtime_started_at_utc,
         jrs.stopped_at_utc AS runtime_stopped_at_utc,
         jrs.last_event_at_utc AS runtime_last_event_at_utc
       FROM jobs j
       LEFT JOIN job_runtime_states jrs ON jrs.job_id = j.id
       WHERE j.user_id = ?
       ORDER BY j.created_at DESC`
    )
      .bind(userId)
      .all(),
    c.env.DB.prepare(
      `SELECT
         ca.id,
         ca.camera_id,
         c.name AS camera_name,
         ca.algorithm_type,
         ca.is_enabled,
         ca.input_type,
         ca.inference_model,
         ca.model_fps,
         ca.run_every,
         ca.running_resolution,
         ca.only_capture_on_motion,
         ca.updated_at
       FROM camera_algorithms ca
       JOIN cameras c ON c.id = ca.camera_id
       WHERE c.user_id = ?
         AND ca.algorithm_type LIKE 'custom_%'
       ORDER BY c.created_at ASC, ca.id ASC`
    )
      .bind(userId)
      .all(),
    c.env.DB.prepare(
      `SELECT
         jsa.id,
         jsa.step_id,
         jsa.camera_id,
         js.name AS step_name,
         js.step_order,
         j.id AS job_id,
         j.name AS job_name,
         jsa.agent_key,
         jsa.input_type,
         jsa.inference_model,
         jsa.model_fps,
         jsa.running_resolution,
         jsa.is_active,
         jsa.updated_at
       FROM job_step_agents jsa
       JOIN job_steps js ON js.id = jsa.step_id
       JOIN jobs j ON j.id = js.job_id
       WHERE j.user_id = ?
       ORDER BY j.created_at DESC, js.step_order ASC, jsa.id ASC`
    )
      .bind(userId)
      .all(),
    c.env.DB.prepare(
      `SELECT id, subscription_type, status, is_active, camera_count, seconds_per_frame, model_tier, started_at, expires_at
       FROM subscriptions
       WHERE user_id = ? AND is_active = 1
       ORDER BY started_at DESC
       LIMIT 1`
    )
      .bind(userId)
      .first(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM active_cards
       WHERE user_id = ?`
    )
      .bind(userId)
      .first(),
    c.env.DB.prepare(
      `SELECT balance, input_balance, output_balance, total_spent
       FROM token_balances
       WHERE user_id = ?`
    )
      .bind(userId)
      .first(),
    getUserOpenAIApiKey(c.env.DB, userId),
    getUserZAIApiKey(c.env.DB, userId),
    loadChatModelRuntimeConfig(c.env.DB, "legacy"),
  ]);

  const cameras = (camerasResult.results || []).map((row: any) => ({
    id: Number(row?.id ?? 0),
    name: typeof row?.name === "string" ? row.name : "",
    description: typeof row?.description === "string" ? row.description : "",
    is_online: Number(row?.is_online ?? 0) === 1,
    is_service_running: Number(row?.is_service_running ?? 0) === 1,
    created_at: row?.created_at ?? null,
    updated_at: row?.updated_at ?? null,
  }));

  const jobs = (jobsResult.results || []).map((row: any) => ({
    id: Number(row?.id ?? 0),
    name: typeof row?.name === "string" ? row.name : "",
    schedule_mode: row?.schedule_mode ?? null,
    status: row?.status ?? null,
    is_active: Number(row?.is_active ?? 0) === 1,
    timezone: row?.timezone ?? null,
    start_at: row?.start_at ?? null,
    end_at: row?.end_at ?? null,
    runtime_status: row?.runtime_status ?? null,
    runtime_started_at_utc: row?.runtime_started_at_utc ?? null,
    runtime_stopped_at_utc: row?.runtime_stopped_at_utc ?? null,
    runtime_last_event_at_utc: row?.runtime_last_event_at_utc ?? null,
    created_at: row?.created_at ?? null,
    updated_at: row?.updated_at ?? null,
  }));

  const cameraAgents = (cameraAgentsResult.results || []).map((row: any) => ({
    id: Number(row?.id ?? 0),
    camera_id: Number(row?.camera_id ?? 0),
    camera_name: typeof row?.camera_name === "string" ? row.camera_name : "",
    algorithm_type: row?.algorithm_type ?? null,
    is_enabled: Number(row?.is_enabled ?? 0) === 1,
    input_type: row?.input_type ?? null,
    inference_model: row?.inference_model ?? null,
    model_fps: row?.model_fps ?? null,
    run_every: row?.run_every ?? null,
    running_resolution: row?.running_resolution ?? null,
    only_capture_on_motion: Number(row?.only_capture_on_motion ?? 0) === 1,
    updated_at: row?.updated_at ?? null,
  }));

  const jobAgents = (jobAgentsResult.results || []).map((row: any) => ({
    id: Number(row?.id ?? 0),
    step_id: Number(row?.step_id ?? 0),
    camera_id:
      row?.camera_id === null || row?.camera_id === undefined
        ? null
        : Number(row.camera_id),
    step_name: typeof row?.step_name === "string" ? row.step_name : "",
    step_order:
      row?.step_order === null || row?.step_order === undefined
        ? null
        : Number(row.step_order),
    job_id: Number(row?.job_id ?? 0),
    job_name: typeof row?.job_name === "string" ? row.job_name : "",
    agent_key: typeof row?.agent_key === "string" ? row.agent_key : "",
    input_type: row?.input_type ?? null,
    inference_model: row?.inference_model ?? null,
    model_fps: row?.model_fps ?? null,
    running_resolution: row?.running_resolution ?? null,
    is_active: Number(row?.is_active ?? 0) === 1,
    updated_at: row?.updated_at ?? null,
  }));

  const cardsCount = Number((activeCardRow as any)?.count ?? 0);
  const tokenBalance = {
    balance: Number((tokenBalanceRow as any)?.balance ?? 0),
    input_balance: Number((tokenBalanceRow as any)?.input_balance ?? 0),
    output_balance: Number((tokenBalanceRow as any)?.output_balance ?? 0),
    total_spent: Number((tokenBalanceRow as any)?.total_spent ?? 0),
  };

  const hasActiveSubscription = !!activeSubscription;
  const hasTokens = tokenBalance.balance > 0;
  const hasActiveCard = cardsCount > 0;

  return c.json({
    generated_at: new Date().toISOString(),
    user: {
      id: userId,
      timezone_iana: timezoneIana,
      timezone_source: (timezoneMeta as any)?.timezone_source || null,
      timezone_updated_at: (timezoneMeta as any)?.timezone_updated_at || null,
    },
    pairing: {
      status: "connected",
      client_id: (pairing as any).client_id,
      exe_id: (pairing as any).exe_id,
      paired_at: (pairing as any).paired_at ?? null,
      last_seen_at: (pairing as any).last_seen_at ?? null,
      timezone_iana: (pairing as any).timezone_iana ?? null,
      timezone_updated_at: (pairing as any).timezone_updated_at ?? null,
    },
    cameras: {
      count: cameras.length,
      online_count: cameras.filter((camera: any) => camera.is_online).length,
      service_running_count: cameras.filter((camera: any) => camera.is_service_running).length,
      items: cameras,
    },
    camera_agents: {
      count: cameraAgents.length,
      enabled_count: cameraAgents.filter((agent: any) => agent.is_enabled).length,
      items: cameraAgents,
    },
    jobs: {
      count: jobs.length,
      running_count: jobs.filter((job: any) =>
        String(job.runtime_status || "").toLowerCase() === "running"
      ).length,
      items: jobs,
    },
    job_agents: {
      count: jobAgents.length,
      active_count: jobAgents.filter((agent: any) => agent.is_active).length,
      items: jobAgents,
    },
    billing: {
      has_active_subscription: hasActiveSubscription,
      active_cards_count: cardsCount,
      has_tokens: hasTokens,
      token_balance: tokenBalance,
      chat_access: hasActiveSubscription || hasTokens || hasActiveCard,
      subscription: activeSubscription
        ? {
            id: Number((activeSubscription as any).id ?? 0),
            subscription_type: (activeSubscription as any).subscription_type ?? null,
            status: (activeSubscription as any).status ?? null,
            is_active: Number((activeSubscription as any).is_active ?? 0) === 1,
            camera_count: Number((activeSubscription as any).camera_count ?? 0),
            seconds_per_frame: Number((activeSubscription as any).seconds_per_frame ?? 0),
            model_tier: (activeSubscription as any).model_tier ?? null,
            started_at: (activeSubscription as any).started_at ?? null,
            expires_at: (activeSubscription as any).expires_at ?? null,
          }
        : null,
    },
    api_keys: {
      openai_configured: !!userOpenAiApiKey,
      zai_configured: !!userZAiApiKey,
      legacy_router_configured: !!routerRuntimeConfig.apiKey,
    },
    capabilities: {
      video_search_ultra_available:
        !!userOpenAiApiKey && !!routerRuntimeConfig.apiKey && (hasActiveSubscription || hasTokens || hasActiveCard),
      video_search_core_available:
        !!userZAiApiKey && !!routerRuntimeConfig.apiKey && (hasActiveSubscription || hasTokens || hasActiveCard),
      chatv2_enabled:
        String(c.env.CHAT_V2_ENABLED || "").trim().toLowerCase() === "1" ||
        String(c.env.CHAT_V2_ENABLED || "").trim().toLowerCase() === "true" ||
        String(c.env.CHAT_V2_ENABLED || "").trim().toLowerCase() === "yes" ||
        String(c.env.CHAT_V2_ENABLED || "").trim().toLowerCase() === "on",
    },
  });
});

// EXE chatv2 routing telemetry endpoint (called by desktop agent)
app.post("/api/agent/orchestrator/telemetry", async (c) => {
  await ensureSchema(c.env.DB);

  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  const pairing = await c.env.DB.prepare(
    `SELECT *
     FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = String((pairing as any).user_id || "");
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req
    .json<{
      chat_session_id?: number | null;
      routing_mode?: string;
      actual_command_type?: string;
      selected_skill?: string;
      confidence?: number | null;
      selection_source?: string | null;
      selection_reason?: string | null;
      reply_preview?: string | null;
      user_query?: string | null;
      metadata?: unknown;
    }>()
    .catch(() => null);

  if (!body) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const routingModeRaw = String(body.routing_mode || "").trim().toLowerCase();
  const routingMode = routingModeRaw === "shadow" ? "shadow" : "actual";

  const actualCommandTypeRaw = String(body.actual_command_type || "").trim().toLowerCase();
  const actualCommandType =
    actualCommandTypeRaw === "orchestrator_query" ? "orchestrator_query" : "chat_query";

  const selectedSkill = String(body.selected_skill || "").trim();
  if (!selectedSkill) {
    return c.json({ error: "selected_skill is required" }, 400);
  }

  const confidence =
    typeof body.confidence === "number" && Number.isFinite(body.confidence)
      ? Math.max(0, Math.min(1, body.confidence))
      : 0;

  const metadataJson = (() => {
    try {
      return JSON.stringify(body.metadata ?? {});
    } catch {
      return "{}";
    }
  })();

  await c.env.DB.prepare(
    `INSERT INTO chat_v2_routing_events (
       user_id,
       chat_session_id,
       routing_mode,
       actual_command_type,
       selected_skill,
       confidence,
       selection_source,
       selection_reason,
       reply_preview,
       user_query,
       metadata_json,
       created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      userId,
      body.chat_session_id ?? null,
      routingMode,
      actualCommandType,
      selectedSkill,
      confidence,
      body.selection_source ?? null,
      body.selection_reason ?? null,
      body.reply_preview ?? null,
      body.user_query ?? "",
      metadataJson,
      new Date().toISOString()
    )
    .run();

  return c.json({ ok: true });
});

// EXE cameras list endpoint (for desktop agent)
app.get("/api/agent/cameras", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  // Read Bearer token from Authorization header
  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  // Find pairing for this client + token
  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = (pairing as any).user_id;

  // Query all cameras for this user
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, description
     FROM cameras
     WHERE user_id = ?
     ORDER BY created_at ASC`
  )
    .bind(userId)
    .all();

  return c.json(results || []);
});

// EXE camera target state endpoint (for desktop agent)
app.post("/api/agent/cameras/:cameraId/target_state", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");
  const cameraId = c.req.param("cameraId");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  if (!cameraId) {
    return c.json({ error: "camera_id is required" }, 400);
  }

  // Read Bearer token from Authorization header
  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  // Find pairing for this client + token
  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = (pairing as any).user_id;

  const body = await c.req.json<{
    is_service_running: number | boolean | string;
    source?: string;
  }>().catch(() => null);

  if (!body || typeof body.is_service_running === "undefined") {
    return c.json({ error: "is_service_running is required" }, 400);
  }

  const raw = body.is_service_running;
  const normalized =
    raw === true || raw === 1 || raw === "1"
      ? 1
      : raw === false || raw === 0 || raw === "0"
      ? 0
      : null;

  if (normalized === null) {
    return c.json({ error: "is_service_running must be 0/1 or boolean" }, 400);
  }

  // Make sure camera belongs to this user
  const camera = await c.env.DB.prepare(
    `SELECT id FROM cameras WHERE id = ? AND user_id = ?`
  )
    .bind(cameraId, userId)
    .first();

  if (!camera) {
    return c.json({ error: "Camera not found" }, 404);
  }

  await c.env.DB.prepare(
    `UPDATE cameras
     SET is_service_running = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`
  )
    .bind(normalized, cameraId, userId)
    .run();

  return c.json({
    ok: true,
    camera_id: Number(cameraId),
    is_service_running: normalized,
  });
});

// EXE camera description endpoint (for desktop agent)
app.get("/api/agent/camera-description", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");
  const cameraId = url.searchParams.get("camera_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  if (!cameraId) {
    return c.json({ error: "camera_id is required" }, 400);
  }

  // Read Bearer token from Authorization header
  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  // Find pairing for this client + token
  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = (pairing as any).user_id;

  // Query the camera
  const camera = await c.env.DB.prepare(
    `SELECT id, name, description, description_first_check_successful, description_first_check_success_at
     FROM cameras
     WHERE id = ? AND user_id = ?`
  )
    .bind(cameraId, userId)
    .first();

  if (!camera) {
    return c.json({ error: "Camera not found" }, 404);
  }

  const cam: any = camera;
  const description = cam?.description ?? "";
  const hasDescription = !!normalizeStructuredCameraDescription(description);
  const successfulFromDb = Number(cam?.description_first_check_successful ?? 0) === 1;
  const descriptionFirstCheckSuccessful = successfulFromDb || hasDescription;
  const descriptionFirstCheckSuccessAt = cam?.description_first_check_success_at ?? null;

  return c.json({
    camera_id: cam.id,
    name: cam.name,
    has_description: hasDescription,
    description: description || "",
    description_first_check_successful: descriptionFirstCheckSuccessful,
    description_first_check_success_at: descriptionFirstCheckSuccessAt,
  });
});

// EXE camera description UPDATE endpoint (for desktop agent)
app.post("/api/agent/camera-description", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  // Read Bearer token from Authorization header
  const authHeader =
    c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  // Find pairing for this client + token
  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = (pairing as any).user_id;

  // Parse body: camera_id + description
  const body = await c.req.json<{
    camera_id: number;
    description: string;
    description_first_check_successful?: boolean | number | string;
    description_first_check_success_at?: string | null;
  }>().catch(() => null);

  if (!body || !body.camera_id || typeof body.description !== "string") {
    return c.json(
      { error: "camera_id (number) and description (string) are required" },
      400
    );
  }

  const cameraId = body.camera_id;

  // Make sure camera belongs to this user
  const camera = await c.env.DB.prepare(
    `SELECT id FROM cameras WHERE id = ? AND user_id = ?`
  )
    .bind(cameraId, userId)
    .first();

  if (!camera) {
    return c.json({ error: "Camera not found" }, 404);
  }

  const requestedSuccessful = (() => {
    const value = body.description_first_check_successful;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
      if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
    }
    return false;
  })();

  const normalizedStructuredDescription = normalizeStructuredCameraDescription(body.description);
  const rawDescription =
    typeof body.description === "string" ? body.description.trim() : "";
  const persistedDescription = normalizedStructuredDescription ?? rawDescription;
  const shouldMarkSuccessful = requestedSuccessful || !!normalizedStructuredDescription;

  if (requestedSuccessful && !normalizedStructuredDescription) {
    return c.json(
      { error: "description must contain valid LABEL and DESCRIPTION when marking successful" },
      400
    );
  }

  if (shouldMarkSuccessful) {
    const parsedSuccessAt =
      typeof body.description_first_check_success_at === "string"
        ? Date.parse(body.description_first_check_success_at)
        : NaN;
    const successAt = Number.isFinite(parsedSuccessAt)
      ? new Date(parsedSuccessAt).toISOString()
      : new Date().toISOString();

    await c.env.DB.prepare(
      `UPDATE cameras
       SET description = ?,
           description_first_check_successful = 1,
           description_first_check_success_at = COALESCE(description_first_check_success_at, ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`
    )
      .bind(persistedDescription, successAt, cameraId, userId)
      .run();
  } else {
    await c.env.DB.prepare(
      `UPDATE cameras
       SET description = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`
    )
      .bind(persistedDescription, cameraId, userId)
      .run();
  }

  return c.json({ ok: true });
});

// EXE commands polling endpoint (for desktop agent)
app.get("/api/agent/commands", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");
  const exeTimezoneHeader =
    c.req.header("x-exe-timezone") || c.req.header("X-EXE-Timezone") || "";

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  // Read Bearer token from Authorization header
  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  // Find pairing for this client + token
  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    // Either not paired or invalid token: return empty list (agent will just poll again)
    return c.json([]);
  }

  const userId = (pairing as any).user_id;
  const exeId = String((pairing as any).exe_id || "");
  const lastSeenTs = new Date().toISOString();

  await syncTimezoneFromExeSignal(c.env.DB, {
    userId,
    clientId,
    exeTokenHash,
    timezoneInput: exeTimezoneHeader,
  });

  // Update "last_seen_at" for heartbeat
  await c.env.DB.prepare(
    `UPDATE exe_pairings SET last_seen_at = ? WHERE user_id = ? AND client_id = ?`
  )
    .bind(lastSeenTs, userId, clientId)
    .run();

  // Fetch pending commands for this user
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM commands
     WHERE user_id = ?
       AND (
         target_client_id IS NULL
         OR TRIM(target_client_id) = ''
         OR target_client_id = ?
       )
       AND (
         target_exe_id IS NULL
         OR TRIM(target_exe_id) = ''
         OR target_exe_id = ?
       )
       AND (status IS NULL OR status = 'pending')
     ORDER BY created_at ASC
     LIMIT 20`
  )
    .bind(userId, clientId, exeId)
    .all();

  if (!results || results.length === 0) {
    return c.json([]);
  }

  const fallbackTimezone = await resolveUserGlobalTimezone(c.env.DB, userId);
  const nowMs = Date.now();
  const jobRuntimeStatusCache = new Map<number, string | null>();
  const loadJobRuntimeStatus = async (jobId: number): Promise<string | null> => {
    if (!Number.isInteger(jobId) || jobId <= 0) return null;
    if (jobRuntimeStatusCache.has(jobId)) {
      return jobRuntimeStatusCache.get(jobId) ?? null;
    }

    const row = await c.env.DB.prepare(
      `SELECT status FROM job_runtime_states WHERE job_id = ? LIMIT 1`
    )
      .bind(jobId)
      .first();

    const status =
      typeof (row as any)?.status === "string" && (row as any).status.trim()
        ? String((row as any).status).trim().toLowerCase()
        : null;
    jobRuntimeStatusCache.set(jobId, status);
    return status;
  };

  const commands: Array<{
    id: number;
    command_type: string;
    camera_id: number | null;
    payload: any;
  }> = [];
  const deliverIds: number[] = [];
  const completionUpdates: Promise<unknown>[] = [];
  const commandRows = results as any[];
  const kJobStartWindowGraceMs = 30_000;

  for (const row of commandRows) {
    let payload: any = null;
    if (row.payload) {
      try {
        payload = JSON.parse(row.payload);
      } catch {
        payload = row.payload; // let C++ handle raw string if parse fails
      }
    }

    const commandId = Number(row.id);
    const commandType = String(row.command_type || "");
    let ignoreReason = "";
    let jobId: number | null = null;
    let windowEndUtc: string | null = null;

    if (commandType === "job_start" && payload && typeof payload === "object") {
      const parsedJobId = Number(payload?.job?.id);
      if (Number.isInteger(parsedJobId) && parsedJobId > 0) {
        jobId = parsedJobId;
        const runtimeStatus = await loadJobRuntimeStatus(parsedJobId);
        if (runtimeStatus === "stopping" || runtimeStatus === "stopped") {
          ignoreReason = `job_runtime_${runtimeStatus}`;
        }
      }

      if (!ignoreReason) {
        windowEndUtc = deriveJobStartWindowBoundaryUtc(payload, "end", fallbackTimezone);
        const windowEndMs = windowEndUtc ? Date.parse(windowEndUtc) : Number.NaN;
        if (Number.isFinite(windowEndMs) && nowMs > windowEndMs + kJobStartWindowGraceMs) {
          ignoreReason = "expired_schedule_window";
        }
      }
    }

    if (ignoreReason && Number.isInteger(commandId) && commandId > 0) {
      const resultPayload: Record<string, unknown> = {
        ignored: true,
        reason: ignoreReason,
      };
      if (jobId) resultPayload.job_id = jobId;
      if (windowEndUtc) resultPayload.window_end_utc = windowEndUtc;

      const resultEnvelope = {
        status: "completed",
        result: resultPayload,
        error: null,
        reported_at: lastSeenTs,
      };

      console.log(
        `[AGENT COMMANDS] Ignoring job_start command ${commandId} reason=${ignoreReason}` +
          (jobId ? ` job_id=${jobId}` : "") +
          (windowEndUtc ? ` window_end_utc=${windowEndUtc}` : "")
      );

      completionUpdates.push(
        c.env.DB.prepare(
          `UPDATE commands
           SET status = 'completed', result = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`
        )
          .bind(JSON.stringify(resultEnvelope), lastSeenTs, commandId, userId)
          .run()
      );
      continue;
    }

    commands.push({
      id: row.id,
      command_type: row.command_type,
      camera_id: row.camera_id,
      payload,
    });
    if (Number.isInteger(commandId) && commandId > 0) {
      deliverIds.push(commandId);
    }
  }

  if (completionUpdates.length > 0) {
    await Promise.all(completionUpdates);
  }

  if (commands.length === 0) {
    return c.json([]);
  }

  // Mark them as "sent" (optional but recommended)
  const placeholders = deliverIds.map(() => "?").join(", ");
  if (placeholders) {
    await c.env.DB.prepare(
      `UPDATE commands
       SET status = 'sent',
           target_client_id = COALESCE(NULLIF(target_client_id, ''), ?),
           target_exe_id = COALESCE(NULLIF(target_exe_id, ''), ?),
           updated_at = ?
       WHERE id IN (${placeholders})`
    )
      .bind(clientId, exeId || null, lastSeenTs, ...deliverIds)
      .run();
  }

  // For job_stop commands, immediately update runtime state to stopped
  for (const cmd of commands) {
    if (cmd.command_type === "job_stop" && cmd.payload) {
      const jobId = cmd.payload?.job?.id;
      const jobName = cmd.payload?.job?.name;
      
      if (jobId) {
        // Upsert runtime state to stopped
        await c.env.DB.prepare(
          `INSERT INTO job_runtime_states (job_id, user_id, job_name, status, stopped_at_utc, last_event_at_utc, created_at, updated_at)
           VALUES (?, ?, ?, 'stopped', ?, ?, ?, ?)
           ON CONFLICT(job_id) DO UPDATE SET
             status = 'stopped',
             job_name = COALESCE(excluded.job_name, job_runtime_states.job_name),
             stopped_at_utc = excluded.stopped_at_utc,
             last_event_at_utc = excluded.last_event_at_utc,
             updated_at = excluded.updated_at`
        )
          .bind(jobId, userId, jobName, lastSeenTs, lastSeenTs, lastSeenTs, lastSeenTs)
          .run();

        // Insert event for activity/history
        await c.env.DB.prepare(
          `INSERT INTO events (user_id, camera_id, event_type, message, is_unread, created_at, updated_at)
           VALUES (?, NULL, 'job_stopped', ?, 0, ?, ?)`
        )
          .bind(userId, `Job "${jobName}" stopped (acknowledged by EXE).`, lastSeenTs, lastSeenTs)
          .run();
      }
    }
  }

  return c.json(commands);
});

app.post("/api/agent/commands/:commandId/result", async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get("client_id");
  const commandId = parseInt(c.req.param("commandId"), 10);

  if (!clientId) {
    return c.json({ error: "client_id is required" }, 400);
  }

  if (!Number.isInteger(commandId) || commandId <= 0) {
    return c.json({ error: "Invalid command id" }, 400);
  }

  const authHeader = c.req.header("authorization") || c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const exeToken = authHeader.slice("Bearer ".length).trim();
  const exeTokenHash = await hashToken(exeToken);

  const pairing = await c.env.DB.prepare(
    `SELECT * FROM exe_pairings
     WHERE client_id = ? AND exe_token_hash = ? AND status = 'connected'`
  )
    .bind(clientId, exeTokenHash)
    .first();

  if (!pairing) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = String((pairing as any).user_id || "");
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req
    .json<{
      status?: string;
      result?: unknown;
      error?: string;
    }>()
    .catch(() => null);

  if (!body) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const statusRaw = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
  const normalizedStatus =
    statusRaw === "completed" ? "completed" : statusRaw === "failed" ? "failed" : null;
  if (!normalizedStatus) {
    return c.json({ error: "status must be 'completed' or 'failed'" }, 400);
  }

  const existingCommand = await c.env.DB.prepare(
    `SELECT id, command_type, payload, target_client_id, target_exe_id
     FROM commands
     WHERE id = ? AND user_id = ?`
  )
    .bind(commandId, userId)
    .first();

  if (!existingCommand) {
    return c.json({ error: "Command not found" }, 404);
  }

  const now = new Date().toISOString();
  const resultEnvelope = {
    status: normalizedStatus,
    result: body.result ?? null,
    error: typeof body.error === "string" ? body.error : null,
    reported_at: now,
  };

  await c.env.DB.prepare(
    `UPDATE commands
     SET status = ?, result = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  )
    .bind(normalizedStatus, JSON.stringify(resultEnvelope), now, commandId, userId)
    .run();

  const commandType = String((existingCommand as any)?.command_type || "");
  if (commandType === "drakon_find_cancel" && normalizedStatus === "completed") {
    const resultObject =
      body.result && typeof body.result === "object" && !Array.isArray(body.result)
        ? (body.result as Record<string, unknown>)
        : null;
    const acceptedRaw = resultObject?.accepted;
    const accepted =
      typeof acceptedRaw === "boolean"
        ? acceptedRaw
        : typeof acceptedRaw === "number"
          ? acceptedRaw !== 0
          : null;

    if (accepted === false) {
      const payload = parseJsonObject((existingCommand as any)?.payload);
      const searchId = clampInteger(payload?.search_id ?? payload?.searchId);
      const targetClientId =
        typeof (existingCommand as any)?.target_client_id === "string" &&
        String((existingCommand as any).target_client_id).trim()
          ? String((existingCommand as any).target_client_id).trim()
          : clientId;
      const targetExeId =
        typeof (existingCommand as any)?.target_exe_id === "string" &&
        String((existingCommand as any).target_exe_id).trim()
          ? String((existingCommand as any).target_exe_id).trim()
          : "";

      if (searchId > 0 && targetClientId) {
        await reconcileDrakonFindSearchClientTerminalState(c.env.DB, {
          searchId,
          clientId: targetClientId,
          exeId: targetExeId || null,
          dispatchStatus: "cancelled",
          lastEventType: "drakon_find_search_cancelled",
          now,
          lastError: null,
        });
        await finalizeDrakonFindSearchIfTerminal(c.env.DB, searchId);
      }
    }
  }
  if (commandType === "drakon_find_start" || commandType === "drakon_find_cancel") {
    await dispatchQueuedDrakonFindSearches(c.env);
  }

  return c.json({ success: true });
});





// Jobs endpoints
app.get("/api/jobs", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;

  const { results } = await c.env.DB.prepare(
    `SELECT 
       j.*,
       jrs.status AS runtime_status,
       jrs.started_at_utc AS runtime_started_at_utc,
       jrs.updated_at AS runtime_updated_at
     FROM jobs j
     LEFT JOIN job_runtime_states jrs ON jrs.job_id = j.id
     WHERE j.user_id = ?
     ORDER BY j.created_at DESC`
  )
    .bind(user.id)
    .all();

  // Attach schedule data for recurring jobs (weekly/monthly/yearly)
  const jobsWithSchedules = await Promise.all(
    (results || []).map(async (job: any) => {
      const isRecurring = ["weekly", "monthly", "yearly"].includes(job.schedule_mode);
      
      if (isRecurring) {
        // Fetch schedule days with their windows
        const { results: days } = await c.env.DB.prepare(
          `SELECT id, day_name, day_of_week, day_of_month, month_of_year, sort_order
           FROM job_schedule_days WHERE job_id = ? ORDER BY sort_order ASC`
        )
          .bind(job.id)
          .all();

        const scheduleDays = await Promise.all(
          (days || []).map(async (day: any) => {
            const { results: windows } = await c.env.DB.prepare(
              `SELECT start_time, end_time, is_enabled FROM job_schedule_windows
               WHERE schedule_day_id = ? ORDER BY sort_order ASC`
            )
              .bind(day.id)
              .all();

            return {
              day_name: day.day_name,
              day_of_week: day.day_of_week,
              day_of_month: day.day_of_month,
              month_of_year: day.month_of_year,
              windows: (windows || []).map((w: any) => ({
                start_time: w.start_time,
                end_time: w.end_time,
              })),
            };
          })
        );

        // Build schedule summary
        const summaryParts: string[] = [];
        for (const day of scheduleDays) {
          const windowStrs = day.windows.map((w: any) => `${w.start_time}–${w.end_time}`).join(', ');
          summaryParts.push(`${day.day_name} ${windowStrs}`);
        }
        const modeLabel = job.schedule_mode.charAt(0).toUpperCase() + job.schedule_mode.slice(1);
        const scheduleSummary = summaryParts.length > 0 
          ? `${modeLabel}: ${summaryParts.join('; ')}`
          : `${modeLabel}: No schedule configured`;

        return {
          ...job,
          schedule_days: scheduleDays,
          schedule_summary: scheduleSummary,
        };
      }
      
      return job;
    })
  );

  return c.json({ jobs: jobsWithSchedules });
});

app.post("/api/jobs", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<{
    name: string;
    description?: string;
    start_at?: string | null;
    end_at?: string | null;
    schedule_mode?: string;
    active_from?: string | null;
    active_until?: string | null;
    schedule_days?: Array<{
      day_name: string;
      day_of_week?: number;
      day_of_month?: number;
      month_of_year?: number;
      windows: Array<{ start_time: string; end_time: string }>;
    }>;
    weekly_schedule?: any; // Legacy support
  }>();

  const now = new Date().toISOString();
  const todayDate = now.split('T')[0]; // YYYY-MM-DD
  
  // Get schedule mode - default to weekly for new jobs (one_shot cannot be created from UI)
  const scheduleMode = body.schedule_mode || "weekly";
  const timezone = await resolveUserGlobalTimezone(c.env.DB, user.id);

  // Reject one_shot creation from UI
  if (scheduleMode === "one_shot") {
    return c.json({ 
      error: "One-time schedules cannot be created. Please use weekly, monthly, or yearly schedule mode." 
    }, 400);
  }

  // Validate schedule mode
  const validModes = ["weekly", "monthly", "yearly"];
  if (!validModes.includes(scheduleMode)) {
    return c.json({ 
      error: `Invalid schedule_mode. Must be one of: ${validModes.join(", ")}` 
    }, 400);
  }

  // Validate schedule_days if provided
  const scheduleDays = body.schedule_days || [];
  
  // Convert legacy weekly_schedule format to schedule_days if needed
  if (!body.schedule_days && body.weekly_schedule && scheduleMode === "weekly") {
    const schedule = body.weekly_schedule;
    const dayMap: Record<string, { dayOfWeek: number; dayName: string }> = {
      sunday: { dayOfWeek: 0, dayName: "Sunday" },
      monday: { dayOfWeek: 1, dayName: "Monday" },
      tuesday: { dayOfWeek: 2, dayName: "Tuesday" },
      wednesday: { dayOfWeek: 3, dayName: "Wednesday" },
      thursday: { dayOfWeek: 4, dayName: "Thursday" },
      friday: { dayOfWeek: 5, dayName: "Friday" },
      saturday: { dayOfWeek: 6, dayName: "Saturday" },
    };

    const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (const dayKey of dayKeys) {
      const daySchedule = schedule[dayKey];
      if (daySchedule && daySchedule.enabled && Array.isArray(daySchedule.windows) && daySchedule.windows.length > 0) {
        const { dayOfWeek, dayName } = dayMap[dayKey];
        scheduleDays.push({
          day_name: dayName,
          day_of_week: dayOfWeek,
          windows: daySchedule.windows.map((w: any) => ({
            start_time: w.start || w.start_time,
            end_time: w.end || w.end_time,
          })),
        });
      }
    }
  }

  // Validate schedule_days for recurring schedules
  if (scheduleDays.length === 0) {
    return c.json({ 
      error: "At least one schedule day is required for recurring schedules" 
    }, 400);
  }

  for (const day of scheduleDays) {
    if (!day.day_name || day.day_name.trim() === "") {
      return c.json({ error: "day_name is required for each schedule day" }, 400);
    }
    
    if (!day.windows || day.windows.length === 0) {
      return c.json({ error: `At least one time window is required for ${day.day_name}` }, 400);
    }

    // Validate windows
    for (const window of day.windows) {
      if (!window.start_time || !window.end_time) {
        return c.json({ error: `start_time and end_time are required for windows in ${day.day_name}` }, 400);
      }
      
      // Basic time format validation
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(window.start_time) || !timeRegex.test(window.end_time)) {
        return c.json({ error: `Invalid time format in ${day.day_name}. Use HH:MM format.` }, 400);
      }
      
      // Validate start < end
      if (window.start_time >= window.end_time) {
        return c.json({ error: `Start time must be before end time in ${day.day_name}` }, 400);
      }
    }

    // Validate mode-specific fields
    if (scheduleMode === "weekly" && day.day_of_week === undefined) {
      return c.json({ error: `day_of_week is required for weekly schedule (${day.day_name})` }, 400);
    }
    if (scheduleMode === "monthly" && day.day_of_month === undefined) {
      return c.json({ error: `day_of_month is required for monthly schedule (${day.day_name})` }, 400);
    }
    if (scheduleMode === "yearly" && (day.month_of_year === undefined || day.day_of_month === undefined)) {
      return c.json({ error: `month_of_year and day_of_month are required for yearly schedule (${day.day_name})` }, 400);
    }
  }

  // Set active_from to today if not provided
  const activeFrom = body.active_from || todayDate;
  const activeUntil = body.active_until || null;

  // Insert the job
  const result = await c.env.DB.prepare(
    `INSERT INTO jobs (user_id, name, description, start_at, end_at, schedule_mode, timezone, active_from, active_until, status, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, 'draft', ?, ?)`
  )
    .bind(
      user.id,
      body.name,
      body.description || null,
      scheduleMode,
      timezone,
      activeFrom,
      activeUntil,
      now,
      now
    )
    .run();

  const jobId = result.meta.last_row_id;

  // Insert schedule days and windows
  let daySortOrder = 0;
  for (const day of scheduleDays) {
    // Insert into job_schedule_days
    const dayResult = await c.env.DB.prepare(
      `INSERT INTO job_schedule_days (job_id, schedule_mode, day_name, day_of_week, day_of_month, month_of_year, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        jobId,
        scheduleMode,
        day.day_name,
        day.day_of_week ?? null,
        day.day_of_month ?? null,
        day.month_of_year ?? null,
        daySortOrder++,
        now,
        now
      )
      .run();

    const scheduleDayId = dayResult.meta.last_row_id;

    // Insert windows for this day
    let windowSortOrder = 0;
    for (const window of day.windows) {
      await c.env.DB.prepare(
        `INSERT INTO job_schedule_windows (job_id, schedule_day_id, start_time, end_time, is_enabled, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
      )
        .bind(jobId, scheduleDayId, window.start_time, window.end_time, windowSortOrder++, now, now)
        .run();
    }
  }

  // Fetch the complete job with schedule
  const job = await c.env.DB.prepare(
    "SELECT * FROM jobs WHERE id = ?"
  )
    .bind(jobId)
    .first();

  // Fetch schedule days with their windows
  const { results: days } = await c.env.DB.prepare(
    `SELECT id, day_name, day_of_week, day_of_month, month_of_year, sort_order
     FROM job_schedule_days
     WHERE job_id = ?
     ORDER BY sort_order ASC`
  )
    .bind(jobId)
    .all();

  const scheduleData = await Promise.all(
    (days || []).map(async (day: any) => {
      const { results: windows } = await c.env.DB.prepare(
        `SELECT start_time, end_time, is_enabled, sort_order
         FROM job_schedule_windows
         WHERE schedule_day_id = ?
         ORDER BY sort_order ASC`
      )
        .bind(day.id)
        .all();

      return {
        day_name: day.day_name,
        day_of_week: day.day_of_week,
        day_of_month: day.day_of_month,
        month_of_year: day.month_of_year,
        windows: (windows || []).map((w: any) => ({
          start_time: w.start_time,
          end_time: w.end_time,
        })),
      };
    })
  );

  // Build schedule summary
  const summaryParts: string[] = [];
  for (const day of scheduleData) {
    const windowStrs = day.windows.map((w: any) => `${w.start_time}–${w.end_time}`).join(', ');
    summaryParts.push(`${day.day_name} ${windowStrs}`);
  }
  const modeLabel = scheduleMode.charAt(0).toUpperCase() + scheduleMode.slice(1);
  const scheduleSummary = `${modeLabel}: ${summaryParts.join('; ')}`;

  const jobWithSchedule = {
    ...job,
    schedule_days: scheduleData,
    schedule_summary: scheduleSummary,
  };

  return c.json({ job: jobWithSchedule }, 201);
});

app.put("/api/jobs/:id", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    description?: string;
    start_at?: string | null;
    end_at?: string | null;
    status?: string;
    schedule_mode?: string;
    active_from?: string | null;
    active_until?: string | null;
    schedule_days?: Array<{
      day_name: string;
      day_of_week?: number;
      day_of_month?: number;
      month_of_year?: number;
      windows: Array<{ start_time: string; end_time: string }>;
    }>;
    weekly_schedule?: any; // Legacy support
  }>();

  const job = await c.env.DB.prepare(
    "SELECT * FROM jobs WHERE id = ? AND user_id = ?"
  )
    .bind(id, user.id)
    .first();

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  if (body.status === "scheduled") {
    const userOpenAiApiKey = await getUserOpenAIApiKey(c.env.DB, user.id);
    if (!userOpenAiApiKey) {
      return c.json(buildOpenAiKeyRequiredErrorBody(), 400);
    }
  }

  const now = new Date().toISOString();
  const todayDate = now.split('T')[0];
  const currentJob = job as any;
  const globalTimezone = await resolveUserGlobalTimezone(c.env.DB, user.id);
  const newScheduleMode = body.schedule_mode || currentJob.schedule_mode;
  const isRecurringMode = ["weekly", "monthly", "yearly"].includes(newScheduleMode);
  const isModeChanging = body.schedule_mode && body.schedule_mode !== currentJob.schedule_mode;

  // Helper to delete all schedule data for a job
  const deleteScheduleData = async () => {
    await c.env.DB.prepare("DELETE FROM job_schedule_windows WHERE job_id = ?").bind(id).run();
    await c.env.DB.prepare("DELETE FROM job_schedule_days WHERE job_id = ?").bind(id).run();
  };

  // Helper to convert legacy weekly_schedule to schedule_days
  const convertLegacySchedule = (schedule: any, _mode: string): typeof body.schedule_days => {
    const result: typeof body.schedule_days = [];
    const dayMap: Record<string, { dayOfWeek: number; dayName: string }> = {
      sunday: { dayOfWeek: 0, dayName: "Sunday" },
      monday: { dayOfWeek: 1, dayName: "Monday" },
      tuesday: { dayOfWeek: 2, dayName: "Tuesday" },
      wednesday: { dayOfWeek: 3, dayName: "Wednesday" },
      thursday: { dayOfWeek: 4, dayName: "Thursday" },
      friday: { dayOfWeek: 5, dayName: "Friday" },
      saturday: { dayOfWeek: 6, dayName: "Saturday" },
    };

    const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (const dayKey of dayKeys) {
      const daySchedule = schedule[dayKey];
      if (daySchedule && daySchedule.enabled && Array.isArray(daySchedule.windows) && daySchedule.windows.length > 0) {
        const { dayOfWeek, dayName } = dayMap[dayKey];
        result.push({
          day_name: dayName,
          day_of_week: dayOfWeek,
          windows: daySchedule.windows.map((w: any) => ({
            start_time: w.start || w.start_time,
            end_time: w.end || w.end_time,
          })),
        });
      }
    }
    return result;
  };

  // Helper to insert schedule data
  const insertScheduleData = async (scheduleDays: typeof body.schedule_days, scheduleMode: string) => {
    let daySortOrder = 0;
    for (const day of (scheduleDays || [])) {
      const dayResult = await c.env.DB.prepare(
        `INSERT INTO job_schedule_days (job_id, schedule_mode, day_name, day_of_week, day_of_month, month_of_year, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          scheduleMode,
          day.day_name,
          day.day_of_week ?? null,
          day.day_of_month ?? null,
          day.month_of_year ?? null,
          daySortOrder++,
          now,
          now
        )
        .run();

      const scheduleDayId = dayResult.meta.last_row_id;

      let windowSortOrder = 0;
      for (const window of day.windows) {
        await c.env.DB.prepare(
          `INSERT INTO job_schedule_windows (job_id, schedule_day_id, start_time, end_time, is_enabled, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
        )
          .bind(id, scheduleDayId, window.start_time, window.end_time, windowSortOrder++, now, now)
          .run();
      }
    }
  };

  const numericJobId = Number(id);
  if (Number.isInteger(numericJobId) && numericJobId > 0) {
    const jobUsesCoreModel = await jobHasCoreModelConfigured(c.env.DB, user.id, numericJobId);
    const recurringScheduleMode = normalizeRecurringScheduleMode(newScheduleMode);
    const scheduleFieldsTouched =
      body.schedule_mode !== undefined ||
      body.schedule_days !== undefined ||
      body.weekly_schedule !== undefined ||
      body.active_from !== undefined ||
      body.active_until !== undefined;
    if (jobUsesCoreModel && recurringScheduleMode && scheduleFieldsTouched) {
      const scheduleDaysFromBody =
        Array.isArray(body.schedule_days) && body.schedule_days.length > 0
          ? body.schedule_days.map((day) => ({
              day_of_week: day.day_of_week,
              day_of_month: day.day_of_month,
              month_of_year: day.month_of_year,
              windows: Array.isArray(day.windows)
                ? day.windows.map((window) => ({
                    start_time: window.start_time,
                    end_time: window.end_time,
                  }))
                : [],
            }))
          : null;
      const scheduleDaysFromLegacy =
        !scheduleDaysFromBody && body.weekly_schedule
          ? (convertLegacySchedule(body.weekly_schedule, recurringScheduleMode) || []).map((day) => ({
              day_of_week: day.day_of_week,
              day_of_month: day.day_of_month,
              month_of_year: day.month_of_year,
              windows: Array.isArray(day.windows)
                ? day.windows.map((window) => ({
                    start_time: window.start_time,
                    end_time: window.end_time,
                  }))
                : [],
            }))
          : null;

      const candidateActiveFrom = isModeChanging
        ? recurringScheduleMode
          ? body.active_from || currentJob.active_from || todayDate
          : null
        : body.active_from !== undefined
        ? body.active_from
        : currentJob.active_from;
      const candidateActiveUntil = isModeChanging
        ? body.active_until ?? currentJob.active_until ?? null
        : body.active_until !== undefined
        ? body.active_until
        : currentJob.active_until;

      let candidateSchedule: RecurringScheduleShape | null = null;
      if (scheduleDaysFromBody || scheduleDaysFromLegacy) {
        candidateSchedule = buildRecurringScheduleFromInput({
          job_id: numericJobId,
          job_name: String(currentJob.name || ""),
          schedule_mode: recurringScheduleMode,
          timezone: globalTimezone,
          active_from: candidateActiveFrom,
          active_until: candidateActiveUntil,
          schedule_days: scheduleDaysFromBody || scheduleDaysFromLegacy || [],
        });
      } else {
        const existingRecurringSchedule = await loadRecurringScheduleForJob(
          c.env.DB,
          user.id,
          numericJobId
        );
        if (
          existingRecurringSchedule &&
          existingRecurringSchedule.schedule_mode === recurringScheduleMode
        ) {
          candidateSchedule = buildRecurringScheduleFromInput({
            job_id: numericJobId,
            job_name: String(currentJob.name || ""),
            schedule_mode: recurringScheduleMode,
            timezone: globalTimezone,
            active_from: candidateActiveFrom,
            active_until: candidateActiveUntil,
            schedule_days: buildRecurringScheduleDaysInputFromSchedule(existingRecurringSchedule),
          });
        }
      }

      if (candidateSchedule) {
        const scheduleConflict = await findCoreScheduleConflictForCandidate(
          c.env.DB,
          user.id,
          candidateSchedule,
          numericJobId
        );
        if (scheduleConflict) {
          return c.json(
            buildCoreModelScheduleConflictErrorBody(
              scheduleConflict.job_name,
              scheduleConflict.job_id
            ),
            409
          );
        }
      }
    }
  }

  // Handle mode switching
  if (isModeChanging) {
    // Delete all existing schedule data first
    await deleteScheduleData();

    if (newScheduleMode === "one_shot") {
      // Switching to one_shot: clear schedule fields, set start_at/end_at
      await c.env.DB.prepare(
        `UPDATE jobs 
         SET schedule_mode = 'one_shot', 
              start_at = ?, 
              end_at = ?, 
              timezone = ?,
              active_from = NULL, 
              active_until = NULL,
              updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`
      )
        .bind(body.start_at || null, body.end_at || null, globalTimezone, id, user.id)
        .run();
    } else {
      // Switching to recurring mode (weekly/monthly/yearly)
      // Set active_from to today if not provided, clear start_at/end_at
      const activeFrom = body.active_from || currentJob.active_from || todayDate;
      const activeUntil = body.active_until ?? currentJob.active_until ?? null;

      await c.env.DB.prepare(
        `UPDATE jobs 
         SET schedule_mode = ?, 
              start_at = NULL, 
              end_at = NULL, 
              timezone = ?,
              active_from = ?, 
              active_until = ?,
              updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`
      )
        .bind(newScheduleMode, globalTimezone, activeFrom, activeUntil, id, user.id)
        .run();

      // Insert new schedule data
      let scheduleDays = body.schedule_days ?? [];
      if (scheduleDays.length === 0 && body.weekly_schedule) {
        scheduleDays = convertLegacySchedule(body.weekly_schedule, newScheduleMode) ?? [];
      }
      if (scheduleDays.length > 0) {
        await insertScheduleData(scheduleDays, newScheduleMode);
      }
    }
  } else if (isRecurringMode) {
    // Updating existing recurring schedule
    let scheduleDays = body.schedule_days ?? [];
    if (scheduleDays.length === 0 && body.weekly_schedule) {
      scheduleDays = convertLegacySchedule(body.weekly_schedule, newScheduleMode) ?? [];
    }

    // If schedule_days provided, replace all schedule data
    if (scheduleDays.length > 0) {
      await deleteScheduleData();
      await insertScheduleData(scheduleDays, newScheduleMode);
    }

    // Update job fields (but not start_at/end_at for recurring jobs)
    const updates: string[] = [];
    const values: any[] = [];

    if (body.name !== undefined) {
      updates.push("name = ?");
      values.push(body.name);
    }
    if (body.description !== undefined) {
      updates.push("description = ?");
      values.push(body.description);
    }
    if (body.status !== undefined) {
      updates.push("status = ?");
      values.push(body.status);
    }
    updates.push("timezone = ?");
    values.push(globalTimezone);
    if (body.active_from !== undefined) {
      updates.push("active_from = ?");
      values.push(body.active_from);
    }
    if (body.active_until !== undefined) {
      updates.push("active_until = ?");
      values.push(body.active_until);
    }

    if (updates.length > 0) {
      updates.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id, user.id);
      await c.env.DB.prepare(
        `UPDATE jobs SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`
      )
        .bind(...values)
        .run();
    }
  } else {
    // Regular update for one_shot jobs or non-schedule fields
    const updates: string[] = [];
    const values: any[] = [];

    Object.entries(body).forEach(([key, value]) => {
      if (!["weekly_schedule", "schedule_mode", "schedule_days", "timezone"].includes(key)) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    });
    updates.push("timezone = ?");
    values.push(globalTimezone);

    if (updates.length > 0) {
      updates.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id, user.id);
      await c.env.DB.prepare(
        `UPDATE jobs SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`
      )
        .bind(...values)
        .run();
    }
  }

  // Fetch updated job
  const updatedJob = await c.env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first();

  // Build response based on schedule mode
  let jobWithSchedule: any = updatedJob;

  if (["weekly", "monthly", "yearly"].includes((updatedJob as any).schedule_mode)) {
    // Fetch schedule days with their windows
    const { results: days } = await c.env.DB.prepare(
      `SELECT id, day_name, day_of_week, day_of_month, month_of_year, sort_order
       FROM job_schedule_days WHERE job_id = ? ORDER BY sort_order ASC`
    )
      .bind(id)
      .all();

    const scheduleData = await Promise.all(
      (days || []).map(async (day: any) => {
        const { results: windows } = await c.env.DB.prepare(
          `SELECT start_time, end_time, is_enabled FROM job_schedule_windows
           WHERE schedule_day_id = ? ORDER BY sort_order ASC`
        )
          .bind(day.id)
          .all();

        return {
          day_name: day.day_name,
          day_of_week: day.day_of_week,
          day_of_month: day.day_of_month,
          month_of_year: day.month_of_year,
          windows: (windows || []).map((w: any) => ({
            start_time: w.start_time,
            end_time: w.end_time,
          })),
        };
      })
    );

    // Build schedule summary
    const summaryParts: string[] = [];
    for (const day of scheduleData) {
      const windowStrs = day.windows.map((w: any) => `${w.start_time}–${w.end_time}`).join(', ');
      summaryParts.push(`${day.day_name} ${windowStrs}`);
    }
    const mode = (updatedJob as any).schedule_mode;
    const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1);
    const scheduleSummary = `${modeLabel}: ${summaryParts.join('; ')}`;

    jobWithSchedule = {
      ...updatedJob,
      schedule_days: scheduleData,
      schedule_summary: scheduleSummary,
    };
  }

  return c.json({ job: jobWithSchedule });
});

app.post("/api/jobs/:id/start", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const numericJobId = Number(id);

  if (!Number.isInteger(numericJobId) || numericJobId <= 0) {
    return c.json({ error: "Invalid job id" }, 400);
  }

  const job = await c.env.DB.prepare(
    `SELECT
       j.*,
       jrs.status AS runtime_status
     FROM jobs j
     LEFT JOIN job_runtime_states jrs ON jrs.job_id = j.id
     WHERE j.id = ? AND j.user_id = ?
     LIMIT 1`
  )
    .bind(id, user.id)
    .first();

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  const jobData = job as any;
  if (jobData.runtime_status === "running") {
    return c.json({ ok: true, already_running: true, status: "running" });
  }

  if (jobData.runtime_status === "stopping") {
    return c.json({ error: "Job is currently stopping" }, 409);
  }

  const { results: stepRows } = await c.env.DB.prepare(
    `SELECT id
     FROM job_steps
     WHERE job_id = ?
     ORDER BY step_order ASC`
  )
    .bind(id)
    .all();

  if (!stepRows || stepRows.length === 0) {
    return c.json({ error: "Job must have at least one step before it can be started." }, 400);
  }

  for (const row of stepRows) {
    const stepId = Number((row as any)?.id);
    if (!Number.isInteger(stepId) || stepId <= 0) {
      return c.json({ error: "Job step is invalid." }, 400);
    }

    const [targetsResult, agentsResult] = await Promise.all([
      c.env.DB.prepare(
        `SELECT camera_id
         FROM job_step_targets
         WHERE step_id = ?`
      )
        .bind(stepId)
        .all(),
      c.env.DB.prepare(
        `SELECT camera_id
         FROM job_step_agents
         WHERE step_id = ?
           AND is_active = 1`
      )
        .bind(stepId)
        .all(),
    ]);

    const targets = (targetsResult.results || []).map((target: any) => Number(target.camera_id));
    const agentCameraIds = new Set(
      (agentsResult.results || [])
        .map((agent: any) =>
          agent.camera_id === null || agent.camera_id === undefined ? null : Number(agent.camera_id)
        )
    );
    const hasDefaultAgent = agentCameraIds.has(null);
    const allTargetsHaveAgents =
      targets.length > 0 &&
      targets.every((cameraId: number) => hasDefaultAgent || agentCameraIds.has(cameraId));

    if (!allTargetsHaveAgents) {
      return c.json(
        { error: "All steps must have at least one target and an active agent before the job can be started." },
        400
      );
    }
  }

  const providerRequirements = await loadJobInferenceProviderRequirements(c.env.DB, numericJobId);
  if (providerRequirements.requiresOpenAi) {
    const openAiKey = await getUserOpenAIApiKey(c.env.DB, user.id);
    if (!openAiKey) {
      return c.json(buildOpenAiKeyRequiredErrorBody(), 400);
    }
  }
  if (providerRequirements.requiresZAi) {
    const zAiKey = await getUserZAIApiKey(c.env.DB, user.id);
    if (!zAiKey) {
      return c.json(buildZAiKeyRequiredErrorBody(), 400);
    }
  }

  const startResult = await enqueueManualJobStart(c.env, jobData);
  if (!startResult.ok) {
    return c.json({ error: startResult.error || "Failed to start job" }, 500);
  }

  return c.json({ ok: true });
});

app.post("/api/jobs/:id/stop", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");

  // Validate job belongs to user
  const job = await c.env.DB.prepare(
    "SELECT id, name FROM jobs WHERE id = ? AND user_id = ?"
  )
    .bind(id, user.id)
    .first();

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  const jobData = job as any;
  const now = new Date().toISOString();

  // Step A: Get all distinct camera IDs from job step targets
  const { results: targetRows } = await c.env.DB.prepare(
    `SELECT DISTINCT jst.camera_id
     FROM job_step_targets jst
     JOIN job_steps js ON jst.step_id = js.id
     WHERE js.job_id = ?`
  )
    .bind(id)
    .all();

  const allCameraIds = (targetRows || []).map((row: any) => row.camera_id);

  // Initialize filtered camera IDs
  let filteredCameraIds: number[] = [];

  if (allCameraIds.length > 0) {
    // Step B: Filter to running cameras only (is_service_running = 1)
    const placeholders = allCameraIds.map(() => "?").join(", ");
    const { results: runningCameras } = await c.env.DB.prepare(
      `SELECT id FROM cameras 
       WHERE user_id = ? AND id IN (${placeholders}) AND is_service_running = 1`
    )
      .bind(user.id, ...allCameraIds)
      .all();

    const runningCameraIds = (runningCameras || []).map((row: any) => row.id);

    if (runningCameraIds.length > 0) {
      // Step C: Get cameras with enabled AI agents (to exclude them)
      const runningPlaceholders = runningCameraIds.map(() => "?").join(", ");
      const { results: agentCameras } = await c.env.DB.prepare(
        `SELECT DISTINCT camera_id FROM camera_algorithms
         WHERE camera_id IN (${runningPlaceholders}) AND is_enabled = 1`
      )
        .bind(...runningCameraIds)
        .all();

      const camerasWithAgents = new Set((agentCameras || []).map((row: any) => row.camera_id));

      // Step D: Filter out cameras with enabled agents
      filteredCameraIds = runningCameraIds.filter((cameraId: number) => !camerasWithAgents.has(cameraId));
    }
  }

  // Insert job_stop command with filtered camera list
  await c.env.DB.prepare(
    `INSERT INTO commands (user_id, camera_id, command_type, payload, status, created_at, updated_at)
     VALUES (?, NULL, 'job_stop', ?, 'pending', ?, ?)`
  )
    .bind(
      user.id,
      JSON.stringify({
        job: { id: jobData.id, name: jobData.name },
        requested_at_utc: now,
        reason: "user_stop_from_dashboard",
        camera_ids: filteredCameraIds,
      }),
      now,
      now
    )
    .run();

  // Immediately update cameras table: set stopped cameras to is_service_running=0, is_online=0
  if (filteredCameraIds.length > 0) {
    const cameraPlaceholders = filteredCameraIds.map(() => "?").join(", ");
    await c.env.DB.prepare(
      `UPDATE cameras 
       SET is_service_running = 0, is_online = 0, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND id IN (${cameraPlaceholders})`
    )
      .bind(user.id, ...filteredCameraIds)
      .run();
  }

  // Optimistically update runtime state to 'stopping'
  await c.env.DB.prepare(
    `INSERT INTO job_runtime_states (job_id, user_id, job_name, status, last_event_at_utc, created_at, updated_at)
     VALUES (?, ?, ?, 'stopping', ?, ?, ?)
     ON CONFLICT(job_id) DO UPDATE SET
       status = 'stopping',
       last_event_at_utc = ?,
       updated_at = ?`
  )
    .bind(jobData.id, user.id, jobData.name, now, now, now, now, now)
    .run();

  // Insert event for Live Activity
  await c.env.DB.prepare(
    `INSERT INTO events (user_id, camera_id, event_type, message, is_unread, created_at, updated_at)
     VALUES (?, NULL, 'job_stop_requested', ?, 0, ?, ?)`
  )
    .bind(user.id, `Job "${jobData.name}" stop requested.`, now, now)
    .run();

  return c.json({ ok: true, camera_ids: filteredCameraIds });
});

app.delete("/api/jobs/:id", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");

  const job = await c.env.DB.prepare(
    "SELECT * FROM jobs WHERE id = ? AND user_id = ?"
  )
    .bind(id, user.id)
    .first();

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  // Get all step IDs for this job to delete related records
  const { results: steps } = await c.env.DB.prepare(
    "SELECT id FROM job_steps WHERE job_id = ?"
  )
    .bind(id)
    .all();

  const stepIds = (steps || []).map((s: any) => s.id);

  if (stepIds.length > 0) {
    const placeholders = stepIds.map(() => "?").join(", ");

    // Delete alert rules for all steps
    await c.env.DB.prepare(
      `DELETE FROM job_step_alert_rules WHERE step_id IN (${placeholders})`
    )
      .bind(...stepIds)
      .run();

    // Delete agents for all steps
    const { results: agentsToDelete } = await c.env.DB.prepare(
      `SELECT id FROM job_step_agents WHERE step_id IN (${placeholders})`
    )
      .bind(...stepIds)
      .all();
    const agentIdsToDelete = (agentsToDelete || [])
      .map((row: any) => Number(row.id))
      .filter((id: number) => Number.isInteger(id) && id > 0);
    if (agentIdsToDelete.length > 0) {
      const agentPlaceholders = agentIdsToDelete.map(() => "?").join(", ");
      await c.env.DB.prepare(
        `DELETE FROM job_step_agent_face_targets WHERE agent_id IN (${agentPlaceholders})`
      )
        .bind(...agentIdsToDelete)
        .run();
    }
    await c.env.DB.prepare(
      `DELETE FROM job_step_agents WHERE step_id IN (${placeholders})`
    )
      .bind(...stepIds)
      .run();

    // Delete targets for all steps
    await c.env.DB.prepare(
      `DELETE FROM job_step_targets WHERE step_id IN (${placeholders})`
    )
      .bind(...stepIds)
      .run();
  }

  // Delete all steps for this job
  await c.env.DB.prepare(
    "DELETE FROM job_steps WHERE job_id = ?"
  )
    .bind(id)
    .run();

  // Delete the job itself
  await c.env.DB.prepare(
    "DELETE FROM jobs WHERE id = ? AND user_id = ?"
  )
    .bind(id, user.id)
    .run();

  return c.json({ success: true });
});

type JobStepInputType = "video" | "image";
type JobStepInferenceModel = "legacy" | "pro" | "ultra" | "core";
const FIXED_JOB_STEP_INFERENCE_MODEL: JobStepInferenceModel = "ultra";
type JobStepRunEverySeconds = 10 | 60;
const FIXED_JOB_STEP_RUN_EVERY_SECONDS: JobStepRunEverySeconds = 60;
type JobStepRunningResolution = 640 | 1024;
const DEFAULT_CORE_RUNNING_RESOLUTION: JobStepRunningResolution = 640;
const DEFAULT_ULTRA_VIDEO_MODEL_FPS = 1;
const MAX_ULTRA_VIDEO_MODEL_FPS = 10;
const MIN_JOB_STEP_TIMEOUT_SECONDS = 120;
type JobStepPriorityLevel = "CRITIC" | "HIGH" | "MEDIUM" | "LOW";

type JobStepInferenceGroup = {
  id: string;
  name: string;
  targetIds: number[];
  agentKey: string;
  inputType: JobStepInputType;
  prompt_template: string;
  alert_condition: string | null;
  negative_condition: string | null;
  priority_level: JobStepPriorityLevel | null;
  inference_model: JobStepInferenceModel;
  model_fps: number;
  run_every: JobStepRunEverySeconds;
  running_resolution: JobStepRunningResolution | null;
  only_capture_on_motion: boolean;
  source_target_id: number | null;
  analysis_bindings: Array<{
    target_id: number;
    region_ids: string[];
  }>;
};

const normalizeJobStepInputType = (value: unknown): JobStepInputType | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "video" || normalized === "image") {
    return normalized;
  }
  return null;
};

const normalizeJobStepInferenceModel = (value: unknown): JobStepInferenceModel | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "legacy" ||
    normalized === "pro" ||
    normalized === "ultra" ||
    normalized === "core"
  ) {
    return normalized;
  }
  return null;
};

const normalizeJobStepPriorityLevel = (value: unknown): JobStepPriorityLevel | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "MEDUIM") return "MEDIUM";
  if (normalized === "CRITIC" || normalized === "HIGH" || normalized === "MEDIUM" || normalized === "LOW") {
    return normalized;
  }
  return null;
};

const normalizeJobStepRunEverySeconds = (
  value: unknown,
  fallback: JobStepRunEverySeconds = FIXED_JOB_STEP_RUN_EVERY_SECONDS
): JobStepRunEverySeconds => {
  const parseSeconds = (candidate: unknown): number | null => {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return Math.round(candidate);
    }
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Number.parseInt(candidate.trim(), 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const normalizeValue = (candidate: unknown): JobStepRunEverySeconds | null => {
    const parsed = parseSeconds(candidate);
    if (parsed === null || parsed <= 0) return null;
    return parsed <= 10 ? 10 : 60;
  };
  return normalizeValue(value) ?? normalizeValue(fallback) ?? FIXED_JOB_STEP_RUN_EVERY_SECONDS;
};

const normalizeJobStepModelFps = (
  value: unknown,
  inferenceModel: JobStepInferenceModel,
  inputType: JobStepInputType,
  fallback = DEFAULT_ULTRA_VIDEO_MODEL_FPS
): number => {
  void inferenceModel;
  if (inputType !== "video") {
    return DEFAULT_ULTRA_VIDEO_MODEL_FPS;
  }
  const parseFps = (candidate: unknown): number | null => {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return Math.round(candidate);
    }
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Number.parseInt(candidate.trim(), 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const parsed = parseFps(value) ?? parseFps(fallback) ?? DEFAULT_ULTRA_VIDEO_MODEL_FPS;
  return Math.min(MAX_ULTRA_VIDEO_MODEL_FPS, Math.max(DEFAULT_ULTRA_VIDEO_MODEL_FPS, parsed));
};

const parseJobStepRunningResolution = (
  value: unknown
): JobStepRunningResolution | null => {
  const parseResolution = (candidate: unknown): number | null => {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return Math.round(candidate);
    }
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Number.parseInt(candidate.trim(), 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const parsed = parseResolution(value);
  if (parsed === 640 || parsed === 1024) return parsed;
  return null;
};

const normalizeJobStepRunningResolution = (
  value: unknown,
  fallback: JobStepRunningResolution = DEFAULT_CORE_RUNNING_RESOLUTION
): JobStepRunningResolution => {
  return (
    parseJobStepRunningResolution(value) ??
    parseJobStepRunningResolution(fallback) ??
    DEFAULT_CORE_RUNNING_RESOLUTION
  );
};

const applyInferenceExecutionConstraints = (
  inputType: JobStepInputType,
  inferenceModel: JobStepInferenceModel,
  runEvery: JobStepRunEverySeconds,
  runningResolution: JobStepRunningResolution | null,
  modelFps: number | null | undefined
): {
  inputType: JobStepInputType;
  inferenceModel: JobStepInferenceModel;
  runEvery: JobStepRunEverySeconds;
  runningResolution: JobStepRunningResolution | null;
  modelFps: number;
  requiresOpenAiKey: boolean;
  requiresZAiKey: boolean;
} => {
  if (inferenceModel === "core") {
    return {
      inputType: "video",
      inferenceModel,
      runEvery: 60,
      runningResolution: normalizeJobStepRunningResolution(
        runningResolution,
        DEFAULT_CORE_RUNNING_RESOLUTION
      ),
      modelFps: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
      requiresOpenAiKey: false,
      requiresZAiKey: true,
    };
  }

  const normalizedInputType = inputType === "image" ? "image" : "video";
  return {
    inputType: normalizedInputType,
    inferenceModel,
    runEvery: normalizeJobStepRunEverySeconds(runEvery, FIXED_JOB_STEP_RUN_EVERY_SECONDS),
    runningResolution: null,
    modelFps: normalizeJobStepModelFps(
      modelFps,
      inferenceModel,
      normalizedInputType
    ),
    requiresOpenAiKey: true,
    requiresZAiKey: false,
  };
};

const normalizeJobStepOnlyCaptureOnMotion = (
  value: unknown,
  fallback = true
): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
      return false;
    }
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
      return true;
    }
  }
  return fallback;
};

const normalizeJobStepUseTemporalContext = (
  value: unknown,
  fallback = true
): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (
      normalized === "0" ||
      normalized === "false" ||
      normalized === "no" ||
      normalized === "off"
    ) {
      return false;
    }
    if (
      normalized === "1" ||
      normalized === "true" ||
      normalized === "yes" ||
      normalized === "on"
    ) {
      return true;
    }
  }
  return fallback;
};

const buildJobStepTemporalContextFields = (row: any, useTemporalContext: boolean) => ({
  use_temporal_context: useTemporalContext,
  temporal_plan_json: useTemporalContext ? row?.temporal_plan_json ?? null : null,
  temporal_plan_hash: useTemporalContext ? row?.temporal_plan_hash ?? null : null,
  temporal_plan_version: useTemporalContext ? row?.temporal_plan_version ?? null : null,
  temporal_compiled_at: useTemporalContext ? row?.temporal_compiled_at ?? null : null,
  temporal_compile_model: useTemporalContext ? row?.temporal_compile_model ?? null : null,
  temporal_explain_json: useTemporalContext ? row?.temporal_explain_json ?? null : null,
});

type PromptTemplateParts = {
  prompt_template: string;
  alert_condition: string | null;
  negative_condition: string | null;
};

type FaceTargetImagePayload = {
  id: number;
  image_url: string;
};

type FaceTargetPayload = {
  id: number;
  name: string;
  description: string;
  images: FaceTargetImagePayload[];
};

type NegativeReferenceImagePayload = {
  id: number;
  image_url: string;
};

type AnalysisRegionPoint = {
  x: number;
  y: number;
};

type AnalysisRegionPayload = {
  region_id: string;
  label: string;
  description: string;
  enabled: boolean;
  full_frame: boolean;
  polygon_norm: AnalysisRegionPoint[];
  draw_ref_width: number;
  draw_ref_height: number;
  context_padding_pct: number;
  prompt_core: string;
  alert_condition: string | null;
  negative_condition: string | null;
  face_target_ids: number[];
  negative_image_ids: number[];
};

const ANALYSIS_REGION_MAX_PER_AGENT = 6;
const ANALYSIS_REGION_MIN_POINTS = 3;
const ANALYSIS_REGION_MAX_POINTS = 20;

const TEMPORAL_ENGINE_PROMPT_SUFFIX_PATTERN =
  /(?:<br\s*\/?>|\r?\n|\s)*Temporal engine:\s*[\s\S]*$/i;

const TEMPORAL_ENGINE_APPENDIX_SECTION_PATTERN =
  /(?:\r?\n){2,}\s*(?:#{1,6}\s*)?(?:identity|operators|temporal operators|temporal plan|runtime plan|plan envelope|compile status|compile confidence|missing operator types|blockers|state policy)\s*:[\s\S]*$/i;

const normalizeOptionalPromptText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const stripTemporalArtifactsFromPromptText = (value: unknown): string => {
  if (typeof value !== "string") return "";
  let normalized = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\r\n/g, "\n");
  normalized = normalized.replace(TEMPORAL_ENGINE_PROMPT_SUFFIX_PATTERN, "");
  normalized = normalized.replace(TEMPORAL_ENGINE_APPENDIX_SECTION_PATTERN, "");
  return normalized.trim();
};

const sanitizePromptTemplatePartsForLegacyFlow = (
  parts: PromptTemplateParts
): PromptTemplateParts => ({
  prompt_template: stripTemporalArtifactsFromPromptText(parts.prompt_template),
  alert_condition: normalizeOptionalPromptText(
    stripTemporalArtifactsFromPromptText(parts.alert_condition)
  ),
  negative_condition: normalizeOptionalPromptText(
    stripTemporalArtifactsFromPromptText(parts.negative_condition)
  ),
});

const parsePromptTemplateParts = (
  templateRaw: unknown,
  fallbackAlertCondition?: unknown,
  fallbackNegativeCondition?: unknown
): PromptTemplateParts => {
  const raw = typeof templateRaw === "string" ? templateRaw : "";
  const lower = raw.toLowerCase();
  const markerSpecs = [
    { key: "alert_condition" as const, marker: "alert_condition:" },
    { key: "negative_condition" as const, marker: "negative_condition:" },
  ];

  const positions = markerSpecs
    .map((spec) => ({ ...spec, index: lower.lastIndexOf(spec.marker) }))
    .filter((spec) => spec.index >= 0)
    .sort((a, b) => a.index - b.index);

  let promptTemplate = raw;
  let parsedAlertCondition: string | null = null;
  let parsedNegativeCondition: string | null = null;

  if (positions.length > 0) {
    promptTemplate = raw.slice(0, positions[0].index).trimEnd();
    for (let i = 0; i < positions.length; i += 1) {
      const current = positions[i];
      const start = current.index + current.marker.length;
      const end = i + 1 < positions.length ? positions[i + 1].index : raw.length;
      const value = raw.slice(start, end).trim();
      if (!value) continue;
      if (current.key === "alert_condition") {
        parsedAlertCondition = value;
      } else {
        parsedNegativeCondition = value;
      }
    }
  }

  return {
    prompt_template: promptTemplate,
    alert_condition:
      normalizeOptionalPromptText(fallbackAlertCondition) ?? parsedAlertCondition,
    negative_condition:
      normalizeOptionalPromptText(fallbackNegativeCondition) ?? parsedNegativeCondition,
  };
};

const parsePromptTemplatePartsForJobStepTemporalMode = (
  templateRaw: unknown,
  fallbackAlertCondition: unknown,
  fallbackNegativeCondition: unknown,
  useTemporalContext: boolean
): PromptTemplateParts => {
  if (useTemporalContext) {
    return parsePromptTemplateParts(
      templateRaw,
      fallbackAlertCondition,
      fallbackNegativeCondition
    );
  }

  const parts = parsePromptTemplateParts(
    stripTemporalArtifactsFromPromptText(templateRaw),
    stripTemporalArtifactsFromPromptText(fallbackAlertCondition),
    stripTemporalArtifactsFromPromptText(fallbackNegativeCondition)
  );
  return sanitizePromptTemplatePartsForLegacyFlow(parts);
};

const buildPromptTemplateFromParts = (parts: PromptTemplateParts): string => {
  const core = String(parts.prompt_template || "").trim();
  const chunks: string[] = [];
  if (core) chunks.push(core);
  if (parts.alert_condition) chunks.push(`alert_condition: ${parts.alert_condition}`);
  if (parts.negative_condition) chunks.push(`negative_condition: ${parts.negative_condition}`);
  return chunks.join("\n\n").trim();
};

const normalizeFaceTargetIdsInput = (value: unknown): number[] | null => {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return [];
  const ids = Array.from(
    new Set<number>(
      value
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v > 0)
    )
  );
  return ids;
};

const normalizeNegativeImageIdsInput = (value: unknown): number[] | null => {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set<number>(
      value
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v > 0)
    )
  );
};

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const normalizeAnalysisRegionId = (value: unknown, index: number): string => {
  const raw = typeof value === "string" ? value.trim() : "";
  const normalized = raw
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized) return normalized.slice(0, 64);
  return `region-${index + 1}`;
};

const normalizeAnalysisRegionPolygon = (value: unknown): AnalysisRegionPoint[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((point: any) => {
      const x = Number(point?.x);
      const y = Number(point?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return {
        x: clamp01(x),
        y: clamp01(y),
      } as AnalysisRegionPoint;
    })
    .filter(Boolean) as AnalysisRegionPoint[];
};

const toPositiveIntOr = (value: unknown, fallback: number): number => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
};

const synthesizeDefaultAnalysisRegion = (
  promptParts: PromptTemplateParts,
  faceTargetIds: number[],
  negativeImageIds: number[]
): AnalysisRegionPayload => ({
  region_id: "full-frame",
  label: "Full frame",
  description: "",
  enabled: true,
  full_frame: true,
  polygon_norm: [],
  draw_ref_width: 1920,
  draw_ref_height: 1080,
  context_padding_pct: 0,
  prompt_core: String(promptParts.prompt_template || "").trim(),
  alert_condition: normalizeOptionalPromptText(promptParts.alert_condition),
  negative_condition: normalizeOptionalPromptText(promptParts.negative_condition),
  face_target_ids: Array.from(new Set(faceTargetIds.filter((id) => Number.isInteger(id) && id > 0))),
  negative_image_ids: Array.from(
    new Set(negativeImageIds.filter((id) => Number.isInteger(id) && id > 0))
  ),
});

const normalizeAnalysisRegionsInput = (
  value: unknown,
  defaults: {
    promptParts: PromptTemplateParts;
    faceTargetIds: number[];
    negativeImageIds: number[];
  }
): { regions: AnalysisRegionPayload[]; error: string | null } => {
  if (!Array.isArray(value)) {
    return { regions: [], error: "analysis_regions must be an array" };
  }
  if (value.length > ANALYSIS_REGION_MAX_PER_AGENT) {
    return {
      regions: [],
      error: `analysis_regions supports at most ${ANALYSIS_REGION_MAX_PER_AGENT} regions`,
    };
  }

  const regions: AnalysisRegionPayload[] = [];
  const usedIds = new Set<string>();
  for (let i = 0; i < value.length; i += 1) {
    const row = value[i] as any;
    if (!row || typeof row !== "object") {
      return { regions: [], error: `analysis_regions[${i}] must be an object` };
    }

    const regionId = normalizeAnalysisRegionId(
      row?.region_id ?? row?.regionId,
      i
    );
    if (usedIds.has(regionId)) {
      return { regions: [], error: `analysis_regions duplicate region_id "${regionId}"` };
    }
    usedIds.add(regionId);

    const fullFrame = normalizeJobStepOnlyCaptureOnMotion(
      row?.full_frame ?? row?.fullFrame,
      false
    );
    const polygonNorm = normalizeAnalysisRegionPolygon(
      row?.polygon_norm ?? row?.polygonNorm
    );
    if (
      !fullFrame &&
      (polygonNorm.length < ANALYSIS_REGION_MIN_POINTS ||
        polygonNorm.length > ANALYSIS_REGION_MAX_POINTS)
    ) {
      return {
        regions: [],
        error: `analysis_regions[${i}] polygon_norm must contain ${ANALYSIS_REGION_MIN_POINTS}-${ANALYSIS_REGION_MAX_POINTS} points`,
      };
    }

    const labelRaw =
      typeof row?.label === "string" ? row.label.trim() : "";
    const descriptionRaw =
      typeof row?.description === "string" ? row.description.trim() : "";
    const promptCoreRaw =
      typeof row?.prompt_core === "string"
        ? row.prompt_core
        : typeof row?.prompt_template === "string"
        ? row.prompt_template
        : defaults.promptParts.prompt_template;
    const alertCondition = normalizeOptionalPromptText(
      row?.alert_condition ?? row?.alertCondition
    ) ?? defaults.promptParts.alert_condition;
    const negativeCondition = normalizeOptionalPromptText(
      row?.negative_condition ?? row?.negativeCondition
    ) ?? defaults.promptParts.negative_condition;

    const faceTargetIds =
      normalizeFaceTargetIdsInput(
        row?.face_target_ids ?? row?.faceTargetIds
      ) ?? defaults.faceTargetIds;
    const negativeImageIds =
      normalizeNegativeImageIdsInput(
        row?.negative_image_ids ?? row?.negativeImageIds
      ) ?? defaults.negativeImageIds;
    const normalizedFullFrame = fullFrame || polygonNorm.length < ANALYSIS_REGION_MIN_POINTS;

    regions.push({
      region_id: regionId,
      label: labelRaw || `Region ${i + 1}`,
      description: descriptionRaw,
      enabled: normalizeJobStepOnlyCaptureOnMotion(
        row?.enabled,
        true
      ),
      full_frame: normalizedFullFrame,
      polygon_norm:
        normalizedFullFrame
          ? []
          : polygonNorm,
      draw_ref_width: toPositiveIntOr(
        row?.draw_ref_width ?? row?.drawRefWidth,
        1920
      ),
      draw_ref_height: toPositiveIntOr(
        row?.draw_ref_height ?? row?.drawRefHeight,
        1080
      ),
      context_padding_pct: 0,
      prompt_core: String(promptCoreRaw || "").trim(),
      alert_condition: alertCondition,
      negative_condition: negativeCondition,
      face_target_ids: Array.from(
        new Set(faceTargetIds.filter((id) => Number.isInteger(id) && id > 0))
      ),
      negative_image_ids: Array.from(
        new Set(negativeImageIds.filter((id) => Number.isInteger(id) && id > 0))
      ),
    });
  }

  return { regions, error: null };
};

const sanitizeAnalysisRegionsForLegacyFlow = (
  regions: AnalysisRegionPayload[]
): AnalysisRegionPayload[] =>
  regions.map((region) => ({
    ...region,
    prompt_core: stripTemporalArtifactsFromPromptText(region.prompt_core),
    alert_condition: normalizeOptionalPromptText(
      stripTemporalArtifactsFromPromptText(region.alert_condition)
    ),
    negative_condition: normalizeOptionalPromptText(
      stripTemporalArtifactsFromPromptText(region.negative_condition)
    ),
  }));

const parseStoredAnalysisRegions = (
  raw: unknown,
  defaults: {
    promptParts: PromptTemplateParts;
    faceTargetIds: number[];
    negativeImageIds: number[];
  }
): AnalysisRegionPayload[] => {
  if (raw === null || raw === undefined) {
    return [synthesizeDefaultAnalysisRegion(defaults.promptParts, defaults.faceTargetIds, defaults.negativeImageIds)];
  }

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return [synthesizeDefaultAnalysisRegion(defaults.promptParts, defaults.faceTargetIds, defaults.negativeImageIds)];
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [synthesizeDefaultAnalysisRegion(defaults.promptParts, defaults.faceTargetIds, defaults.negativeImageIds)];
    }
  }

  const normalized = normalizeAnalysisRegionsInput(parsed, defaults);
  if (normalized.error || normalized.regions.length === 0) {
    return [synthesizeDefaultAnalysisRegion(defaults.promptParts, defaults.faceTargetIds, defaults.negativeImageIds)];
  }
  return normalized.regions;
};

const loadFaceTargetIdsByAgentId = async (
  db: D1Database,
  agentIds: number[]
): Promise<Map<number, number[]>> => {
  const byAgentId = new Map<number, number[]>();
  const normalizedAgentIds = Array.from(
    new Set(
      agentIds.filter((id) => Number.isInteger(id) && id > 0)
    )
  );
  if (normalizedAgentIds.length === 0) {
    return byAgentId;
  }

  const placeholders = normalizedAgentIds.map(() => "?").join(", ");
  try {
    const { results } = await db
      .prepare(
        `SELECT agent_id, face_target_id
         FROM job_step_agent_face_targets
         WHERE agent_id IN (${placeholders})
         ORDER BY agent_id ASC, face_target_id ASC`
      )
      .bind(...normalizedAgentIds)
      .all();

    for (const row of results || []) {
      const agentId = Number((row as any)?.agent_id);
      const targetId = Number((row as any)?.face_target_id);
      if (!Number.isInteger(agentId) || agentId <= 0) continue;
      if (!Number.isInteger(targetId) || targetId <= 0) continue;
      if (!byAgentId.has(agentId)) byAgentId.set(agentId, []);
      byAgentId.get(agentId)!.push(targetId);
    }
  } catch (error) {
    console.log("[FACE TARGET] Warning: failed to load mappings for agents", error);
  }

  return byAgentId;
};

const parseStoredInferenceGroups = (raw: unknown): JobStepInferenceGroup[] => {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  const normalizedGroups: JobStepInferenceGroup[] = [];
  for (const row of parsed) {
    const group = row as any;
    const id = typeof group?.id === "string" ? group.id.trim() : "";
    const name = typeof group?.name === "string" ? group.name.trim() : "";
    const agentKey = typeof group?.agentKey === "string" ? group.agentKey.trim() : "";
    const promptTemplate =
      typeof group?.prompt_template === "string"
        ? group.prompt_template
        : typeof group?.promptTemplate === "string"
        ? group.promptTemplate
        : "";
    const alertCondition =
      typeof group?.alert_condition === "string"
        ? group.alert_condition
        : typeof group?.alertCondition === "string"
        ? group.alertCondition
        : null;
    const negativeCondition =
      typeof group?.negative_condition === "string"
        ? group.negative_condition
        : typeof group?.negativeCondition === "string"
        ? group.negativeCondition
        : null;
    const promptParts = parsePromptTemplateParts(
      promptTemplate,
      alertCondition,
      negativeCondition
    );
    const priorityLevel = normalizeJobStepPriorityLevel(
      typeof group?.priority_level === "string"
        ? group.priority_level
        : group?.priorityLevel
    );
    const inferenceModel =
      normalizeJobStepInferenceModel(
        typeof group?.inference_model === "string"
          ? group.inference_model
          : group?.inferenceModel
      ) || FIXED_JOB_STEP_INFERENCE_MODEL;
    const requestedRunEvery = normalizeJobStepRunEverySeconds(
      group?.run_every ?? group?.runEvery,
      FIXED_JOB_STEP_RUN_EVERY_SECONDS
    );
    const requestedRunningResolution = normalizeJobStepRunningResolution(
      group?.running_resolution ?? group?.runningResolution,
      DEFAULT_CORE_RUNNING_RESOLUTION
    );
    const requestedInputType = normalizeJobStepInputType(group?.inputType) || "video";
    const requestedModelFps = normalizeJobStepModelFps(
      group?.model_fps ?? group?.modelFps,
      inferenceModel,
      requestedInputType
    );
    const executionSettings = applyInferenceExecutionConstraints(
      requestedInputType,
      inferenceModel,
      requestedRunEvery,
      requestedRunningResolution,
      requestedModelFps
    );
    const onlyCaptureOnMotion = normalizeJobStepOnlyCaptureOnMotion(
      group?.only_capture_on_motion ?? group?.onlyCaptureOnMotion,
      true
    );
    const sourceTargetIdRaw = group?.source_target_id ?? group?.sourceTargetId;
    const sourceTargetIdNumeric = Number(sourceTargetIdRaw);
    const sourceTargetId =
      Number.isInteger(sourceTargetIdNumeric) && sourceTargetIdNumeric > 0
        ? sourceTargetIdNumeric
        : null;
    const targetIdsRaw = Array.isArray(group?.targetIds) ? group.targetIds : [];
    const targetIds = Array.from(
      new Set<number>(
        targetIdsRaw
          .map((v: unknown) => Number(v))
          .filter((v: number) => Number.isInteger(v) && v > 0)
      )
    );
    const analysisBindingsRaw = Array.isArray(group?.analysis_bindings)
      ? group.analysis_bindings
      : Array.isArray(group?.analysisBindings)
      ? group.analysisBindings
      : [];
    const analysisBindings = analysisBindingsRaw
      .map((binding: any) => {
        const targetId = Number(binding?.target_id ?? binding?.targetId);
        if (!Number.isInteger(targetId) || targetId <= 0) return null;
        const regionIdsRaw = Array.isArray(binding?.region_ids)
          ? binding.region_ids
          : Array.isArray(binding?.regionIds)
          ? binding.regionIds
          : [];
        const regionIds = Array.from(
          new Set(
            regionIdsRaw
              .map((v: unknown) => String(v ?? "").trim())
              .filter((v: string) => v.length > 0)
          )
        );
        if (regionIds.length === 0) return null;
        return {
          target_id: targetId,
          region_ids: regionIds,
        };
      })
      .filter(Boolean) as Array<{ target_id: number; region_ids: string[] }>;

    if (!id || !agentKey || targetIds.length === 0) continue;

    normalizedGroups.push({
      id,
      name: name || `Group ${normalizedGroups.length + 1}`,
      targetIds,
      agentKey,
      inputType: executionSettings.inputType,
      prompt_template: promptParts.prompt_template,
      alert_condition: promptParts.alert_condition,
      negative_condition: promptParts.negative_condition,
      priority_level: priorityLevel,
      inference_model: executionSettings.inferenceModel,
      model_fps: executionSettings.modelFps,
      run_every: executionSettings.runEvery,
      running_resolution: executionSettings.runningResolution,
      only_capture_on_motion: onlyCaptureOnMotion,
      source_target_id: sourceTargetId,
      analysis_bindings: analysisBindings,
    });
  }

  return normalizedGroups;
};

const parseHHMMToMinutesForStepTimeout = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const match = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/.exec(value.trim());
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return hours * 60 + minutes;
};

const formatDurationHuman = (seconds: number): string => {
  const totalMinutes = Math.max(1, Math.floor(Math.max(0, seconds) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
};

const getJobMaxStepTimeoutSeconds = async (
  db: D1Database,
  job: any
): Promise<number | null> => {
  if (!job) return null;
  const scheduleMode = String(job.schedule_mode || "").toLowerCase();

  if (scheduleMode === "one_shot") {
    const startMs = Date.parse(String(job.start_at || ""));
    const endMs = Date.parse(String(job.end_at || ""));
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      return Math.floor((endMs - startMs) / 1000);
    }
  }

  if (scheduleMode === "weekly" || scheduleMode === "monthly" || scheduleMode === "yearly") {
    const { results } = await db.prepare(
      `SELECT start_time, end_time
         FROM job_schedule_windows
        WHERE job_id = ?
          AND is_enabled = 1`
    )
      .bind(job.id)
      .all();

    const durations: number[] = [];
    for (const row of results || []) {
      const startMinutes = parseHHMMToMinutesForStepTimeout((row as any).start_time);
      const endMinutes = parseHHMMToMinutesForStepTimeout((row as any).end_time);
      if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) continue;
      durations.push((endMinutes - startMinutes) * 60);
    }

    if (durations.length > 0) {
      // Shortest window guarantees timeout validity across all recurring runs.
      return Math.min(...durations);
    }
  }

  return null;
};

// Job steps endpoints
app.get("/api/jobs/:jobId/steps", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const jobId = c.req.param("jobId");

  const job = await c.env.DB.prepare(
    "SELECT * FROM jobs WHERE id = ? AND user_id = ?"
  )
    .bind(jobId, user.id)
    .first();

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM job_steps WHERE job_id = ? ORDER BY step_order ASC"
  )
    .bind(jobId)
    .all();

  return c.json({ steps: results });
});

app.post("/api/jobs/:jobId/steps", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const jobId = c.req.param("jobId");
  const body = await c.req.json<{
    step_order: number;
    name: string;
    timeout_seconds: number;
  }>();

  const job = await c.env.DB.prepare(
    "SELECT * FROM jobs WHERE id = ? AND user_id = ?"
  )
    .bind(jobId, user.id)
    .first();

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  const timeoutSeconds = Math.round(Number(body.timeout_seconds));
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < MIN_JOB_STEP_TIMEOUT_SECONDS) {
    return c.json(
      { error: `timeout_seconds must be an integer >= ${MIN_JOB_STEP_TIMEOUT_SECONDS}` },
      400
    );
  }

  const maxTimeoutSeconds = await getJobMaxStepTimeoutSeconds(c.env.DB, job);
  if (maxTimeoutSeconds !== null && timeoutSeconds > maxTimeoutSeconds) {
    return c.json(
      {
        error: `Step timeout exceeds this job limit (${formatDurationHuman(maxTimeoutSeconds)} max)`,
      },
      400
    );
  }

  const now = new Date().toISOString();

  const result = await c.env.DB.prepare(
    `INSERT INTO job_steps (job_id, step_order, name, timeout_seconds, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?)`
  )
    .bind(
      jobId,
      body.step_order,
      body.name,
      timeoutSeconds,
      now,
      now
    )
    .run();

  const step = await c.env.DB.prepare(
    "SELECT * FROM job_steps WHERE id = ?"
  )
    .bind(result.meta.last_row_id)
    .first();

  return c.json({ step }, 201);
});

app.patch("/api/job-steps/:stepId", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const stepId = parseInt(c.req.param("stepId"), 10);
  const body = await c.req.json<{
    name?: string;
    timeout_seconds?: number;
    status?: string;
    step_order?: number;
    input_from_step_id?: number | null;
    input_inject_key?: string | null;
    on_missing_input?: string | null;
    start_condition?: string | null;
    start_condition_from_step_id?: number | null;
    pipelines?: Array<{
      input_from_step_id: number;
      input_inject_keys: string[];
      target_camera_id?: number | null;
      target_camera_name?: string | null;
    }> | null;
      inference_groups?: Array<{
        id: string;
        name?: string;
        targetIds: number[];
        agentKey: string;
        inputType: string;
        prompt_template?: string;
        alert_condition?: string | null;
        negative_condition?: string | null;
        priority_level?: string | null;
        inference_model?: string;
        run_every?: number;
        running_resolution?: number | null;
        only_capture_on_motion?: boolean | number | string;
        source_target_id?: number | null;
      }> | null;
  }>();

  // Verify step belongs to user's job
  const step = await c.env.DB.prepare(
    `SELECT js.*, j.id as job_id, j.schedule_mode, j.start_at, j.end_at FROM job_steps js
     JOIN jobs j ON js.job_id = j.id
     WHERE js.id = ? AND j.user_id = ?`
  )
    .bind(stepId, user.id)
    .first();

  if (!step) {
    return c.json({ error: "Step not found" }, 404);
  }

  const stepData = step as any;

  const normalizePipelineKeys = (keys: any[]): string[] => {
    const normalized = keys
      .map((k) => (k == null ? "" : String(k)).trim())
      .filter((k) => k.length > 0);
    return Array.from(new Set(normalized));
  };

  const isPipelinesUpdate = body.pipelines !== undefined;
  let normalizedPipelines: Array<{
    input_from_step_id: number;
    input_inject_keys: string[];
    target_camera_id?: number | null;
    target_camera_name?: string | null;
  }> | null = null;

  if (isPipelinesUpdate) {
    if (body.pipelines === null) {
      normalizedPipelines = [];
    } else if (!Array.isArray(body.pipelines)) {
      return c.json({ error: "Invalid pipelines format" }, 400);
    } else {
      normalizedPipelines = [];
      for (const p of body.pipelines) {
        const fromStepId = Number((p as any)?.input_from_step_id);
        if (!Number.isFinite(fromStepId)) {
          return c.json({ error: "Invalid pipeline input_from_step_id" }, 400);
        }
        const keys = normalizePipelineKeys(
          Array.isArray((p as any)?.input_inject_keys) ? (p as any).input_inject_keys : []
        );
        if (keys.length === 0) {
          return c.json({ error: "Each pipeline must include at least one input key" }, 400);
        }
        const targetCameraIdRaw = (p as any)?.target_camera_id;
        const targetCameraId = targetCameraIdRaw === null || targetCameraIdRaw === undefined || targetCameraIdRaw === ""
          ? null
          : Number(targetCameraIdRaw);
        if (targetCameraIdRaw !== null && targetCameraIdRaw !== undefined && targetCameraIdRaw !== "" && !Number.isFinite(targetCameraId)) {
          return c.json({ error: "Invalid pipeline target_camera_id" }, 400);
        }
        const targetCameraNameRaw = (p as any)?.target_camera_name;
        const targetCameraName =
          typeof targetCameraNameRaw === "string" ? targetCameraNameRaw.trim() : null;
        normalizedPipelines.push({
          input_from_step_id: fromStepId,
          input_inject_keys: keys,
          target_camera_id: targetCameraId,
          target_camera_name: targetCameraName || null,
        });
      }
    }
  }

  // Legacy support: if input_inject_key starts with "start:", treat it as start_condition
  if (!isPipelinesUpdate && body.input_inject_key && typeof body.input_inject_key === "string" && body.input_inject_key.startsWith("start:")) {
    // Map legacy format to new fields
    body.start_condition = body.input_inject_key;
    body.start_condition_from_step_id = body.input_from_step_id ?? null;
    // Clear pipeline fields since they were misused
    body.input_inject_key = null;
    body.input_from_step_id = null;
  }

  // Enforce: pipeline inject_key cannot start with "start:"
  if (!isPipelinesUpdate && body.input_inject_key && typeof body.input_inject_key === "string" && body.input_inject_key.startsWith("start:")) {
    return c.json({
      error: "Invalid input_inject_key",
      message: "Pipeline inject_key cannot start with 'start:'. Use camera name only or use start_condition field for start conditions."
    }, 400);
  }

  const validatePipelineSourceStep = async (inputStepId: number) => {
    // Allow referencing itself (same-step pipelines) to share data across targets.
    if (inputStepId === stepId) {
      return null;
    }

    // Verify input step exists and belongs to same job
    const inputStep = await c.env.DB.prepare(
      "SELECT id, job_id, step_order FROM job_steps WHERE id = ?"
    )
      .bind(inputStepId)
      .first();

    if (!inputStep) {
      return { error: "Input step not found" };
    }

    const inputStepData = inputStep as any;

    // Must be from same job
    if (inputStepData.job_id !== stepData.job_id) {
      return { 
        error: "Pipeline would create cycle or invalid order",
        message: "Input step must be from the same job"
      };
    }

    // Must have lower step_order (be earlier in sequence)
    if (inputStepData.step_order >= stepData.step_order) {
      return { 
        error: "Pipeline would create cycle or invalid order",
        message: "You can only use output from previous steps (with lower step_order)"
      };
    }
    return null;
  };

  if (isPipelinesUpdate && normalizedPipelines) {
    for (const p of normalizedPipelines) {
      const err = await validatePipelineSourceStep(p.input_from_step_id);
      if (err) return c.json(err, 400);
      const badKey = p.input_inject_keys.find((k) => k.startsWith("start:"));
      if (badKey) {
        return c.json({
          error: "Invalid input_inject_key",
          message: "Pipeline inject_key cannot start with 'start:'. Use camera name only or use start_condition field for start conditions."
        }, 400);
      }
    }

    if (normalizedPipelines.length === 0) {
      body.input_from_step_id = null;
      body.input_inject_key = null;
    } else {
      body.input_from_step_id = null;
      body.input_inject_key = JSON.stringify({ pipelines: normalizedPipelines });
    }
  }

  // Validate input_from_step_id if provided (pipeline source)
  if (!isPipelinesUpdate && body.input_from_step_id !== undefined && body.input_from_step_id !== null) {
    const inputStepId = body.input_from_step_id;

    const err = await validatePipelineSourceStep(inputStepId);
    if (err) return c.json(err, 400);
  }

  // Validate start_condition_from_step_id if provided
  if (body.start_condition_from_step_id !== undefined && body.start_condition_from_step_id !== null) {
    const fromStepId = body.start_condition_from_step_id;

    // Cannot reference itself
    if (fromStepId === stepId) {
      return c.json({ 
        error: "Start condition would create cycle or invalid order",
        message: "A step cannot reference itself in start condition"
      }, 400);
    }

    // Verify step exists and belongs to same job
    const fromStep = await c.env.DB.prepare(
      "SELECT id, job_id, step_order FROM job_steps WHERE id = ?"
    )
      .bind(fromStepId)
      .first();

    if (!fromStep) {
      return c.json({ 
        error: "Start condition step not found"
      }, 400);
    }

    const fromStepData = fromStep as any;

    // Must be from same job
    if (fromStepData.job_id !== stepData.job_id) {
      return c.json({ 
        error: "Start condition would create cycle or invalid order",
        message: "Start condition step must be from the same job"
      }, 400);
    }

    // Must have lower step_order (be earlier in sequence)
    if (fromStepData.step_order >= stepData.step_order) {
      return c.json({ 
        error: "Start condition would create cycle or invalid order",
        message: "Start condition can only reference previous steps (with lower step_order)"
      }, 400);
    }
  }

  let normalizedInferenceGroups: JobStepInferenceGroup[] | null = null;
  if (body.inference_groups !== undefined) {
    if (body.inference_groups === null) {
      normalizedInferenceGroups = [];
    } else if (!Array.isArray(body.inference_groups)) {
      return c.json({ error: "Invalid inference_groups format" }, 400);
    } else {
      const { results: stepTargets } = await c.env.DB.prepare(
        "SELECT id, camera_id FROM job_step_targets WHERE step_id = ?"
      )
        .bind(stepId)
        .all();

      const targetIdToCameraId = new Map<number, number>();
      for (const row of stepTargets || []) {
        const targetId = Number((row as any)?.id);
        const cameraId = Number((row as any)?.camera_id);
        if (Number.isInteger(targetId) && targetId > 0 && Number.isInteger(cameraId) && cameraId > 0) {
          targetIdToCameraId.set(targetId, cameraId);
        }
      }

      const allowedTargetIds = new Set<number>(
        (stepTargets || [])
          .map((row: any) => Number(row.id))
          .filter((id: number) => Number.isInteger(id) && id > 0)
      );

      const { results: activeStepAgents } = await c.env.DB.prepare(
        `SELECT camera_id, agent_key, prompt_template, alert_condition, negative_condition, input_type, inference_model, run_every, running_resolution, only_capture_on_motion
         FROM job_step_agents
         WHERE step_id = ? AND is_active = 1
         ORDER BY created_at DESC`
      )
        .bind(stepId)
        .all();

      const usedTargetIds = new Set<number>();
      const usedGroupIds = new Set<string>();
      const groups: JobStepInferenceGroup[] = [];

      for (const [index, raw] of body.inference_groups.entries()) {
        const row = raw as any;
        const groupId = typeof row?.id === "string" ? row.id.trim() : "";
        if (!groupId) {
          return c.json({ error: `Invalid inference group id at index ${index}` }, 400);
        }
        if (usedGroupIds.has(groupId)) {
          return c.json({ error: `Duplicate inference group id "${groupId}"` }, 400);
        }

        const agentKey = typeof row?.agentKey === "string" ? row.agentKey.trim() : "";
        if (!agentKey) {
          return c.json({ error: `Inference group "${groupId}" requires agentKey` }, 400);
        }

        const inputType = normalizeJobStepInputType(row?.inputType);
        if (!inputType) {
          return c.json({ error: `Inference group "${groupId}" has invalid inputType` }, 400);
        }

        const targetIdsRaw = Array.isArray(row?.targetIds) ? row.targetIds : [];
        const targetIds = Array.from(
          new Set<number>(
            targetIdsRaw
              .map((v: unknown) => Number(v))
              .filter((v: number) => Number.isInteger(v) && v > 0)
          )
        );

        if (targetIds.length < 2) {
          return c.json({ error: `Inference group "${groupId}" must include at least 2 targets` }, 400);
        }

        const sourceTargetIdRaw = row?.source_target_id ?? row?.sourceTargetId;
        const sourceTargetId =
          sourceTargetIdRaw === null || sourceTargetIdRaw === undefined || sourceTargetIdRaw === ""
            ? null
            : Number(sourceTargetIdRaw);
        if (sourceTargetId !== null && (!Number.isInteger(sourceTargetId) || sourceTargetId <= 0)) {
          return c.json({ error: `Inference group "${groupId}" has invalid source_target_id` }, 400);
        }

        const groupCameraIds = new Set<number>();
        for (const targetId of targetIds) {
          if (!allowedTargetIds.has(targetId)) {
            return c.json({ error: `Inference group "${groupId}" references invalid targetId ${targetId}` }, 400);
          }
          if (usedTargetIds.has(targetId)) {
            return c.json({ error: `Target ${targetId} cannot belong to multiple inference groups` }, 400);
          }
          const mappedCameraId = targetIdToCameraId.get(targetId);
          if (mappedCameraId) {
            groupCameraIds.add(mappedCameraId);
          }
          usedTargetIds.add(targetId);
        }

        if (sourceTargetId !== null && !targetIds.includes(sourceTargetId)) {
          return c.json({
            error: `Inference group "${groupId}" source_target_id must belong to targetIds`
          }, 400);
        }

        const sourceCameraId =
          sourceTargetId !== null ? targetIdToCameraId.get(sourceTargetId) ?? null : null;
        const analysisBindingsRaw = Array.isArray(row?.analysis_bindings)
          ? row.analysis_bindings
          : Array.isArray(row?.analysisBindings)
          ? row.analysisBindings
          : [];
        const analysisBindings: Array<{ target_id: number; region_ids: string[] }> = [];
        const usedBindingTargets = new Set<number>();
        for (const binding of analysisBindingsRaw) {
          const targetId = Number((binding as any)?.target_id ?? (binding as any)?.targetId);
          if (!Number.isInteger(targetId) || targetId <= 0 || !targetIds.includes(targetId)) {
            return c.json(
              {
                error: `Inference group "${groupId}" has invalid analysis binding target_id`,
              },
              400
            );
          }
          if (usedBindingTargets.has(targetId)) {
            return c.json(
              {
                error: `Inference group "${groupId}" has duplicated analysis binding for target ${targetId}`,
              },
              400
            );
          }
          usedBindingTargets.add(targetId);
          const regionIdsRaw = Array.isArray((binding as any)?.region_ids)
            ? (binding as any).region_ids
            : Array.isArray((binding as any)?.regionIds)
            ? (binding as any).regionIds
            : [];
          const regionIds: string[] = Array.from(
            new Set<string>(
              regionIdsRaw
                .map((v: unknown) => String(v ?? "").trim())
                .filter((v: string) => v.length > 0)
            )
          );
          if (regionIds.length === 0) {
            continue;
          }
          analysisBindings.push({
            target_id: targetId,
            region_ids: regionIds,
          });
        }
        const matchingAgents = (activeStepAgents || []).filter((a: any) => {
          return String(a?.agent_key || "").trim() === agentKey;
        });
        const sourceCameraSpecificAgent =
          sourceCameraId !== null
            ? matchingAgents.find((a: any) => {
                const cameraId = Number(a?.camera_id);
                return Number.isInteger(cameraId) && cameraId === sourceCameraId;
              })
            : null;
        const cameraSpecificAgent = matchingAgents.find((a: any) => {
          const cameraId = Number(a?.camera_id);
          return Number.isInteger(cameraId) && groupCameraIds.has(cameraId);
        });
        const defaultAgent = matchingAgents.find((a: any) => a?.camera_id === null || a?.camera_id === undefined);
        const resolvedAgent =
          sourceCameraSpecificAgent || cameraSpecificAgent || defaultAgent || matchingAgents[0] || null;

        if (!resolvedAgent) {
          return c.json({
            error: `Inference group "${groupId}" has no active agent configuration for key "${agentKey}"`,
            message: "Configure the selected AI agent for one of the grouped target cameras before saving the group."
          }, 400);
        }

        const requestedInferenceModel =
          normalizeJobStepInferenceModel(
            (resolvedAgent as any)?.inference_model ??
              row?.inference_model ??
              row?.inferenceModel
          ) || FIXED_JOB_STEP_INFERENCE_MODEL;
        const requestedRunEvery = normalizeJobStepRunEverySeconds(
          (resolvedAgent as any)?.run_every ??
            row?.run_every ??
            row?.runEvery,
          FIXED_JOB_STEP_RUN_EVERY_SECONDS
        );
        const requestedRunningResolution =
          parseJobStepRunningResolution(
            (resolvedAgent as any)?.running_resolution ??
              row?.running_resolution ??
              row?.runningResolution
          ) ??
          (requestedInferenceModel === "core" ? DEFAULT_CORE_RUNNING_RESOLUTION : null);
        const requestedModelFps = normalizeJobStepModelFps(
          (resolvedAgent as any)?.model_fps ??
            row?.model_fps ??
            row?.modelFps,
          requestedInferenceModel,
          inputType
        );
        const executionSettings = applyInferenceExecutionConstraints(
          inputType,
          requestedInferenceModel,
          requestedRunEvery,
          requestedRunningResolution,
          requestedModelFps
        );

        const name = typeof row?.name === "string" ? row.name.trim() : "";
        const resolvedPromptParts = parsePromptTemplateParts(
          (resolvedAgent as any)?.prompt_template,
          (resolvedAgent as any)?.alert_condition,
          (resolvedAgent as any)?.negative_condition
        );
        groups.push({
          id: groupId,
          name: name || `Group ${groups.length + 1}`,
          targetIds,
          agentKey,
          inputType: executionSettings.inputType,
          prompt_template: resolvedPromptParts.prompt_template,
          alert_condition: resolvedPromptParts.alert_condition,
          negative_condition: resolvedPromptParts.negative_condition,
          priority_level: normalizeJobStepPriorityLevel(
            (resolvedAgent as any)?.priority_level ??
              row?.priority_level ??
              row?.priorityLevel
          ),
          inference_model: executionSettings.inferenceModel,
          model_fps: executionSettings.modelFps,
          run_every: executionSettings.runEvery,
          running_resolution: executionSettings.runningResolution,
          only_capture_on_motion: normalizeJobStepOnlyCaptureOnMotion(
            (resolvedAgent as any)?.only_capture_on_motion ??
              (resolvedAgent as any)?.onlyCaptureOnMotion ??
              row?.only_capture_on_motion ??
              row?.onlyCaptureOnMotion,
            true
          ),
          source_target_id: sourceTargetId,
          analysis_bindings: analysisBindings,
        });
        usedGroupIds.add(groupId);
      }

      normalizedInferenceGroups = groups;
    }
  }

  // Build UPDATE query
  const updates: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) {
    updates.push("name = ?");
    values.push(body.name);
  }

  if (body.timeout_seconds !== undefined) {
    const timeoutSeconds = Math.round(Number(body.timeout_seconds));
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < MIN_JOB_STEP_TIMEOUT_SECONDS) {
      return c.json(
        { error: `timeout_seconds must be an integer >= ${MIN_JOB_STEP_TIMEOUT_SECONDS}` },
        400
      );
    }
    const maxTimeoutSeconds = await getJobMaxStepTimeoutSeconds(c.env.DB, stepData);
    if (maxTimeoutSeconds !== null && timeoutSeconds > maxTimeoutSeconds) {
      return c.json(
        {
          error: `Step timeout exceeds this job limit (${formatDurationHuman(maxTimeoutSeconds)} max)`,
        },
        400
      );
    }
    updates.push("timeout_seconds = ?");
    values.push(timeoutSeconds);
  }

  if (body.status !== undefined) {
    updates.push("status = ?");
    values.push(body.status);
  }

  if (body.step_order !== undefined) {
    updates.push("step_order = ?");
    values.push(body.step_order);
  }

  if (body.input_from_step_id !== undefined) {
    updates.push("input_from_step_id = ?");
    values.push(body.input_from_step_id);
  }

  if (body.input_inject_key !== undefined) {
    updates.push("input_inject_key = ?");
    values.push(body.input_inject_key);
  }

  if (body.on_missing_input !== undefined) {
    updates.push("on_missing_input = ?");
    values.push(body.on_missing_input);
  }

  if (body.start_condition !== undefined) {
    updates.push("start_condition = ?");
    values.push(body.start_condition);
  }

  if (body.start_condition_from_step_id !== undefined) {
    updates.push("start_condition_from_step_id = ?");
    values.push(body.start_condition_from_step_id);
  }

  if (body.inference_groups !== undefined) {
    updates.push("inference_groups = ?");
    values.push(JSON.stringify(normalizedInferenceGroups ?? []));
  }

  if (updates.length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  updates.push("updated_at = CURRENT_TIMESTAMP");
  values.push(stepId);

  await c.env.DB.prepare(
    `UPDATE job_steps SET ${updates.join(", ")} WHERE id = ?`
  )
    .bind(...values)
    .run();

  const updatedStep = await c.env.DB.prepare(
    "SELECT * FROM job_steps WHERE id = ?"
  )
    .bind(stepId)
    .first();

  return c.json(updatedStep);
});

app.delete("/api/job-steps/:stepId", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const stepId = parseInt(c.req.param("stepId"), 10);

  // Verify step belongs to user's job
  const step = await c.env.DB.prepare(
    `SELECT js.* FROM job_steps js
     JOIN jobs j ON js.job_id = j.id
     WHERE js.id = ? AND j.user_id = ?`
  )
    .bind(stepId, user.id)
    .first();

  if (!step) {
    return c.json({ error: "Step not found" }, 404);
  }

  // Delete related records for this step
  await c.env.DB.prepare(
    "DELETE FROM job_step_alert_rules WHERE step_id = ?"
  )
    .bind(stepId)
    .run();

  const { results: stepAgentRows } = await c.env.DB.prepare(
    "SELECT id FROM job_step_agents WHERE step_id = ?"
  )
    .bind(stepId)
    .all();
  const stepAgentIds = (stepAgentRows || [])
    .map((row: any) => Number(row.id))
    .filter((id: number) => Number.isInteger(id) && id > 0);
  if (stepAgentIds.length > 0) {
    const placeholders = stepAgentIds.map(() => "?").join(", ");
    await c.env.DB.prepare(
      `DELETE FROM job_step_agent_face_targets WHERE agent_id IN (${placeholders})`
    )
      .bind(...stepAgentIds)
      .run();
  }

  await c.env.DB.prepare(
    "DELETE FROM job_step_agents WHERE step_id = ?"
  )
    .bind(stepId)
    .run();

  await c.env.DB.prepare(
    "DELETE FROM job_step_targets WHERE step_id = ?"
  )
    .bind(stepId)
    .run();

  // Delete the step itself
  await c.env.DB.prepare(
    "DELETE FROM job_steps WHERE id = ?"
  )
    .bind(stepId)
    .run();

  return c.json({ success: true });
});

// Job step targets endpoints
app.get("/api/job-steps/:stepId/targets", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const stepId = parseInt(c.req.param("stepId"), 10);

  const step = await c.env.DB.prepare(
    `SELECT js.* FROM job_steps js
     JOIN jobs j ON js.job_id = j.id
     WHERE js.id = ? AND j.user_id = ?`
  )
    .bind(stepId, user.id)
    .first();

  if (!step) {
    return c.json({ error: "Step not found" }, 404);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT jst.*, c.name as camera_name, COALESCE(jsa.input_type, 'video') as input_type
     FROM job_step_targets jst
     LEFT JOIN cameras c ON jst.camera_id = c.id
     LEFT JOIN job_step_agents jsa
       ON jsa.step_id = jst.step_id
      AND jsa.camera_id = jst.camera_id
      AND jsa.is_active = 1
     WHERE jst.step_id = ?`
  )
    .bind(stepId)
    .all();

  return c.json({ targets: results });
});

app.post("/api/job-steps/:stepId/targets", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const stepId = parseInt(c.req.param("stepId"), 10);
  const body = await c.req.json<{ camera_id: number }>();

  const step = await c.env.DB.prepare(
    `SELECT js.* FROM job_steps js
     JOIN jobs j ON js.job_id = j.id
     WHERE js.id = ? AND j.user_id = ?`
  )
    .bind(stepId, user.id)
    .first();

  if (!step) {
    return c.json({ error: "Step not found" }, 404);
  }

  const cameraId = Number(body.camera_id);
  if (!Number.isInteger(cameraId) || cameraId <= 0) {
    return c.json({ error: "Invalid camera_id" }, 400);
  }

  const now = new Date().toISOString();

  const result = await c.env.DB.prepare(
    `INSERT INTO job_step_targets (step_id, camera_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`
  )
    .bind(stepId, cameraId, now, now)
    .run();

  const target = await c.env.DB.prepare(
    `SELECT jst.*, c.name as camera_name, COALESCE(jsa.input_type, 'video') as input_type
     FROM job_step_targets jst
     LEFT JOIN cameras c ON jst.camera_id = c.id
     LEFT JOIN job_step_agents jsa
       ON jsa.step_id = jst.step_id
      AND jsa.camera_id = jst.camera_id
      AND jsa.is_active = 1
     WHERE jst.id = ?`
  )
    .bind(result.meta.last_row_id)
    .first();

  return c.json({ target }, 201);
});

app.patch("/api/job-steps/:stepId/targets/:targetId", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const stepId = parseInt(c.req.param("stepId"), 10);
  const targetId = parseInt(c.req.param("targetId"), 10);
  const body = await c.req.json<{ input_type?: string }>();

  if (!Number.isInteger(targetId) || targetId <= 0) {
    return c.json({ error: "Invalid targetId" }, 400);
  }

  const step = await c.env.DB.prepare(
    `SELECT js.* FROM job_steps js
     JOIN jobs j ON js.job_id = j.id
     WHERE js.id = ? AND j.user_id = ?`
  )
    .bind(stepId, user.id)
    .first();

  if (!step) {
    return c.json({ error: "Step not found" }, 404);
  }

  if (body.input_type === undefined) {
    return c.json({ error: "No fields to update" }, 400);
  }

  const inputType = normalizeJobStepInputType(body.input_type);
  if (!inputType) {
    return c.json({ error: "Invalid input_type. Allowed values: video, image" }, 400);
  }

  const existingTarget = await c.env.DB.prepare(
    "SELECT id, camera_id FROM job_step_targets WHERE id = ? AND step_id = ?"
  )
    .bind(targetId, stepId)
    .first();

  if (!existingTarget) {
    return c.json({ error: "Target not found" }, 404);
  }

  const now = new Date().toISOString();
  const cameraId = Number((existingTarget as any).camera_id);
  const activeAgent = await c.env.DB.prepare(
    `SELECT id, inference_model FROM job_step_agents
     WHERE step_id = ? AND camera_id = ? AND is_active = 1
     ORDER BY created_at DESC
     LIMIT 1`
  )
    .bind(stepId, cameraId)
    .first();

  if (!activeAgent) {
    return c.json({
      error: "No active agent configured for this target camera",
      message: "Configure an AI agent for this target before setting input type."
    }, 400);
  }

  const activeInferenceModel =
    normalizeJobStepInferenceModel((activeAgent as any)?.inference_model) ||
    FIXED_JOB_STEP_INFERENCE_MODEL;
  if (inputType === "image" && activeInferenceModel === "core") {
    return c.json(
      {
        error: "CORE_MODEL_REQUIRES_VIDEO",
        message: "Core model supports only video input.",
      },
      400
    );
  }

  await c.env.DB.prepare(
    "UPDATE job_step_agents SET input_type = ?, updated_at = ? WHERE id = ?"
  )
    .bind(inputType, now, (activeAgent as any).id)
    .run();

  const target = await c.env.DB.prepare(
    `SELECT jst.*, c.name as camera_name, COALESCE(jsa.input_type, 'video') as input_type
     FROM job_step_targets jst
     LEFT JOIN cameras c ON jst.camera_id = c.id
     LEFT JOIN job_step_agents jsa
       ON jsa.step_id = jst.step_id
      AND jsa.camera_id = jst.camera_id
      AND jsa.is_active = 1
     WHERE jst.id = ? AND jst.step_id = ?`
  )
    .bind(targetId, stepId)
    .first();

  return c.json({ target }, 200);
});

app.delete("/api/job-steps/:stepId/targets/:targetId", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const stepId = parseInt(c.req.param("stepId"), 10);
  const targetId = parseInt(c.req.param("targetId"), 10);

  const step = await c.env.DB.prepare(
    `SELECT js.* FROM job_steps js
     JOIN jobs j ON js.job_id = j.id
     WHERE js.id = ? AND j.user_id = ?`
  )
    .bind(stepId, user.id)
    .first();

  if (!step) {
    return c.json({ error: "Step not found" }, 404);
  }

  // Get the camera_id for this target before deleting
  const target = await c.env.DB.prepare(
    "SELECT camera_id FROM job_step_targets WHERE id = ? AND step_id = ?"
  )
    .bind(targetId, stepId)
    .first();

  const now = new Date().toISOString();

  // Delete the target
  await c.env.DB.prepare(
    "DELETE FROM job_step_targets WHERE id = ? AND step_id = ?"
  )
    .bind(targetId, stepId)
    .run();

  // Deactivate any active agent for this camera
  if (target) {
    const cameraId = (target as any).camera_id;
    
    await c.env.DB.prepare(
      "UPDATE job_step_agents SET is_active = 0, updated_at = ? WHERE step_id = ? AND camera_id = ? AND is_active = 1"
    )
      .bind(now, stepId, cameraId)
      .run();
  }

  const stepData = step as any;
  const existingGroups = parseStoredInferenceGroups(stepData.inference_groups);
  if (existingGroups.length > 0) {
    const cleanedGroups = existingGroups
      .map((group) => {
        const nextTargetIds = group.targetIds.filter((id) => id !== targetId);
        const nextTargetSet = new Set(nextTargetIds);
        return {
          ...group,
          targetIds: nextTargetIds,
          analysis_bindings: Array.isArray(group.analysis_bindings)
            ? group.analysis_bindings.filter(
                (binding) =>
                  Number.isInteger(Number(binding?.target_id)) &&
                  nextTargetSet.has(Number(binding.target_id))
              )
            : [],
        };
      })
      .filter((group) => group.targetIds.length >= 2);

    await c.env.DB.prepare(
      "UPDATE job_steps SET inference_groups = ?, updated_at = ? WHERE id = ?"
    )
      .bind(JSON.stringify(cleanedGroups), now, stepId)
      .run();
  }

  return c.json({ success: true });
});

const resolveOwnedJobStepAgentForUser = async (
  db: D1Database,
  userId: string,
  agentId: number
): Promise<any | null> => {
  if (!Number.isInteger(agentId) || agentId <= 0) return null;
  const row = await db
    .prepare(
      `SELECT jsa.*
       FROM job_step_agents jsa
       JOIN job_steps js ON js.id = jsa.step_id
       JOIN jobs j ON j.id = js.job_id
       WHERE jsa.id = ? AND j.user_id = ?
       LIMIT 1`
    )
    .bind(agentId, userId)
    .first();
  return row || null;
};

app.get("/api/job-step-agents/:agentId/negative-images", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const agentId = Number(c.req.param("agentId"));
  if (!Number.isInteger(agentId) || agentId <= 0) {
    return c.json({ error: "Invalid agent id" }, 400);
  }

  const agent = await resolveOwnedJobStepAgentForUser(c.env.DB, user.id, agentId);
  if (!agent) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const imagesByAgentId = await loadNegativeReferenceImagesByAgentId(c.env.DB, [agentId]);
  return c.json({ images: imagesByAgentId.get(agentId) || [] });
});

app.post("/api/job-step-agents/:agentId/negative-images", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const agentId = Number(c.req.param("agentId"));
  if (!Number.isInteger(agentId) || agentId <= 0) {
    return c.json({ error: "Invalid agent id" }, 400);
  }

  const agent = await resolveOwnedJobStepAgentForUser(c.env.DB, user.id, agentId);
  if (!agent) {
    return c.json({ error: "Agent not found" }, 404);
  }

  try {
    const formData = await c.req.formData();
    const imageFile = formData.get("image") as File | null;
    if (!imageFile) {
      return c.json({ error: "image is required" }, 400);
    }
    if (!String(imageFile.type || "").toLowerCase().startsWith("image/")) {
      return c.json({ error: "Only image uploads are allowed" }, 400);
    }
    if (
      typeof imageFile.size === "number" &&
      imageFile.size > NEGATIVE_CONDITION_MAX_UPLOAD_BYTES
    ) {
      return c.json({ error: "Image is too large. Maximum size is 10MB." }, 400);
    }

    const currentImageCount = await getAgentNegativeImageCount(c.env.DB, agentId);
    if (currentImageCount >= NEGATIVE_CONDITION_MAX_IMAGES) {
      return c.json(
        { error: `Maximum ${NEGATIVE_CONDITION_MAX_IMAGES} images per agent` },
        409
      );
    }

    const storageKey = buildJobStepAgentNegativeImageStorageKey(
      user.id,
      agentId,
      imageFile.type
    );
    const arrayBuffer = await imageFile.arrayBuffer();
    await c.env.R2_BUCKET.put(storageKey, arrayBuffer, {
      httpMetadata: { contentType: imageFile.type || "image/jpeg" },
    });
    const imageUrl = `/api/negative-condition-images/${encodeURIComponent(storageKey)}`;
    const now = new Date().toISOString();

    const inserted = await c.env.DB
      .prepare(
        `INSERT INTO job_step_agent_negative_images (agent_id, image_url, created_at, updated_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(agentId, imageUrl, now, now)
      .run();

    const imageId = Number(inserted.meta.last_row_id || 0);
    return c.json(
      {
        image: {
          id: imageId,
          agent_id: agentId,
          image_url: imageUrl,
        },
      },
      201
    );
  } catch (error) {
    console.error("[NEGATIVE CONDITION] Failed to upload negative image", { agentId, error });
    return c.json({ error: "Failed to upload negative condition image" }, 500);
  }
});

app.delete(
  "/api/job-step-agents/:agentId/negative-images/:imageId",
  anyAuthMiddleware,
  async (c) => {
    const user = c.get("user")!;
    const agentId = Number(c.req.param("agentId"));
    const imageId = Number(c.req.param("imageId"));
    if (!Number.isInteger(agentId) || agentId <= 0) {
      return c.json({ error: "Invalid agent id" }, 400);
    }
    if (!Number.isInteger(imageId) || imageId <= 0) {
      return c.json({ error: "Invalid image id" }, 400);
    }

    const row = await c.env.DB
      .prepare(
        `SELECT jsani.id, jsani.image_url
         FROM job_step_agent_negative_images jsani
         JOIN job_step_agents jsa ON jsa.id = jsani.agent_id
         JOIN job_steps js ON js.id = jsa.step_id
         JOIN jobs j ON j.id = js.job_id
         WHERE jsani.id = ? AND jsani.agent_id = ? AND j.user_id = ?`
      )
      .bind(imageId, agentId, user.id)
      .first();

    if (!row) {
      return c.json({ error: "Negative condition image not found" }, 404);
    }

    const imageUrl =
      typeof (row as any)?.image_url === "string" ? String((row as any).image_url).trim() : "";
    if (!imageUrl) {
      console.error("[NEGATIVE CONDITION] Missing image_url while deleting image", {
        agentId,
        imageId,
      });
      return c.json({ error: "Failed to delete image from storage" }, 500);
    }

    const storageKey = extractStorageKeyFromNegativeConditionImageUrl(imageUrl);
    if (!storageKey) {
      console.error("[NEGATIVE CONDITION] Invalid image_url while deleting image", {
        agentId,
        imageId,
        imageUrl,
      });
      return c.json({ error: "Failed to delete image from storage" }, 500);
    }

    try {
      await c.env.R2_BUCKET.delete(storageKey);
    } catch (error) {
      console.error("[NEGATIVE CONDITION] Failed to delete image from R2", {
        agentId,
        imageId,
        storageKey,
        error,
      });
      return c.json({ error: "Failed to delete image from storage" }, 502);
    }

    try {
      await c.env.DB
        .prepare("DELETE FROM job_step_agent_negative_images WHERE id = ? AND agent_id = ?")
        .bind(imageId, agentId)
        .run();
    } catch (error) {
      console.error("[NEGATIVE CONDITION] Failed to delete image row", {
        agentId,
        imageId,
        error,
      });
      return c.json({ error: "Failed to delete negative condition image" }, 500);
    }

    return c.json({ success: true });
  }
);

// Job step agents endpoints
app.get("/api/job-steps/:stepId/agents", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const stepId = parseInt(c.req.param("stepId"), 10);

  const step = await c.env.DB.prepare(
    `SELECT js.* FROM job_steps js
     JOIN jobs j ON js.job_id = j.id
     WHERE js.id = ? AND j.user_id = ?`
  )
    .bind(stepId, user.id)
    .first();

  if (!step) {
    return c.json({ error: "Step not found" }, 404);
  }

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM job_step_agents WHERE step_id = ? ORDER BY created_at DESC"
  )
    .bind(stepId)
    .all();
  const agents = (results || []).map((row: any) => ({ ...row }));
  const agentIds = agents
    .map((row: any) => Number(row?.id))
    .filter((id: number) => Number.isInteger(id) && id > 0);
  const faceTargetIdsByAgentId = await loadFaceTargetIdsByAgentId(c.env.DB, agentIds);
  const negativeImagesByAgentId = await loadNegativeReferenceImagesByAgentId(c.env.DB, agentIds);

  const agentsWithFaceTargets = agents.map((agent: any) => {
    const useTemporalContext = normalizeJobStepUseTemporalContext(
      agent?.use_temporal_context,
      true
    );
    const agentId = Number(agent?.id);
    const faceTargetIds =
      Number.isInteger(agentId) && agentId > 0
        ? faceTargetIdsByAgentId.get(agentId) || []
        : [];
    const negativeReferenceImages =
      Number.isInteger(agentId) && agentId > 0
        ? negativeImagesByAgentId.get(agentId) || []
        : [];
    const promptParts = parsePromptTemplatePartsForJobStepTemporalMode(
      agent?.prompt_template,
      agent?.alert_condition,
      agent?.negative_condition,
      useTemporalContext
    );
    const analysisRegionsRaw = parseStoredAnalysisRegions(agent?.analysis_regions, {
      promptParts,
      faceTargetIds,
      negativeImageIds: negativeReferenceImages
        .map((img) => Number(img?.id))
        .filter((id) => Number.isInteger(id) && id > 0),
    });
    const analysisRegions = useTemporalContext
      ? analysisRegionsRaw
      : sanitizeAnalysisRegionsForLegacyFlow(analysisRegionsRaw);
    const rawInputType = normalizeJobStepInputType(agent?.input_type) || "video";
    const rawInferenceModel =
      normalizeJobStepInferenceModel(agent?.inference_model) || FIXED_JOB_STEP_INFERENCE_MODEL;
    const rawRunEvery = normalizeJobStepRunEverySeconds(
      agent?.run_every,
      FIXED_JOB_STEP_RUN_EVERY_SECONDS
    );
    const rawRunningResolution = normalizeJobStepRunningResolution(
      agent?.running_resolution,
      DEFAULT_CORE_RUNNING_RESOLUTION
    );
    const execution = applyInferenceExecutionConstraints(
      rawInputType,
      rawInferenceModel,
      rawRunEvery,
      rawRunningResolution,
      agent?.model_fps
    );
    return {
      ...agent,
      input_type: execution.inputType,
      inference_model: execution.inferenceModel,
      model_fps: execution.modelFps,
      run_every: execution.runEvery,
      running_resolution: execution.runningResolution,
      ...buildJobStepTemporalContextFields(agent, useTemporalContext),
      face_target_ids: faceTargetIds,
      negative_reference_images: negativeReferenceImages,
      analysis_regions: analysisRegions,
    };
  });

  return c.json({ agents: agentsWithFaceTargets });
});

app.post("/api/job-steps/:stepId/agents", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const stepId = parseInt(c.req.param("stepId"), 10);
  const body = await c.req.json<{
    camera_id?: number;
    agent_key: string;
    prompt_template: string;
    params?: string;
    input_schema?: string;
    alert_condition?: string;
    negative_condition?: string;
    priority_level?: string;
    input_type?: string;
    inference_model?: string;
    model_fps?: unknown;
    run_every?: number;
    running_resolution?: unknown;
    only_capture_on_motion?: boolean | number | string;
    use_temporal_context?: boolean | number | string;
    face_target_ids?: number[];
    analysis_regions?: unknown[];
  }>();

  const step = await c.env.DB.prepare(
    `SELECT js.* FROM job_steps js
     JOIN jobs j ON js.job_id = j.id
     WHERE js.id = ? AND j.user_id = ?`
  )
    .bind(stepId, user.id)
    .first();

  if (!step) {
    return c.json({ error: "Step not found" }, 404);
  }
  const jobId = Number((step as any).job_id);

  // Validate camera_id belongs to this step's targets if provided
  if (body.camera_id !== undefined && body.camera_id !== null) {
    const targetExists = await c.env.DB.prepare(
      "SELECT 1 FROM job_step_targets WHERE step_id = ? AND camera_id = ?"
    )
      .bind(stepId, body.camera_id)
      .first();

    if (!targetExists) {
      return c.json({ 
        error: "Invalid camera_id - camera must be added as a target first" 
      }, 400);
    }
  }

  const now = new Date().toISOString();
  const cameraId = body.camera_id ?? null;
  const normalizedAgentKey = String(body.agent_key || "").trim().toLowerCase();
  const isFaceIdAgent =
    normalizedAgentKey === "faceid" ||
    normalizedAgentKey === "face_id" ||
    normalizedAgentKey === "face-id";

  const priorityCandidate = body.priority_level
    ? String(body.priority_level).trim().toUpperCase()
    : "MEDIUM";
  const allowedPriorities = new Set(["CRITIC", "HIGH", "MEDIUM", "LOW"]);
  const priorityLevel = allowedPriorities.has(priorityCandidate)
    ? priorityCandidate
    : "MEDIUM";
  const requestedInputType = body.input_type === undefined
    ? null
    : normalizeJobStepInputType(body.input_type);
  if (body.input_type !== undefined && !requestedInputType) {
    return c.json({ error: "Invalid input_type. Allowed values: video, image" }, 400);
  }
  const requestedInferenceModel = body.inference_model === undefined
    ? null
    : normalizeJobStepInferenceModel(body.inference_model);
  if (body.inference_model !== undefined && !requestedInferenceModel) {
    return c.json({ error: "Invalid inference_model. Allowed values: legacy, pro, ultra, core" }, 400);
  }
  const requestedRunEvery = body.run_every === undefined
    ? null
    : normalizeJobStepRunEverySeconds(body.run_every, FIXED_JOB_STEP_RUN_EVERY_SECONDS);
  const requestedModelFps = body.model_fps === undefined
    ? null
    : normalizeJobStepModelFps(
        body.model_fps,
        requestedInferenceModel || FIXED_JOB_STEP_INFERENCE_MODEL,
        requestedInputType || "video"
      );
  const requestedRunningResolution = body.running_resolution === undefined
    ? null
    : body.running_resolution === null
    ? null
    : parseJobStepRunningResolution(body.running_resolution);
  if (
    body.running_resolution !== undefined &&
    body.running_resolution !== null &&
    requestedRunningResolution === null
  ) {
    return c.json({ error: "Invalid running_resolution. Allowed values: 640, 1024" }, 400);
  }
  const requestedOnlyCaptureOnMotion = body.only_capture_on_motion === undefined
    ? null
    : normalizeJobStepOnlyCaptureOnMotion(body.only_capture_on_motion, true);
  const requestedUseTemporalContext = body.use_temporal_context === undefined
    ? null
    : normalizeJobStepUseTemporalContext(body.use_temporal_context, true);
  const resolveNormalizedPromptParts = (
    promptTemplateRaw: unknown,
    alertConditionRaw: unknown,
    negativeConditionRaw: unknown,
    useTemporalContext: boolean
  ): PromptTemplateParts =>
    parsePromptTemplatePartsForJobStepTemporalMode(
      promptTemplateRaw,
      alertConditionRaw,
      negativeConditionRaw,
      useTemporalContext
    );
  if (body.face_target_ids !== undefined && !Array.isArray(body.face_target_ids)) {
    return c.json({ error: "face_target_ids must be an array of integers" }, 400);
  }
  const requestedFaceTargetIds = normalizeFaceTargetIdsInput(body.face_target_ids);
  const requestedAnalysisRegionsRaw =
    body.analysis_regions === undefined
      ? undefined
      : body.analysis_regions === null
      ? []
      : body.analysis_regions;
  if (
    requestedAnalysisRegionsRaw !== undefined &&
    !Array.isArray(requestedAnalysisRegionsRaw)
  ) {
    return c.json({ error: "analysis_regions must be an array" }, 400);
  }

  if (requestedFaceTargetIds !== null && requestedFaceTargetIds.length > 0) {
    const placeholders = requestedFaceTargetIds.map(() => "?").join(", ");
    const { results: rows } = await c.env.DB
      .prepare(
        `SELECT ft.id, COUNT(fti.id) AS image_count
         FROM face_targets ft
         LEFT JOIN face_target_images fti ON fti.face_target_id = ft.id
         WHERE ft.user_id = ?
           AND ft.id IN (${placeholders})
         GROUP BY ft.id`
      )
      .bind(user.id, ...requestedFaceTargetIds)
      .all();

    const validated = new Map<number, number>();
    for (const row of rows || []) {
      const id = Number((row as any)?.id);
      const imageCount = Number((row as any)?.image_count || 0);
      if (!Number.isInteger(id) || id <= 0) continue;
      validated.set(id, imageCount);
    }

    const missing = requestedFaceTargetIds.filter((id) => !validated.has(id));
    if (missing.length > 0) {
      return c.json({ error: "Some selected face targets are invalid" }, 400);
    }

    const withoutImages = requestedFaceTargetIds.filter((id) => (validated.get(id) || 0) <= 0);
    if (withoutImages.length > 0) {
      return c.json(
        { error: "All selected face targets must have at least one image" },
        400
      );
    }
  }

  let existingAgent: any = null;
  if (cameraId === null) {
    existingAgent = await c.env.DB.prepare(
      "SELECT * FROM job_step_agents WHERE step_id = ? AND is_active = 1 AND camera_id IS NULL"
    )
      .bind(stepId)
      .first();
  } else {
    existingAgent = await c.env.DB.prepare(
      "SELECT * FROM job_step_agents WHERE step_id = ? AND is_active = 1 AND camera_id = ?"
    )
      .bind(stepId, cameraId)
      .first();
  }

  if (existingAgent) {
    const existingAgentId = Number((existingAgent as any)?.id);
    let effectiveFaceTargetIds = requestedFaceTargetIds;
    if (
      effectiveFaceTargetIds === null &&
      Number.isInteger(existingAgentId) &&
      existingAgentId > 0
    ) {
      const existingFaceTargetIds = await loadFaceTargetIdsByAgentId(c.env.DB, [existingAgentId]);
      effectiveFaceTargetIds = existingFaceTargetIds.get(existingAgentId) || [];
    }
    let effectiveNegativeImageIds: number[] = [];
    if (Number.isInteger(existingAgentId) && existingAgentId > 0) {
      const existingNegativeImages = await loadNegativeReferenceImagesByAgentId(c.env.DB, [
        existingAgentId,
      ]);
      effectiveNegativeImageIds = (existingNegativeImages.get(existingAgentId) || [])
        .map((img) => Number(img?.id))
        .filter((id) => Number.isInteger(id) && id > 0);
    }

    if (isFaceIdAgent && (!effectiveFaceTargetIds || effectiveFaceTargetIds.length === 0)) {
      return c.json(
        { error: "FaceID agent requires at least one selected target face" },
        400
      );
    }

    const existingInputType = normalizeJobStepInputType((existingAgent as any).input_type) || "video";
    const existingInferenceModel =
      normalizeJobStepInferenceModel((existingAgent as any).inference_model) ||
      FIXED_JOB_STEP_INFERENCE_MODEL;
    const existingRunEvery = normalizeJobStepRunEverySeconds(
      (existingAgent as any).run_every,
      FIXED_JOB_STEP_RUN_EVERY_SECONDS
    );
    const existingModelFps = normalizeJobStepModelFps(
      (existingAgent as any).model_fps,
      existingInferenceModel,
      existingInputType
    );
    const existingRunningResolution =
      parseJobStepRunningResolution((existingAgent as any).running_resolution) ??
      (existingInferenceModel === "core" ? DEFAULT_CORE_RUNNING_RESOLUTION : null);
    const existingOnlyCaptureOnMotion = normalizeJobStepOnlyCaptureOnMotion(
      (existingAgent as any).only_capture_on_motion,
      true
    );
    const existingUseTemporalContext = normalizeJobStepUseTemporalContext(
      (existingAgent as any).use_temporal_context,
      true
    );
    const useTemporalContext =
      requestedUseTemporalContext ?? existingUseTemporalContext;
    const normalizedPromptParts = resolveNormalizedPromptParts(
      body.prompt_template === undefined
        ? (existingAgent as any)?.prompt_template
        : body.prompt_template,
      body.alert_condition === undefined
        ? (existingAgent as any)?.alert_condition
        : body.alert_condition,
      body.negative_condition === undefined
        ? (existingAgent as any)?.negative_condition
        : body.negative_condition,
      useTemporalContext
    );
    const storedPromptTemplate = buildPromptTemplateFromParts(normalizedPromptParts);
    let analysisRegionsToStore: string | null = (existingAgent as any)?.analysis_regions ?? null;
    if (requestedAnalysisRegionsRaw !== undefined) {
      const normalizedAnalysisRegions = normalizeAnalysisRegionsInput(
        requestedAnalysisRegionsRaw,
        {
          promptParts: normalizedPromptParts,
          faceTargetIds: effectiveFaceTargetIds || [],
          negativeImageIds: effectiveNegativeImageIds,
        }
      );
      if (normalizedAnalysisRegions.error) {
        return c.json({ error: normalizedAnalysisRegions.error }, 400);
      }
      const regionsToStore = useTemporalContext
        ? normalizedAnalysisRegions.regions
        : sanitizeAnalysisRegionsForLegacyFlow(normalizedAnalysisRegions.regions);
      analysisRegionsToStore = JSON.stringify(regionsToStore);
    } else if (!useTemporalContext) {
      const existingRegions = parseStoredAnalysisRegions((existingAgent as any)?.analysis_regions, {
        promptParts: normalizedPromptParts,
        faceTargetIds: effectiveFaceTargetIds || [],
        negativeImageIds: effectiveNegativeImageIds,
      });
      analysisRegionsToStore = JSON.stringify(
        sanitizeAnalysisRegionsForLegacyFlow(existingRegions)
      );
    }
    const inputType = requestedInputType || existingInputType;
    const inferenceModel = requestedInferenceModel || existingInferenceModel;
    const runEvery = requestedRunEvery ?? existingRunEvery;
    const modelFps = requestedModelFps ?? existingModelFps;
    const runningResolution = requestedRunningResolution ?? existingRunningResolution;
    const executionSettings = applyInferenceExecutionConstraints(
      inputType,
      inferenceModel,
      runEvery,
      runningResolution,
      modelFps
    );
    const onlyCaptureOnMotion =
      requestedOnlyCaptureOnMotion ?? existingOnlyCaptureOnMotion;
    const temporalPlanJson = useTemporalContext
      ? (existingAgent as any)?.temporal_plan_json ?? null
      : null;
    const temporalPlanHash = useTemporalContext
      ? (existingAgent as any)?.temporal_plan_hash ?? null
      : null;
    const temporalPlanVersion = useTemporalContext
      ? (existingAgent as any)?.temporal_plan_version ?? null
      : null;
    const temporalCompiledAt = useTemporalContext
      ? (existingAgent as any)?.temporal_compiled_at ?? null
      : null;
    const temporalCompileModel = useTemporalContext
      ? (existingAgent as any)?.temporal_compile_model ?? null
      : null;
    const temporalExplainJson = useTemporalContext
      ? (existingAgent as any)?.temporal_explain_json ?? null
      : null;

    const introducingCoreModel =
      existingInferenceModel !== "core" && executionSettings.inferenceModel === "core";
    if (introducingCoreModel) {
      if (!Number.isInteger(jobId) || jobId <= 0) {
        return c.json({ error: "Invalid job reference for step" }, 400);
      }
      const activeCoreAgentsInJob = await countActiveCoreAgentsInJob(
        c.env.DB,
        user.id,
        jobId,
        Number((existingAgent as any)?.id)
      );
      if (activeCoreAgentsInJob >= 1) {
        return c.json(buildCoreModelJobLimitErrorBody(), 409);
      }

      const currentJobSchedule = await loadRecurringScheduleForJob(c.env.DB, user.id, jobId);
      if (currentJobSchedule) {
        const scheduleConflict = await findCoreScheduleConflictForCandidate(
          c.env.DB,
          user.id,
          currentJobSchedule,
          jobId
        );
        if (scheduleConflict) {
          return c.json(
            buildCoreModelScheduleConflictErrorBody(
              scheduleConflict.job_name,
              scheduleConflict.job_id
            ),
            409
          );
        }
      }
    }

    if (executionSettings.requiresOpenAiKey) {
      const userOpenAiApiKey = await getUserOpenAIApiKey(c.env.DB, user.id);
      if (!userOpenAiApiKey) {
        return c.json(buildOpenAiKeyRequiredErrorBody(), 400);
      }
    }
    if (executionSettings.requiresZAiKey) {
      const userZAiApiKey = await getUserZAIApiKey(c.env.DB, user.id);
      if (!userZAiApiKey) {
        return c.json(buildZAiKeyRequiredErrorBody(), 400);
      }
    }

    await c.env.DB.prepare(
      `UPDATE job_step_agents
       SET agent_key = ?, priority_level = ?, input_type = ?, inference_model = ?, model_fps = ?, run_every = ?, running_resolution = ?, only_capture_on_motion = ?, use_temporal_context = ?, prompt_template = ?, params = ?, input_schema = ?, alert_condition = ?, analysis_regions = ?, temporal_plan_json = ?, temporal_plan_hash = ?, temporal_plan_version = ?, temporal_compiled_at = ?, temporal_compile_model = ?, temporal_explain_json = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.agent_key,
        priorityLevel,
        executionSettings.inputType,
        executionSettings.inferenceModel,
        executionSettings.modelFps,
        executionSettings.runEvery,
        executionSettings.runningResolution,
        onlyCaptureOnMotion ? 1 : 0,
        useTemporalContext ? 1 : 0,
        storedPromptTemplate,
        body.params || null,
        body.input_schema || null,
        normalizedPromptParts.alert_condition,
        analysisRegionsToStore,
        temporalPlanJson,
        temporalPlanHash,
        temporalPlanVersion,
        temporalCompiledAt,
        temporalCompileModel,
        temporalExplainJson,
        now,
        existingAgent.id
      )
      .run();

    if (requestedFaceTargetIds !== null) {
      await c.env.DB.prepare(
        "DELETE FROM job_step_agent_face_targets WHERE agent_id = ?"
      )
        .bind(existingAgent.id)
        .run();

      if (requestedFaceTargetIds.length > 0) {
        for (const faceTargetId of requestedFaceTargetIds) {
          await c.env.DB.prepare(
            `INSERT INTO job_step_agent_face_targets (agent_id, face_target_id, created_at, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(agent_id, face_target_id) DO NOTHING`
          )
            .bind(existingAgent.id, faceTargetId, now, now)
            .run();
        }
      }
    }

    const agent = await c.env.DB.prepare(
      "SELECT * FROM job_step_agents WHERE id = ?"
    )
      .bind(existingAgent.id)
      .first();
    const faceTargetIdsByAgentId = await loadFaceTargetIdsByAgentId(c.env.DB, [
      Number(existingAgent.id),
    ]);
    const negativeImagesByAgentId = await loadNegativeReferenceImagesByAgentId(c.env.DB, [
      Number(existingAgent.id),
    ]);
    const responseUseTemporalContext = normalizeJobStepUseTemporalContext(
      (agent as any)?.use_temporal_context,
      true
    );
    const responsePromptParts = parsePromptTemplatePartsForJobStepTemporalMode(
      (agent as any)?.prompt_template,
      (agent as any)?.alert_condition,
      (agent as any)?.negative_condition,
      responseUseTemporalContext
    );
    const responseAnalysisRegionsRaw = parseStoredAnalysisRegions(
      (agent as any)?.analysis_regions,
      {
        promptParts: responsePromptParts,
        faceTargetIds: faceTargetIdsByAgentId.get(Number(existingAgent.id)) || [],
        negativeImageIds: (negativeImagesByAgentId.get(Number(existingAgent.id)) || [])
          .map((img) => Number(img?.id))
          .filter((id) => Number.isInteger(id) && id > 0),
      }
    );
    const responseAgent = {
      ...(agent as any),
      ...(() => {
        const rawInputType = normalizeJobStepInputType((agent as any)?.input_type) || "video";
        const rawInferenceModel =
          normalizeJobStepInferenceModel((agent as any)?.inference_model) ||
          FIXED_JOB_STEP_INFERENCE_MODEL;
        const rawRunEvery = normalizeJobStepRunEverySeconds(
          (agent as any)?.run_every,
          FIXED_JOB_STEP_RUN_EVERY_SECONDS
        );
        const rawRunningResolution = normalizeJobStepRunningResolution(
          (agent as any)?.running_resolution,
          DEFAULT_CORE_RUNNING_RESOLUTION
        );
        const execution = applyInferenceExecutionConstraints(
          rawInputType,
          rawInferenceModel,
          rawRunEvery,
          rawRunningResolution,
          (agent as any)?.model_fps
        );
        return {
          input_type: execution.inputType,
          inference_model: execution.inferenceModel,
          model_fps: execution.modelFps,
          run_every: execution.runEvery,
          running_resolution: execution.runningResolution,
        };
      })(),
      ...buildJobStepTemporalContextFields(
        agent,
        responseUseTemporalContext
      ),
      face_target_ids: faceTargetIdsByAgentId.get(Number(existingAgent.id)) || [],
      negative_reference_images:
        negativeImagesByAgentId.get(Number(existingAgent.id)) || [],
      prompt_template: responsePromptParts.prompt_template,
      alert_condition: responsePromptParts.alert_condition,
      negative_condition: responsePromptParts.negative_condition,
      analysis_regions: responseUseTemporalContext
        ? responseAnalysisRegionsRaw
        : sanitizeAnalysisRegionsForLegacyFlow(responseAnalysisRegionsRaw),
    };

    return c.json({ agent: responseAgent }, 200);
  }

  const inputType = requestedInputType || "video";
  const inferenceModel = requestedInferenceModel || FIXED_JOB_STEP_INFERENCE_MODEL;
  const runEvery = requestedRunEvery ?? FIXED_JOB_STEP_RUN_EVERY_SECONDS;
  const modelFps = requestedModelFps ?? DEFAULT_ULTRA_VIDEO_MODEL_FPS;
  const runningResolution = requestedRunningResolution ?? null;
  const executionSettings = applyInferenceExecutionConstraints(
    inputType,
    inferenceModel,
    runEvery,
    runningResolution,
    modelFps
  );
  if (executionSettings.inferenceModel === "core") {
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return c.json({ error: "Invalid job reference for step" }, 400);
    }
    const activeCoreAgentsInJob = await countActiveCoreAgentsInJob(
      c.env.DB,
      user.id,
      jobId
    );
    if (activeCoreAgentsInJob >= 1) {
      return c.json(buildCoreModelJobLimitErrorBody(), 409);
    }

    const currentJobSchedule = await loadRecurringScheduleForJob(c.env.DB, user.id, jobId);
    if (currentJobSchedule) {
      const scheduleConflict = await findCoreScheduleConflictForCandidate(
        c.env.DB,
        user.id,
        currentJobSchedule,
        jobId
      );
      if (scheduleConflict) {
        return c.json(
          buildCoreModelScheduleConflictErrorBody(
            scheduleConflict.job_name,
            scheduleConflict.job_id
          ),
          409
        );
      }
    }
  }
  if (executionSettings.requiresOpenAiKey) {
    const userOpenAiApiKey = await getUserOpenAIApiKey(c.env.DB, user.id);
    if (!userOpenAiApiKey) {
      return c.json(buildOpenAiKeyRequiredErrorBody(), 400);
    }
  }
  if (executionSettings.requiresZAiKey) {
    const userZAiApiKey = await getUserZAIApiKey(c.env.DB, user.id);
    if (!userZAiApiKey) {
      return c.json(buildZAiKeyRequiredErrorBody(), 400);
    }
  }
  const onlyCaptureOnMotion = requestedOnlyCaptureOnMotion ?? false;
  const useTemporalContext = requestedUseTemporalContext ?? true;
  const normalizedPromptParts = resolveNormalizedPromptParts(
    body.prompt_template,
    body.alert_condition,
    body.negative_condition,
    useTemporalContext
  );
  const storedPromptTemplate = buildPromptTemplateFromParts(normalizedPromptParts);
  const insertFaceTargetIds = requestedFaceTargetIds || [];
  let insertAnalysisRegionsJson: string | null = null;
  if (requestedAnalysisRegionsRaw !== undefined) {
    const normalizedAnalysisRegions = normalizeAnalysisRegionsInput(
      requestedAnalysisRegionsRaw,
      {
        promptParts: normalizedPromptParts,
        faceTargetIds: insertFaceTargetIds,
        negativeImageIds: [],
      }
    );
    if (normalizedAnalysisRegions.error) {
      return c.json({ error: normalizedAnalysisRegions.error }, 400);
    }
    const regionsToStore = useTemporalContext
      ? normalizedAnalysisRegions.regions
      : sanitizeAnalysisRegionsForLegacyFlow(normalizedAnalysisRegions.regions);
    insertAnalysisRegionsJson = JSON.stringify(regionsToStore);
  }
  if (isFaceIdAgent && insertFaceTargetIds.length === 0) {
    return c.json(
      { error: "FaceID agent requires at least one selected target face" },
      400
    );
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO job_step_agents (step_id, camera_id, agent_key, priority_level, input_type, inference_model, model_fps, run_every, running_resolution, only_capture_on_motion, use_temporal_context, prompt_template, params, input_schema, alert_condition, analysis_regions, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  )
    .bind(
      stepId,
      cameraId,
      body.agent_key,
      priorityLevel,
      executionSettings.inputType,
      executionSettings.inferenceModel,
      executionSettings.modelFps,
      executionSettings.runEvery,
      executionSettings.runningResolution,
      onlyCaptureOnMotion ? 1 : 0,
      useTemporalContext ? 1 : 0,
      storedPromptTemplate,
      body.params || null,
      body.input_schema || null,
      normalizedPromptParts.alert_condition,
      insertAnalysisRegionsJson,
      now,
      now
    )
    .run();

  const insertedAgentId = Number(result.meta.last_row_id || 0);
  if (
    Number.isInteger(insertedAgentId) &&
    insertedAgentId > 0 &&
    insertFaceTargetIds.length > 0
  ) {
    for (const faceTargetId of insertFaceTargetIds) {
      await c.env.DB.prepare(
        `INSERT INTO job_step_agent_face_targets (agent_id, face_target_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(agent_id, face_target_id) DO NOTHING`
      )
        .bind(insertedAgentId, faceTargetId, now, now)
        .run();
    }
  }

  const agent = await c.env.DB.prepare(
    "SELECT * FROM job_step_agents WHERE id = ?"
  )
    .bind(insertedAgentId)
    .first();
  const faceTargetIdsByAgentId = await loadFaceTargetIdsByAgentId(c.env.DB, [
    insertedAgentId,
  ]);
  const negativeImagesByAgentId = await loadNegativeReferenceImagesByAgentId(c.env.DB, [
    insertedAgentId,
  ]);
  const responseUseTemporalContext = normalizeJobStepUseTemporalContext(
    (agent as any)?.use_temporal_context,
    true
  );
  const responsePromptParts = parsePromptTemplatePartsForJobStepTemporalMode(
    (agent as any)?.prompt_template,
    (agent as any)?.alert_condition,
    (agent as any)?.negative_condition,
    responseUseTemporalContext
  );
  const responseAnalysisRegionsRaw = parseStoredAnalysisRegions((agent as any)?.analysis_regions, {
    promptParts: responsePromptParts,
    faceTargetIds: faceTargetIdsByAgentId.get(insertedAgentId) || [],
    negativeImageIds: (negativeImagesByAgentId.get(insertedAgentId) || [])
      .map((img) => Number(img?.id))
      .filter((id) => Number.isInteger(id) && id > 0),
  });
  const responseAgent = {
    ...(agent as any),
    ...(() => {
      const rawInputType = normalizeJobStepInputType((agent as any)?.input_type) || "video";
      const rawInferenceModel =
        normalizeJobStepInferenceModel((agent as any)?.inference_model) ||
        FIXED_JOB_STEP_INFERENCE_MODEL;
      const rawRunEvery = normalizeJobStepRunEverySeconds(
        (agent as any)?.run_every,
        FIXED_JOB_STEP_RUN_EVERY_SECONDS
      );
      const rawRunningResolution = normalizeJobStepRunningResolution(
        (agent as any)?.running_resolution,
        DEFAULT_CORE_RUNNING_RESOLUTION
      );
      const execution = applyInferenceExecutionConstraints(
        rawInputType,
        rawInferenceModel,
        rawRunEvery,
        rawRunningResolution,
        (agent as any)?.model_fps
      );
      return {
        input_type: execution.inputType,
        inference_model: execution.inferenceModel,
        model_fps: execution.modelFps,
        run_every: execution.runEvery,
        running_resolution: execution.runningResolution,
      };
      })(),
      ...buildJobStepTemporalContextFields(
        agent,
        responseUseTemporalContext
      ),
      face_target_ids: faceTargetIdsByAgentId.get(insertedAgentId) || [],
      negative_reference_images:
        negativeImagesByAgentId.get(insertedAgentId) || [],
      prompt_template: responsePromptParts.prompt_template,
      alert_condition: responsePromptParts.alert_condition,
      negative_condition: responsePromptParts.negative_condition,
      analysis_regions: responseUseTemporalContext
        ? responseAnalysisRegionsRaw
        : sanitizeAnalysisRegionsForLegacyFlow(responseAnalysisRegionsRaw),
  };

  return c.json({ agent: responseAgent }, 201);
});

app.post("/api/job-steps/:stepId/agents/enhance-prompt", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const stepId = parseInt(c.req.param("stepId"), 10);
  const body = await c.req
    .json<{
      camera_id?: number | string;
      prompt_template?: string;
      alert_condition?: string;
      negative_condition?: string;
      language?: string;
      analysis_regions?: unknown;
    }>()
    .catch(() => null);

  if (!body) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const cameraIdRaw =
    typeof body.camera_id === "string" ? parseInt(body.camera_id, 10) : Number(body.camera_id);
  const cameraId = Number.isInteger(cameraIdRaw) && cameraIdRaw > 0 ? cameraIdRaw : null;
  if (!cameraId) {
    return c.json({ error: "camera_id is required" }, 400);
  }

  const promptTemplate = typeof body.prompt_template === "string" ? body.prompt_template.trim() : "";
  const alertCondition = typeof body.alert_condition === "string" ? body.alert_condition.trim() : "";
  const negativeCondition =
    typeof body.negative_condition === "string" ? body.negative_condition.trim() : "";
  const languageHint = typeof body.language === "string" ? body.language.trim() : "";
  const analysisRegionsRaw = body.analysis_regions;

  if (!promptTemplate) {
    return c.json({ error: "Prompt Core is required" }, 400);
  }
  if (!alertCondition) {
    return c.json({ error: "Alert Condition is required" }, 400);
  }

  let enhanceAnalysisRegions: AnalysisRegionPayload[] = [];
  if (analysisRegionsRaw !== undefined) {
    const normalizedEnhanceRegions = normalizeAnalysisRegionsInput(
      analysisRegionsRaw,
      {
        promptParts: {
          prompt_template: promptTemplate,
          alert_condition: alertCondition,
          negative_condition: normalizeOptionalPromptText(negativeCondition),
        },
        faceTargetIds: [],
        negativeImageIds: [],
      }
    );
    if (normalizedEnhanceRegions.error) {
      return c.json({ error: normalizedEnhanceRegions.error }, 400);
    }
    enhanceAnalysisRegions = normalizedEnhanceRegions.regions;
  }

  const step = await c.env.DB.prepare(
    `SELECT js.* FROM job_steps js
     JOIN jobs j ON js.job_id = j.id
     WHERE js.id = ? AND j.user_id = ?`
  )
    .bind(stepId, user.id)
    .first();

  if (!step) {
    return c.json({ error: "Step not found" }, 404);
  }

  const targetExists = await c.env.DB.prepare(
    `SELECT 1 FROM job_step_targets WHERE step_id = ? AND camera_id = ?`
  )
    .bind(stepId, cameraId)
    .first();
  if (!targetExists) {
    return c.json({ error: "Selected camera is not a target of this step" }, 400);
  }

  const pairing = await c.env.DB.prepare(
    `SELECT *
     FROM exe_pairings
     WHERE user_id = ? AND status = 'connected'
     ORDER BY last_seen_at DESC
     LIMIT 1`
  )
    .bind(user.id)
    .first();

  if (!pairing) {
    return c.json({ error: "No EXE connected. Prompt enhancement requires the desktop agent online." }, 409);
  }

  const camera = await c.env.DB.prepare(
    `SELECT id, name, description, ip_address, rtsp_port, username, password, manufacturer,
            connection_method, webcam_index, channel, subtype
       FROM cameras
      WHERE id = ? AND user_id = ?`
  )
    .bind(cameraId, user.id)
    .first();

  if (!camera) {
    return c.json({ error: "Camera not found" }, 404);
  }

  const userOpenAiApiKey = await getUserOpenAIApiKey(c.env.DB, user.id);
  const modelApiKey = userOpenAiApiKey;
  if (!modelApiKey) {
    return c.json(buildOpenAiKeyRequiredErrorBody(), 400);
  }

  const cam = camera as any;
  const commandPayload = {
    step_id: stepId,
    camera_id: cameraId,
    camera_name: typeof cam.name === "string" ? cam.name : `Camera ${cameraId}`,
    camera_description: typeof cam.description === "string" ? cam.description : "",
    prompt_core: promptTemplate,
    alert_condition: alertCondition,
    negative_condition: negativeCondition,
    user_language: languageHint || "pt-BR",
    model_name: "gpt-5.1",
    model_api_key: modelApiKey,
    analysis_regions: enhanceAnalysisRegions,
    fallback_option: "A",
    snapshot_strategy: {
      prefer_running_session_snapshot: true,
      warmup_seconds: 6,
      target_second: 5,
      max_capture_seconds: 12,
      require_snapshot: true,
    },
    camera_payload: {
      camera_id: cameraId,
      name: typeof cam.name === "string" ? cam.name : `Camera ${cameraId}`,
      description: typeof cam.description === "string" ? cam.description : "",
      ip: normalizeCameraTransportField(cam.ip_address) ?? "",
      port: normalizeCameraTransportField(cam.rtsp_port),
      username: normalizeCameraTransportField(cam.username) ?? "",
      password: typeof cam.password === "string" ? cam.password : "",
      manufacturer: normalizeCameraTransportField(cam.manufacturer) ?? "",
      connection_method:
        normalizeCameraTransportField(cam.connection_method) ?? "",
      webcam_index:
        cam.webcam_index === null || cam.webcam_index === undefined
          ? null
          : Number(cam.webcam_index),
      channel: normalizeCameraTransportField(cam.channel),
      subtype: normalizeCameraTransportField(cam.subtype),
    },
  };

  const now = new Date().toISOString();
  const commandInsert = await c.env.DB.prepare(
    `INSERT INTO commands (user_id, camera_id, command_type, payload, status, created_at, updated_at)
     VALUES (?, ?, 'prompt_enhance', ?, 'pending', ?, ?)`
  )
    .bind(user.id, cameraId, JSON.stringify(commandPayload), now, now)
    .run();

  const commandId = Number(commandInsert.meta.last_row_id || 0);
  if (!Number.isInteger(commandId) || commandId <= 0) {
    return c.json({ error: "Failed to create enhancement command" }, 500);
  }

  return c.json({
    command_id: commandId,
    status: "pending",
  });
});

app.get(
  "/api/job-steps/:stepId/agents/enhance-prompt/:commandId",
  anyAuthMiddleware,
  async (c) => {
    const user = c.get("user")!;
    const stepId = parseInt(c.req.param("stepId"), 10);
    const commandId = parseInt(c.req.param("commandId"), 10);

    if (!Number.isInteger(commandId) || commandId <= 0) {
      return c.json({ error: "Invalid command id" }, 400);
    }

    const step = await c.env.DB.prepare(
      `SELECT js.* FROM job_steps js
       JOIN jobs j ON js.job_id = j.id
       WHERE js.id = ? AND j.user_id = ?`
    )
      .bind(stepId, user.id)
      .first();

    if (!step) {
      return c.json({ error: "Step not found" }, 404);
    }

    const command = await c.env.DB.prepare(
      `SELECT id, status, result, payload
       FROM commands
       WHERE id = ? AND user_id = ? AND command_type = 'prompt_enhance'
       LIMIT 1`
    )
      .bind(commandId, user.id)
      .first();

    if (!command) {
      return c.json({ error: "Enhancement command not found" }, 404);
    }

    const cmd = command as any;
    const status = String(cmd.status || "pending").trim().toLowerCase();

    let payloadObj: any = null;
    if (typeof cmd.payload === "string" && cmd.payload.trim()) {
      try {
        payloadObj = JSON.parse(cmd.payload);
      } catch {
        payloadObj = null;
      }
    }
    const commandStepId = Number(payloadObj?.step_id);
    if (Number.isInteger(commandStepId) && commandStepId > 0 && commandStepId !== stepId) {
      return c.json({ error: "Enhancement command not found for this step" }, 404);
    }

    let resultObj: any = null;
    if (typeof cmd.result === "string" && cmd.result.trim()) {
      try {
        resultObj = JSON.parse(cmd.result);
      } catch {
        resultObj = { error: cmd.result };
      }
    }

    if (status === "failed") {
      const errorMessage =
        typeof resultObj?.error === "string" && resultObj.error.trim()
          ? resultObj.error.trim()
          : "Prompt enhancement failed";
      return c.json({ status: "failed", error: errorMessage });
    }

    if (status === "completed") {
      const rawResult =
        resultObj && typeof resultObj === "object" && resultObj.result
          ? resultObj.result
          : resultObj;
      const suggestionSource =
        rawResult && typeof rawResult === "object" && rawResult.suggestion
          ? rawResult.suggestion
          : rawResult;

      const promptTemplate =
        typeof suggestionSource?.prompt_template === "string"
          ? suggestionSource.prompt_template.trim()
          : "";
      const alertCondition =
        typeof suggestionSource?.alert_condition === "string"
          ? suggestionSource.alert_condition.trim()
          : "";
      const negativeCondition =
        typeof suggestionSource?.negative_condition === "string"
          ? suggestionSource.negative_condition.trim()
          : "";

      if (!promptTemplate || !alertCondition) {
        return c.json({
          status: "failed",
          error: "Enhancer returned invalid prompt suggestion",
        });
      }

      return c.json({
        status: "completed",
        suggestion: {
          prompt_template: promptTemplate,
          alert_condition: alertCondition,
          negative_condition: negativeCondition,
        },
        meta: {
          model_name:
            typeof rawResult?.model_name === "string" ? rawResult.model_name : undefined,
          snapshot_source:
            typeof rawResult?.snapshot_source === "string"
              ? rawResult.snapshot_source
              : undefined,
          snapshot_ts_utc_iso:
            typeof rawResult?.snapshot_ts_utc_iso === "string"
              ? rawResult.snapshot_ts_utc_iso
              : undefined,
        },
      });
    }

    return c.json({ status: status || "pending" });
  }
);

// Job step alerts endpoints
app.get("/api/job-steps/:stepId/alerts", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const stepId = parseInt(c.req.param("stepId"), 10);

  const step = await c.env.DB.prepare(
    `SELECT js.* FROM job_steps js
     JOIN jobs j ON js.job_id = j.id
     WHERE js.id = ? AND j.user_id = ?`
  )
    .bind(stepId, user.id)
    .first();

  if (!step) {
    return c.json({ error: "Step not found" }, 404);
  }

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM job_step_alert_rules WHERE step_id = ? ORDER BY created_at DESC"
  )
    .bind(stepId)
    .all();

  return c.json({ alerts: results });
});

app.post("/api/job-steps/:stepId/alerts", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const stepId = parseInt(c.req.param("stepId"), 10);
  const body = await c.req.json<{
    condition_expr?: string;
    channel: string;
    channel_params?: string;
    message_template?: string;
  }>();

  const step = await c.env.DB.prepare(
    `SELECT js.* FROM job_steps js
     JOIN jobs j ON js.job_id = j.id
     WHERE js.id = ? AND j.user_id = ?`
  )
    .bind(stepId, user.id)
    .first();

  if (!step) {
    return c.json({ error: "Step not found" }, 404);
  }

  const now = new Date().toISOString();
  
  // Use default condition if not provided (always trigger)
  const conditionExpr = body.condition_expr || "true";

  const result = await c.env.DB.prepare(
    `INSERT INTO job_step_alert_rules (step_id, condition_expr, channel, channel_params, message_template, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      stepId,
      conditionExpr,
      body.channel,
      body.channel_params || null,
      body.message_template || null,
      now,
      now
    )
    .run();

  const alert = await c.env.DB.prepare(
    "SELECT * FROM job_step_alert_rules WHERE id = ?"
  )
    .bind(result.meta.last_row_id)
    .first();

  return c.json({ alert }, 201);
});

app.delete("/api/job-steps/:stepId/alerts/:alertId", anyAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const stepId = parseInt(c.req.param("stepId"), 10);
  const alertId = parseInt(c.req.param("alertId"), 10);

  const step = await c.env.DB.prepare(
    `SELECT js.* FROM job_steps js
     JOIN jobs j ON js.job_id = j.id
     WHERE js.id = ? AND j.user_id = ?`
  )
    .bind(stepId, user.id)
    .first();

  if (!step) {
    return c.json({ error: "Step not found" }, 404);
  }

  await c.env.DB.prepare(
    "DELETE FROM job_step_alert_rules WHERE id = ? AND step_id = ?"
  )
    .bind(alertId, stepId)
    .run();

  return c.json({ success: true });
});

// Secure HTTP endpoint to trigger scheduler tick (fallback when cron triggers unavailable)
// Accepts either scheduler secret or EXE bearer token from an active pairing.
app.post("/api/scheduler/tick", async (c) => {
  const authHeader = c.req.header("Authorization") || c.req.header("authorization");
  const exeTimezoneHeader =
    c.req.header("x-exe-timezone") || c.req.header("X-EXE-Timezone") || "";
  let providedToken = authHeader || "";
  if (providedToken.startsWith("Bearer ")) {
    providedToken = providedToken.slice(7);
  }

  const expectedSecret = c.env.SCHEDULER_TICK_SECRET || "";
  let authorized = false;
  let authMode = "none";
  let exeBearerUserId: string | null = null;
  let exeBearerClientId: string | null = null;
  let exeBearerTokenHash: string | null = null;

  if (providedToken && expectedSecret && providedToken === expectedSecret) {
    authorized = true;
    authMode = "scheduler_secret";
  } else if (providedToken) {
    try {
      const providedHash = await hashToken(providedToken);
      exeBearerTokenHash = providedHash;
      const pairing = await c.env.DB.prepare(
        `SELECT user_id, client_id FROM exe_pairings
         WHERE exe_token_hash = ? AND status = 'connected'
         LIMIT 1`
      )
        .bind(providedHash)
        .first();

      if (pairing) {
        authorized = true;
        authMode = "exe_bearer";
        exeBearerUserId = (pairing as any).user_id || null;
        exeBearerClientId = (pairing as any).client_id || null;
      }
    } catch (error) {
      console.error("[SCHEDULER TICK HTTP] EXE token validation error:", error);
    }
  }

  if (!authorized) {
    console.log("[SCHEDULER TICK HTTP] Unauthorized request - invalid or missing token");
    return c.json({ error: "Unauthorized" }, 401);
  }

  console.log(`[SCHEDULER TICK HTTP] Authorized (${authMode}), invoking scheduler tick...`);
  
  try {
    if (authMode === "exe_bearer" && exeBearerUserId) {
      await syncTimezoneFromExeSignal(c.env.DB, {
        userId: exeBearerUserId,
        clientId: exeBearerClientId,
        exeTokenHash: exeBearerTokenHash,
        timezoneInput: exeTimezoneHeader,
      });
    }

    // runJobSchedulerTick already handles:
    // - Acquiring cron lock (55 seconds) to prevent overlapping ticks
    // - Finding eligible jobs
    // - Matching schedule windows
    // - Inserting fire records (idempotent via fire_key)
    // - Starting cameras and enqueuing job_start commands
    await runJobSchedulerTick(c.env);
    await dispatchQueuedDrakonFindSearches(c.env);
    
    console.log("[SCHEDULER TICK HTTP] Scheduler tick completed successfully");
    return c.json({ 
      ok: true, 
      message: "Scheduler tick executed",
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("[SCHEDULER TICK HTTP] Scheduler tick failed:", error);
    return c.json({ 
      error: "Scheduler tick failed", 
      details: error?.message || "Unknown error" 
    }, 500);
  }
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext | any) {
    await ensureSchema(env.DB);
    return app.fetch(request, env, ctx as any);
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext | any) {
    ctx.waitUntil(
      Promise.all([runJobSchedulerTick(env), dispatchQueuedDrakonFindSearches(env)]).then(
        () => undefined
      )
    );
  },
};



