import { useState } from "react";
import { Camera, Clock3, Fingerprint, Loader2, MapPin, PencilLine, Save, ScanFace, Shapes, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UpdateIdentityCardOptions } from "@/react-app/hooks/usePerceptrumChatSession";
import type { ChatIdentityCardMetadata } from "@/react-app/utils/chatUtils";

type Props = {
  cards: ChatIdentityCardMetadata[];
  busy?: boolean;
  onUpdateIdentityCard?: (input: UpdateIdentityCardOptions) => Promise<void>;
};

function normalizeStringArray(raw: unknown, maxItems: number): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    values.push(trimmed);
    if (values.length >= maxItems) {
      break;
    }
  }
  return values;
}

const IDENTITY_SCENE_CUES = [
  "background",
  "scene",
  "room",
  "office",
  "kitchen",
  "bedroom",
  "garage",
  "door",
  "window",
  "wall",
  "desk",
  "table",
  "chair",
  "cabinet",
  "wardrobe",
  "closet",
  "computer",
  "notebook",
  "keyboard",
  "monitor",
  "ambiente",
  "fundo",
  "cozinha",
  "porta",
  "janela",
  "parede",
  "mesa",
  "cadeira",
  "armario",
  "escritorio",
  "quarto",
  "sala",
];

const IDENTITY_POSE_CUES = [
  "sitting",
  "seated",
  "standing",
  "walking",
  "running",
  "typing",
  "working",
  "using ",
  "holding ",
  "carrying ",
  "in front of",
  "next to",
  "sentado",
  "sentada",
  "em pe",
  "andando",
  "correndo",
  "digitando",
  "usando ",
  "segurando ",
  "carregando ",
  "frente a",
  "ao lado",
  "perto de",
];

const IDENTITY_PERSON_INTRINSIC_CUES = [
  "skin",
  "skin tone",
  "light skin",
  "dark skin",
  "fair skin",
  "brown skin",
  "pele",
  "tom de pele",
  "hair",
  "cabelo",
  "beard",
  "mustache",
  "moustache",
  "barba",
  "bigode",
  "tattoo",
  "tatu",
  "scar",
  "cicatriz",
  "bald",
  "careca",
  "calvo",
  "build",
  "body build",
  "body type",
  "porte fisico",
  "slim",
  "thin",
  "heavyset",
  "stocky",
  "magro",
  "gordo",
  "stubble",
  "barba curta",
  "barba baixa",
  "barba por fazer",
  "short beard",
  "light beard",
  "jawline",
  "nose",
  "eyebrow",
  "sobrancelha",
  "nariz",
];

const IDENTITY_PERSON_SECONDARY_CUES = [
  "hat",
  "cap",
  "beanie",
  "helmet",
  "glasses",
  "goggles",
  "mask",
  "bracelet",
  "watch",
  "necklace",
  "ring",
  "earring",
  "bone",
  "chapeu",
  "oculos",
  "brinco",
  "pulseira",
  "colar",
  "anel",
];

const IDENTITY_PERSON_DISCARDED_CUES = [
  "shirt",
  "t-shirt",
  "tshirt",
  "camisa",
  "camiseta",
  "blouse",
  "jacket",
  "hoodie",
  "coat",
  "pants",
  "jeans",
  "shorts",
  "bermuda",
  "dress",
  "skirt",
  "shoe",
  "sneaker",
  "boot",
  "backpack",
  "shoulder bag",
  "purse",
  "bag",
  "weapon",
  "gun",
  "pistol",
  "rifle",
  "knife",
  "machete",
  "firearm",
  "mochila",
  "bolsa",
  "arma",
  "roupa",
  "tenis",
  "calcado",
];

function foldIdentityCardText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  try {
    return value
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function identityTextHasCue(text: string, cues: string[]): boolean {
  return cues.some((cue) => text.includes(cue));
}

function normalizeIdentityEntityType(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isIdentitySceneLikeText(value: unknown): boolean {
  const text = foldIdentityCardText(value);
  return !!text && identityTextHasCue(text, IDENTITY_SCENE_CUES);
}

function isIdentityPoseLikeText(value: unknown): boolean {
  const text = foldIdentityCardText(value);
  return !!text && identityTextHasCue(text, IDENTITY_POSE_CUES);
}

function classifyIdentityTraitPriority(entityTypeInput: unknown, value: unknown): number {
  const text = foldIdentityCardText(value);
  if (!text || isIdentitySceneLikeText(text) || isIdentityPoseLikeText(text)) {
    return 0;
  }

  const entityType = normalizeIdentityEntityType(entityTypeInput);
  const personLike =
    entityType.includes("person") ||
    entityType.includes("people") ||
    entityType.includes("human") ||
    entityType.includes("man") ||
    entityType.includes("woman");
  const vehicleLike =
    entityType.includes("vehicle") ||
    entityType.includes("car") ||
    entityType.includes("truck") ||
    entityType.includes("suv") ||
    entityType.includes("van") ||
    entityType.includes("bus") ||
    entityType.includes("plate");

  if (vehicleLike) {
    return identityTextHasCue(text, ["plate", "placa", "dent", "scratch", "rack", "headlight", "taillight"])
      ? 3
      : 0;
  }

  if (personLike) {
    if (identityTextHasCue(text, IDENTITY_PERSON_DISCARDED_CUES)) {
      return 0;
    }
    if (identityTextHasCue(text, IDENTITY_PERSON_INTRINSIC_CUES)) {
      return 3;
    }
    if (identityTextHasCue(text, IDENTITY_PERSON_SECONDARY_CUES)) {
      return 2;
    }
    if (identityTextHasCue(text, ["adult", "male", "female", "homem", "mulher", "person", "pessoa", "face", "rosto"])) {
      return 1;
    }
    return 0;
  }

  return identityTextHasCue(text, ["box", "package", "bottle", "cup", "phone", "bag", "backpack", "caixa", "pacote", "garrafa", "copo", "celular", "bolsa", "mochila"]) ? 2 : 0;
}

function sanitizeIdentityTraitsForDisplay(card: ChatIdentityCardMetadata, maxItems = 8): string[] {
  const entityType = normalizeIdentityEntityType(card.entity_type);
  const seen = new Set<string>();
  const accepted: Array<{ priority: number; value: string; order: number }> = [];
  let order = 0;
  for (const value of [
    ...normalizeStringArray(card.identity_signature_traits, 12),
    ...normalizeStringArray(card.key_traits, 12),
    ...normalizeStringArray(card.stable_attributes, 12),
  ]) {
    const dedupeKey = foldIdentityCardText(value);
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue;
    }
    const priority = classifyIdentityTraitPriority(entityType, value);
    if (priority <= 0) {
      continue;
    }
    seen.add(dedupeKey);
    accepted.push({ priority, value, order: order++ });
  }
  return accepted
    .sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.order - b.order;
    })
    .slice(0, maxItems)
    .map((item) => item.value);
}

function sanitizeIdentityDescriptionForDisplay(card: ChatIdentityCardMetadata, value: unknown): string {
  const description = typeof value === "string" ? value.trim() : "";
  if (!description || isIdentitySceneLikeText(description) || isIdentityPoseLikeText(description)) {
    return "";
  }
  const signatureKey = sanitizeIdentityTraitsForDisplay(card, 4).join("; ").toLowerCase();
  if (signatureKey && description.toLowerCase() === signatureKey) {
    return "";
  }
  return description;
}

function isAllowedFeatureCandidateForDisplay(
  card: ChatIdentityCardMetadata,
  candidate: Record<string, unknown>
): boolean {
  const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
  if (!text) {
    return false;
  }
  const category = typeof candidate.category === "string" ? candidate.category.trim().toLowerCase() : "";
  const relation =
    typeof candidate.relation_to_target === "string"
      ? candidate.relation_to_target.trim().toLowerCase()
      : "";
  if (
    category === "scene" ||
    category === "nearby_object" ||
    category === "pose_or_activity" ||
    relation === "background_scene" ||
    relation === "detached_near_target" ||
    relation === "pose_or_activity" ||
    relation === "visibility_condition" ||
    relation === "continuity_context"
  ) {
    return false;
  }
  return classifyIdentityTraitPriority(card.entity_type, text) > 0;
}

function getPortraitUrl(card: ChatIdentityCardMetadata): string {
  if (typeof card.portrait_url === "string" && card.portrait_url.trim()) {
    return card.portrait_url.trim();
  }

  const primaryPortrait = card.primary_portrait;
  if (
    primaryPortrait &&
    typeof primaryPortrait === "object" &&
    typeof primaryPortrait.image_url === "string" &&
    primaryPortrait.image_url.trim()
  ) {
    return primaryPortrait.image_url.trim();
  }
  if (
    primaryPortrait &&
    typeof primaryPortrait === "object" &&
    typeof primaryPortrait.image_data_url === "string" &&
    primaryPortrait.image_data_url.trim()
  ) {
    return primaryPortrait.image_data_url.trim();
  }

  const contextPortrait = card.context_portrait;
  if (
    contextPortrait &&
    typeof contextPortrait === "object" &&
    typeof contextPortrait.image_url === "string" &&
    contextPortrait.image_url.trim()
  ) {
    return contextPortrait.image_url.trim();
  }
  if (
    contextPortrait &&
    typeof contextPortrait === "object" &&
    typeof contextPortrait.image_data_url === "string" &&
    contextPortrait.image_data_url.trim()
  ) {
    return contextPortrait.image_data_url.trim();
  }

  return "";
}

function getPortraitDataUrl(card: ChatIdentityCardMetadata): string {
  const directPortrait = typeof card.portrait_url === "string" ? card.portrait_url.trim() : "";
  if (directPortrait.startsWith("data:image/")) {
    return directPortrait;
  }

  const primaryPortrait = card.primary_portrait;
  if (
    primaryPortrait &&
    typeof primaryPortrait === "object" &&
    typeof primaryPortrait.image_data_url === "string" &&
    primaryPortrait.image_data_url.trim().startsWith("data:image/")
  ) {
    return primaryPortrait.image_data_url.trim();
  }
  if (
    primaryPortrait &&
    typeof primaryPortrait === "object" &&
    typeof primaryPortrait.image_url === "string" &&
    primaryPortrait.image_url.trim().startsWith("data:image/")
  ) {
    return primaryPortrait.image_url.trim();
  }

  const contextPortrait = card.context_portrait;
  if (
    contextPortrait &&
    typeof contextPortrait === "object" &&
    typeof contextPortrait.image_data_url === "string" &&
    contextPortrait.image_data_url.trim().startsWith("data:image/")
  ) {
    return contextPortrait.image_data_url.trim();
  }
  if (
    contextPortrait &&
    typeof contextPortrait === "object" &&
    typeof contextPortrait.image_url === "string" &&
    contextPortrait.image_url.trim().startsWith("data:image/")
  ) {
    return contextPortrait.image_url.trim();
  }

  return "";
}

function getDisplayName(card: ChatIdentityCardMetadata): string {
  if (typeof card.display_name === "string" && card.display_name.trim()) {
    return card.display_name.trim();
  }
  if (typeof card.known_name === "string" && card.known_name.trim()) {
    return card.known_name.trim();
  }
  if (
    card.resolved_identity &&
    typeof card.resolved_identity === "object" &&
    typeof card.resolved_identity.target_name === "string" &&
    card.resolved_identity.target_name.trim()
  ) {
    return card.resolved_identity.target_name.trim();
  }
  if (typeof card.entity_id === "string" && card.entity_id.trim()) {
    return card.entity_id.trim();
  }
  return "entity";
}

function getEditableName(card: ChatIdentityCardMetadata): string {
  const entityId = typeof card.entity_id === "string" ? card.entity_id.trim() : "";
  const candidates = [
    typeof card.known_name === "string" ? card.known_name.trim() : "",
    card.resolved_identity &&
    typeof card.resolved_identity === "object" &&
    typeof card.resolved_identity.target_name === "string"
      ? card.resolved_identity.target_name.trim()
      : "",
    typeof card.display_name === "string" && card.display_name.trim() !== entityId
      ? card.display_name.trim()
      : "",
  ];
  return candidates.find(Boolean) || "";
}

function getDescription(card: ChatIdentityCardMetadata): string {
  const directDescription = sanitizeIdentityDescriptionForDisplay(card, card.description);
  if (directDescription) {
    return directDescription;
  }
  if (
    card.resolved_identity &&
    typeof card.resolved_identity === "object" &&
    typeof card.resolved_identity.target_description === "string" &&
    card.resolved_identity.target_description.trim()
  ) {
    return sanitizeIdentityDescriptionForDisplay(card, card.resolved_identity.target_description);
  }
  return "";
}

function getIdentitySignatureSummary(card: ChatIdentityCardMetadata, isPt: boolean): string {
  if (
    typeof card.identity_signature_summary === "string" &&
    card.identity_signature_summary.trim() &&
    !isIdentitySceneLikeText(card.identity_signature_summary) &&
    !isIdentityPoseLikeText(card.identity_signature_summary)
  ) {
    return card.identity_signature_summary.trim();
  }
  const traits = sanitizeIdentityTraitsForDisplay(card, 5);
  if (traits.length > 0) {
    return isPt
      ? `Assinatura de identidade: ${traits.join("; ")}`
      : `Identity signature: ${traits.join("; ")}`;
  }
  return "";
}

function formatEntityType(entityType: unknown, isPt: boolean): string {
  const normalized = typeof entityType === "string" ? entityType.trim().toLowerCase() : "";
  switch (normalized) {
    case "person":
    case "people":
    case "human":
      return isPt ? "Pessoa" : "Person";
    case "vehicle":
      return isPt ? "Veiculo" : "Vehicle";
    case "animal":
      return isPt ? "Animal" : "Animal";
    case "object":
      return isPt ? "Objeto" : "Object";
    default:
      return normalized ? normalized : isPt ? "Entidade" : "Entity";
  }
}

function formatLastSeenTimestamp(raw: unknown, locale: string): string {
  if (typeof raw !== "string" || !raw.trim()) {
    return "";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  return parsed.toLocaleString(locale || undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function collectTraitBadges(card: ChatIdentityCardMetadata): string[] {
  return sanitizeIdentityTraitsForDisplay(card, 8);
}

function collectFeatureHighlights(card: ChatIdentityCardMetadata): string[] {
  const seen = new Set<string>();
  const highlights: string[] = [];
  const badgeSet = new Set(
    sanitizeIdentityTraitsForDisplay(card, 8).map((item) => foldIdentityCardText(item))
  );

  const append = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const dedupe = trimmed.toLocaleLowerCase();
    if (seen.has(dedupe) || badgeSet.has(foldIdentityCardText(trimmed))) {
      return;
    }
    seen.add(dedupe);
    highlights.push(trimmed);
  };

  if (Array.isArray(card.identity_feature_candidates)) {
    card.identity_feature_candidates.forEach((item) => {
      if (!item || typeof item !== "object" || !isAllowedFeatureCandidateForDisplay(card, item as Record<string, unknown>)) {
        return;
      }
      append(item.text);
    });
  }

  if (highlights.length > 6) {
    return highlights.slice(0, 6);
  }
  return highlights;
}

function buildEditableTraitDraft(card: ChatIdentityCardMetadata): string {
  const traits = sanitizeIdentityTraitsForDisplay(card, 8);
  if (traits.length > 0) {
    return traits.join("\n");
  }
  return "";
}

function normalizeTraitDraft(text: string): string[] {
  const parts = text
    .split(/[\r\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const traits: string[] = [];
  for (const part of parts) {
    const dedupeKey = part.toLocaleLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    traits.push(part.slice(0, 160));
    if (traits.length >= 12) {
      break;
    }
  }
  return traits;
}

function isPersonCard(card: ChatIdentityCardMetadata): boolean {
  const entityType = typeof card.entity_type === "string" ? card.entity_type.trim().toLowerCase() : "";
  return entityType === "person" || entityType === "people" || entityType === "human";
}

function cardIdentityKey(card: ChatIdentityCardMetadata, index: number): string {
  if (typeof card.card_id === "string" && card.card_id.trim()) {
    return card.card_id.trim();
  }
  if (typeof card.entity_id === "string" && card.entity_id.trim()) {
    return card.entity_id.trim();
  }
  return `identity-card-${index}`;
}

export default function ChatIdentityCardsPanel({ cards, busy = false, onUpdateIdentityCard }: Props) {
  const { i18n } = useTranslation();
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftTraits, setDraftTraits] = useState("");
  const [saveAsFaceTarget, setSaveAsFaceTarget] = useState(false);
  const [formError, setFormError] = useState("");
  const [submittingCardId, setSubmittingCardId] = useState<string | null>(null);

  if (!Array.isArray(cards) || cards.length === 0) {
    return null;
  }

  const locale = i18n.resolvedLanguage || i18n.language || "en";
  const isPt = locale.trim().toLowerCase().startsWith("pt");

  const startEditing = (card: ChatIdentityCardMetadata, cardKey: string) => {
    setEditingCardId(cardKey);
    setDraftName(getEditableName(card));
    setDraftTraits(buildEditableTraitDraft(card));
    setSaveAsFaceTarget(false);
    setFormError("");
  };

  const stopEditing = () => {
    setEditingCardId(null);
    setDraftName("");
    setDraftTraits("");
    setSaveAsFaceTarget(false);
    setFormError("");
  };

  return (
    <div className="rounded-[24px] border border-white/[0.08] bg-white/[0.04] p-4 shadow-[0_22px_64px_-42px_rgba(0,0,0,0.88)] backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">
            {cards.length > 1
              ? isPt
                ? "Cards de identidade"
                : "Identity cards"
              : isPt
                ? "Card de identidade"
                : "Identity card"}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {isPt
              ? "Memoria visual e identidade preservadas nesta conversa."
              : "Visual memory and identity state preserved in this conversation."}
          </p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-400/10 text-cyan-100">
          <ScanFace className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {cards.map((card, index) => {
          const cardKey = cardIdentityKey(card, index);
          const displayName = getDisplayName(card);
          const description = getDescription(card);
          const identitySummary = getIdentitySignatureSummary(card, isPt);
          const portraitUrl = getPortraitUrl(card);
          const portraitDataUrl = getPortraitDataUrl(card);
          const entityTypeLabel = formatEntityType(card.entity_type, isPt);
          const traitBadges = collectTraitBadges(card);
          const featureHighlights = collectFeatureHighlights(card);
          const lastSeen = card.last_seen && typeof card.last_seen === "object" ? card.last_seen : undefined;
          const lastSeenTime = formatLastSeenTimestamp(lastSeen?.timestamp_utc_iso, locale);
          const lastSeenCamera =
            typeof lastSeen?.camera_name === "string" && lastSeen.camera_name.trim()
              ? lastSeen.camera_name.trim()
              : "";
          const lastSeenZone =
            typeof lastSeen?.zone === "string" && lastSeen.zone.trim() ? lastSeen.zone.trim() : "";
          const isFacePortrait =
            !!card.face_available ||
            (
              card.primary_portrait &&
              typeof card.primary_portrait === "object" &&
              typeof card.primary_portrait.portrait_kind === "string" &&
              card.primary_portrait.portrait_kind.toLowerCase() === "face"
            );
          const canSaveReusableFaceTarget = isPersonCard(card) && !!portraitDataUrl;
          const isEditing = editingCardId === cardKey;
          const isSubmitting = submittingCardId === cardKey;
          const canSubmit = !busy && !isSubmitting && !!onUpdateIdentityCard;
          const entityId = typeof card.entity_id === "string" ? card.entity_id.trim() : "";
          const hasHumanName = !!getEditableName(card) || (!!displayName && displayName !== entityId);
          const editButtonLabel =
            hasHumanName
              ? isPt
                ? "Editar identidade"
                : "Edit identity"
              : isPt
                ? "Adicionar nome"
                : "Add name";

          return (
            <div
              key={cardKey}
              className="rounded-[22px] border border-white/[0.07] bg-black/10 p-4"
            >
              <div className="flex flex-col gap-4 md:flex-row">
                <div className="flex-shrink-0">
                  {portraitUrl ? (
                    <img
                      src={portraitUrl}
                      alt={displayName}
                      className="h-24 w-24 rounded-2xl border border-white/[0.08] object-cover shadow-md md:h-28 md:w-28"
                    />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.03] text-gray-500 md:h-28 md:w-28">
                      <ScanFace className="h-8 w-8" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-white">{displayName}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-200">
                          <Shapes className="h-3.5 w-3.5" />
                          {entityTypeLabel}
                        </span>
                        {typeof card.entity_id === "string" && card.entity_id.trim() ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-blue-300/15 bg-blue-400/10 px-2.5 py-1 text-[11px] font-medium text-blue-100">
                            <Fingerprint className="h-3.5 w-3.5" />
                            {card.entity_id.trim()}
                          </span>
                        ) : null}
                        {isFacePortrait ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-100">
                            <ScanFace className="h-3.5 w-3.5" />
                            {isPt ? "Rosto" : "Face"}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {onUpdateIdentityCard ? (
                      <button
                        type="button"
                        onClick={() => (isEditing ? stopEditing() : startEditing(card, cardKey))}
                        disabled={busy && !isEditing}
                        className="inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-400/10 px-3 py-1.5 text-xs font-medium text-cyan-50 transition hover:border-cyan-200/25 hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isEditing ? <X className="h-3.5 w-3.5" /> : <PencilLine className="h-3.5 w-3.5" />}
                        {isEditing
                          ? isPt
                            ? "Fechar edicao"
                            : "Close editor"
                          : editButtonLabel}
                      </button>
                    ) : null}
                  </div>

                  {description ? (
                    <p className="mt-3 text-sm leading-6 text-slate-200">{description}</p>
                  ) : null}

                  {identitySummary && identitySummary !== description ? (
                    <p className="mt-3 text-sm leading-6 text-slate-300">{identitySummary}</p>
                  ) : null}

                  {traitBadges.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {traitBadges.map((trait) => (
                        <span
                          key={trait}
                          className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] text-gray-200"
                        >
                          {trait}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {featureHighlights.length > 0 ? (
                    <div className="mt-4">
                      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">
                        {isPt ? "Caracteristicas observadas" : "Observed characteristics"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {featureHighlights.map((feature) => (
                          <span
                            key={feature}
                            className="rounded-full border border-cyan-300/15 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-50"
                          >
                            {feature}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {(lastSeenTime || lastSeenCamera || lastSeenZone) ? (
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-gray-400">
                      {lastSeenTime ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Clock3 className="h-3.5 w-3.5" />
                          {lastSeenTime}
                        </span>
                      ) : null}
                      {lastSeenCamera ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Camera className="h-3.5 w-3.5" />
                          {lastSeenCamera}
                        </span>
                      ) : null}
                      {lastSeenZone ? (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5" />
                          {lastSeenZone}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {isEditing ? (
                    <div className="mt-4 rounded-[20px] border border-cyan-300/10 bg-slate-950/35 p-4">
                      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.4fr)]">
                        <label className="block">
                          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">
                            {isPt ? "De um nome" : "Give it a name"}
                          </span>
                          <input
                            type="text"
                            value={draftName}
                            onChange={(event) => setDraftName(event.target.value)}
                            disabled={!canSubmit}
                            placeholder={isPt ? "Ex.: Mochila azul" : "e.g. Blue backpack"}
                            className="mt-2 w-full rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">
                            {isPt ? "Traits fisicas" : "Physical traits"}
                          </span>
                          <textarea
                            rows={4}
                            value={draftTraits}
                            onChange={(event) => setDraftTraits(event.target.value)}
                            disabled={!canSubmit}
                            placeholder={
                              isPt
                                ? "cor da pele, cor/tipo/tamanho do cabelo, barba, tatuagem, porte fisico"
                                : "skin tone, hair color/type/length, beard, tattoos, body build"
                            }
                            className="mt-2 w-full rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm leading-6 text-white outline-none transition placeholder:text-gray-500 focus:border-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        </label>
                      </div>

                      <p className="mt-3 text-xs leading-5 text-gray-400">
                        {isPt
                          ? "Priorize pele, cabelo, barba, tatuagem, cicatriz e porte fisico. Evite roupa, pose e ambiente."
                          : "Prioritize skin, hair, beard, tattoos, scars, and build. Avoid clothing, pose, and environment."}
                      </p>

                      {canSaveReusableFaceTarget ? (
                        <label className="mt-3 flex items-start gap-3 rounded-2xl border border-emerald-300/10 bg-emerald-400/5 px-3 py-3 text-sm text-emerald-50">
                          <input
                            type="checkbox"
                            checked={saveAsFaceTarget}
                            onChange={(event) => setSaveAsFaceTarget(event.target.checked)}
                            disabled={!canSubmit}
                            className="mt-0.5 h-4 w-4 rounded border-white/20 bg-transparent text-emerald-400"
                          />
                          <span>
                            {isPt
                              ? "Salvar ou atualizar esse crop de rosto como target facial reutilizavel."
                              : "Save or update this face crop as a reusable face target."}
                          </span>
                        </label>
                      ) : null}

                      {formError ? (
                        <p className="mt-3 text-sm text-rose-300">{formError}</p>
                      ) : null}

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={!canSubmit}
                          onClick={() => {
                            if (!onUpdateIdentityCard) {
                              return;
                            }
                            const physicalTraits = normalizeTraitDraft(draftTraits);
                            const cleanedName = draftName.trim();
                            setFormError("");
                            setSubmittingCardId(cardKey);
                            void onUpdateIdentityCard({
                              entity_id: typeof card.entity_id === "string" ? card.entity_id.trim() : "",
                              entity_type:
                                typeof card.entity_type === "string" ? card.entity_type.trim() : undefined,
                              target_name: cleanedName || undefined,
                              physical_traits: physicalTraits,
                              save_as_face_target: saveAsFaceTarget,
                              portrait_data_url: portraitDataUrl || null,
                              card_snapshot: card as Record<string, unknown>,
                            })
                              .then(() => {
                                stopEditing();
                              })
                              .catch((error) => {
                                const message =
                                  error instanceof Error && error.message.trim()
                                    ? error.message.trim()
                                    : isPt
                                      ? "Nao consegui atualizar esse card de identidade."
                                      : "I couldn't update this identity card.";
                                setFormError(message);
                              })
                              .finally(() => {
                                setSubmittingCardId((current) => (current === cardKey ? null : current));
                              });
                          }}
                          className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-400/40 disabled:text-slate-900/60"
                        >
                          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          {isSubmitting
                            ? isPt
                              ? "Atualizando..."
                              : "Updating..."
                            : isPt
                              ? "Atualizar card"
                              : "Update card"}
                        </button>
                        <button
                          type="button"
                          onClick={stopEditing}
                          disabled={isSubmitting}
                          className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <X className="h-4 w-4" />
                          {isPt ? "Cancelar" : "Cancel"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
