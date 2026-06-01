export const FREE_AGENT_INSTANCES = 1;

export const AGENT_BILLING_PAID_PLAN_IDS = [
  "starter",
  "growth",
  "scale",
  "max",
] as const;

export type PaidAgentBillingPlanId = (typeof AGENT_BILLING_PAID_PLAN_IDS)[number];
export type AgentBillingPlanId = "free" | PaidAgentBillingPlanId;

export interface AgentBillingPlan {
  id: AgentBillingPlanId;
  name: string;
  monthlyPriceUsd: number;
  monthlyPriceBrl: number;
  paidAgentInstances: number;
  totalAgentInstances: number;
  headline: string;
  description: string;
  stripePriceId: string | null;
}

const freePlan: AgentBillingPlan = {
  id: "free",
  name: "Free",
  monthlyPriceUsd: 0,
  monthlyPriceBrl: 0,
  paidAgentInstances: 0,
  totalAgentInstances: FREE_AGENT_INSTANCES,
  headline: "1 live agent instance included",
  description:
    "Unlimited cameras, saved agents, jobs and steps. Free is best for one live viewpoint at a time before Knowledge Sharing spans multiple cameras.",
  stripePriceId: null,
};

export const AGENT_BILLING_PAID_PLANS: AgentBillingPlan[] = [
  {
    id: "starter",
    name: "Starter",
    monthlyPriceUsd: 4.99,
    monthlyPriceBrl: 24.9,
    paidAgentInstances: 4,
    totalAgentInstances: FREE_AGENT_INSTANCES + 4,
    headline: "Adds 4 paid agent instances for Knowledge Sharing",
    description:
      "Run up to 5 agents in parallel and turn multiple cameras into one shared live analysis layer.",
    stripePriceId: "price_1TKjpr3n54CFNceJx2lAWlte",
  },
  {
    id: "growth",
    name: "Growth",
    monthlyPriceUsd: 17.99,
    monthlyPriceBrl: 89.9,
    paidAgentInstances: 16,
    totalAgentInstances: FREE_AGENT_INSTANCES + 16,
    headline: "Adds 16 paid agent instances for broader shared context",
    description:
      "Run up to 17 agents in parallel for a stronger Knowledge Sharing layer across recurring multi-camera workflows.",
    stripePriceId: "price_1TKjtJ3n54CFNceJiojpYY9e",
  },
  {
    id: "scale",
    name: "Scale",
    monthlyPriceUsd: 31.99,
    monthlyPriceBrl: 159.9,
    paidAgentInstances: 32,
    totalAgentInstances: FREE_AGENT_INSTANCES + 32,
    headline: "Adds 32 paid agent instances across larger footprints",
    description:
      "Run up to 33 agents in parallel across buildings, lines and distributed camera operations.",
    stripePriceId: "price_1TKjuV3n54CFNceJXdM8gmfd",
  },
  {
    id: "max",
    name: "Max",
    monthlyPriceUsd: 55.99,
    monthlyPriceBrl: 279.9,
    paidAgentInstances: 64,
    totalAgentInstances: FREE_AGENT_INSTANCES + 64,
    headline: "Adds 64 paid agent instances for dense always-on coverage",
    description:
      "Run up to 65 agents in parallel for dense always-on deployments with shared live context across large fleets.",
    stripePriceId: "price_1TKjvU3n54CFNceJarjTlJ55",
  },
];

export const AGENT_BILLING_PLANS: AgentBillingPlan[] = [
  freePlan,
  ...AGENT_BILLING_PAID_PLANS,
];

export const AGENT_BILLING_PLANS_BY_ID = Object.fromEntries(
  AGENT_BILLING_PLANS.map((plan) => [plan.id, plan])
) as Record<AgentBillingPlanId, AgentBillingPlan>;

export const AGENT_BILLING_PAID_PLANS_BY_ID = Object.fromEntries(
  AGENT_BILLING_PAID_PLANS.map((plan) => [plan.id, plan])
) as Record<PaidAgentBillingPlanId, AgentBillingPlan>;

const AGENT_INSTANCE_TYPE_PATTERN =
  /(?:agent[_-]?instances?|agent[_-]?bundle|parallel|concurrency)[_-]?(\d+)/i;

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

export function getAgentBillingPlanById(
  planId: AgentBillingPlanId | null | undefined
): AgentBillingPlan | null {
  if (!planId) return null;
  return AGENT_BILLING_PLANS_BY_ID[planId] || null;
}

export function getAgentBillingPlanByStripePriceId(
  stripePriceId: string | null | undefined
): AgentBillingPlan | null {
  const normalized = typeof stripePriceId === "string" ? stripePriceId.trim() : "";
  if (!normalized) return null;
  return AGENT_BILLING_PAID_PLANS.find((plan) => plan.stripePriceId === normalized) || null;
}

export function getPaidAgentInstancesFromSubscription(
  subscription: Record<string, unknown> | null | undefined
): number {
  if (!subscription || typeof subscription !== "object") {
    return 0;
  }

  const directFields = [
    subscription.paid_agent_instances,
    subscription.agent_instances,
    subscription.agent_instance_limit,
    subscription.parallel_agent_instances,
    subscription.parallel_instances,
  ];

  for (const candidate of directFields) {
    const parsed = parsePositiveInteger(candidate);
    if (parsed !== null && parsed > 0) {
      return parsed;
    }
  }

  const subscriptionType = String(subscription.subscription_type || "").trim();
  const typeMatch = subscriptionType.match(AGENT_INSTANCE_TYPE_PATTERN);
  if (typeMatch) {
    return Number(typeMatch[1]) || 0;
  }

  return 0;
}

export function getCurrentAgentInstanceLimit(
  subscription: Record<string, unknown> | null | undefined
): number {
  return FREE_AGENT_INSTANCES + getPaidAgentInstancesFromSubscription(subscription);
}

export function getAgentBillingPlanFromPaidInstances(
  paidAgentInstances: number
): AgentBillingPlan | null {
  return (
    AGENT_BILLING_PAID_PLANS.find((plan) => plan.paidAgentInstances === paidAgentInstances) || null
  );
}

export function getAgentBillingPlanFromSubscription(
  subscription: Record<string, unknown> | null | undefined
): AgentBillingPlan | null {
  return getAgentBillingPlanFromPaidInstances(
    getPaidAgentInstancesFromSubscription(subscription)
  );
}

export function isLegacyCameraBillingSubscription(
  subscription: Record<string, unknown> | null | undefined
): boolean {
  if (!subscription || typeof subscription !== "object") {
    return false;
  }

  if (getPaidAgentInstancesFromSubscription(subscription) > 0) {
    return false;
  }

  const subscriptionType = String(subscription.subscription_type || "").trim().toLowerCase();
  if (subscriptionType.includes("camera_monitoring")) {
    return true;
  }

  return (
    typeof subscription.model_tier === "string" ||
    Number.isFinite(Number(subscription.seconds_per_frame)) ||
    Number(subscription.camera_count || 0) > 0
  );
}

export function formatAgentInstanceLabel(count: number): string {
  return `${count} agent ${count === 1 ? "instance" : "instances"}`;
}
