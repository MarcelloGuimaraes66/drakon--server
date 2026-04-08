import { Camera, Clock3, Fingerprint, MapPin, ScanFace, Shapes } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatIdentityCardMetadata } from "@/react-app/utils/chatUtils";

type Props = {
  cards: ChatIdentityCardMetadata[];
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

  const contextPortrait = card.context_portrait;
  if (
    contextPortrait &&
    typeof contextPortrait === "object" &&
    typeof contextPortrait.image_url === "string" &&
    contextPortrait.image_url.trim()
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

function getDescription(card: ChatIdentityCardMetadata): string {
  if (typeof card.description === "string" && card.description.trim()) {
    return card.description.trim();
  }
  if (
    card.resolved_identity &&
    typeof card.resolved_identity === "object" &&
    typeof card.resolved_identity.target_description === "string" &&
    card.resolved_identity.target_description.trim()
  ) {
    return card.resolved_identity.target_description.trim();
  }
  return "";
}

function getIdentitySignatureSummary(card: ChatIdentityCardMetadata): string {
  if (
    typeof card.identity_signature_summary === "string" &&
    card.identity_signature_summary.trim()
  ) {
    return card.identity_signature_summary.trim();
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
  const primary = normalizeStringArray(card.identity_signature_traits, 4);
  const secondary = normalizeStringArray(card.key_traits, 3);
  const stable = normalizeStringArray(card.stable_attributes, 3);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const group of [primary, secondary, stable]) {
    for (const item of group) {
      if (seen.has(item)) {
        continue;
      }
      seen.add(item);
      merged.push(item);
      if (merged.length >= 8) {
        return merged;
      }
    }
  }
  return merged;
}

function collectFeatureHighlights(card: ChatIdentityCardMetadata): string[] {
  const seen = new Set<string>();
  const highlights: string[] = [];

  const append = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const dedupe = trimmed.toLocaleLowerCase();
    if (seen.has(dedupe)) {
      return;
    }
    seen.add(dedupe);
    highlights.push(trimmed);
  };

  if (Array.isArray(card.identity_feature_candidates)) {
    card.identity_feature_candidates.forEach((item) => {
      if (!item || typeof item !== "object") {
        return;
      }
      append(item.text);
    });
  }

  normalizeStringArray(card.identity_context_traits, 4).forEach(append);

  if (highlights.length > 6) {
    return highlights.slice(0, 6);
  }
  return highlights;
}

export default function ChatIdentityCardsPanel({ cards }: Props) {
  const { i18n } = useTranslation();
  if (!Array.isArray(cards) || cards.length === 0) {
    return null;
  }

  const locale = i18n.resolvedLanguage || i18n.language || "en";
  const isPt = locale.trim().toLowerCase().startsWith("pt");

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
          const displayName = getDisplayName(card);
          const description = getDescription(card);
          const identitySummary = getIdentitySignatureSummary(card);
          const portraitUrl = getPortraitUrl(card);
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

          return (
            <div
              key={typeof card.card_id === "string" && card.card_id.trim() ? card.card_id : `${displayName}-${index}`}
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
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
