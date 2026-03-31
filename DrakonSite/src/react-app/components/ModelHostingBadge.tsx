type HostedModelTier = "ultra" | "ultra_plus" | "light" | "core";

type HostingMeta = {
  flag: string;
  location: string;
  title: string;
};

const MODEL_HOSTING_META: Record<HostedModelTier, HostingMeta> = {
  ultra: {
    flag: "🌐",
    location: "Global",
    title:
      "Ultra uses GPT-5.1 via OpenAI's default api.openai.com endpoint. This app does not pin Brazil, Latin America, the US, or another regional residency endpoint.",
  },
  ultra_plus: {
    flag: "🌐",
    location: "Global",
    title:
      "Ultra+ uses GPT-5.4 via OpenAI's default api.openai.com endpoint. This app does not pin Brazil, Latin America, the US, or another regional residency endpoint.",
  },
  light: {
    flag: "🌐",
    location: "Global",
    title:
      "Light uses GPT-5.4-mini via OpenAI's default api.openai.com endpoint. This app does not pin Brazil, Latin America, the US, or another regional residency endpoint.",
  },
  core: {
    flag: "🇸🇬",
    location: "Singapore",
    title:
      "Core uses GLM-4.6V-Flash via Z.ai. Z.ai states that all Z.ai services are based in Singapore.",
  },
};

export function getModelHostingMeta(modelTier: string | null | undefined): HostingMeta | null {
  if (typeof modelTier !== "string") return null;

  const normalizedTier = modelTier.trim().toLowerCase();
  if (
    normalizedTier !== "ultra" &&
    normalizedTier !== "ultra_plus" &&
    normalizedTier !== "light" &&
    normalizedTier !== "core"
  ) {
    return null;
  }

  return MODEL_HOSTING_META[normalizedTier as HostedModelTier];
}

type ModelHostingBadgeProps = {
  modelTier: string | null | undefined;
  compact?: boolean;
  className?: string;
};

export default function ModelHostingBadge({
  modelTier,
  compact = false,
  className = "",
}: ModelHostingBadgeProps) {
  const meta = getModelHostingMeta(modelTier);
  if (!meta) return null;

  const sizeClasses = compact ? "px-2 py-1 text-[11px]" : "px-2.5 py-1 text-xs";
  const classes =
    `inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/[0.08] ` +
    `bg-white/[0.04] text-gray-300 ${sizeClasses} ${className}`.trim();

  return (
    <span className={classes} title={meta.title} aria-label={`${meta.location}. ${meta.title}`}>
      <span aria-hidden="true" className="text-sm leading-none">
        {meta.flag}
      </span>
      <span className="leading-none">{meta.location}</span>
    </span>
  );
}
