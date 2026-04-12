import type { TFunction } from "i18next";
import type { AgentBillingPlanId } from "@/react-app/utils/agentBilling";

const LANGUAGE_TO_LOCALE: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  pt: "pt-BR",
  fr: "fr-FR",
  zh: "zh-CN",
  ar: "ar-EG",
};

const PAYMENT_STATUS_KEYS = {
  paid: "billing.statusValue.paid",
  pending: "billing.statusValue.pending",
  processing: "billing.statusValue.processing",
  succeeded: "billing.statusValue.succeeded",
  failed: "billing.statusValue.failed",
  canceled: "billing.statusValue.canceled",
  cancelled: "billing.statusValue.cancelled",
  refunded: "billing.statusValue.refunded",
} as const;

export function getBillingLocale(language?: string): string {
  const normalized = String(language || "en").trim().toLowerCase();
  const baseLanguage = normalized.split("-")[0];
  return LANGUAGE_TO_LOCALE[baseLanguage] || language || "en-US";
}

export function formatBillingMoney(
  amount: number,
  currency = "usd",
  language?: string
): string {
  return new Intl.NumberFormat(getBillingLocale(language), {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount);
}

export function formatBillingPaymentAmount(
  amount: number,
  currency: string,
  language?: string
): string {
  return formatBillingMoney(amount / 100, currency, language);
}

export function formatBillingDate(dateString: string, language?: string): string {
  return new Date(dateString).toLocaleDateString(getBillingLocale(language), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function getBillingIncludedLabel(t: TFunction): string {
  return t("billing.included", { defaultValue: "Included" });
}

export function getBillingPlanName(
  t: TFunction,
  planId: AgentBillingPlanId,
  fallback?: string
): string {
  return t(`billing.plan.${planId}.name`, {
    defaultValue: fallback || planId,
  });
}

export function getBillingAgentInstanceLabel(t: TFunction, count: number): string {
  return t(
    count === 1 ? "billing.agentInstanceCount.one" : "billing.agentInstanceCount.other",
    {
      count,
      defaultValue: count === 1 ? `${count} agent instance` : `${count} agent instances`,
    }
  );
}

export function getBillingPaidSlotsLabel(t: TFunction, count: number): string {
  return t(count === 1 ? "billing.paidSlotsCount.one" : "billing.paidSlotsCount.other", {
    count,
    defaultValue: count === 1 ? `+${count} paid slot` : `+${count} paid slots`,
  });
}

export function getBillingPaymentStatusLabel(t: TFunction, status: string): string {
  const normalized = status.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const translationKey =
    PAYMENT_STATUS_KEYS[normalized as keyof typeof PAYMENT_STATUS_KEYS];

  return translationKey
    ? t(translationKey, { defaultValue: status })
    : status;
}
