import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/react-app/components/Layout";
import ManagePlansCardsModal from "@/react-app/components/ManagePlansCardsModal";
import {
  AGENT_BILLING_PAID_PLANS,
  AGENT_BILLING_PLANS,
  FREE_AGENT_INSTANCES,
  getAgentBillingPlanFromSubscription,
  getCurrentAgentInstanceLimit,
  isLegacyCameraBillingSubscription,
  type AgentBillingPlan,
  type AgentBillingPlanId,
} from "@/react-app/utils/agentBilling";
import {
  formatBillingDate,
  formatBillingMoney,
  formatBillingPaymentAmount,
  getBillingAgentInstanceLabel,
  getBillingIncludedLabel,
  getBillingPaidSlotsLabel,
  getBillingPaymentStatusLabel,
  getBillingPlanName,
} from "@/react-app/utils/billingI18n";
import { brand } from "@/shared/brand";
import { Payment } from "@/shared/types";
import {
  ArrowRight,
  Bot,
  Camera,
  Check,
  CreditCard,
  Gauge,
  History,
  MessageSquare,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TFunction } from "i18next";

type BillingTab = "plans" | "history";
type ActiveSubscription = Record<string, unknown> | null;

const HISTORY_EMPTY_STATE_ICON_CLASS =
  "w-12 md:w-16 h-12 md:h-16 text-gray-600 mx-auto mb-4";
const IS_PERCEPTRUM_BILLING = brand.id === "perceptrum";

const PLAN_MARKETING: Record<
  AgentBillingPlanId,
  {
    eyebrowKey?: string;
    summaryKey: string;
    summaryPerceptrumKey?: string;
    bestForKey: string;
    knowledgeValueKey: string;
  }
> = {
  free: {
    summaryKey: "billing.page.plan.free.summary",
    summaryPerceptrumKey: "billing.page.plan.free.summaryPerceptrum",
    bestForKey: "billing.page.plan.free.bestFor",
    knowledgeValueKey: "billing.page.plan.free.knowledgeValue",
  },
  starter: {
    eyebrowKey: "billing.page.plan.starter.eyebrow",
    summaryKey: "billing.page.plan.starter.summary",
    bestForKey: "billing.page.plan.starter.bestFor",
    knowledgeValueKey: "billing.page.plan.starter.knowledgeValue",
  },
  growth: {
    eyebrowKey: "billing.page.plan.growth.eyebrow",
    summaryKey: "billing.page.plan.growth.summary",
    bestForKey: "billing.page.plan.growth.bestFor",
    knowledgeValueKey: "billing.page.plan.growth.knowledgeValue",
  },
  scale: {
    eyebrowKey: "billing.page.plan.scale.eyebrow",
    summaryKey: "billing.page.plan.scale.summary",
    bestForKey: "billing.page.plan.scale.bestFor",
    knowledgeValueKey: "billing.page.plan.scale.knowledgeValue",
  },
  max: {
    eyebrowKey: "billing.page.plan.max.eyebrow",
    summaryKey: "billing.page.plan.max.summary",
    bestForKey: "billing.page.plan.max.bestFor",
    knowledgeValueKey: "billing.page.plan.max.knowledgeValue",
  },
};

const INCLUDED_FEATURES: Array<{
  titleKey: string;
  titlePerceptrumKey?: string;
  descriptionKey: string;
  descriptionPerceptrumKey?: string;
  icon: LucideIcon;
  iconClassName: string;
}> = [
  {
    titleKey: "billing.page.included.feature.knowledgeSharing.title",
    descriptionKey: "billing.page.included.feature.knowledgeSharing.description",
    icon: Sparkles,
    iconClassName: "bg-cyan-500/12 text-cyan-100",
  },
  {
    titleKey: "billing.page.included.feature.unlimitedSetup.title",
    descriptionKey: "billing.page.included.feature.unlimitedSetup.description",
    icon: Camera,
    iconClassName: "bg-blue-500/12 text-blue-100",
  },
  {
    titleKey: "billing.page.included.feature.chat.title",
    titlePerceptrumKey: "billing.page.included.feature.chat.titlePerceptrum",
    descriptionKey: "billing.page.included.feature.chat.description",
    descriptionPerceptrumKey: "billing.page.included.feature.chat.descriptionPerceptrum",
    icon: MessageSquare,
    iconClassName: "bg-emerald-500/12 text-emerald-100",
  },
  {
    titleKey: "billing.page.included.feature.upgrade.title",
    descriptionKey: "billing.page.included.feature.upgrade.description",
    icon: Gauge,
    iconClassName: "bg-amber-500/12 text-amber-100",
  },
];

function getPlanEyebrow(t: TFunction, planId: AgentBillingPlanId): string {
  const key = PLAN_MARKETING[planId].eyebrowKey;
  return key ? t(key) : "";
}

function getPlanSummary(
  t: TFunction,
  planId: AgentBillingPlanId,
  isPerceptrumBilling: boolean
): string {
  const plan = PLAN_MARKETING[planId];
  return t(
    isPerceptrumBilling && plan.summaryPerceptrumKey
      ? plan.summaryPerceptrumKey
      : plan.summaryKey
  );
}

function getPlanBestFor(t: TFunction, planId: AgentBillingPlanId): string {
  return t(PLAN_MARKETING[planId].bestForKey);
}

function getPlanKnowledgeValue(t: TFunction, planId: AgentBillingPlanId): string {
  return t(PLAN_MARKETING[planId].knowledgeValueKey);
}

function getIncludedFeatureTitle(
  t: TFunction,
  feature: (typeof INCLUDED_FEATURES)[number],
  isPerceptrumBilling: boolean
): string {
  return t(
    isPerceptrumBilling && feature.titlePerceptrumKey
      ? feature.titlePerceptrumKey
      : feature.titleKey
  );
}

function getIncludedFeatureDescription(
  t: TFunction,
  feature: (typeof INCLUDED_FEATURES)[number],
  isPerceptrumBilling: boolean
): string {
  return t(
    isPerceptrumBilling && feature.descriptionPerceptrumKey
      ? feature.descriptionPerceptrumKey
      : feature.descriptionKey
  );
}

function getDisplayedPlanPrice(
  plan: AgentBillingPlan,
  t: TFunction,
  language?: string
): string {
  if (plan.monthlyPriceUsd <= 0) {
    return getBillingIncludedLabel(t);
  }

  return formatBillingMoney(plan.monthlyPriceUsd, "usd", language);
}

function getPlanSurfaceClass(planId: AgentBillingPlanId, isCurrent: boolean): string {
  if (isCurrent) {
    return "border-blue-300/35 bg-[linear-gradient(180deg,rgba(59,130,246,0.16),rgba(15,23,42,0.88))] shadow-[0_32px_90px_-60px_rgba(59,130,246,0.9)]";
  }

  if (planId === "growth") {
    return "border-emerald-300/30 bg-[linear-gradient(180deg,rgba(16,185,129,0.16),rgba(15,23,42,0.88))] shadow-[0_28px_80px_-60px_rgba(16,185,129,0.9)]";
  }

  if (planId === "starter") {
    return "border-sky-300/18 bg-sky-500/[0.05]";
  }

  if (planId === "scale") {
    return "border-amber-300/18 bg-amber-500/[0.05]";
  }

  if (planId === "max") {
    return "border-rose-300/18 bg-rose-500/[0.05]";
  }

  return "border-white/10 bg-white/[0.035]";
}

function getPlanBadgeClass(planId: AgentBillingPlanId, isCurrent: boolean): string {
  if (isCurrent) {
    return "border-blue-300/20 bg-blue-400/15 text-blue-50";
  }

  if (planId === "growth") {
    return "border-emerald-300/20 bg-emerald-400/15 text-emerald-50";
  }

  if (planId === "scale") {
    return "border-amber-300/20 bg-amber-400/15 text-amber-50";
  }

  if (planId === "max") {
    return "border-rose-300/20 bg-rose-400/15 text-rose-50";
  }

  return "border-white/10 bg-white/[0.05] text-gray-200";
}

function getPlanMetricClass(planId: AgentBillingPlanId, isCurrent: boolean): string {
  if (isCurrent) {
    return "border-blue-300/18 bg-blue-950/30";
  }

  if (planId === "growth") {
    return "border-emerald-300/18 bg-emerald-950/30";
  }

  if (planId === "scale") {
    return "border-amber-300/18 bg-amber-950/30";
  }

  if (planId === "max") {
    return "border-rose-300/18 bg-rose-950/30";
  }

  return "border-white/10 bg-black/20";
}

function getPlanCtaClass(planId: AgentBillingPlanId, isCurrent: boolean): string {
  if (isCurrent) {
    return "cursor-default bg-white/5 text-gray-400";
  }

  if (planId === "growth") {
    return "bg-emerald-500 text-white hover:bg-emerald-400";
  }

  return "bg-blue-500 text-white hover:bg-blue-400";
}

export default function Billing() {
  const { t, i18n } = useTranslation();
  const currentLanguage = i18n.resolvedLanguage || i18n.language;
  const [payments, setPayments] = useState<Payment[]>([]);
  const [configuredCameras, setConfiguredCameras] = useState(0);
  const [runningCameras, setRunningCameras] = useState(0);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [activeSubscription, setActiveSubscription] =
    useState<ActiveSubscription>(null);
  const [activeTab, setActiveTab] = useState<BillingTab>("plans");
  const [checkoutPlanId, setCheckoutPlanId] = useState<string | null>(null);

  useEffect(() => {
    void fetchPayments();
    void fetchCameraSummary();
    void fetchActiveSubscription();

    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get("session_id");

    if (sessionId) {
      void confirmStripeSession(sessionId);
    }
  }, []);

  const fetchPayments = async () => {
    try {
      const response = await fetch("/api/payments");
      const data = await response.json();
      setPayments(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to fetch payments:", error);
    }
  };

  const fetchCameraSummary = async () => {
    try {
      const response = await fetch("/api/cameras");
      const data = await response.json();
      const cameras = Array.isArray(data) ? data : [];
      setConfiguredCameras(cameras.length);
      setRunningCameras(
        cameras.filter((camera: any) => camera?.is_service_running === 1).length
      );
    } catch (error) {
      console.error("Failed to fetch camera summary:", error);
    }
  };

  const fetchActiveSubscription = async () => {
    try {
      const response = await fetch("/api/subscriptions/me");
      const data = await response.json();
      if (data && typeof data === "object") {
        setActiveSubscription(data as Record<string, unknown>);
      } else {
        setActiveSubscription(null);
      }
    } catch (error) {
      console.error("Failed to fetch active subscription:", error);
    }
  };

  const confirmStripeSession = async (sessionId: string) => {
    try {
      const response = await fetch("/api/stripe/confirm-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });

      if (!response.ok) {
        console.error("Failed to confirm session");
        return;
      }

      const data = await response.json();
      if (!data.alreadyProcessed) {
        setShowSuccessToast(true);
        setTimeout(() => setShowSuccessToast(false), 5000);
      }

      await Promise.all([
        fetchPayments(),
        fetchCameraSummary(),
        fetchActiveSubscription(),
      ]);

      const url = new URL(window.location.href);
      url.searchParams.delete("session_id");
      window.history.replaceState({}, "", url.toString());
    } catch (error) {
      console.error("Error confirming session:", error);
    }
  };

  const currentPlan = useMemo(
    () => getAgentBillingPlanFromSubscription(activeSubscription),
    [activeSubscription]
  );
  const isLegacyPlan = useMemo(
    () => isLegacyCameraBillingSubscription(activeSubscription),
    [activeSubscription]
  );
  const currentAgentLimit = useMemo(
    () => getCurrentAgentInstanceLimit(activeSubscription),
    [activeSubscription]
  );
  const currentPlanName = currentPlan
    ? getBillingPlanName(t, currentPlan.id, currentPlan.name)
    : isLegacyPlan
    ? t("billing.page.current.legacyName")
    : getBillingPlanName(t, "free", "Free");
  const currentPlanPrice = isLegacyPlan
    ? {
        primary: t("billing.page.current.legacyPrimary"),
        secondary: t("billing.page.current.legacySecondary"),
      }
    : currentPlan
    ? {
        primary: getDisplayedPlanPrice(currentPlan, t, currentLanguage),
        secondary: t("billing.page.current.secondaryBilledMonthly"),
      }
    : {
        primary: getBillingIncludedLabel(t),
        secondary: t("billing.page.current.secondaryNoCharge"),
      };
  const currentPlanSummary = isLegacyPlan
    ? t("billing.page.current.summaryLegacy")
    : currentPlan
    ? t("billing.page.current.summaryPaid", {
        countLabel: getBillingAgentInstanceLabel(t, currentPlan.totalAgentInstances),
        summary: getPlanSummary(t, currentPlan.id, IS_PERCEPTRUM_BILLING),
      })
    : IS_PERCEPTRUM_BILLING
    ? t("billing.page.current.summaryFreePerceptrum")
    : t("billing.page.current.summaryFree");
  const nextStepCopy = isLegacyPlan
    ? t("billing.page.current.nextStepLegacy")
    : currentPlan
    ? t("billing.page.current.nextStepPaid", {
        paidSlotsLabel: getBillingPaidSlotsLabel(t, currentPlan.paidAgentInstances),
      })
    : IS_PERCEPTRUM_BILLING
    ? t("billing.page.current.nextStepFreePerceptrum")
    : t("billing.page.current.nextStepFree");
  const currentBillingStats = useMemo(
    () => [
      {
        label: t("billing.page.current.stat.configuredCameras"),
        value: configuredCameras,
        icon: Camera,
        iconClassName: "bg-blue-500/15 text-blue-100",
      },
      {
        label: t("billing.page.current.stat.runtimeLimit"),
        value: currentAgentLimit,
        icon: Bot,
        iconClassName: "bg-emerald-500/15 text-emerald-100",
      },
      {
        label: t("billing.page.current.stat.runningCameras"),
        value: runningCameras,
        icon: Gauge,
        iconClassName: "bg-amber-500/15 text-amber-100",
      },
    ],
    [configuredCameras, currentAgentLimit, runningCameras, t]
  );

  const tabs: Array<{ id: BillingTab; label: string }> = [
    {
      id: "plans",
      label: t("billing.page.tabs.plans"),
    },
    {
      id: "history",
      label: t("billing.paymentHistory", { defaultValue: "Payment History" }),
    },
  ];

  const comparisonRows = useMemo(
    () => [
      {
        label: t("billing.page.compare.row.monthlyPrice"),
        getValue: (plan: AgentBillingPlan) =>
          plan.id === "free"
            ? getBillingIncludedLabel(t)
            : `${getDisplayedPlanPrice(plan, t, currentLanguage)} ${t("billing.perMonth")}`,
      },
      {
        label: t("billing.page.compare.row.parallelRuntime"),
        getValue: (plan: AgentBillingPlan) =>
          getBillingAgentInstanceLabel(t, plan.totalAgentInstances),
      },
      {
        label: t("billing.page.compare.row.paidAddon"),
        getValue: (plan: AgentBillingPlan) =>
          plan.id === "free"
            ? t("billing.page.compare.paidAddonNone")
            : getBillingPaidSlotsLabel(t, plan.paidAgentInstances),
      },
      {
        label: t("billing.page.compare.row.unlimitedSavedCameras"),
        getValue: () => getBillingIncludedLabel(t),
      },
      {
        label: t("billing.page.compare.row.unlimitedSavedAgentsJobs"),
        getValue: () => getBillingIncludedLabel(t),
      },
      {
        label: t("billing.page.compare.row.knowledgeSharingValue"),
        getValue: (plan: AgentBillingPlan) => getPlanKnowledgeValue(t, plan.id),
      },
      {
        label: t("billing.page.compare.row.chatAccess"),
        getValue: (plan: AgentBillingPlan) =>
          IS_PERCEPTRUM_BILLING
            ? plan.id === "free"
              ? t("billing.page.compare.chatAccessFreePerceptrum")
              : t("billing.page.compare.chatAccessPaidPerceptrum")
            : t("billing.page.compare.chatAccessConfiguredModel"),
      },
      {
        label: t("billing.page.compare.row.bestFit"),
        getValue: (plan: AgentBillingPlan) => getPlanBestFor(t, plan.id),
      },
    ],
    [currentLanguage, t]
  );

  const startCheckout = async (planId: string) => {
    setCheckoutPlanId(planId);

    try {
      const response = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "subscription",
          agent_plan_id: planId,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data?.url !== "string" || !data.url) {
        throw new Error(
          (typeof data?.error === "string" && data.error) ||
            t("billing.page.checkoutFailed")
        );
      }

      window.location.href = data.url;
    } catch (error) {
      console.error("Failed to start Stripe checkout:", error);
      alert(
        error instanceof Error && error.message
          ? error.message
          : t("billing.page.checkoutFailed")
      );
    } finally {
      setCheckoutPlanId(null);
    }
  };

  return (
    <Layout>
      {showSuccessToast ? (
        <div className="fixed top-4 right-4 z-50 rounded-lg bg-green-500 px-6 py-3 text-white shadow-lg animate-fade-in">
          {t("billing.page.toast.paymentSuccess")}
        </div>
      ) : null}

      <ManagePlansCardsModal
        isOpen={showManageModal}
        onClose={() => setShowManageModal(false)}
        onUpdate={() => {
          void fetchActiveSubscription();
          void fetchPayments();
        }}
      />

      <div className="max-w-[1280px] space-y-6 md:space-y-8">
        <header className="max-w-3xl">
          <div className="inline-flex items-center rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-100">
            {t("billing.page.hero.badge")}
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
            {t("billing.page.hero.title")}
          </h1>
          <p className="mt-3 text-sm leading-6 text-gray-400 md:text-[15px]">
            {IS_PERCEPTRUM_BILLING
              ? t("billing.page.hero.descriptionPerceptrum")
              : t("billing.page.hero.description")}
          </p>
        </header>

        {isLegacyPlan ? (
          <section className="rounded-3xl border border-amber-400/20 bg-amber-500/10 px-5 py-4 text-sm text-amber-100">
            <p className="font-medium">{t("billing.page.legacy.title")}</p>
            <p className="mt-1 text-amber-100/80">
              {t("billing.page.legacy.description")}
            </p>
          </section>
        ) : null}

        <div className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 shadow-[0_20px_60px_-52px_rgba(0,0,0,0.95)] backdrop-blur-sm">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={isActive}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-all duration-200 ${
                  isActive
                    ? "bg-blue-600 text-white shadow-[0_16px_40px_-20px_rgba(37,99,235,0.95)]"
                    : "text-gray-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "plans" ? (
          <>
            <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(30,64,175,0.28),rgba(10,18,38,0.96)_44%,rgba(2,6,23,0.98))] p-6 shadow-[0_40px_120px_-72px_rgba(37,99,235,0.8)] md:p-8">
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_380px]">
                <div>
                  <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-gray-200">
                    {t("billing.page.hero.panelBadge")}
                  </div>

                  <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-[2.6rem] md:leading-[1.05]">
                    {t("billing.page.hero.mainTitle")}
                  </h2>

                  <p className="mt-4 max-w-2xl text-sm leading-7 text-gray-300 md:text-[15px]">
                    {IS_PERCEPTRUM_BILLING
                      ? t("billing.page.hero.mainDescriptionPerceptrum")
                      : t("billing.page.hero.mainDescription")}
                  </p>

                  <div className="mt-6 flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-200">
                      {t("billing.page.hero.chip.freeRuntime")}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-200">
                      {t("billing.page.hero.chip.knowledgeSharing")}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-200">
                      {t("billing.page.hero.chip.unlimitedSaved")}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-200">
                      {t("billing.page.hero.chip.secureCheckout")}
                    </span>
                  </div>

                  <div className="mt-6 rounded-[28px] border border-white/10 bg-black/20 p-5 backdrop-blur-sm">
                    <p className="text-xs uppercase tracking-[0.24em] text-gray-500">
                      {t("billing.page.choosePlan.label")}
                    </p>

                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                          {t("billing.page.choosePlan.step1.title")}
                        </div>
                        <p className="mt-2 text-sm leading-6 text-gray-300">
                          {t("billing.page.choosePlan.step1.description")}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                          {t("billing.page.choosePlan.step2.title")}
                        </div>
                        <p className="mt-2 text-sm leading-6 text-gray-300">
                          {t("billing.page.choosePlan.step2.description")}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                          {t("billing.page.choosePlan.step3.title")}
                        </div>
                        <p className="mt-2 text-sm leading-6 text-gray-300">
                          {IS_PERCEPTRUM_BILLING
                            ? t("billing.page.choosePlan.step3.descriptionPerceptrum")
                            : t("billing.page.choosePlan.step3.description")}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <aside className="rounded-[30px] border border-white/10 bg-black/25 p-6 backdrop-blur-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-200">
                      {t("billing.page.current.label")}
                    </span>
                    <span className="rounded-full border border-blue-300/20 bg-blue-400/15 px-3 py-1 text-[11px] font-medium text-blue-50">
                      {currentPlanName}
                    </span>
                  </div>

                  <div className="mt-5">
                    <div className="text-3xl font-semibold tracking-tight text-white">
                      {currentPlanPrice.primary}
                      {currentPlan?.id ? (
                        <span className="ml-2 text-sm font-normal text-gray-400">
                          {t("billing.page.current.priceSuffix")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-gray-400">{currentPlanPrice.secondary}</p>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-gray-300">
                    {currentPlanSummary}
                  </p>

                  <div className="mt-5 grid gap-3 grid-cols-1 min-[560px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                    {currentBillingStats.map((stat) => {
                      const Icon = stat.icon;

                      return (
                        <div
                          key={stat.label}
                          className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                        >
                          <div
                            className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.iconClassName}`}
                          >
                            <Icon className="h-5 w-5" />
                          </div>

                          <div className="mt-4 min-w-0">
                            <div className="text-xs font-medium leading-5 text-gray-400">
                              {stat.label}
                            </div>
                            <div className="mt-2 text-2xl font-semibold tabular-nums text-white">
                              {stat.value}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] text-gray-100">
                        <ShieldCheck className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">
                          {t("billing.page.current.nextStepTitle")}
                        </div>
                        <p className="mt-1 text-sm leading-6 text-gray-400">
                          {nextStepCopy}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 border-t border-white/10 pt-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-400">
                          {t("billing.page.manage.title")}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          {t("billing.page.manage.description")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowManageModal(true)}
                        className="inline-flex min-h-[36px] items-center justify-center self-start rounded-lg px-2 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-blue-200 sm:self-auto"
                      >
                        {t("billing.managePlansCards")}
                      </button>
                    </div>
                  </div>
                </aside>
              </div>
            </section>

            <section className="space-y-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-gray-500">
                    {t("billing.page.pricing.eyebrow")}
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    {t("billing.page.pricing.title")}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
                    {t("billing.page.pricing.description")}
                  </p>
                </div>

                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-gray-300">
                  <Sparkles className="h-3.5 w-3.5 text-blue-200" />
                  {t("billing.page.pricing.hint")}
                </div>
              </div>

              <article className="overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(148,163,184,0.12),rgba(15,23,42,0.82))] p-6">
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                  <div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-200">
                      {!isLegacyPlan && !currentPlan?.id
                        ? t("billing.page.free.badgeCurrent")
                        : t("billing.page.free.badgeIncluded")}
                    </span>
                    <h3 className="mt-4 text-2xl font-semibold text-white">
                      {getBillingPlanName(t, "free", "Free")}
                    </h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-300">
                      {getPlanSummary(t, "free", IS_PERCEPTRUM_BILLING)}
                    </p>

                    <div className="mt-5 flex flex-wrap gap-2">
                      <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-gray-200">
                        {t("billing.page.free.chip.runtime")}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-gray-200">
                        {t("billing.page.free.chip.unlimitedSaved")}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-gray-200">
                        {t("billing.page.free.chip.knowledgeSharing")}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-gray-200">
                        {IS_PERCEPTRUM_BILLING
                          ? t("billing.page.free.chip.chatPerceptrum")
                          : t("billing.page.free.chip.chat")}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                        {t("billing.page.paid.metric.monthlyPrice")}
                      </div>
                      <div className="mt-2 text-xl font-semibold text-white">
                        {getBillingIncludedLabel(t)}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-gray-400">
                        {t("billing.page.free.metric.noMonthlyCharge")}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                        {t("billing.page.paid.metric.parallelRuntime")}
                      </div>
                      <div className="mt-2 text-xl font-semibold text-white">
                        {FREE_AGENT_INSTANCES}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-gray-400">
                        {getBillingAgentInstanceLabel(t, FREE_AGENT_INSTANCES)}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                        {t("billing.page.compare.row.bestFit")}
                      </div>
                      <div className="mt-2 text-sm font-medium text-white">
                        {getPlanBestFor(t, "free")}
                      </div>
                    </div>
                  </div>
                </div>
              </article>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {AGENT_BILLING_PAID_PLANS.map((plan) => {
                  const isCurrent = currentPlan?.id === plan.id;
                  const isLoadingCheckout = checkoutPlanId === plan.id;
                  const planPrice = getDisplayedPlanPrice(plan, t, currentLanguage);
                  const planName = getBillingPlanName(t, plan.id, plan.name);

                  return (
                    <article
                      key={plan.id}
                      className={`relative overflow-hidden rounded-[30px] border p-5 transition-all duration-200 ${getPlanSurfaceClass(
                        plan.id,
                        isCurrent
                      )}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                            {getPlanEyebrow(t, plan.id)}
                          </div>
                          <h3 className="mt-2 text-2xl font-semibold text-white">
                            {planName}
                          </h3>
                        </div>

                        <span
                          className={`rounded-full border px-3 py-1 text-[11px] font-medium ${getPlanBadgeClass(
                            plan.id,
                            isCurrent
                          )}`}
                        >
                          {isCurrent
                            ? t("billing.page.paid.badgeCurrent")
                            : plan.id === "growth"
                            ? t("billing.page.paid.badgeRecommended")
                            : `+${plan.paidAgentInstances}`}
                        </span>
                      </div>

                      <p className="mt-3 text-sm leading-6 text-gray-300">
                        {getPlanSummary(t, plan.id, IS_PERCEPTRUM_BILLING)}
                      </p>

                      <div className="mt-5">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                          {t("billing.page.paid.metric.monthlyPrice")}
                        </div>
                        <div className="mt-2 flex items-end gap-2">
                          <span className="text-4xl font-semibold tracking-tight text-white">
                            {planPrice}
                          </span>
                          <span className="pb-1 text-sm text-gray-400">
                            {t("billing.page.current.priceSuffix")}
                          </span>
                        </div>
                      </div>

                      <div
                        className={`mt-5 rounded-2xl border p-4 ${getPlanMetricClass(
                          plan.id,
                          isCurrent
                        )}`}
                      >
                        <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                          {t("billing.page.paid.metric.parallelRuntime")}
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-white">
                          {plan.totalAgentInstances}
                        </div>
                        <p className="mt-1 text-sm text-gray-300">
                          {getBillingAgentInstanceLabel(t, plan.totalAgentInstances)}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-gray-400">
                          {t("billing.page.paid.metric.paidSlotsSummary", {
                            paidSlotsLabel: getBillingPaidSlotsLabel(
                              t,
                              plan.paidAgentInstances
                            ),
                          })}
                        </p>
                      </div>

                      <div className="mt-5 space-y-2 text-sm text-gray-200">
                        <div className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                          <span>{t("billing.page.paid.feature.unlimitedSaved")}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                          <span>{getPlanKnowledgeValue(t, plan.id)}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                          <span>
                            {IS_PERCEPTRUM_BILLING
                              ? t("billing.page.paid.feature.availabilityPerceptrum")
                              : t("billing.page.paid.feature.availability")}
                          </span>
                        </div>
                        <div className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                          <span>{getPlanBestFor(t, plan.id)}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => void startCheckout(plan.id)}
                        disabled={isCurrent || isLoadingCheckout}
                        className={`mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors ${getPlanCtaClass(
                          plan.id,
                          isCurrent
                        )} ${isLoadingCheckout ? "opacity-70" : ""}`}
                      >
                        {isCurrent ? (
                          t("billing.page.free.badgeCurrent")
                        ) : isLoadingCheckout ? (
                          t("billing.page.paid.openingCheckout")
                        ) : (
                          <>
                            {t("billing.page.paid.choose", { plan: planName })}
                            <ArrowRight className="h-4 w-4" />
                          </>
                        )}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <article className="rounded-[30px] border border-white/10 bg-white/[0.035] p-6">
                <p className="text-xs uppercase tracking-[0.24em] text-gray-500">
                  {t("billing.page.included.eyebrow")}
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">
                  {IS_PERCEPTRUM_BILLING
                    ? t("billing.page.included.titlePerceptrum")
                    : t("billing.page.included.title")}
                </h3>

                <div className="mt-6 space-y-4">
                  {INCLUDED_FEATURES.map((feature) => {
                    const Icon = feature.icon;

                    return (
                      <div
                        key={feature.titleKey}
                        className="rounded-2xl border border-white/10 bg-black/20 p-4"
                      >
                        <div className="flex items-start gap-4">
                          <div
                            className={`flex h-11 w-11 items-center justify-center rounded-2xl ${feature.iconClassName}`}
                          >
                            <Icon className="h-5 w-5" />
                          </div>
                          <div>
                            <h4 className="text-base font-semibold text-white">
                              {getIncludedFeatureTitle(t, feature, IS_PERCEPTRUM_BILLING)}
                            </h4>
                            <p className="mt-2 text-sm leading-6 text-gray-400">
                              {getIncludedFeatureDescription(
                                t,
                                feature,
                                IS_PERCEPTRUM_BILLING
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>

              <article className="rounded-[30px] border border-white/10 bg-white/[0.035] p-6">
                <p className="text-xs uppercase tracking-[0.24em] text-gray-500">
                  {t("billing.page.capacity.eyebrow")}
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">
                  {t("billing.page.capacity.title")}
                </h3>

                <div className="mt-6 space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                      {t("billing.page.capacity.free.title")}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-gray-300">
                      {t("billing.page.capacity.free.description")}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-emerald-300/15 bg-emerald-500/[0.06] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-100/80">
                      {t("billing.page.capacity.starterGrowth.title")}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-gray-200">
                      {t("billing.page.capacity.starterGrowth.description")}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                      {t("billing.page.capacity.scaleMax.title")}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-gray-300">
                      {t("billing.page.capacity.scaleMax.description")}
                    </p>
                  </div>
                </div>
              </article>
            </section>

            <section className="rounded-[32px] border border-white/10 bg-white/[0.035] p-6 backdrop-blur-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-gray-500">
                    {t("billing.page.compare.eyebrow")}
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">
                    {t("billing.page.compare.title")}
                  </h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
                    {t("billing.page.compare.description")}
                  </p>
                </div>
              </div>

              <div className="mt-6 overflow-x-auto">
                <table className="min-w-[1040px] w-full border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 border-b border-white/10 bg-[#0b1220] px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                        {t("billing.page.compare.metricHeader")}
                      </th>
                      {AGENT_BILLING_PLANS.map((plan) => {
                        const isCurrent = currentPlan?.id === plan.id;
                        const price = getDisplayedPlanPrice(plan, t, currentLanguage);
                        const planName = getBillingPlanName(t, plan.id, plan.name);

                        return (
                          <th
                            key={plan.id}
                            className={`border-b border-white/10 px-4 py-4 text-left ${
                              plan.id === "growth"
                                ? "bg-emerald-500/[0.08]"
                                : "bg-[#0b1220]"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-base font-semibold text-white">
                                {planName}
                              </span>
                              {isCurrent ? (
                                <span className="rounded-full border border-blue-300/20 bg-blue-400/15 px-2.5 py-1 text-[11px] font-medium text-blue-50">
                                  {t("billing.page.paid.badgeCurrent")}
                                </span>
                              ) : plan.id === "growth" ? (
                                <span className="rounded-full border border-emerald-300/20 bg-emerald-400/15 px-2.5 py-1 text-[11px] font-medium text-emerald-50">
                                  {t("billing.page.paid.badgeRecommended")}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-sm text-gray-400">
                              {plan.id === "free" ? getBillingIncludedLabel(t) : price}
                            </p>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>

                  <tbody>
                    {comparisonRows.map((row, rowIndex) => (
                      <tr key={row.label}>
                        <td
                          className={`sticky left-0 z-10 border-b border-white/10 bg-[#0b1220] px-4 py-4 align-top text-sm font-medium text-gray-200 ${
                            rowIndex === comparisonRows.length - 1
                              ? "border-b-0"
                              : ""
                          }`}
                        >
                          {row.label}
                        </td>

                        {AGENT_BILLING_PLANS.map((plan) => (
                          <td
                            key={`${row.label}-${plan.id}`}
                            className={`border-b border-white/10 px-4 py-4 align-top text-sm leading-6 text-gray-300 ${
                              rowIndex === comparisonRows.length - 1
                                ? "border-b-0"
                                : ""
                            } ${plan.id === "growth" ? "bg-emerald-500/[0.04]" : ""}`}
                          >
                            {row.getValue(plan)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <section>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.04] text-gray-200">
                <History className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-100">
                  {t("billing.paymentHistory", { defaultValue: "Payment History" })}
                </h2>
                <p className="text-sm text-gray-400">
                  {t("billing.page.history.description")}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] backdrop-blur-sm">
              {payments.length === 0 ? (
                <div className="py-14 text-center md:py-16">
                  <CreditCard className={HISTORY_EMPTY_STATE_ICON_CLASS} />
                  <p className="text-sm text-gray-500">
                    {t("billing.noPaymentHistory", {
                      defaultValue: "No payment history yet.",
                    })}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-white/10">
                  {payments.map((payment) => (
                    <div
                      key={payment.id}
                      className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:p-6"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.04] text-gray-300">
                          <CreditCard className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-100">
                            {payment.description || t("billing.page.paymentFallback")}
                          </p>
                          <p className="text-sm text-gray-500">
                            {formatBillingDate(payment.created_at, currentLanguage)}
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="font-semibold text-gray-100">
                          {formatBillingPaymentAmount(
                            payment.amount,
                            payment.currency,
                            currentLanguage
                          )}
                        </p>
                        <p className="text-xs capitalize text-emerald-400">
                          {getBillingPaymentStatusLabel(t, payment.status)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </Layout>
  );
}
