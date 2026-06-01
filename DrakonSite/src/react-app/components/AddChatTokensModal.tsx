import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Minus, Plus, Loader2 } from "lucide-react";

interface AddChatTokensModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPurchase: (tokens: number, tokenType: "both" | "input" | "output") => Promise<void>;
}

type TokenType = "both" | "input" | "output";

export default function AddChatTokensModal({
  isOpen,
  onClose,
  onPurchase,
}: AddChatTokensModalProps) {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState(1_000_000);
  const [tokenType, setTokenType] = useState<TokenType>("both");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const MIN_TOKENS = 1_000_000;
  const MAX_TOKENS = 500_000_000;
  const STEP = 1_000_000;

  // Base costs per 1M tokens
  const INPUT_BASE_COST = 0.075;
  const OUTPUT_BASE_COST = 0.30;

  // Calculate markup based on total tokens
  const getMarkupMultiplier = (totalTokens: number): number => {
    if (totalTokens <= 49_000_000) {
      return 1.40; // 40% markup
    } else if (totalTokens <= 200_000_000) {
      return 1.30; // 30% markup
    } else {
      return 1.20; // 20% markup
    }
  };

  const markupMultiplier = getMarkupMultiplier(tokens);
  
  // Calculate prices based on token type
  let pricePerMillion: number;
  let description: string;
  
  if (tokenType === "both") {
    pricePerMillion = (INPUT_BASE_COST + OUTPUT_BASE_COST) * markupMultiplier;
    description = "1M input + 1M output tokens";
  } else if (tokenType === "input") {
    pricePerMillion = INPUT_BASE_COST * markupMultiplier;
    description = "1M input tokens";
  } else {
    pricePerMillion = OUTPUT_BASE_COST * markupMultiplier;
    description = "1M output tokens";
  }
  
  const totalPrice = (tokens / 1_000_000) * pricePerMillion;

  // Determine discount tier for display
  const getDiscountTier = (totalTokens: number): string => {
    if (totalTokens <= 49_000_000) {
      return "Standard pricing";
    } else if (totalTokens <= 200_000_000) {
      return "10% volume discount";
    } else {
      return "20% volume discount";
    }
  };

  const handleIncrement = () => {
    setTokens((prev) => Math.min(prev + STEP, MAX_TOKENS));
  };

  const handleDecrement = () => {
    setTokens((prev) => Math.max(prev - STEP, MIN_TOKENS));
  };

  const handlePurchase = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await onPurchase(tokens, tokenType);
      onClose();
    } catch (err) {
      setError("Failed to create checkout session. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-100">{t("billing.buyTokens")}</h2>
          <button
            onClick={handleClose}
            className="p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          {/* Token Type Selector */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Token Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setTokenType("both")}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
                  tokenType === "both"
                    ? "bg-blue-500 border-blue-400 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:border-blue-500/60"
                }`}
              >
                Both
              </button>
              <button
                onClick={() => setTokenType("input")}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
                  tokenType === "input"
                    ? "bg-blue-500 border-blue-400 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:border-blue-500/60"
                }`}
              >
                Input
              </button>
              <button
                onClick={() => setTokenType("output")}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
                  tokenType === "output"
                    ? "bg-blue-500 border-blue-400 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:border-blue-500/60"
                }`}
              >
                Output
              </button>
            </div>
          </div>

          {/* Token Selector */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-3">
              {t("billing.numberOfTokens")}
            </label>
            <div className="flex items-center gap-4">
              <button
                onClick={handleDecrement}
                disabled={tokens <= MIN_TOKENS}
                className="p-3 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800 disabled:opacity-30 text-gray-200 rounded-lg transition-colors"
              >
                <Minus className="w-5 h-5" />
              </button>

              <div className="flex-1 text-center">
                <div className="text-3xl font-bold text-gray-100">
                  {(tokens / 1_000_000).toFixed(0)}M
                </div>
                <div className="text-sm text-gray-500 mt-1">
                  {tokens.toLocaleString()} {description}
                </div>
              </div>

              <button
                onClick={handleIncrement}
                disabled={tokens >= MAX_TOKENS}
                className="p-3 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800 disabled:opacity-30 text-gray-200 rounded-lg transition-colors"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Pricing Breakdown */}
          <div className="mb-4 p-4 bg-gray-800/50 rounded-xl space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Base price ({description})</span>
              <span className="text-gray-300">
                ${tokenType === "both" 
                  ? (INPUT_BASE_COST + OUTPUT_BASE_COST).toFixed(3)
                  : tokenType === "input" 
                    ? INPUT_BASE_COST.toFixed(3)
                    : OUTPUT_BASE_COST.toFixed(3)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Volume tier</span>
              <span className="text-blue-400 font-medium">{getDiscountTier(tokens)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Price per million</span>
              <span className="text-gray-300">${pricePerMillion.toFixed(3)}</span>
            </div>
          </div>

          {/* Price Display */}
          <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">{t("billing.totalPrice")}</span>
              <span className="text-2xl font-bold text-blue-400">
                ${totalPrice.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Volume Discount Info */}
          <div className="mb-6 p-3 bg-gray-800/30 border border-gray-700 rounded-lg">
            <p className="text-xs text-gray-400 leading-relaxed">
              💡 <strong className="text-gray-300">Save more with volume:</strong>
              <br />
              • Up to 49M tokens: Standard pricing
              <br />
              • 50M - 200M tokens: 10% discount
              <br />
              • Above 200M tokens: 20% discount
              <br />
              <br />
              <strong className="text-gray-300">Pricing:</strong> Input tokens ${INPUT_BASE_COST}/M, Output tokens ${OUTPUT_BASE_COST}/M
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleClose}
              disabled={isLoading}
              className="flex-1 px-4 py-3 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 rounded-lg font-medium transition-colors"
            >
              {t("billing.cancel")}
            </button>
            <button
              onClick={handlePurchase}
              disabled={isLoading}
              className="flex-1 px-4 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("billing.processing")}
                </>
              ) : (
                t("billing.purchase")
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
