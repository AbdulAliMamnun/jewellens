import type { MetalId } from "@/lib/metals";

export type BandProfile = "flat" | "rounded" | "knife-edge";
export type StoneShape =
  | "round"
  | "oval"
  | "cushion"
  | "emerald"
  | "pear"
  | "princess"
  | "radiant"
  | "marquise"
  | "none";
export type StoneColor = "diamond" | "sapphire" | "ruby" | "emerald";
export type ProngCount = 0 | 4 | 6;
export type SettingType = "prong" | "bezel";
export type HaloStyle = "none" | "standard" | "hidden";
export type PaveCoverage = "none" | "half" | "three_quarter" | "full";

/** The complete design state. Every field is directly controllable by the user or by Claude. */
export interface RingParams {
  /** US ring size 3–13; size 7 = 17.35mm inner diameter. */
  ringSize: number;
  /** Band width measured along the finger, 1.5–8mm. */
  bandWidthMm: number;
  /** Band thickness measured radially, 1–3mm. */
  bandThicknessMm: number;
  bandProfile: BandProfile;
  /** Shoulders sweep up to meet a raised setting head. */
  cathedral: boolean;
  metal: MetalId;
  stoneShape: StoneShape;
  /** Center stone weight, 0.25–5ct. */
  stoneCarat: number;
  stoneColor: StoneColor;
  /** How the center stone is held. `bezel` replaces prongs entirely. */
  settingType: SettingType;
  /** Ignored when settingType is "bezel". */
  prongCount: ProngCount;
  /** "hidden" rings the base of the head instead of the girdle. */
  haloStyle: HaloStyle;
  /** How far accent stones run around the band. */
  paveCoverage: PaveCoverage;
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
  { value: "princess", label: "Princess" },
  { value: "radiant", label: "Radiant" },
  { value: "marquise", label: "Marquise" },
  { value: "none", label: "No stone" },
];

export const STONE_COLORS: readonly { value: StoneColor; label: string }[] = [
  { value: "diamond", label: "Diamond" },
  { value: "sapphire", label: "Sapphire" },
  { value: "ruby", label: "Ruby" },
  { value: "emerald", label: "Emerald" },
];

export const SETTING_TYPES: readonly { value: SettingType; label: string }[] = [
  { value: "prong", label: "Prongs" },
  { value: "bezel", label: "Bezel" },
];

export const PRONG_COUNTS: readonly { value: ProngCount; label: string }[] = [
  { value: 0, label: "None" },
  { value: 4, label: "4 prong" },
  { value: 6, label: "6 prong" },
];

export const HALO_STYLES: readonly { value: HaloStyle; label: string }[] = [
  { value: "none", label: "None" },
  { value: "standard", label: "Standard" },
  { value: "hidden", label: "Hidden" },
];

export const PAVE_COVERAGES: readonly { value: PaveCoverage; label: string }[] = [
  { value: "none", label: "None" },
  { value: "half", label: "Half" },
  { value: "three_quarter", label: "¾" },
  { value: "full", label: "Full (eternity)" },
];

export const DEFAULT_RING_PARAMS: RingParams = {
  ringSize: 7,
  bandWidthMm: 2,
  bandThicknessMm: 1.6,
  bandProfile: "rounded",
  cathedral: false,
  metal: "yellow_gold",
  stoneShape: "round",
  stoneCarat: 1,
  stoneColor: "diamond",
  settingType: "prong",
  prongCount: 4,
  haloStyle: "none",
  paveCoverage: "none",
};

export const RING_PARAM_KEYS = [
  "ringSize",
  "bandWidthMm",
  "bandThicknessMm",
  "bandProfile",
  "cathedral",
  "metal",
  "stoneShape",
  "stoneCarat",
  "stoneColor",
  "settingType",
  "prongCount",
  "haloStyle",
  "paveCoverage",
] as const satisfies readonly (keyof RingParams)[];

export function isRingParamKey(value: string): value is keyof RingParams {
  return (RING_PARAM_KEYS as readonly string[]).includes(value);
}

/** Which fields actually differ — ground truth for highlighting what a turn changed. */
export function diffRingParams(
  before: RingParams,
  after: RingParams,
): (keyof RingParams)[] {
  return RING_PARAM_KEYS.filter((key) => before[key] !== after[key]);
}

/**
 * Params as they may arrive from an older client or from a model trained on the
 * v1 schema, where halo and pavé were booleans.
 */
export interface LegacyRingParams extends Partial<Omit<RingParams, "haloStyle" | "paveCoverage">> {
  haloStyle?: HaloStyle;
  paveCoverage?: PaveCoverage;
  /** v1: halo on/off. */
  halo?: boolean;
  /** v1: pavé along the top arc. */
  paveBand?: boolean;
}

/**
 * Folds the v1 boolean fields into their v2 enums. Applied before validation so
 * a model that answers with the old shape still produces a usable design.
 */
export function migrateRingParams(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== "object") return candidate;
  const input = { ...(candidate as Record<string, unknown>) };

  if (input.haloStyle === undefined && typeof input.halo === "boolean") {
    input.haloStyle = input.halo ? "standard" : "none";
  }
  if (input.paveCoverage === undefined && typeof input.paveBand === "boolean") {
    input.paveCoverage = input.paveBand ? "half" : "none";
  }
  delete input.halo;
  delete input.paveBand;

  return input;
}

function clampNumber(value: unknown, bound: NumericBound, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(bound.max, Math.max(bound.min, value));
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Forces any candidate params back inside the supported ranges and enums, after
 * migrating v1 fields. Every model-produced update runs through this — never
 * trust the arithmetic.
 */
export function clampRingParams(candidate: RingParams | LegacyRingParams): RingParams {
  const input = migrateRingParams(candidate) as Record<string, unknown>;

  return {
    ringSize: clampNumber(
      input.ringSize,
      RING_PARAM_BOUNDS.ringSize,
      DEFAULT_RING_PARAMS.ringSize,
    ),
    bandWidthMm: clampNumber(
      input.bandWidthMm,
      RING_PARAM_BOUNDS.bandWidthMm,
      DEFAULT_RING_PARAMS.bandWidthMm,
    ),
    bandThicknessMm: clampNumber(
      input.bandThicknessMm,
      RING_PARAM_BOUNDS.bandThicknessMm,
      DEFAULT_RING_PARAMS.bandThicknessMm,
    ),
    bandProfile: oneOf(
      input.bandProfile,
      BAND_PROFILES.map((option) => option.value),
      DEFAULT_RING_PARAMS.bandProfile,
    ),
    cathedral: Boolean(input.cathedral),
    metal: oneOf(
      input.metal,
      ["yellow_gold", "rose_gold", "white_gold", "platinum"] as const,
      DEFAULT_RING_PARAMS.metal,
    ),
    stoneShape: oneOf(
      input.stoneShape,
      STONE_SHAPES.map((option) => option.value),
      DEFAULT_RING_PARAMS.stoneShape,
    ),
    stoneCarat: clampNumber(
      input.stoneCarat,
      RING_PARAM_BOUNDS.stoneCarat,
      DEFAULT_RING_PARAMS.stoneCarat,
    ),
    stoneColor: oneOf(
      input.stoneColor,
      STONE_COLORS.map((option) => option.value),
      DEFAULT_RING_PARAMS.stoneColor,
    ),
    settingType: oneOf(
      input.settingType,
      SETTING_TYPES.map((option) => option.value),
      DEFAULT_RING_PARAMS.settingType,
    ),
    prongCount: oneOf(
      input.prongCount,
      PRONG_COUNTS.map((option) => option.value),
      DEFAULT_RING_PARAMS.prongCount,
    ),
    haloStyle: oneOf(
      input.haloStyle,
      HALO_STYLES.map((option) => option.value),
      DEFAULT_RING_PARAMS.haloStyle,
    ),
    paveCoverage: oneOf(
      input.paveCoverage,
      PAVE_COVERAGES.map((option) => option.value),
      DEFAULT_RING_PARAMS.paveCoverage,
    ),
  };
}
