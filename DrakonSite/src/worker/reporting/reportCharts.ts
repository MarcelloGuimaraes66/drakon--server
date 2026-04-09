import type { ReportChartBlock, ReportDocxInput } from "./reportBlocks";
import { REPORT_THEME, reportToneInk, type ReportTone } from "./reportTheme";

type ChartDatum = {
  label: string;
  value: number;
  tone?: ReportTone;
};

function isPtLanguage(language: string | undefined): boolean {
  return typeof language === "string" && language.trim().toLowerCase().startsWith("pt");
}

function normalizeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function coerceRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
      )
    : [];
}

function toFiniteNumber(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function trimLabel(label: string, maxLength = 28): string {
  const normalized = normalizeText(label);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function svgBytes(svg: string): Uint8Array {
  return new TextEncoder().encode(svg);
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function chartToneForScore(value: number): ReportTone {
  if (value <= 45) return "critical";
  if (value <= 75) return "warning";
  if (value >= 90) return "success";
  return "primary";
}

function horizontalBarChartSvg(params: {
  title: string;
  subtitle: string;
  items: ChartDatum[];
  maxValue?: number;
}): string {
  const width = 1200;
  const height = Math.max(340, 160 + params.items.length * 84);
  const maxValue = Math.max(params.maxValue || 0, ...params.items.map((item) => item.value), 1);
  const chartLeft = 310;
  const chartWidth = 760;
  const barHeight = 34;
  const startY = 110;

  const rows = params.items
    .map((item, index) => {
      const y = startY + index * 78;
      const widthValue = Math.max(12, (item.value / maxValue) * chartWidth);
      const tone = item.tone || "primary";
      return [
        `<text x="56" y="${y + 22}" font-family="${REPORT_THEME.fonts.body}" font-size="25" fill="#${REPORT_THEME.colors.ink}">${escapeSvgText(trimLabel(item.label, 30))}</text>`,
        `<rect x="${chartLeft}" y="${y}" width="${chartWidth}" height="${barHeight}" rx="12" fill="#${REPORT_THEME.colors.surfaceMuted}"/>`,
        `<rect x="${chartLeft}" y="${y}" width="${widthValue}" height="${barHeight}" rx="12" fill="#${reportToneInk(tone)}"/>`,
        `<text x="${chartLeft + chartWidth + 26}" y="${y + 24}" text-anchor="end" font-family="${REPORT_THEME.fonts.display}" font-size="24" font-weight="700" fill="#${REPORT_THEME.colors.ink}">${escapeSvgText(String(Number(item.value.toFixed(2))))}</text>`,
      ].join("");
    })
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" rx="28" fill="#${REPORT_THEME.colors.surfaceAlt}"/>`,
    `<rect x="42" y="36" width="6" height="48" rx="3" fill="#${REPORT_THEME.colors.accent}"/>`,
    `<text x="64" y="58" font-family="${REPORT_THEME.fonts.display}" font-size="34" font-weight="700" fill="#${REPORT_THEME.colors.ink}">${escapeSvgText(params.title)}</text>`,
    `<text x="64" y="88" font-family="${REPORT_THEME.fonts.body}" font-size="20" fill="#${REPORT_THEME.colors.muted}">${escapeSvgText(params.subtitle)}</text>`,
    rows,
    "</svg>",
  ].join("");
}

function verticalBarChartSvg(params: {
  title: string;
  subtitle: string;
  items: ChartDatum[];
}): string {
  const width = 1200;
  const height = 540;
  const chartHeight = 250;
  const chartWidth = 980;
  const left = 120;
  const bottom = 430;
  const maxValue = Math.max(...params.items.map((item) => item.value), 1);
  const barGap = 36;
  const totalGaps = Math.max(0, params.items.length - 1) * barGap;
  const barWidth = Math.max(72, (chartWidth - totalGaps) / Math.max(1, params.items.length));

  const bars = params.items
    .map((item, index) => {
      const heightValue = Math.max(14, (item.value / maxValue) * chartHeight);
      const x = left + index * (barWidth + barGap);
      const y = bottom - heightValue;
      const tone = item.tone || "primary";
      return [
        `<rect x="${x}" y="${y}" width="${barWidth}" height="${heightValue}" rx="16" fill="#${reportToneInk(tone)}"/>`,
        `<text x="${x + barWidth / 2}" y="${y - 14}" text-anchor="middle" font-family="${REPORT_THEME.fonts.display}" font-size="24" font-weight="700" fill="#${REPORT_THEME.colors.ink}">${escapeSvgText(String(Number(item.value.toFixed(2))))}</text>`,
        `<text x="${x + barWidth / 2}" y="${bottom + 34}" text-anchor="middle" font-family="${REPORT_THEME.fonts.body}" font-size="22" fill="#${REPORT_THEME.colors.ink}">${escapeSvgText(trimLabel(item.label, 14))}</text>`,
      ].join("");
    })
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" rx="28" fill="#${REPORT_THEME.colors.surfaceAlt}"/>`,
    `<rect x="42" y="36" width="6" height="48" rx="3" fill="#${REPORT_THEME.colors.primary}"/>`,
    `<text x="64" y="58" font-family="${REPORT_THEME.fonts.display}" font-size="34" font-weight="700" fill="#${REPORT_THEME.colors.ink}">${escapeSvgText(params.title)}</text>`,
    `<text x="64" y="88" font-family="${REPORT_THEME.fonts.body}" font-size="20" fill="#${REPORT_THEME.colors.muted}">${escapeSvgText(params.subtitle)}</text>`,
    `<line x1="${left}" y1="${bottom}" x2="${left + chartWidth}" y2="${bottom}" stroke="#${REPORT_THEME.colors.lineStrong}" stroke-width="2"/>`,
    bars,
    "</svg>",
  ].join("");
}

function buildSignalChart(input: ReportDocxInput, isPt: boolean): ReportChartBlock | null {
  const stats = new Map<string, string>();
  for (const stat of input.stats || []) {
    const key = normalizeText(stat.label).toLowerCase();
    if (key) {
      stats.set(key, normalizeText(stat.value));
    }
  }

  const items = [
    {
      label: isPt ? "Detecções" : "Detections",
      value: toFiniteNumber(
        stats.get("detecções na janela") ||
          stats.get("deteccoes na janela") ||
          stats.get("detections in window")
      ),
      tone: "success",
    },
    {
      label: isPt ? "Alertas" : "Alerts",
      value: toFiniteNumber(stats.get("alertas na janela") || stats.get("alerts in window")),
      tone: "warning",
    },
    {
      label: isPt ? "Comandos" : "Commands",
      value: toFiniteNumber(stats.get("comandos na janela") || stats.get("commands in window")),
      tone: "primary",
    },
    {
      label: isPt ? "Erros" : "Errors",
      value: toFiniteNumber(
        stats.get("erros de agentes na janela") || stats.get("agent errors in window")
      ),
      tone: "critical",
    },
  ] satisfies ChartDatum[];

  const visibleItems = items.filter((item) => item.value > 0);

  if (visibleItems.length === 0) {
    return null;
  }

  return {
    title: isPt ? "Volume operacional" : "Operational volume",
    caption: isPt
      ? "Leitura rápida da movimentação do período selecionado."
      : "Quick read of the selected window's operational flow.",
    filename: "chart-operational-volume.svg",
    contentType: "image/svg+xml",
    bytes: svgBytes(
      verticalBarChartSvg({
        title: isPt ? "Volume operacional" : "Operational volume",
        subtitle: isPt ? "Detecções, alertas, comandos e erros" : "Detections, alerts, commands, and errors",
        items: visibleItems,
      })
    ),
  };
}

export function buildReportCharts(input: ReportDocxInput): ReportChartBlock[] {
  const context = input.context || {};
  const comparisons = context.comparisons || {};
  const isPt = isPtLanguage(context.replyLanguage);
  const charts: ReportChartBlock[] = [];

  const cameraRows = coerceRows(comparisons.cameras)
    .map((row) => ({
      label: normalizeText(row.camera_name, `Camera ${normalizeText(row.camera_id, "")}`),
      value: toFiniteNumber(row.stability_score),
      tone: chartToneForScore(toFiniteNumber(row.stability_score)),
    }))
    .filter((row) => row.label && row.value >= 0)
    .slice(0, 5);

  if (cameraRows.length > 0) {
    charts.push({
      title: isPt ? "Estabilidade por câmera" : "Stability by camera",
      caption: isPt
        ? "Score agregado por câmera no recorte analisado."
        : "Aggregated camera score for the selected window.",
      filename: "chart-camera-stability.svg",
      contentType: "image/svg+xml",
      bytes: svgBytes(
        horizontalBarChartSvg({
          title: isPt ? "Estabilidade por câmera" : "Stability by camera",
          subtitle: isPt ? "Quanto maior, mais estável" : "Higher means more stable",
          items: cameraRows,
          maxValue: 100,
        })
      ),
    });
  }

  const jobRows = coerceRows(comparisons.jobs)
    .map((row) => ({
      label: normalizeText(row.job_name, `Job ${normalizeText(row.job_id, "")}`),
      value: toFiniteNumber(row.activity_score || row.run_count),
      tone: "primary" as const,
    }))
    .filter((row) => row.label && row.value > 0)
    .slice(0, 5);

  if (jobRows.length > 0) {
    charts.push({
      title: isPt ? "Atividade de jobs" : "Job activity",
      caption: isPt
        ? "Jobs com maior score de atividade recente."
        : "Jobs with the highest recent activity score.",
      filename: "chart-job-activity.svg",
      contentType: "image/svg+xml",
      bytes: svgBytes(
        horizontalBarChartSvg({
          title: isPt ? "Atividade de jobs" : "Job activity",
          subtitle: isPt ? "Baseado em runs, etapas e alertas" : "Based on runs, steps, and alerts",
          items: jobRows,
        })
      ),
    });
  }

  const signalChart = buildSignalChart(input, isPt);
  if (signalChart) {
    charts.push(signalChart);
  }

  return charts.slice(0, 3);
}
