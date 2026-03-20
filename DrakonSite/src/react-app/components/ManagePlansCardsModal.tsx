import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Trash2, AlertCircle, Loader2 } from "lucide-react";

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
  subscription_type: string;
  camera_id: number;
  is_active: number;
  started_at: string;
}

interface ManagePlansCardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export default function ManagePlansCardsModal({ isOpen, onClose, onUpdate }: ManagePlansCardsModalProps) {
  const { t } = useTranslation();
  const [cards, setCards] = useState<ActiveCard[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cardToRemove, setCardToRemove] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [cardsRes, subRes] = await Promise.all([
        fetch("/api/billing/cards"),
        fetch("/api/subscriptions/me"),
      ]);

      if (cardsRes.ok) {
        const cardsData = await cardsRes.json();
        setCards(cardsData);
      }

      if (subRes.ok) {
        const subData = await subRes.json();
        setSubscription(subData);
      }
    } catch (error) {
      console.error("Failed to fetch data:", error);
      setError("Failed to load billing information");
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

      if (response.ok) {
        setShowCancelConfirm(false);
        await fetchData();
        onUpdate();
      } else {
        const data = await response.json();
        setError(data.error || "Failed to cancel subscription");
      }
    } catch (error) {
      console.error("Failed to cancel subscription:", error);
      setError("Failed to cancel subscription");
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

      if (response.ok) {
        setCardToRemove(null);
        await fetchData();
        onUpdate();
      } else {
        const data = await response.json();
        setError(data.error || "Failed to remove card");
      }
    } catch (error) {
      console.error("Failed to remove card:", error);
      setError("Failed to remove card");
    } finally {
      setIsLoading(false);
    }
  };

  const getPlanName = (subscriptionType: string) => {
    if (subscriptionType?.includes("999")) return t("billing.basicPlan");
    if (subscriptionType?.includes("3999")) return t("billing.standardPlan");
    if (subscriptionType?.includes("6999")) return t("billing.premiumPlan");
    return t("billing.currentSubscription");
  };

  const getPlanPrice = (subscriptionType: string) => {
    if (subscriptionType?.includes("999")) return "$9.99";
    if (subscriptionType?.includes("3999")) return "$39.99";
    if (subscriptionType?.includes("6999")) return "$69.99";
    return "";
  };

  const getBrandIcon = (brand: string) => {
    const brandLower = brand.toLowerCase();
    if (brandLower === "visa") return "💳";
    if (brandLower === "mastercard") return "💳";
    if (brandLower === "amex") return "💳";
    if (brandLower === "discover") return "💳";
    return "💳";
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between p-6 border-b border-gray-800 bg-gray-900">
          <h2 className="text-xl font-bold text-gray-100">{t("billing.managePlansCards")}</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-100 transition-colors rounded-lg hover:bg-gray-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-8">
          {error && (
            <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* Current Subscription Section */}
          <div>
            <h3 className="text-lg font-semibold text-gray-100 mb-4">{t("billing.currentSubscription")}</h3>
            {isLoading && !subscription && !cards.length ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
              </div>
            ) : subscription && subscription.is_active === 1 ? (
              <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-base font-medium text-gray-100">
                      {getPlanName(subscription.subscription_type)} – {getPlanPrice(subscription.subscription_type)} {t("billing.perMonth")}
                    </p>
                    <p className="text-sm text-gray-400 mt-1">
                      {t("billing.status")}: <span className="text-green-400 font-medium">{t("billing.active")}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => setShowCancelConfirm(true)}
                    disabled={isLoading}
                    className="px-4 py-2 text-sm font-medium text-red-400 border border-red-500/30 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {t("billing.cancelSubscription")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">
                {t("billing.noActiveSubscription")}
              </div>
            )}
          </div>

          {/* Payment Methods Section */}
          <div>
            <h3 className="text-lg font-semibold text-gray-100 mb-4">{t("billing.paymentMethods")}</h3>
            {isLoading && !cards.length ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
              </div>
            ) : cards.length > 0 ? (
              <div className="space-y-3">
                {cards.map((card) => (
                  <div
                    key={card.id}
                    className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-gray-700 rounded-lg flex items-center justify-center text-xl">
                        {getBrandIcon(card.brand)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-100 capitalize">
                          {card.brand} {card.is_default === 1 && (
                            <span className="ml-2 px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">
                              {t("billing.default")}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400">
                          •••• {card.last4} · Exp {card.exp_month}/{card.exp_year}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setCardToRemove(card.id)}
                      disabled={isLoading}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">
                {t("billing.noSavedCards")}
              </div>
            )}
          </div>
        </div>

        {/* Cancel Subscription Confirmation */}
        {showCancelConfirm && (
          <div className="absolute inset-0 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm rounded-2xl">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-md w-full">
              <h3 className="text-lg font-semibold text-gray-100 mb-3">{t("billing.cancelSubscription")}</h3>
              <p className="text-sm text-gray-400 mb-6">
                {t("billing.cancelConfirm")}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  disabled={isLoading}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {t("billing.keepSubscription")}
                </button>
                <button
                  onClick={handleCancelSubscription}
                  disabled={isLoading}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t("billing.canceling")}
                    </>
                  ) : (
                    t("billing.cancelSubscription")
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Remove Card Confirmation */}
        {cardToRemove !== null && (
          <div className="absolute inset-0 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm rounded-2xl">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-md w-full">
              <h3 className="text-lg font-semibold text-gray-100 mb-3">{t("billing.removeCard")}</h3>
              <p className="text-sm text-gray-400 mb-6">
                {t("billing.removeCardConfirm")}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setCardToRemove(null)}
                  disabled={isLoading}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {t("billing.cancel")}
                </button>
                <button
                  onClick={() => handleRemoveCard(cardToRemove)}
                  disabled={isLoading}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t("billing.removing")}
                    </>
                  ) : (
                    t("billing.removeCard")
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
