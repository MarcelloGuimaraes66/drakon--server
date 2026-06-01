import { useEffect, useState } from "react";

type LoginHorizonScanProps = {
  className?: string;
};

type ConnectionNavigator = Navigator & {
  connection?: {
    saveData?: boolean;
  };
};

export default function LoginHorizonScan({
  className = "",
}: LoginHorizonScanProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const nav = navigator as ConnectionNavigator;

    const updateMotionPreference = () => {
      setPrefersReducedMotion(
        mediaQuery.matches || Boolean(nav.connection?.saveData)
      );
    };

    updateMotionPreference();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateMotionPreference);
    } else {
      mediaQuery.addListener(updateMotionPreference);
    }

    return () => {
      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", updateMotionPreference);
      } else {
        mediaQuery.removeListener(updateMotionPreference);
      }
    };
  }, []);

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid slice"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`.trim()}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id="perceptrum-login-bg"
          x1="130"
          y1="46"
          x2="1466"
          y2="854"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#040915" />
          <stop offset="0.55" stopColor="#06101C" />
          <stop offset="1" stopColor="#02050F" />
        </linearGradient>
        <linearGradient
          id="perceptrum-login-line"
          x1="148"
          y1="0"
          x2="1452"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#50E0F8" stopOpacity="0" />
          <stop offset="0.18" stopColor="#50E0F8" stopOpacity="0.32" />
          <stop offset="0.5" stopColor="#9AF5FF" stopOpacity="0.52" />
          <stop offset="0.82" stopColor="#D870F8" stopOpacity="0.28" />
          <stop offset="1" stopColor="#D870F8" stopOpacity="0" />
        </linearGradient>
        <radialGradient
          id="perceptrum-login-cyan-glow"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(280 486) rotate(10) scale(388 198)"
        >
          <stop stopColor="#50E0F8" stopOpacity="0.14" />
          <stop offset="1" stopColor="#50E0F8" stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id="perceptrum-login-magenta-glow"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(1318 420) rotate(-10) scale(356 184)"
        >
          <stop stopColor="#D870F8" stopOpacity="0.12" />
          <stop offset="1" stopColor="#D870F8" stopOpacity="0" />
        </radialGradient>
        <filter
          id="perceptrum-login-blur44"
          x="-160"
          y="-160"
          width="1920"
          height="1220"
          filterUnits="userSpaceOnUse"
        >
          <feGaussianBlur stdDeviation="44" />
        </filter>
        <filter
          id="perceptrum-login-blur18"
          x="-80"
          y="-80"
          width="1760"
          height="1060"
          filterUnits="userSpaceOnUse"
        >
          <feGaussianBlur stdDeviation="18" />
        </filter>
      </defs>

      <rect width="1600" height="900" fill="url(#perceptrum-login-bg)" />

      <ellipse
        cx="280"
        cy="486"
        rx="340"
        ry="176"
        fill="url(#perceptrum-login-cyan-glow)"
        filter="url(#perceptrum-login-blur44)"
      >
        {!prefersReducedMotion && (
          <animate
            attributeName="opacity"
            values="0.7;1;0.7"
            dur="16s"
            repeatCount="indefinite"
          />
        )}
      </ellipse>
      <ellipse
        cx="1318"
        cy="420"
        rx="318"
        ry="166"
        fill="url(#perceptrum-login-magenta-glow)"
        filter="url(#perceptrum-login-blur44)"
      >
        {!prefersReducedMotion && (
          <animate
            attributeName="opacity"
            values="0.72;0.96;0.72"
            dur="18s"
            repeatCount="indefinite"
          />
        )}
      </ellipse>

      <g opacity="0.24">
        <path d="M0 272H1600" stroke="#8DEFFF" strokeOpacity="0.08" />
        <path d="M0 628H1600" stroke="#D48DF8" strokeOpacity="0.06" />
      </g>

      <g transform="translate(0 452)">
        <path d="M148 0H1452" stroke="url(#perceptrum-login-line)" strokeWidth="1.2" />
        <path
          d="M148 0H1452"
          stroke="url(#perceptrum-login-line)"
          strokeWidth="7"
          strokeLinecap="round"
          opacity="0.14"
          filter="url(#perceptrum-login-blur18)"
        />
        <g opacity="0.46">
          <path d="M214 -12V12" stroke="#8EF1FF" strokeOpacity="0.3" strokeWidth="1.2" />
          <path d="M314 -8V8" stroke="#8EF1FF" strokeOpacity="0.18" strokeWidth="1" />
          <path d="M1288 -12V12" stroke="#D870F8" strokeOpacity="0.24" strokeWidth="1.2" />
          <path d="M1388 -8V8" stroke="#D870F8" strokeOpacity="0.16" strokeWidth="1" />
        </g>
        {!prefersReducedMotion && (
          <g>
            <circle r="4.5" fill="#9CF6FF">
              <animateMotion
                dur="10s"
                repeatCount="indefinite"
                path="M148 0H1452"
              />
            </circle>
            <circle r="4.2" fill="#D870F8">
              <animateMotion
                dur="13s"
                repeatCount="indefinite"
                begin="-6s"
                path="M1452 0H148"
              />
            </circle>
          </g>
        )}
      </g>

      <g transform="translate(178 452)" opacity="0.7">
        <circle r="34" stroke="#50E0F8" strokeOpacity="0.18" strokeWidth="1" />
        <circle r="86" stroke="#50E0F8" strokeOpacity="0.12" strokeWidth="1" />
        <path
          d="M-62 -58A86 86 0 0 1 58 -62"
          stroke="#9CF6FF"
          strokeOpacity="0.28"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>

      <g transform="translate(1422 452)" opacity="0.58">
        <circle r="28" stroke="#D870F8" strokeOpacity="0.18" strokeWidth="1" />
        <circle r="74" stroke="#D870F8" strokeOpacity="0.12" strokeWidth="1" />
        <path
          d="M-52 52A74 74 0 0 0 52 50"
          stroke="#D870F8"
          strokeOpacity="0.3"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
