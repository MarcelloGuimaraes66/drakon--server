import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/react-app/components/Layout";
import AddChatTokensModal from "@/react-app/components/AddChatTokensModal";
import ManagePlansCardsModal from "@/react-app/components/ManagePlansCardsModal";
import { TokenBalance, Payment } from "@/shared/types";
import { brand } from "@/shared/brand";
import { CreditCard, Camera, Plus, TrendingUp, Loader2, Settings } from "lucide-react";

type ModelTier = "light" | "plus" | "pro";
type SecondsPerFrame = 1 | 3 | 5 | 10;

const MODEL_DISPLAY_LABELS: Record<ModelTier, string> = {
  light: "Light",
  plus: "Plus",
  pro: "Pro",
};

// Values derived from gemini_price_12h.xlsx for 12h/day, 30 days
// TotalCost + 20% margin, already rounded to 2 decimals
const GEMINI_SUBSCRIPTION_PRICING: Record<
  ModelTier,
  Record<SecondsPerFrame, number>
> = {
  pro: {
    1: 165.72, // 2.5 flash, 1s
    3: 55.24,  // 2.5 flash, 3s
    5: 33.14,  // 2.5 flash, 5s
    10: 16.57, // 2.5 flash, 10s
  },
  plus: {
    1: 51.6,   // 2.0 flash, 1s
    3: 17.2,   // 2.0 flash, 3s
    5: 10.32,  // 2.0 flash, 5s
    10: 5.16,  // 2.0 flash, 10s
  },
  light: {
    1: 38.7,   // 2.0 flash lite, 1s
    3: 12.9,   // 2.0 flash lite, 3s
    5: 7.74,   // 2.0 flash lite, 5s
    10: 3.87,  // 2.0 flash lite, 10s
  },
} as const;

function getSubscriptionPrice(
  tier: ModelTier,
  secondsPerFrame: SecondsPerFrame
): number {
  return GEMINI_SUBSCRIPTION_PRICING[tier][secondsPerFrame];
}

export default function Billing() {
  const { t } = useTranslation();
  const [tokenBalance, setTokenBalance] = useState<TokenBalance | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [activeCameras, setActiveCameras] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [activeSubscription, setActiveSubscription] = useState<any>(null);

  // New state for configurable subscription
  const [selectedTier, setSelectedTier] = useState<ModelTier>("plus");
  const [selectedSecondsPerFrame, setSelectedSecondsPerFrame] = useState<SecondsPerFrame>(3);

  const MIN_CAMERAS = 1;
  const MAX_CAMERAS = 32;
  const [cameraCount, setCameraCount] = useState<number>(1);

  const pricePerCamera = getSubscriptionPrice(selectedTier, selectedSecondsPerFrame);
  const totalPrice = pricePerCamera * cameraCount;

  useEffect(() => {
    fetchTokenBalance();
    fetchPayments();
    fetchActiveCameras();
    fetchActiveSubscription();
    
    // Check for session_id in URL
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get("session_id");
    
    if (sessionId) {
      confirmStripeSession(sessionId);
    }
  }, []);

  const fetchTokenBalance = async () => {
    try {
      const response = await fetch("/api/token-balance");
      const data = await response.json();
      setTokenBalance(data);
    } catch (error) {
      console.error("Failed to fetch token balance:", error);
    }
  };

  const fetchPayments = async () => {
    try {
      const response = await fetch("/api/payments");
      const data = await response.json();
      setPayments(data);
    } catch (error) {
      console.error("Failed to fetch payments:", error);
    }
  };

  const fetchActiveCameras = async () => {
    try {
      // Get subscribed camera count from active subscription
      const subResponse = await fetch("/api/subscriptions/me");
      const subData = await subResponse.json();
      
      if (subData && subData.camera_count) {
        setActiveCameras(subData.camera_count);
      } else {
        // Fallback to counting running cameras if no subscription
        const response = await fetch("/api/cameras");
        const data = await response.json();
        setActiveCameras(data.filter((c: any) => c.is_service_running).length);
      }
    } catch (error) {
      console.error("Failed to fetch cameras:", error);
    }
  };

  const fetchActiveSubscription = async () => {
    try {
      const response = await fetch("/api/subscriptions/me");
      const data = await response.json();
      setActiveSubscription(data);
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

      if (response.ok) {
        const data = await response.json();
        
        if (!data.alreadyProcessed) {
          setShowSuccessToast(true);
          setTimeout(() => setShowSuccessToast(false), 5000);
        }

        // Refresh data
        await fetchTokenBalance();
        await fetchPayments();
        await fetchActiveSubscription();

        // Clean URL
        const url = new URL(window.location.href);
        url.searchParams.delete("session_id");
        window.history.replaceState({}, "", url.toString());
      } else {
        console.error("Failed to confirm session");
      }
    } catch (error) {
      console.error("Error confirming session:", error);
    }
  };

  const handlePurchaseCredits = async (amount: number, tokenType: "both" | "input" | "output") => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "credits",
          credits_amount: amount,
          token_type: tokenType,
        }),
      });
  
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Checkout failed (${response.status}): ${text}`);
      }
  
      const data = await response.json();
  
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data?.error || "No checkout URL returned");
      }
    } catch (error) {
      console.error("Failed to create checkout session:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  

  const handleSubscribe = async (tier: ModelTier, secondsPerFrame: SecondsPerFrame) => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "subscription",
          camera_id: 1, // Placeholder - should be selected by user
          plan_tier: tier,
          camera_count: cameraCount,
          metadata: {
            model_tier: tier,
            seconds_per_frame: secondsPerFrame,
            camera_count: cameraCount,
          },
        }),
      });
  
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Checkout failed (${response.status}): ${text}`);
      }
  
      const data = await response.json();
  
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data?.error || "No checkout URL returned");
      }
    } catch (error) {
      console.error("Failed to create checkout session:", error);
      alert("Failed to start checkout. Check server logs.");
    } finally {
      setIsLoading(false);
    }
  };

  
  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Check if user has an active subscription with exact plan match
  const isCurrentPlan = activeSubscription && 
    activeSubscription.model_tier === selectedTier &&
    activeSubscription.seconds_per_frame === selectedSecondsPerFrame &&
    activeSubscription.camera_count === cameraCount;

  return (
    <Layout>
      {showSuccessToast && (
        <div className="fixed top-4 right-4 z-50 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg animate-fade-in">
          Payment successful! Your account has been updated.
        </div>
      )}

      <AddChatTokensModal
        isOpen={showTokenModal}
        onClose={() => setShowTokenModal(false)}
        onPurchase={handlePurchaseCredits}
      />

      <ManagePlansCardsModal
        isOpen={showManageModal}
        onClose={() => setShowManageModal(false)}
        onUpdate={() => {
          fetchActiveSubscription();
          fetchPayments();
        }}
      />

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-100 mb-2">
            {t("billing.title")}
          </h1>
          <p className="text-sm md:text-base text-gray-400">{t("billing.subtitle")}</p>
        </div>

        {/* Subscription */}
        <section className="mb-6 md:mb-8">
          <h2 className="text-lg md:text-xl font-bold text-gray-100 mb-4">
            Subscription
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            <div className="col-span-1 md:col-span-2 bg-gray-900/50 backdrop-blur-sm border border-blue-500/40 rounded-2xl p-4 md:p-6 shadow-lg">
              <p className="text-xs md:text-sm text-blue-400 mb-2 uppercase tracking-wide">
                AI Agent Subscription
              </p>

              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-3xl md:text-4xl font-bold text-gray-100">
                  ${totalPrice.toFixed(2)}
                </span>
                <span className="text-sm text-gray-400">per month</span>
              </div>

              <p className="text-xs md:text-sm text-gray-400 mb-1">
                {MODEL_DISPLAY_LABELS[selectedTier]} plan â€¢ {cameraCount}{" "}
                {cameraCount === 1 ? "camera" : "cameras"} â€¢ 1 frame every{" "}
                {selectedSecondsPerFrame} seconds per camera
              </p>
              <p className="text-xs text-gray-500 mb-6">
                ${pricePerCamera.toFixed(2)} per camera / month
              </p>

              {/* Cameras selector */}
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">
                  Cameras
                </p>

                <div className="inline-flex items-center gap-2 rounded-full border border-gray-700 bg-gray-800/60 px-3 py-1.5 shadow-sm">
                  <button
                    type="button"
                    onClick={() =>
                      setCameraCount((prev) =>
                        Math.max(MIN_CAMERAS, prev - 1)
                      )
                    }
                    disabled={cameraCount <= MIN_CAMERAS}
                    className={
                      "w-6 h-6 flex items-center justify-center rounded-full text-sm font-semibold transition-colors " +
                      (cameraCount <= MIN_CAMERAS
                        ? "text-gray-500 cursor-not-allowed"
                        : "text-gray-100 hover:bg-gray-700/60")
                    }
                  >
                    -
                  </button>

                  <span className="text-sm font-medium text-gray-100">
                    {cameraCount}x {cameraCount === 1 ? "camera" : "cameras"}
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      setCameraCount((prev) =>
                        Math.min(MAX_CAMERAS, prev + 1)
                      )
                    }
                    disabled={cameraCount >= MAX_CAMERAS}
                    className={
                      "w-6 h-6 flex items-center justify-center rounded-full text-sm font-semibold transition-colors " +
                      (cameraCount >= MAX_CAMERAS
                        ? "text-gray-500 cursor-not-allowed"
                        : "text-gray-100 hover:bg-gray-700/60")
                    }
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Controls */}
              <div className="flex flex-col md:flex-row gap-4 mb-6">
                {/* Model selector */}
                <div className="flex-1">
                  <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">
                    Model
                  </p>
                  <div className="flex gap-2">
                    {(["light", "plus", "pro"] as ModelTier[]).map((tier) => {
                      const isActive = selectedTier === tier;
                      return (
                        <button
                          key={tier}
                          type="button"
                          onClick={() => setSelectedTier(tier)}
                          className={
                            "flex-1 rounded-lg px-3 py-2 text-sm font-medium border transition " +
                            (isActive
                              ? "bg-blue-500 border-blue-400 text-white"
                              : "bg-gray-800 border-gray-700 text-gray-300 hover:border-blue-500/60")
                          }
                        >
                          {MODEL_DISPLAY_LABELS[tier]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* FPS selector */}
                <div className="flex-1">
                  <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">
                    Analysis speed
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 3, 5, 10].map((sec) => {
                      const seconds = sec as SecondsPerFrame;
                      const isActive = selectedSecondsPerFrame === seconds;
                      return (
                        <button
                          key={seconds}
                          type="button"
                          onClick={() => setSelectedSecondsPerFrame(seconds)}
                          className={
                            "rounded-lg px-2 py-2 text-xs font-medium border transition " +
                            (isActive
                              ? "bg-blue-500 border-blue-400 text-white"
                              : "bg-gray-800 border-gray-700 text-gray-300 hover:border-blue-500/60")
                          }
                        >
                          {/* Label pattern 1/1, 3/1, 5/1, 10/1 */}
                          {seconds}/1
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-gray-500">
                    1/1 = fast events, 10/1 = slower actions.
                  </p>
                </div>
              </div>

              {/* Subscribe / Current Plan button */}
              <div className="flex justify-end">
                {isCurrentPlan ? (
                  <button
                    type="button"
                    className="px-5 py-2 rounded-lg text-sm font-semibold bg-green-500/20 text-green-400 border border-green-500/40 cursor-default"
                    disabled
                  >
                    Current Plan
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      handleSubscribe(selectedTier, selectedSecondsPerFrame)
                    }
                    disabled={isLoading}
                    className="px-6 py-2 rounded-lg text-sm font-semibold bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white shadow-md shadow-blue-500/40 transition"
                  >
                    {isLoading ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Processing...
                      </span>
                    ) : (
                      "Subscribe"
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Optional: keep a small side card with a short explanation or limits */}
            <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl p-4 text-sm text-gray-300 border border-gray-800/50">
              <p className="font-semibold mb-2 text-gray-100">How it works</p>
              <p className="text-xs text-gray-400 mb-2">
                Choose the model based on how powerful you need your AI analysis to be.
                The Light plan is optimized for speed and lower cost. Plus balances cost
                and reasoning ability. Pro is the most advanced option, ideal for more
                complex analysis and decision-making.
              </p>
              <p className="text-xs text-gray-400">
                Analysis speed controls how often frames are processed. 1/1 (every second)
                is recommended for fast or sudden actions. 10/1 (every ten seconds) is
                enough for slower situations, like long-running activities or scenes that
                change gradually.
              </p>
            </div>
          </div>
        </section>

        {/* Chat tokens section */}
        <div className="mb-6 md:mb-8">
          <h2 className="text-lg md:text-xl font-bold text-gray-100 mb-4">
            {`${brand.chatName} Tokens`}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            {/* Token balance card */}
            <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/20 rounded-2xl p-4 md:p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 md:w-12 h-10 md:h-12 bg-blue-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <CreditCard className="w-5 md:w-6 h-5 md:h-6 text-blue-400" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-gray-400 mb-1">Token Balance</p>
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-xs text-gray-500">Input</p>
                      <p className="text-lg font-bold text-gray-100">
                        {(tokenBalance?.input_balance || 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="h-8 w-px bg-gray-700"></div>
                    <div>
                      <p className="text-xs text-gray-500">Output</p>
                      <p className="text-lg font-bold text-gray-100">
                        {(tokenBalance?.output_balance || 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-4">
                {`Purchase tokens to use ${brand.assistantName}`}
              </p>
              <button
                onClick={() => setShowTokenModal(true)}
                disabled={isLoading}
                className="w-full px-4 py-3 md:py-2.5 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 min-h-[44px] md:min-h-0"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Buy Tokens
                  </>
                )}
              </button>
            </div>

            {/* Total Spent card */}
            <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-2xl p-4 md:p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 md:w-12 h-10 md:h-12 bg-purple-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="w-5 md:w-6 h-5 md:h-6 text-purple-400" />
                </div>
                <div>
                  <p className="text-xs md:text-sm text-gray-400">{t("billing.totalSpent")}</p>
                  <p className="text-xl md:text-2xl font-bold text-gray-100">
                    {tokenBalance?.total_spent.toLocaleString() || 0}
                  </p>
                </div>
              </div>
              <p className="text-xs text-gray-500">{t("billing.tokensUsedAllTime")}</p>
            </div>

            {/* Active Cameras card */}
            <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-2xl p-4 md:p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 md:w-12 h-10 md:h-12 bg-green-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Camera className="w-5 md:w-6 h-5 md:h-6 text-green-400" />
                </div>
                <div>
                  <p className="text-xs md:text-sm text-gray-400">{t("billing.activeCameras")}</p>
                  <p className="text-xl md:text-2xl font-bold text-gray-100">{activeCameras}</p>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                {t("billing.subscriptionAvailable")}
              </p>
            </div>
          </div>
        </div>

        {/* Payment History */}
        <div>
          <h2 className="text-lg md:text-xl font-bold text-gray-100 mb-4">
            {t("billing.paymentHistory")}
          </h2>
          <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800/50 rounded-2xl overflow-hidden">
            {payments.length === 0 ? (
              <div className="text-center py-12 md:py-16">
                <CreditCard className="w-12 md:w-16 h-12 md:h-16 text-gray-600 mx-auto mb-4" />
                <p className="text-sm md:text-base text-gray-500">{t("billing.noPaymentHistory")}</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-800">
                {payments.map((payment) => (
                  <div key={payment.id} className="p-4 md:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center">
                        <CreditCard className="w-5 h-5 text-gray-400" />
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
                        {formatCurrency(payment.amount, payment.currency)}
                      </p>
                      <p className="text-xs text-green-400 capitalize">
                        {payment.status}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Manage Plans & Cards Button */}
        <div className="mt-8 flex justify-center">
          <button
            onClick={() => setShowManageModal(true)}
            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors flex items-center gap-2 shadow-lg shadow-blue-500/20"
          >
            <Settings className="w-5 h-5" />
            {t("billing.managePlansCards")}
          </button>
        </div>
      </div>
    </Layout>
  );
}

