export const REPORT_THEME = {
  fonts: {
    body: "Aptos",
    display: "Aptos Display",
    mono: "Consolas",
  },
  colors: {
    ink: "1F2937",
    muted: "667085",
    line: "D0D5DD",
    lineStrong: "98A2B3",
    surface: "FFFFFF",
    surfaceAlt: "F8FAFC",
    surfaceMuted: "EEF4FF",
    surfaceStrong: "102A43",
    primary: "0F4C81",
    primarySoft: "EAF3FF",
    accent: "14B8A6",
    accentSoft: "EAFBF6",
    success: "15803D",
    successSoft: "F0FDF4",
    warning: "D97706",
    warningSoft: "FFF7ED",
    danger: "C62828",
    dangerSoft: "FEF2F2",
    white: "FFFFFF",
  },
  page: {
    widthTwips: 12_240,
    heightTwips: 15_840,
    marginTwips: 1_080,
    headerTwips: 540,
    footerTwips: 540,
  },
  media: {
    heroWidthTwips: 10_080,
    chartWidthEmu: 5_950_000,
    chartHeightEmu: 3_200_000,
    galleryWidthEmu: 3_950_000,
    galleryHeightEmu: 2_221_875,
    posterWidthEmu: 4_450_000,
    posterHeightEmu: 2_503_125,
    fullWidthImageEmu: 5_800_000,
    fullWidthImageHeightEmu: 3_262_500,
  },
} as const;

export type ReportTone = "primary" | "success" | "warning" | "critical" | "neutral";

export function reportToneFill(tone: ReportTone): string {
  switch (tone) {
    case "success":
      return REPORT_THEME.colors.successSoft;
    case "warning":
      return REPORT_THEME.colors.warningSoft;
    case "critical":
      return REPORT_THEME.colors.dangerSoft;
    case "neutral":
      return REPORT_THEME.colors.surfaceAlt;
    case "primary":
    default:
      return REPORT_THEME.colors.primarySoft;
  }
}

export function reportToneInk(tone: ReportTone): string {
  switch (tone) {
    case "success":
      return REPORT_THEME.colors.success;
    case "warning":
      return REPORT_THEME.colors.warning;
    case "critical":
      return REPORT_THEME.colors.danger;
    case "neutral":
      return REPORT_THEME.colors.ink;
    case "primary":
    default:
      return REPORT_THEME.colors.primary;
  }
}

export function reportContentWidthTwips(): number {
  return REPORT_THEME.page.widthTwips - REPORT_THEME.page.marginTwips * 2;
}
