import { useEffect, useRef } from "react";

type ChatPlexusBackgroundProps = {
  className?: string;
};

type Particle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  hueMix: number;
  twinkleOffset: number;
  twinkleSpeed: number;
  driftSeedX: number;
  driftSeedY: number;
  driftSeedZ: number;
};

const MAX_DPR = 1.75;
const MIN_PARTICLES = 18;
const MAX_PARTICLES = 34;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function wrap(value: number, min: number, max: number): number {
  const range = max - min;
  if (range <= 0) return min;
  let nextValue = value;
  while (nextValue < min) nextValue += range;
  while (nextValue > max) nextValue -= range;
  return nextValue;
}

function mixChannel(start: number, end: number, amount: number): number {
  return Math.round(start + (end - start) * amount);
}

function createParticle(width: number, height: number): Particle {
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    z: Math.random(),
    vx: (Math.random() - 0.5) * 0.34,
    vy: (Math.random() - 0.5) * 0.24,
    vz: (Math.random() - 0.5) * 0.008,
    radius: 0.85 + Math.random() * 1.45,
    hueMix: Math.random(),
    twinkleOffset: Math.random() * Math.PI * 2,
    twinkleSpeed: 0.75 + Math.random() * 0.8,
    driftSeedX: Math.random() * Math.PI * 2,
    driftSeedY: Math.random() * Math.PI * 2,
    driftSeedZ: Math.random() * Math.PI * 2,
  };
}

export default function ChatPlexusBackground({
  className = "",
}: ChatPlexusBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = {
      currentX: 0,
      currentY: 0,
      targetX: 0,
      targetY: 0,
    };

    let reducedMotion = mediaQuery.matches;
    let width = 1;
    let height = 1;
    let particles: Particle[] = [];
    let frameId = 0;
    let lastTimestamp = performance.now();

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);

      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const particleCount = clamp(Math.round((width * height) / 42000), MIN_PARTICLES, MAX_PARTICLES);
      particles = Array.from({ length: particleCount }, () => createParticle(width, height));
    };

    const draw = (timestamp: number) => {
      const frameDelta = Math.min((timestamp - lastTimestamp) / 16.6667, 2.2);
      lastTimestamp = timestamp;

      pointer.currentX += (pointer.targetX - pointer.currentX) * 0.055;
      pointer.currentY += (pointer.targetY - pointer.currentY) * 0.055;

      context.clearRect(0, 0, width, height);

      const connectionDistance = width < 768 ? 120 : 150;
      const connectionDistanceSq = connectionDistance * connectionDistance;
      const edgePadding = 80;

      const renderedParticles = particles.map((particle) => {
        if (!reducedMotion) {
          particle.x = wrap(
            particle.x +
              (particle.vx + Math.sin(timestamp * 0.00018 + particle.driftSeedX) * 0.18) * frameDelta,
            -edgePadding,
            width + edgePadding,
          );
          particle.y = wrap(
            particle.y +
              (particle.vy + Math.cos(timestamp * 0.00015 + particle.driftSeedY) * 0.14) * frameDelta,
            -edgePadding,
            height + edgePadding,
          );
          particle.z = wrap(
            particle.z +
              (particle.vz + Math.sin(timestamp * 0.00011 + particle.driftSeedZ) * 0.0035) * frameDelta,
            0,
            1,
          );
        }

        const depthScale = 0.68 + particle.z * 0.86;
        const pulse = 0.65 + (Math.sin(timestamp * 0.0012 * particle.twinkleSpeed + particle.twinkleOffset) + 1) * 0.175;
        const parallaxX = pointer.currentX * (0.18 + particle.z * 0.55);
        const parallaxY = pointer.currentY * (0.18 + particle.z * 0.55);
        const x = particle.x + parallaxX;
        const y = particle.y + parallaxY;
        const alpha = (0.12 + particle.z * 0.22) * pulse;
        const radius = particle.radius * depthScale;
        const color = {
          r: mixChannel(45, 83, particle.hueMix),
          g: mixChannel(212, 154, particle.hueMix),
          b: mixChannel(191, 255, particle.hueMix),
        };

        return {
          particle,
          x,
          y,
          alpha,
          radius,
          depthScale,
          color,
        };
      });

      for (let index = 0; index < renderedParticles.length; index += 1) {
        const source = renderedParticles[index];
        for (let pairIndex = index + 1; pairIndex < renderedParticles.length; pairIndex += 1) {
          const target = renderedParticles[pairIndex];
          const dx = source.x - target.x;
          const dy = source.y - target.y;
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq > connectionDistanceSq) continue;

          const depthGap = Math.abs(source.particle.z - target.particle.z);
          if (depthGap > 0.42) continue;

          const distance = Math.sqrt(distanceSq);
          const intensity = 1 - distance / connectionDistance;
          const alpha = intensity * (0.025 + (1 - depthGap) * 0.05);
          if (alpha <= 0.008) continue;

          const blend = (source.particle.hueMix + target.particle.hueMix) / 2;
          const lineColor = [
            mixChannel(42, 73, blend),
            mixChannel(190, 150, blend),
            mixChannel(170, 255, blend),
          ];

          context.beginPath();
          context.moveTo(source.x, source.y);
          context.lineTo(target.x, target.y);
          context.lineWidth = 0.35 + ((source.depthScale + target.depthScale) / 2) * 0.28;
          context.strokeStyle = `rgba(${lineColor[0]}, ${lineColor[1]}, ${lineColor[2]}, ${alpha})`;
          context.stroke();
        }
      }

      for (const particle of renderedParticles) {
        const glowRadius = particle.radius * 5.6;
        const glow = context.createRadialGradient(
          particle.x,
          particle.y,
          0,
          particle.x,
          particle.y,
          glowRadius,
        );
        glow.addColorStop(0, `rgba(${particle.color.r}, ${particle.color.g}, ${particle.color.b}, ${particle.alpha * 0.24})`);
        glow.addColorStop(0.5, `rgba(${particle.color.r}, ${particle.color.g}, ${particle.color.b}, ${particle.alpha * 0.08})`);
        glow.addColorStop(1, `rgba(${particle.color.r}, ${particle.color.g}, ${particle.color.b}, 0)`);
        context.fillStyle = glow;
        context.beginPath();
        context.arc(particle.x, particle.y, glowRadius, 0, Math.PI * 2);
        context.fill();

        context.fillStyle = `rgba(${particle.color.r}, ${particle.color.g}, ${particle.color.b}, ${particle.alpha * 0.85})`;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();
      }

      if (!reducedMotion) {
        frameId = window.requestAnimationFrame(draw);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      ) {
        pointer.targetX = 0;
        pointer.targetY = 0;
        return;
      }

      const normalizedX = (event.clientX - bounds.left) / bounds.width - 0.5;
      const normalizedY = (event.clientY - bounds.top) / bounds.height - 0.5;
      pointer.targetX = normalizedX * 26;
      pointer.targetY = normalizedY * 22;
    };

    const handlePointerLeave = () => {
      pointer.targetX = 0;
      pointer.targetY = 0;
    };

    const handleReducedMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      window.cancelAnimationFrame(frameId);
      lastTimestamp = performance.now();
      draw(lastTimestamp);
    };

    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(canvas);

    resize();
    draw(lastTimestamp);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("blur", handlePointerLeave);
    window.addEventListener("resize", resize);
    mediaQuery.addEventListener("change", handleReducedMotionChange);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("blur", handlePointerLeave);
      window.removeEventListener("resize", resize);
      mediaQuery.removeEventListener("change", handleReducedMotionChange);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] ${className}`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_8%,rgba(84,96,152,0.2),transparent_48%),radial-gradient(circle_at_18%_82%,rgba(45,212,191,0.08),transparent_30%),radial-gradient(circle_at_82%_76%,rgba(79,154,255,0.07),transparent_34%)]" />
      <div className="absolute inset-x-0 top-0 h-[38%] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.05),transparent_72%)] opacity-70" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,10,16,0.08)_0%,rgba(8,10,16,0)_24%,rgba(8,10,16,0)_74%,rgba(8,10,16,0.18)_100%)]" />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full opacity-85 [mask-image:radial-gradient(circle_at_center,black_0%,black_60%,transparent_100%)]"
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_48%,rgba(5,6,10,0.26)_100%)]" />
    </div>
  );
}
