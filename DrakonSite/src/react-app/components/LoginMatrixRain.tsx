import { useEffect, useRef } from "react";

type LoginMatrixRainProps = {
  className?: string;
};

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+-=<>?/[]{}";
const MAX_DPR = 1.5;
const DESKTOP_FPS = 22;
const MOBILE_FPS = 16;

const randomChar = (): string =>
  CHARSET[Math.floor(Math.random() * CHARSET.length)] || "A";

export default function LoginMatrixRain({ className = "" }: LoginMatrixRainProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    const saveData = Boolean(nav.connection?.saveData);

    let prefersReducedMotion = mediaQuery.matches || saveData;
    let width = 0;
    let height = 0;
    let fontSize = 14;
    let columns = 0;
    let frameInterval = 1000 / DESKTOP_FPS;
    let drops: number[] = [];
    let speeds: number[] = [];
    let rafId = 0;
    let running = false;
    let lastFrameTime = 0;

    const initColumns = (isMobile: boolean) => {
      const step = (isMobile ? 1.4 : 1.25) * fontSize;
      columns = Math.max(12, Math.floor(width / step));
      drops = Array.from(
        { length: columns },
        () => -Math.random() * (height / Math.max(fontSize, 1))
      );
      speeds = Array.from(
        { length: columns },
        () => (isMobile ? 0.4 : 0.5) + Math.random() * (isMobile ? 0.35 : 0.55)
      );
    };

    const drawStatic = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = "rgba(17, 17, 17, 0.92)";
      ctx.fillRect(0, 0, width, height);
      ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
      ctx.textBaseline = "top";

      for (let i = 0; i < columns; i += 1) {
        const x = (i * width) / columns;
        const y = Math.random() * height;
        ctx.fillStyle = "rgba(74, 149, 255, 0.22)";
        ctx.fillText(randomChar(), x, y);
      }
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      const isMobile = width < 768;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fontSize = isMobile ? 12 : 14;
      frameInterval = 1000 / (isMobile ? MOBILE_FPS : DESKTOP_FPS);
      ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
      ctx.textBaseline = "top";

      initColumns(isMobile);

      if (prefersReducedMotion) {
        drawStatic();
      } else {
        ctx.fillStyle = "rgb(17, 17, 17)";
        ctx.fillRect(0, 0, width, height);
      }
    };

    const drawFrame = (time: number) => {
      ctx.fillStyle = "rgba(17, 17, 17, 0.2)";
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < columns; i += 1) {
        const x = (i * width) / columns;
        const y = drops[i] * fontSize;
        const tailY = y - fontSize * 1.15;

        ctx.fillStyle = "rgba(74, 149, 255, 0.2)";
        ctx.fillText(randomChar(), x, tailY);

        const glow = ((i + Math.floor(time / 220)) % 5) === 0;
        if (glow) {
          ctx.shadowColor = "rgba(74, 149, 255, 0.65)";
          ctx.shadowBlur = 7;
          ctx.fillStyle = "rgba(140, 198, 255, 0.96)";
        } else {
          ctx.shadowBlur = 0;
          ctx.fillStyle = "rgba(106, 171, 255, 0.78)";
        }
        ctx.fillText(randomChar(), x, y);

        drops[i] += speeds[i];
        if (y > height + fontSize * 2) {
          drops[i] = -Math.random() * (height / Math.max(fontSize, 1)) * 0.45;
          speeds[i] = (width < 768 ? 0.4 : 0.5) + Math.random() * (width < 768 ? 0.35 : 0.55);
        }
      }
      ctx.shadowBlur = 0;
    };

    const tick = (time: number) => {
      if (!running || prefersReducedMotion) return;
      if (lastFrameTime === 0 || time - lastFrameTime >= frameInterval) {
        drawFrame(time);
        lastFrameTime = time;
      }
      rafId = window.requestAnimationFrame(tick);
    };

    const stop = () => {
      running = false;
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    const start = () => {
      if (running || prefersReducedMotion) return;
      running = true;
      lastFrameTime = 0;
      rafId = window.requestAnimationFrame(tick);
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else if (!prefersReducedMotion) {
        start();
      } else {
        drawStatic();
      }
    };

    const onMotionPreferenceChange = () => {
      prefersReducedMotion = mediaQuery.matches || saveData;
      if (prefersReducedMotion) {
        stop();
        drawStatic();
      } else {
        resize();
        start();
      }
    };

    resize();
    if (!prefersReducedMotion && !document.hidden) {
      start();
    }

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", onMotionPreferenceChange);
    } else {
      mediaQuery.addListener(onMotionPreferenceChange);
    }

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", onMotionPreferenceChange);
      } else {
        mediaQuery.removeListener(onMotionPreferenceChange);
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`.trim()}
    />
  );
}
