import type { MetalId } from "@/lib/metals";

export type BandProfile = "flat" | "rounded" | "knife-edge";
export type StoneShape = "round" | "oval" | "cushion" | "emerald" | "pear" | "none";
export type StoneColor = "diamond" | "sapphire" | "ruby" | "emerald";
export type ProngCount = 0 | 4 | 6;

/** The complete design state. Every field is directly controllable by the user (D1) or by Claude (D2). */
export interface RingParams {
  /** US ring size 3–13; size 7 = 17.35mm inner diameter. */
  ringSize: number;
  /** Band width measured along the finger, 1.5–8mm. */
  bandWidthMm: number;
  /** Band thickness measured radially, 1–3mm. */
  bandThicknessMm: number;
  bandProfile: BandProfile;
  metal: MetalId;
  stoneShape: StoneShape;
  /** Center stone weight, 0.25–5ct. */
  stoneCarat: number;
  stoneColor: StoneColor;
  prongCount: ProngCount;
  halo: boolean;
  /** Small stones along the top arc of the band. */
  paveBand: boolean;
}

export interface NumericBound {
  min: number;
  max: number;
  step: number;
}

export const RING_PARAM_BOUNDS = {
  ringSize: { min: 3, max: 13, step: 0.25 },
  bandWidthMm: { min: 1.5, max: 8, step: 0.1 },
  bandThicknessMm: { min: 1, max: 3, step: 0.05 },
  stoneCarat: { min: 0.25, max: 5, step: 0.05 },
} as const satisfies Record<string, NumericBound>;

export const BAND_PROFILES: readonly { value: BandProfile; label: string }[] = [
  { value: "rounded", label: "Rounded" },
  { value: "flat", label: "Flat" },
  { value: "knife-edge", label: "Knife-edge" },
];

export const STONE_SHAPES: readonly { value: StoneShape; label: string }[] = [
  { value: "round", label: "Round" },
  { value: "oval", label: "Oval" },
  { value: "cushion", label: "Cushion" },
  { value: "emerald", label: "Emerald" },
  { value: "pear", label: "Pear" },
  { value: "none", label: "No stone" },
];

export const STONE_COLORS: readonly { value: StoneColor; label: string }[] = [
  { value: "diamond", label: "Diamond" },
  { value: "sapphire", label: "Sapphire" },
  { value: "ruby", label: "Ruby" },
  { value: "emerald", label: "Emerald" },
];

export const PRONG_COUNTS: readonly { value: ProngCount; label: string }[] = [
  { value: 0, label: "None" },
  { value: 4, label: "4 prong" },
  { value: 6, label: "6 prong" },
];

export const DEFAULT_RING_PARAMS: RingParams = {
  ringSize: 7,
  bandWidthMm: 2,
  bandThicknessMm: 1.6,
  bandProfile: "rounded",
  metal: "yellow_gold",
  stoneShape: "round",
  stoneCarat: 1,
  stoneColor: "diamond",
  prongCount: 4,
  halo: false,
  paveBand: false,
};

function clampNumber(value: number, bound: NumericBound, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(bound.max, Math.max(bound.min, value));
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Forces any candidate params back inside the supported ranges and enums.
 * D2 runs every model-produced update through this — never trust the arithmetic.
 */
export function clampRingParams(candidate: RingParams): RingParams {
  return {
    ringSize: clampNumber(
      candidate.ringSize,
      RING_PARAM_BOUNDS.ringSize,
      DEFAULT_RING_PARAMS.ringSize,
    ),
    bandWidthMm: clampNumber(
      candidate.bandWidthMm,
      RING_PARAM_BOUNDS.bandWidthMm,
      DEFAULT_RING_PARAMS.bandWidthMm,
    ),
    bandThicknessMm: clampNumber(
      candidate.bandThicknessMm,
      RING_PARAM_BOUNDS.bandThicknessMm,
      DEFAULT_RING_PARAMS.bandThicknessMm,
    ),
    bandProfile: oneOf(
      candidate.bandProfile,
      BAND_PROFILES.map((option) => option.value),
      DEFAULT_RING_PARAMS.bandProfile,
    ),
    metal: oneOf(
      candidate.metal,
      ["yellow_gold", "rose_gold", "white_gold", "platinum"] as const,
      DEFAULT_RING_PARAMS.metal,
    ),
    stoneShape: oneOf(
      candidate.stoneShape,
      STONE_SHAPES.map((option) => option.value),
      DEFAULT_RING_PARAMS.stoneShape,
    ),
    stoneCarat: clampNumber(
      candidate.stoneCarat,
      RING_PARAM_BOUNDS.stoneCarat,
      DEFAULT_RING_PARAMS.stoneCarat,
    ),
    stoneColor: oneOf(
      candidate.stoneColor,
      STONE_COLORS.map((option) => option.value),
      DEFAULT_RING_PARAMS.stoneColor,
    ),
    prongCount: oneOf(
      candidate.prongCount,
      PRONG_COUNTS.map((option) => option.value),
      DEFAULT_RING_PARAMS.prongCount,
    ),
    halo: Boolean(candidate.halo),
    paveBand: Boolean(candidate.paveBand),
  };
}
