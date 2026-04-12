import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CreditCard, Loader2, Trash2, X } from "lucide-react";
import {
  FREE_AGENT_INSTANCES,
  getAgentBillingPlanFromSubscription,
  getCurrentAgentInstanceLimit,
  getPaidAgentInstancesFromSubscription,
  isLegacyCameraBillingSubscription,
} from "@/react-app/utils/agentBilling";
import {
  formatBillingMoney,
  getBillingAgentInstanceLabel,
  getBillingPlanName,
} from "@/react-app/utils/billingI18n";

interface ActiveCard {
  id: number;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  is_default: number;
}

interface Subscription {
  id: number;
  subscription_type?: string;
  camera_id?: number | null;
  is_active: number;
  started_at?: string | null;
  [key: string]: unknown;
}

interface ManagePlansCardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export default function ManagePlansCardsModal({
  isOpen,
  onClose,
  onUpdate,
}: ManagePlansCardsModalProps) {
  const { t, i18n } = useTranslation();
  const currentLanguage = i18n.resolvedLanguage || i18n.language;
  const [cards, setCards] = useState<ActiveCard[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cardToRemove, setCardToRemove] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      void fetchData();
    }
  }, [isOpen]);

  const currentPlan = useMemo(
    () => getAgentBillingPlanFromSubscription(subscription as Record<string, unknown> | null),
    [subscription]
  );
  const isLegacyPlan = useMemo(
    () => isLegacyCameraBillingSubscription(subscription as Record<string, unknown> | null),
    [subscription]
  );
  const paidAgentInstances = useMemo(
    () => getPaidAgentInstancesFromSubscription(subscription as Record<string, unknown> | null),
    [subscription]
  );
  const totalAgentInstances = useMemo(
    () => getCurrentAgentInstanceLimit(subscription as Record<string, unknown> | null),
    [subscription]
  );

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [cardsRes, subRes] = await Promise.all([
        fetch("/api/billing/cards"),
        fetch("/api/subscriptions/me"),
      ]);

      if (cardsRes.ok) {
        const cardsData = await cardsRes.json();
        setCards(Array.isArray(cardsData) ? cardsData : []);
      }

      if (subRes.ok) {
        const subData = await subRes.json();
        if (subData && typeof subData === "object") {
          setSubscription(subData as Subscription);
        } else {
          setSubscription(null);
        }
      }
    } catch (fetchError) {
      console.error("Failed to fetch data:", fetchError);
      setError(t("billing.modal.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!subscription) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/billing/cancel-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || t("billing.modal.cancelFailed"));
        return;
      }

      setShowCancelConfirm(false);
      await fetchData();
      onUpdate();
    } catch (cancelError) {
      console.error("Failed to cancel subscription:", cancelError);
      setError(t("billing.modal.cancelFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveCard = async (cardId: number) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/billing/remove-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_id: cardId }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || t("billing.modal.removeFailed"));
        return;
      }

      setCardToRemove(null);
      await fetchData();
      onUpdate();
    } catch (removeError) {
      console.error("Failed to remove card:", removeError);
      setError(t("billing.modal.removeFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-gray-900 p-6">
          <h2 className="text-xl font-bold text-gray-100">
            {t("billing.managePlansCards")}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-8 p-6">
          {error ? (
            <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-400">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
          ) : null}

          <div>
            <h3 className="mb-4 text-lg font-semibold text-gray-100">
              {t("billing.currentSubscription")}
            </h3>

            {isLoading && !subscription && cards.length === 0 ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
              </div>
            ) : subscription && subscription.is_active === 1 ? (
              <div className="rounded-2xl border border-gray-700 bg-gray-800/50 p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-base font-medium text-gray-100">
                      {currentPlan
                        ? `${getBillingPlanName(t, currentPlan.id, currentPlan.name)} - ${formatBillingMoney(
                            currentPlan.monthlyPriceUsd,
                            "usd",
                            currentLanguage
                          )} ${t("billing.perMonth")}`
                        : isLegacyPlan
                        ? t("billing.modal.currentPlanLegacy")
                        : t("billing.modal.currentPlanFree")}
                    </p>

                    <p className="mt-1 text-sm text-gray-400">
                      {currentPlan
                        ? t("billing.modal.currentSummaryPaid", {
                            countLabel: getBillingAgentInstanceLabel(
                              t,
                              totalAgentInstances
                            ),
                            freeCount: FREE_AGENT_INSTANCES,
                            paidCount: paidAgentInstances,
                          })
                        : isLegacyPlan
                        ? t("billing.modal.currentSummaryLegacy")
                        : t("billing.modal.currentSummaryFree", {
                            countLabel: getBillingAgentInstanceLabel(
                              t,
                              FREE_AGENT_INSTANCES
                            ),
                          })}
                    </p>

                    <p className="mt-1 text-sm text-gray-400">
                      {t("billing.status")}:{" "}
                      <span className="font-medium text-green-400">
                        {t("billing.active")}
                      </span>
                    </p>
                  </div>

                  <button
                    onClick={() => setShowCancelConfirm(true)}
                    disabled={isLoading}
                    className="rounded-lg border border-red-500/30 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {t("billing.cancelSubscription")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-gray-800 bg-gray-800/30 px-4 py-6 text-center text-sm text-gray-400">
                {t("billing.modal.noActiveLicense")}
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-4 text-lg font-semibold text-gray-100">
              {t("billing.paymentMethods")}
            </h3>

            {isLoading && cards.length === 0 ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
              </div>
            ) : cards.length > 0 ? (
              <div className="space-y-3">
                {cards.map((card) => (
                  <div
                    key={card.id}
                    className="flex items-center justify-between rounded-2xl border border-gray-700 bg-gray-800/50 p-4"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-700 text-gray-200">
                        <CreditCard className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-medium capitalize text-gray-100">
                          {card.brand}
                          {card.is_default === 1 ? (
                            <span className="ml-2 rounded bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">
                              {t("billing.default")}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-gray-400">
                          {t("billing.modal.cardExpiry", {
                            last4: card.last4,
                            month: card.exp_month,
                            year: card.exp_year,
                          })}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => setCardToRemove(card.id)}
                      disabled={isLoading}
                      className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-gray-800 bg-gray-800/30 px-4 py-6 text-center text-sm text-gray-400">
                {t("billing.noSavedCards")}
              </div>
            )}
          </div>
        </div>

        {showCancelConfirm ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/80 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-6">
              <h3 className="mb-3 text-lg font-semibold text-gray-100">
                {t("billing.cancelSubscription")}
              </h3>
              <p className="mb-6 text-sm text-gray-400">{t("billing.cancelConfirm")}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  disabled={isLoading}
                  className="flex-1 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 disabled:opacity-50"
                >
                  {t("billing.keepSubscription")}
                </button>
                <button
                  onClick={() => void handleCancelSubscription()}
                  disabled={isLoading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("billing.canceling")}
                    </>
                  ) : (
                    t("billing.cancelSubscription")
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {cardToRemove !== null ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/80 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-6">
              <h3 className="mb-3 text-lg font-semibold text-gray-100">
                {t("billing.removeCard")}
              </h3>
              <p className="mb-6 text-sm text-gray-400">
                {t("billing.removeCardConfirm")}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setCardToRemove(null)}
                  disabled={isLoading}
                  className="flex-1 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 disabled:opacity-50"
                >
                  {t("billing.cancel")}
                </button>
                <button
                  onClick={() => void handleRemoveCard(cardToRemove)}
                  disabled={isLoading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("billing.removing")}
                    </>
                  ) : (
                    t("billing.removeCard")
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
