import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/react-app/components/Layout";
import ManagePlansCardsModal from "@/react-app/components/ManagePlansCardsModal";
import {
  AGENT_BILLING_PAID_PLANS,
  AGENT_BILLING_PLANS,
  FREE_AGENT_INSTANCES,
  formatAgentInstanceLabel,
  getAgentBillingPlanFromSubscription,
  getCurrentAgentInstanceLimit,
  isLegacyCameraBillingSubscription,
  type AgentBillingPlan,
  type AgentBillingPlanId,
} from "@/react-app/utils/agentBilling";
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

type BillingTab = "plans" | "history";
type ActiveSubscription = Record<string, unknown> | null;

const HISTORY_EMPTY_STATE_ICON_CLASS =
  "w-12 md:w-16 h-12 md:h-16 text-gray-600 mx-auto mb-4";
const IS_PERCEPTRUM_BILLING = brand.id === "perceptrum";

const PLAN_MARKETING: Record<
  AgentBillingPlanId,
  {
    eyebrow: string;
    summary: string;
    bestFor: string;
    knowledgeValue: string;
  }
> = {
  free: {
    eyebrow: "Included baseline",
    summary: IS_PERCEPTRUM_BILLING
      ? "Save unlimited cameras, agents, jobs and steps. Free is best for proving one live viewpoint before Knowledge Sharing spans multiple cameras, and new accounts get 30 days of chat."
      : "Save unlimited cameras, agents, jobs and steps. Free is best for proving one live viewpoint before Knowledge Sharing spans multiple cameras.",
    bestFor: "Single-camera setup, validation and low-volume operations.",
    knowledgeValue:
      "One live viewpoint at a time before cameras start building richer shared context.",
  },
  starter: {
    eyebrow: "Knowledge Sharing entry",
    summary:
      "The first paid plan that turns multiple cameras into one shared live analysis brain.",
    bestFor: "Homes, stores and small teams that want cross-camera awareness fast.",
    knowledgeValue:
      "Multiple cameras start sharing live analysis like one operational brain.",
  },
  growth: {
    eyebrow: "Recommended",
    summary:
      "Balanced capacity for a stronger Knowledge Sharing layer across recurring multi-camera workflows and daily operations.",
    bestFor: "Businesses that need shared live context across several areas or shifts.",
    knowledgeValue:
      "Recurring areas and shifts can feed the same shared live context in real time.",
  },
  scale: {
    eyebrow: "Multi-site",
    summary:
      "Extend the shared real-time brain across larger sites, denser schedules and distributed deployments.",
    bestFor: "Factories, campuses and operators spanning many cameras or locations.",
    knowledgeValue:
      "Larger sites and distributed cameras can stay aligned through one live knowledge layer.",
  },
  max: {
    eyebrow: "High density",
    summary:
      "Keep a large Knowledge Sharing network online when many cameras and agents must collaborate continuously.",
    bestFor: "Heavy production fleets with constant parallel execution.",
    knowledgeValue:
      "Dense fleets can maintain a large always-on shared intelligence layer.",
  },
};

const INCLUDED_FEATURES: Array<{
  title: string;
  description: string;
  icon: LucideIcon;
  iconClassName: string;
}> = [
  {
    title: "Knowledge Sharing turns cameras into one live brain",
    description:
      "Paid runtime lets multiple agents run at once, so cameras can reuse each other's analysis in real time instead of acting like isolated feeds.",
    icon: Sparkles,
    iconClassName: "bg-cyan-500/12 text-cyan-100",
  },
  {
    title: "Unlimited setup stays unlocked",
    description:
      "Every plan keeps unlimited saved cameras, agents, jobs and steps. Licensing only changes what can run at the same time.",
    icon: Camera,
    iconClassName: "bg-blue-500/12 text-blue-100",
  },
  {
    title: IS_PERCEPTRUM_BILLING ? "Chat trial and unlock path" : "Chat stays available",
    description:
      IS_PERCEPTRUM_BILLING
        ? "Perceptrum includes 30 days of chat on new accounts. Buying any paid plan permanently unlocks chat, and users still need a valid API key for the selected model."
        : "Chat is not tied to token packs or licenses. Users only need a valid API key for the selected model.",
    icon: MessageSquare,
    iconClassName: "bg-emerald-500/12 text-emerald-100",
  },
  {
    title: "Upgrade only when concurrency grows",
    description:
      "Choose plans by how much shared live coverage you need, not by how many cameras you created or which model you selected.",
    icon: Gauge,
    iconClassName: "bg-amber-500/12 text-amber-100",
  },
];

function formatMoney(amount: number, currency = "usd", locale?: string): string {
  const normalizedCurrency = currency.toUpperCase();
  const resolvedLocale =
    locale || (normalizedCurrency === "BRL" ? "pt-BR" : "en-US");

  return new Intl.NumberFormat(resolvedLocale, {
    style: "currency",
    currency: normalizedCurrency,
  }).format(amount);
}

function formatUsd(amount: number): string {
  return formatMoney(amount, "usd", "en-US");
}

function formatPaymentAmount(amount: number, currency: string): string {
  return formatMoney(amount / 100, currency);
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getDisplayedPlanPrice(plan: AgentBillingPlan): string {
  if (plan.monthlyPriceUsd <= 0) {
    return "Included";
  }

  return formatUsd(plan.monthlyPriceUsd);
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
  const { t } = useTranslation();
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
  const currentPlanName = currentPlan?.name || (isLegacyPlan ? "Legacy" : "Free");
  const currentPlanPrice = isLegacyPlan
    ? { primary: "Legacy plan", secondary: "Camera-based billing structure" }
    : currentPlan
    ? { primary: getDisplayedPlanPrice(currentPlan), secondary: "Billed monthly in USD" }
    : { primary: "Included", secondary: "No monthly charge" };
  const currentPlanSummary = isLegacyPlan
    ? "This account still uses the previous camera-based subscription and should be migrated to the new agent-instance catalog."
    : currentPlan
    ? `${formatAgentInstanceLabel(currentPlan.totalAgentInstances)} can run in parallel on this account. ${currentPlan.description}`
    : IS_PERCEPTRUM_BILLING
    ? "The free plan includes 1 running agent instance with unlimited saved cameras, agents, jobs and steps, plus 30 days of chat. Upgrade when you want Knowledge Sharing across multiple live cameras and a permanent chat unlock."
    : "The free plan includes 1 running agent instance with unlimited saved cameras, agents, jobs and steps. Upgrade when you want Knowledge Sharing across multiple live cameras.";
  const nextStepCopy = isLegacyPlan
    ? "Keep this account on the legacy billing path until the Stripe migration is complete."
    : currentPlan
    ? `This account already includes +${currentPlan.paidAgentInstances} paid runtime slots on top of the free base instance, so more cameras can contribute to the same shared live context.`
    : IS_PERCEPTRUM_BILLING
    ? "Stay on Free if one live camera is enough today. Upgrade when you want Knowledge Sharing across multiple cameras, or when chat matters beyond the first 30 days."
    : "Stay on Free if one live camera is enough today, or upgrade when you want multiple cameras contributing to the same real-time operating brain.";
  const currentBillingStats = useMemo(
    () => [
      {
        label: "Configured cameras",
        value: configuredCameras,
        icon: Camera,
        iconClassName: "bg-blue-500/15 text-blue-100",
      },
      {
        label: "Runtime limit",
        value: currentAgentLimit,
        icon: Bot,
        iconClassName: "bg-emerald-500/15 text-emerald-100",
      },
      {
        label: "Running cameras",
        value: runningCameras,
        icon: Gauge,
        iconClassName: "bg-amber-500/15 text-amber-100",
      },
    ],
    [configuredCameras, currentAgentLimit, runningCameras]
  );

  const tabs: Array<{ id: BillingTab; label: string }> = [
    {
      id: "plans",
      label: "Plans",
    },
    {
      id: "history",
      label: t("billing.paymentHistory", { defaultValue: "Payment History" }),
    },
  ];

  const comparisonRows = useMemo(
    () => [
      {
        label: "Monthly price",
        getValue: (plan: AgentBillingPlan) =>
          plan.id === "free" ? "Included" : `${getDisplayedPlanPrice(plan)} / month`,
      },
      {
        label: "Parallel runtime",
        getValue: (plan: AgentBillingPlan) =>
          formatAgentInstanceLabel(plan.totalAgentInstances),
      },
      {
        label: "Paid add-on",
        getValue: (plan: AgentBillingPlan) =>
          plan.id === "free" ? "0 paid slots" : `+${plan.paidAgentInstances} paid slots`,
      },
      {
        label: "Unlimited saved cameras",
        getValue: () => "Included",
      },
      {
        label: "Unlimited saved agents and jobs",
        getValue: () => "Included",
      },
      {
        label: "Knowledge Sharing value",
        getValue: (plan: AgentBillingPlan) => PLAN_MARKETING[plan.id].knowledgeValue,
      },
      {
        label: "Chat access",
        getValue: (plan: AgentBillingPlan) =>
          IS_PERCEPTRUM_BILLING
            ? plan.id === "free"
              ? "30 days free, then unlock with any paid plan"
              : "Unlocked with a configured model key"
            : "Included with a configured model key",
      },
      {
        label: "Best fit",
        getValue: (plan: AgentBillingPlan) => PLAN_MARKETING[plan.id].bestFor,
      },
    ],
    []
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
            "Failed to create Stripe checkout session"
        );
      }

      window.location.href = data.url;
    } catch (error) {
      console.error("Failed to start Stripe checkout:", error);
      alert(
        error instanceof Error && error.message
          ? error.message
          : "Failed to start Stripe checkout"
      );
    } finally {
      setCheckoutPlanId(null);
    }
  };

  return (
    <Layout>
      {showSuccessToast ? (
        <div className="fixed top-4 right-4 z-50 rounded-lg bg-green-500 px-6 py-3 text-white shadow-lg animate-fade-in">
          Payment successful! Your account has been updated.
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
            Monthly subscriptions by agent runtime
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Billing
          </h1>
          <p className="mt-3 text-sm leading-6 text-gray-400 md:text-[15px]">
            Parallel runtime is what makes Knowledge Sharing valuable: more live
            agents can connect more cameras into one real-time analysis brain.
          </p>
        </header>

        {isLegacyPlan ? (
          <section className="rounded-3xl border border-amber-400/20 bg-amber-500/10 px-5 py-4 text-sm text-amber-100">
            <p className="font-medium">Legacy billing detected.</p>
            <p className="mt-1 text-amber-100/80">
              This subscription still uses the previous camera and model structure.
              Keep it on the migration path before enabling self-serve plan changes.
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
                    No token packs. No camera fees.
                  </div>

                  <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-[2.6rem] md:leading-[1.05]">
                    Turn many cameras into one shared real-time analysis brain.
                  </h2>

                  <p className="mt-4 max-w-2xl text-sm leading-7 text-gray-300 md:text-[15px]">
                    {IS_PERCEPTRUM_BILLING
                      ? "Create as many cameras, agents, jobs and steps as you want. Paid runtime makes Knowledge Sharing live, so agents running on different cameras can share analysis in real time across a home, company, factory or shopping environment. Any paid plan also keeps chat unlocked after the first 30 days."
                      : "Create as many cameras, agents, jobs and steps as you want. Paid runtime makes Knowledge Sharing live, so agents running on different cameras can share analysis in real time across a home, company, factory or shopping environment."}
                  </p>

                  <div className="mt-6 flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-200">
                      1 free runtime slot is always included
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-200">
                      Knowledge Sharing across multiple live cameras
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-200">
                      Unlimited saved cameras and agents
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-200">
                      Secure Stripe checkout
                    </span>
                  </div>

                  <div className="mt-6 rounded-[28px] border border-white/10 bg-black/20 p-5 backdrop-blur-sm">
                    <p className="text-xs uppercase tracking-[0.24em] text-gray-500">
                      How to choose the right plan
                    </p>

                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                          1. Map the environment
                        </div>
                        <p className="mt-2 text-sm leading-6 text-gray-300">
                          Connect as many cameras, agents, jobs and steps as the
                          environment needs, from a home or store to a factory
                          or mall.
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                          2. Build the shared brain
                        </div>
                        <p className="mt-2 text-sm leading-6 text-gray-300">
                          The moment more than one agent can run, Knowledge
                          Sharing stops being isolated analysis and becomes one
                          live operational context across cameras.
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                          3. Buy the parallelism that keeps it live
                        </div>
                        <p className="mt-2 text-sm leading-6 text-gray-300">
                          {IS_PERCEPTRUM_BILLING
                            ? "Free covers one live agent. Starter is the first paid step into cross-camera intelligence, and any paid plan keeps chat unlocked after 30 days."
                            : "Free covers one live agent. Starter is the first paid step into cross-camera intelligence, and higher tiers expand that same shared brain."}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <aside className="rounded-[30px] border border-white/10 bg-black/25 p-6 backdrop-blur-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-200">
                      Current billing
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
                          / month
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
                          What this means today
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
                          Need to update cards or manage this subscription?
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          Open billing management for saved cards, cancellation
                          and current plan details.
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
                    Pricing plans
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    Choose how much shared live intelligence you want available
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
                    Free is your baseline. Paid plans add the parallel slots
                    that let Knowledge Sharing connect more cameras into one
                    real-time brain.
                  </p>
                </div>

                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-gray-300">
                  <Sparkles className="h-3.5 w-3.5 text-blue-200" />
                  Starter is the entry to Knowledge Sharing. Growth is best for active teams.
                </div>
              </div>

              <article className="overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(148,163,184,0.12),rgba(15,23,42,0.82))] p-6">
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                  <div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-200">
                      {!isLegacyPlan && !currentPlan?.id ? "Current plan" : "Still included"}
                    </span>
                    <h3 className="mt-4 text-2xl font-semibold text-white">Free</h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-300">
                      {PLAN_MARKETING.free.summary}
                    </p>

                    <div className="mt-5 flex flex-wrap gap-2">
                      <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-gray-200">
                        1 running agent instance
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-gray-200">
                        Unlimited saved cameras and agents
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-gray-200">
                        Knowledge Sharing grows with more runtime
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-gray-200">
                        {IS_PERCEPTRUM_BILLING
                          ? "30-day chat access with model API key"
                          : "Chat available with model API key"}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                        Monthly price
                      </div>
                      <div className="mt-2 text-xl font-semibold text-white">Included</div>
                      <p className="mt-1 text-xs leading-5 text-gray-400">
                        No monthly charge.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                        Runtime
                      </div>
                      <div className="mt-2 text-xl font-semibold text-white">
                        {FREE_AGENT_INSTANCES}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-gray-400">
                        {formatAgentInstanceLabel(FREE_AGENT_INSTANCES)}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                        Best fit
                      </div>
                      <div className="mt-2 text-sm font-medium text-white">
                        {PLAN_MARKETING.free.bestFor}
                      </div>
                    </div>
                  </div>
                </div>
              </article>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {AGENT_BILLING_PAID_PLANS.map((plan) => {
                  const isCurrent = currentPlan?.id === plan.id;
                  const isLoadingCheckout = checkoutPlanId === plan.id;
                  const planPrice = getDisplayedPlanPrice(plan);

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
                            {PLAN_MARKETING[plan.id].eyebrow}
                          </div>
                          <h3 className="mt-2 text-2xl font-semibold text-white">
                            {plan.name}
                          </h3>
                        </div>

                        <span
                          className={`rounded-full border px-3 py-1 text-[11px] font-medium ${getPlanBadgeClass(
                            plan.id,
                            isCurrent
                          )}`}
                        >
                          {isCurrent
                            ? "Current"
                            : plan.id === "growth"
                            ? "Recommended"
                            : `+${plan.paidAgentInstances}`}
                        </span>
                      </div>

                      <p className="mt-3 text-sm leading-6 text-gray-300">
                        {PLAN_MARKETING[plan.id].summary}
                      </p>

                      <div className="mt-5">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                          Monthly price
                        </div>
                        <div className="mt-2 flex items-end gap-2">
                          <span className="text-4xl font-semibold tracking-tight text-white">
                            {planPrice}
                          </span>
                          <span className="pb-1 text-sm text-gray-400">/ month</span>
                        </div>
                      </div>

                      <div
                        className={`mt-5 rounded-2xl border p-4 ${getPlanMetricClass(
                          plan.id,
                          isCurrent
                        )}`}
                      >
                        <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                          Parallel runtime
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-white">
                          {plan.totalAgentInstances}
                        </div>
                        <p className="mt-1 text-sm text-gray-300">
                          {formatAgentInstanceLabel(plan.totalAgentInstances)}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-gray-400">
                          Includes +{plan.paidAgentInstances} paid runtime slots
                          plus the free base instance.
                        </p>
                      </div>

                      <div className="mt-5 space-y-2 text-sm text-gray-200">
                        <div className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                          <span>Unlimited cameras and saved agents</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                          <span>{PLAN_MARKETING[plan.id].knowledgeValue}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                          <span>
                            {IS_PERCEPTRUM_BILLING
                              ? "Jobs and steps stay available, and chat stays unlocked"
                              : "Jobs, steps and chat stay available"}
                          </span>
                        </div>
                        <div className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                          <span>{PLAN_MARKETING[plan.id].bestFor}</span>
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
                          "Current plan"
                        ) : isLoadingCheckout ? (
                          "Opening checkout..."
                        ) : (
                          <>
                            Choose {plan.name}
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
                  Included on every plan
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">
                  {IS_PERCEPTRUM_BILLING
                    ? "Most of the product stays unlocked across plans"
                    : "The upgrade changes concurrency, not product access"}
                </h3>

                <div className="mt-6 space-y-4">
                  {INCLUDED_FEATURES.map((feature) => {
                    const Icon = feature.icon;

                    return (
                      <div
                        key={feature.title}
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
                              {feature.title}
                            </h4>
                            <p className="mt-2 text-sm leading-6 text-gray-400">
                              {feature.description}
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
                  Capacity examples
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">
                  Think in shared live context, not isolated feeds
                </h3>

                <div className="mt-6 space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                      Free
                    </div>
                    <p className="mt-2 text-sm leading-6 text-gray-300">
                      One agent can run at a time on one camera. It is enough
                      for testing, setup and low-volume usage, but it does not
                      create the richer Knowledge Sharing loop that comes from
                      multiple live viewpoints.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-emerald-300/15 bg-emerald-500/[0.06] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-100/80">
                      Starter to Growth
                    </div>
                    <p className="mt-2 text-sm leading-6 text-gray-200">
                      This is where a home, company, factory or shopping
                      environment starts acting like one central brain.
                      Multiple cameras can run agents in parallel and share
                      analysis in real time through Knowledge Sharing.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                      Scale to Max
                    </div>
                    <p className="mt-2 text-sm leading-6 text-gray-300">
                      These tiers are better when that shared brain has to stay
                      alive across bigger footprints, many zones, heavier
                      schedules and multi-site operations.
                    </p>
                  </div>
                </div>
              </article>
            </section>

            <section className="rounded-[32px] border border-white/10 bg-white/[0.035] p-6 backdrop-blur-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-gray-500">
                    Compare plans
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">
                    Only one thing scales: how much shared live intelligence you can run
                  </h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
                    This comparison is designed to make the buying decision fast:
                    the product surface stays the same, and the real difference
                    is how much Knowledge Sharing headroom you have as you move
                    up.
                  </p>
                </div>
              </div>

              <div className="mt-6 overflow-x-auto">
                <table className="min-w-[1040px] w-full border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 border-b border-white/10 bg-[#0b1220] px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                        Metric
                      </th>
                      {AGENT_BILLING_PLANS.map((plan) => {
                        const isCurrent = currentPlan?.id === plan.id;
                        const price = getDisplayedPlanPrice(plan);

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
                                {plan.name}
                              </span>
                              {isCurrent ? (
                                <span className="rounded-full border border-blue-300/20 bg-blue-400/15 px-2.5 py-1 text-[11px] font-medium text-blue-50">
                                  Current
                                </span>
                              ) : plan.id === "growth" ? (
                                <span className="rounded-full border border-emerald-300/20 bg-emerald-400/15 px-2.5 py-1 text-[11px] font-medium text-emerald-50">
                                  Recommended
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-sm text-gray-400">
                              {plan.id === "free" ? "Included" : price}
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
                  Past charges remain visible here, including legacy purchases.
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
                            {payment.description || "Payment"}
                          </p>
                          <p className="text-sm text-gray-500">
                            {formatDate(payment.created_at)}
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="font-semibold text-gray-100">
                          {formatPaymentAmount(payment.amount, payment.currency)}
                        </p>
                        <p className="text-xs capitalize text-emerald-400">
                          {payment.status}
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
