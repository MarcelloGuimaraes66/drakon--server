import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@getmocha/users-service/react";
import { useNavigate } from "react-router";
import { Loader2, Eye, EyeOff, Search, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import BrandLogo from "@/react-app/components/BrandLogo";
import { brand } from "@/shared/brand";
import { COUNTRIES } from "../data/countries";

type Tab = "login" | "signup";
type LoginLayoutMetrics = {
  scale: number;
  width: number;
  height: number;
};

function GoogleIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.44a5.51 5.51 0 0 1-2.39 3.62v3h3.88c2.27-2.09 3.56-5.17 3.56-8.65Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.73-2.46 1.16-4.07 1.16-3.13 0-5.78-2.12-6.73-4.96H1.26v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.29V6.62H1.26A12 12 0 0 0 0 12c0 1.93.46 3.75 1.26 5.38l4.01-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.33.61 4.57 1.8l3.43-3.43C17.95 1.14 15.23 0 12 0A12 12 0 0 0 1.26 6.62l4.01 3.09c.95-2.84 3.6-4.94 6.73-4.94Z"
      />
    </svg>
  );
}

export default function Login() {
  const { user, isPending, redirectToLogin } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const layoutContentRef = useRef<HTMLDivElement | null>(null);
  const hasDedicatedLoginWordmark = Boolean(
    brand.assets.loginWordmarkDarkPath || brand.assets.loginWordmarkLightPath
  );
  const isPerceptrumBrand = brand.id === "perceptrum";
  const useCompactLoginLayout = hasDedicatedLoginWordmark;
  const googleLoginEnabled = brand.features.googleLoginEnabled;
  const brandAccentTextClass = isPerceptrumBrand
    ? "text-cyan-300"
    : "text-blue-400";
  const brandAccentHoverTextClass = isPerceptrumBrand
    ? "hover:text-cyan-200"
    : "hover:text-blue-300";
  const brandFocusRingClass = isPerceptrumBrand
    ? "focus:ring-cyan-300/25"
    : "focus:ring-blue-400/25";
  const brandFocusBorderClass = isPerceptrumBrand
    ? "focus:border-cyan-300/40"
    : "focus:border-blue-400/40";
  const selectedCountryClass = isPerceptrumBrand
    ? "bg-cyan-400/12 text-cyan-50"
    : "bg-blue-500/16 text-blue-50";
  const checkboxAccentClass = isPerceptrumBrand
    ? "text-cyan-300 focus:ring-cyan-300/30"
    : "text-blue-500 focus:ring-blue-400/30";
  const inputClass = `w-full rounded-full border border-white/10 bg-transparent px-5 text-white placeholder:text-gray-500 transition-all focus:outline-none focus:ring-2 ${brandFocusRingClass} ${brandFocusBorderClass} ${
    useCompactLoginLayout ? "py-3" : "py-3.5"
  }`;
  const primaryButtonClass = `w-full rounded-full bg-white text-[#171717] font-semibold transition-all duration-200 hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/12 disabled:text-gray-500 ${
    useCompactLoginLayout ? "py-3" : "py-3.5"
  }`;
  const iconButtonClass =
    "flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-transparent text-white transition-all hover:bg-white/[0.03] hover:border-white/15 disabled:cursor-not-allowed disabled:border-white/6 disabled:text-gray-600";
  const subtleButtonClass =
    "text-sm text-gray-400 transition-colors hover:text-gray-200";
  const accentButtonClass = `${brandAccentTextClass} ${brandAccentHoverTextClass} text-sm transition-colors`;
  const languageButtonClass =
    "flex items-center gap-2 rounded-full border border-white/10 bg-transparent px-4 py-2 text-gray-300 transition-all hover:bg-white/[0.03] hover:text-white";
  const panelClass =
    "absolute right-0 mt-3 w-48 overflow-hidden rounded-2xl border border-white/10 bg-[#171717]/95 shadow-2xl backdrop-blur-xl";
  const countryDropdownClass =
    "absolute z-10 mt-3 max-h-80 w-full overflow-hidden rounded-2xl border border-white/10 bg-[#171717]/95 shadow-2xl backdrop-blur-xl";

  const [activeTab, setActiveTab] = useState<Tab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [countryCode, setCountryCode] = useState<string>("");
  const [detectedCountry, setDetectedCountry] = useState<string | null>(null);
  const [countrySearch, setCountrySearch] = useState("");
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [layoutMetrics, setLayoutMetrics] = useState<LoginLayoutMetrics>({
    scale: 1,
    width: 0,
    height: 0,
  });

  const languages = [
    { code: "en", name: "English" },
    { code: "es", name: "Español" },
    { code: "pt", name: "Português" },
    { code: "fr", name: "Français" },
    { code: "zh", name: "中文" },
    { code: "ar", name: "العربية" },
  ];

  // Filter countries based on search
  const filteredCountries = useMemo(() => {
    if (!countrySearch) return COUNTRIES;
    const search = countrySearch.toLowerCase();
    return COUNTRIES.filter(
      (country) =>
        country.name.toLowerCase().includes(search) ||
        country.code.toLowerCase().includes(search)
    );
  }, [countrySearch]);

  const selectedCountry = COUNTRIES.find((c) => c.code === countryCode);
  const hasMeasuredLayout = layoutMetrics.width > 0 && layoutMetrics.height > 0;
  const scaledShellStyle =
    hasMeasuredLayout
      ? {
          width: `${Math.ceil(layoutMetrics.width * layoutMetrics.scale)}px`,
          height: `${Math.ceil(layoutMetrics.height * layoutMetrics.scale)}px`,
        }
      : undefined;
  const scaledContentStyle = {
    transform: `translateX(-50%) scale(${layoutMetrics.scale})`,
    transformOrigin: "top center",
    willChange: layoutMetrics.scale < 0.999 ? "transform" : undefined,
  } as const;
  const measuredContentStyle = hasMeasuredLayout
    ? {
        ...scaledContentStyle,
        width: `${layoutMetrics.width}px`,
      }
    : undefined;

  // Redirect authenticated users away from the login page.
  useEffect(() => {
    if (user) {
      navigate("/ai-agents", { replace: true });
    }
  }, [user, navigate]);

  // Detect country on mount
  useEffect(() => {
    const detectCountry = async () => {
      try {
        const response = await fetch("/api/auth/country");
        if (response.ok) {
          const data = await response.json();
          if (data.detectedCountryCode) {
            setDetectedCountry(data.detectedCountryCode);
            setCountryCode(data.detectedCountryCode);
          }
        }
      } catch (err) {
        console.error("Failed to detect country:", err);
      }
    };

    detectCountry();
  }, []);

  useLayoutEffect(() => {
    const node = layoutContentRef.current;
    if (!node) {
      return;
    }

    let frameId = 0;
    const measure = () => {
      const naturalWidth = node.offsetWidth;
      const naturalHeight = node.offsetHeight;
      if (!naturalWidth || !naturalHeight) {
        return;
      }

      const availableWidth = Math.max(window.innerWidth - 32, 280);
      const availableHeight = Math.max(window.innerHeight - 24, 320);
      const nextScale = Math.min(
        1,
        availableWidth / naturalWidth,
        availableHeight / naturalHeight
      );

      setLayoutMetrics((current) => {
        if (
          current.width === naturalWidth &&
          current.height === naturalHeight &&
          Math.abs(current.scale - nextScale) < 0.01
        ) {
          return current;
        }

        return {
          scale: nextScale,
          width: naturalWidth,
          height: naturalHeight,
        };
      });
    };

    const scheduleMeasure = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(measure);
    };

    measure();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            scheduleMeasure();
          });
    resizeObserver?.observe(node);
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, []);

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const isEmailValid = validateEmail(email);
  const hasSelectedCountry = Boolean(detectedCountry || countryCode);
  const signupBlockingReasons = useMemo(() => {
    const reasons: string[] = [];

    if (!isEmailValid) {
      reasons.push(t("login.errorInvalidEmail"));
    }

    if (password.length < 8) {
      reasons.push(t("login.errorPasswordLength"));
    }

    if (!hasSelectedCountry) {
      reasons.push(t("login.errorSelectCountry"));
    }

    if (!agreeTerms) {
      reasons.push(t("login.errorAgreeTerms"));
    }

    return reasons;
  }, [agreeTerms, hasSelectedCountry, isEmailValid, password.length, t]);

  const isFormValid =
    activeTab === "login"
      ? isEmailValid && password.length > 0
      : signupBlockingReasons.length === 0;
  const isGoogleSignupBlocked =
    activeTab === "signup" && (!agreeTerms || !hasSelectedCountry);

  const handleLocalSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!isEmailValid) {
      setError(t("login.errorInvalidEmail"));
      return;
    }

    if (password.length < 8) {
      setError(t("login.errorPasswordLength"));
      return;
    }

    if (!agreeTerms) {
      setError(t("login.errorAgreeTerms"));
      return;
    }

    if (!hasSelectedCountry) {
      setError(t("login.errorSelectCountry"));
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/local/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          country_code: countryCode || detectedCountry,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Signup failed");
        setIsLoading(false);
        return;
      }

      // Signup successful, force full page reload to refresh auth state
      window.location.href = "/ai-agents";
    } catch (err) {
      setError(t("login.errorNetwork"));
      setIsLoading(false);
    }
  };

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!isEmailValid) {
      setError(t("login.errorInvalidEmail"));
      return;
    }

    if (!password) {
      setError(t("login.errorInvalidEmail"));
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/local/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Login failed");
        setIsLoading(false);
        return;
      }

      // Login successful, force full page reload to refresh auth state
      window.location.href = "/ai-agents";
    } catch (err) {
      setError(t("login.errorNetwork"));
      setIsLoading(false);
    }
  };

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    setShowLanguageDropdown(false);
  };

  const handleGoogleLogin = async () => {
    setError("");

    if (activeTab === "signup") {
      if (!agreeTerms) {
        setError(t("login.errorAgreeTerms"));
        return;
      }
      if (!hasSelectedCountry) {
        setError(t("login.errorSelectCountry"));
        return;
      }
    }

    setIsGoogleLoading(true);
    try {
      await redirectToLogin({
        intent: activeTab,
        countryCode:
          activeTab === "signup" ? countryCode || detectedCountry || null : null,
      });
    } catch (err) {
      const message =
        err instanceof Error && err.message.trim()
          ? err.message
          : "Google login is unavailable right now.";
      setError(message);
    } finally {
      setIsGoogleLoading(false);
    }
  };

  if (isPending) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-gray-950">
        <Loader2
          className={`h-10 w-10 animate-spin ${
            isPerceptrumBrand ? "text-cyan-300" : "text-blue-400"
          }`}
        />
      </div>
    );
  }

  return (
    <div className="relative h-[100dvh] min-h-[100dvh] overflow-hidden bg-[#171717] px-4 py-[clamp(0.875rem,2.6vh,1.5rem)] text-white">
      <div className="absolute inset-0 bg-[#171717]" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className={`absolute -left-32 top-[38%] h-[24rem] w-[32rem] rounded-full blur-3xl ${
            isPerceptrumBrand ? "bg-cyan-400/[0.06]" : "bg-blue-500/[0.07]"
          }`}
        />
        <div
          className={`absolute -right-28 top-[18%] h-[21rem] w-[27rem] rounded-full blur-3xl ${
            isPerceptrumBrand ? "bg-fuchsia-500/[0.05]" : "bg-sky-400/[0.05]"
          }`}
        />
      </div>

      {/* Language Selector */}
      <div className="absolute right-[clamp(0.75rem,2vw,1.5rem)] top-[clamp(0.75rem,2.2vh,1.5rem)] z-20">
        <div className="relative">
          <button
            onClick={() => setShowLanguageDropdown(!showLanguageDropdown)}
            className={languageButtonClass}
          >
            <Globe className="w-4 h-4" />
            <span className="text-sm font-medium">
              {languages.find((l) => l.code === i18n.language)?.name || "English"}
            </span>
          </button>

          {showLanguageDropdown && (
            <div className={panelClass}>
              {languages.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => changeLanguage(lang.code)}
                  className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                    i18n.language === lang.code
                      ? selectedCountryClass
                      : "text-gray-300 hover:bg-white/[0.03]"
                  }`}
                >
                  {lang.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="relative z-10 flex h-full w-full items-center justify-center">
        <div
          className="relative flex max-w-full items-start justify-center overflow-hidden"
          style={scaledShellStyle}
        >
          <div
            ref={layoutContentRef}
            className={`${hasMeasuredLayout ? "absolute left-1/2 top-0" : "w-full"} ${
              useCompactLoginLayout ? "max-w-[26rem]" : "max-w-[27rem]"
            }`}
            style={measuredContentStyle}
          >
            <div className="px-[clamp(0.75rem,2.4vw,1rem)] py-[clamp(0.75rem,2.2vh,1.5rem)]">
          {/* Logo and title */}
          <div className="mb-[clamp(1.5rem,3vh,2.5rem)] text-center">
            <div className="mb-[clamp(0.625rem,1.8vh,0.875rem)] flex justify-center">
              <BrandLogo
                variant="full"
                theme="dark"
                surface="login"
                className="flex items-center justify-center gap-4"
                imageClassName={
                  hasDedicatedLoginWordmark
                    ? "mx-auto h-auto max-h-[clamp(6.25rem,18vh,8.75rem)] w-auto max-w-full object-contain"
                    : "mx-auto h-[clamp(4rem,9vh,5rem)] w-auto object-contain"
                }
                iconClassName="h-[clamp(3.25rem,8vh,4rem)] w-[clamp(3.25rem,8vh,4rem)] rounded-xl object-contain"
                textClassName="text-[clamp(2rem,4vw,2.5rem)] font-semibold tracking-tight text-white"
              />
            </div>
            <p className="text-[clamp(0.75rem,1.5vh,0.875rem)] text-gray-500">
              {t("login.tagline")}
            </p>
          </div>

          {/* Login Form */}
          {activeTab === "login" && (
            <form
              onSubmit={handleLocalLogin}
              className={useCompactLoginLayout ? "space-y-3" : "space-y-3.5"}
            >
              <div className="mb-[clamp(1rem,2.2vh,1.5rem)] text-center">
                <h2 className="text-[clamp(2rem,4.4vw,3rem)] font-semibold tracking-tight leading-[0.95] text-white">
                  {t("login.welcomeBack")}
                </h2>
              </div>

              {error && (
                <div className="rounded-2xl border border-red-500/35 bg-red-500/8 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              <div>
                <label className="sr-only">
                  {t("login.email")}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("login.emailPlaceholder")}
                  className={inputClass}
                  disabled={isLoading}
                />
              </div>

              <div>
                <label className="sr-only">
                  {t("login.password")}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("login.passwordPlaceholder")}
                    className={`${inputClass} pr-12`}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 transition-colors hover:text-white"
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <button type="button" className={subtleButtonClass}>
                  {t("login.forgotPassword")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("signup");
                    setError("");
                  }}
                  className={accentButtonClass}
                >
                  {t("login.signup")}
                </button>
              </div>

              <button
                type="submit"
                disabled={!isFormValid || isLoading || isGoogleLoading}
                className={`${primaryButtonClass} flex items-center justify-center gap-2 px-6`}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {t("login.loggingIn")}
                  </>
                ) : (
                  t("login.continue")
                )}
              </button>

              {googleLoginEnabled && (
                <>
                  <div className="flex items-center gap-4 pt-1">
                    <div className="h-px flex-1 bg-white/10" />
                    <button
                      type="button"
                      onClick={handleGoogleLogin}
                      disabled={isLoading || isGoogleLoading || isGoogleSignupBlocked}
                      className={iconButtonClass}
                      aria-label={t("login.continueWithGoogle")}
                    >
                      {isGoogleLoading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <GoogleIcon />
                      )}
                    </button>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>
                </>
              )}
            </form>
          )}

          {/* Signup Form */}
          {activeTab === "signup" && (
            <form
              onSubmit={handleLocalSignup}
              className={useCompactLoginLayout ? "space-y-3" : "space-y-3.5"}
            >
              <div className="mb-[clamp(1rem,2.2vh,1.5rem)] text-center">
                <h2 className="text-[clamp(2rem,4.4vw,3rem)] font-semibold tracking-tight leading-[0.95] text-white">
                  {t("login.createAccount")}
                </h2>
              </div>

              {error && (
                <div className="rounded-2xl border border-red-500/35 bg-red-500/8 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              <div>
                <label className="sr-only">
                  {t("login.email")}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("login.emailPlaceholder")}
                  className={inputClass}
                  disabled={isLoading}
                />
              </div>

              <div>
                <label className="sr-only">
                  {t("login.password")}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("login.passwordSignupPlaceholder")}
                    className={`${inputClass} pr-12`}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 transition-colors hover:text-white"
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                    aria-label={t("login.country")}
                    className={`${inputClass} text-left ${
                      selectedCountry ? "text-white" : "text-gray-500"
                    }`}
                    disabled={isLoading}
                  >
                    {selectedCountry ? selectedCountry.name : t("login.countryPlaceholder")}
                  </button>

                  {showCountryDropdown && (
                    <div className={countryDropdownClass}>
                      <div className="sticky top-0 border-b border-white/10 bg-[#171717]/95 p-2">
                        <div className="relative">
                          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                          <input
                            type="text"
                            value={countrySearch}
                            onChange={(e) => setCountrySearch(e.target.value)}
                            placeholder={t("login.searchCountry")}
                            className={`w-full rounded-full border border-white/10 bg-transparent py-2.5 pl-11 pr-4 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 ${brandFocusRingClass} ${brandFocusBorderClass}`}
                          />
                        </div>
                      </div>
                      <div className="max-h-60 overflow-y-auto">
                        {filteredCountries.map((country) => (
                          <button
                            key={country.code}
                            type="button"
                            onClick={() => {
                              setCountryCode(country.code);
                              setShowCountryDropdown(false);
                              setCountrySearch("");
                            }}
                            className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                              countryCode === country.code
                                ? selectedCountryClass
                                : "text-gray-300 hover:bg-white/[0.03]"
                            }`}
                          >
                            {country.name}
                          </button>
                        ))}
                        {filteredCountries.length === 0 && (
                          <div className="px-4 py-6 text-center text-sm text-gray-400">
                            No countries found
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="terms"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className={`mt-1 h-4 w-4 rounded border-white/10 bg-transparent ${checkboxAccentClass}`}
                  disabled={isLoading}
                />
                <label htmlFor="terms" className="text-sm leading-6 text-gray-400">
                  {t("login.agreeTerms")}{" "}
                  <a href="/terms" className={`${brandAccentTextClass} ${brandAccentHoverTextClass}`}>
                    {t("login.terms")}
                  </a>{" "}
                  {t("login.and")}{" "}
                  <a href="/privacy" className={`${brandAccentTextClass} ${brandAccentHoverTextClass}`}>
                    {t("login.privacyPolicy")}
                  </a>
                </label>
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("login");
                    setError("");
                  }}
                  className={accentButtonClass}
                >
                  {t("login.login")}
                </button>
              </div>

              {signupBlockingReasons.length > 0 && !isLoading && !isGoogleLoading && (
                <div
                  id="signup-blocking-reasons"
                  className="rounded-2xl border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm text-amber-100"
                >
                  <ul className="space-y-1.5">
                    {signupBlockingReasons.map((reason) => (
                      <li key={reason} className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-amber-300"
                        />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                type="submit"
                disabled={!isFormValid || isLoading || isGoogleLoading}
                aria-describedby={
                  signupBlockingReasons.length > 0 && !isLoading && !isGoogleLoading
                    ? "signup-blocking-reasons"
                    : undefined
                }
                className={`${primaryButtonClass} flex items-center justify-center gap-2 px-6`}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {t("login.creatingAccount")}
                  </>
                ) : (
                  t("login.continue")
                )}
              </button>

              {googleLoginEnabled && (
                <>
                  <div className="flex items-center gap-4 pt-1">
                    <div className="h-px flex-1 bg-white/10" />
                    <button
                      type="button"
                      onClick={handleGoogleLogin}
                      disabled={isLoading || isGoogleLoading || isGoogleSignupBlocked}
                      className={iconButtonClass}
                      aria-label={t("login.continueWithGoogle")}
                    >
                      {isGoogleLoading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <GoogleIcon />
                      )}
                    </button>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>
                </>
              )}
            </form>
          )}

          {/* Footer */}
          <p className="mt-[clamp(1rem,2.4vh,2rem)] text-center text-xs text-gray-600">
            {t("login.footer")}
          </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
