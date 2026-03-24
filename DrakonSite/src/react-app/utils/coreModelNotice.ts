export type CoreModelNoticeCopy = {
  title: string;
  message: string;
};

type SupportedLocale = "en" | "es" | "fr" | "pt";

const CORE_MODEL_NOTICE_COPY: Record<SupportedLocale, CoreModelNoticeCopy> = {
  en: {
    title: "Core model selected",
    message: "Core is free, so it can only be used in one instance at a time.",
  },
  es: {
    title: "Modelo Core seleccionado",
    message: "Core es gratuito, asi que solo puede usarse en una instancia a la vez.",
  },
  fr: {
    title: "Modele Core selectionne",
    message: "Core est gratuit, donc il ne peut etre utilise que sur une seule instance a la fois.",
  },
  pt: {
    title: "Modelo Core selecionado",
    message: "O Core e gratuito, entao ele so pode ser usado em uma instancia por vez.",
  },
};

const normalizeModelName = (value: string | null | undefined): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export function shouldShowCoreModelNotice(
  nextModel: string | null | undefined,
  previousModel: string | null | undefined
): boolean {
  return normalizeModelName(nextModel) === "core" && normalizeModelName(previousModel) !== "core";
}

export function getCoreModelNoticeCopy(locale: string | null | undefined): CoreModelNoticeCopy {
  const normalizedLocale = typeof locale === "string" ? locale.trim().toLowerCase() : "";

  if (normalizedLocale.startsWith("pt")) return CORE_MODEL_NOTICE_COPY.pt;
  if (normalizedLocale.startsWith("es")) return CORE_MODEL_NOTICE_COPY.es;
  if (normalizedLocale.startsWith("fr")) return CORE_MODEL_NOTICE_COPY.fr;

  return CORE_MODEL_NOTICE_COPY.en;
}
