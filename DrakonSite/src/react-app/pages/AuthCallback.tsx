import { useEffect, useState } from "react";
import { useAuth } from "@getmocha/users-service/react";
import { Loader2 } from "lucide-react";

export default function AuthCallback() {
  const { exchangeCodeForSessionToken } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const handleCallback = async () => {
      try {
        const user = await exchangeCodeForSessionToken();
        if (cancelled) {
          return;
        }
        if (!user) {
          setErrorMessage("Google sign in did not complete. Please try again.");
          return;
        }
        window.location.replace("/ai-agents");
      } catch (error) {
        console.error("Authentication error:", error);
        if (cancelled) {
          return;
        }
        setErrorMessage(
          error instanceof Error && error.message
            ? error.message
            : "Failed to complete Google sign in."
        );
      }
    };

    handleCallback();

    return () => {
      cancelled = true;
    };
  }, [exchangeCodeForSessionToken]);

  if (errorMessage) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-6">
        <div className="w-full max-w-md rounded-3xl border border-red-500/30 bg-gray-900 p-8 text-center shadow-2xl shadow-black/30">
          <h1 className="text-2xl font-semibold text-white">Google sign in failed</h1>
          <p className="mt-3 text-sm leading-6 text-gray-300">{errorMessage}</p>
          <button
            type="button"
            onClick={() => window.location.replace("/login")}
            className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-medium text-gray-950 transition hover:bg-gray-100"
          >
            Back to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
        <p className="text-gray-400">Completing sign in...</p>
      </div>
    </div>
  );
}
