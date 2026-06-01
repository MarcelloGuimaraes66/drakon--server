import type { BrazilStateCode } from "@/shared/brazilStates";

export type BrazilStateTile = {
  code: BrazilStateCode;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const BRAZIL_TILEMAP_VIEWBOX = {
  width: 900,
  height: 930,
} as const;

export const BRAZIL_STATE_TILES: BrazilStateTile[] = [
  { code: "RR", x: 198, y: 54, width: 86, height: 52 },
  { code: "AP", x: 648, y: 98, width: 78, height: 52 },
  { code: "AM", x: 164, y: 134, width: 156, height: 92 },
  { code: "PA", x: 348, y: 132, width: 184, height: 86 },
  { code: "AC", x: 72, y: 270, width: 82, height: 56 },
  { code: "RO", x: 170, y: 270, width: 86, height: 56 },
  { code: "TO", x: 506, y: 268, width: 96, height: 70 },
  { code: "MA", x: 616, y: 238, width: 98, height: 66 },
  { code: "PI", x: 724, y: 238, width: 80, height: 66 },
  { code: "CE", x: 812, y: 238, width: 66, height: 66 },
  { code: "RN", x: 852, y: 206, width: 42, height: 42 },
  { code: "PB", x: 852, y: 258, width: 42, height: 42 },
  { code: "PE", x: 804, y: 312, width: 88, height: 60 },
  { code: "AL", x: 824, y: 384, width: 60, height: 48 },
  { code: "SE", x: 862, y: 408, width: 36, height: 42 },
  { code: "BA", x: 674, y: 362, width: 142, height: 132 },
  { code: "MT", x: 304, y: 344, width: 154, height: 118 },
  { code: "GO", x: 502, y: 382, width: 104, height: 82 },
  { code: "DF", x: 548, y: 430, width: 28, height: 28 },
  { code: "MS", x: 324, y: 484, width: 120, height: 102 },
  { code: "MG", x: 602, y: 520, width: 132, height: 98 },
  { code: "ES", x: 750, y: 522, width: 48, height: 86 },
  { code: "RJ", x: 734, y: 620, width: 62, height: 44 },
  { code: "SP", x: 540, y: 624, width: 136, height: 80 },
  { code: "PR", x: 522, y: 718, width: 116, height: 66 },
  { code: "SC", x: 560, y: 794, width: 92, height: 44 },
  { code: "RS", x: 496, y: 844, width: 144, height: 72 },
];
