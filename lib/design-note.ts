// Relative, extension-bearing imports (not "@/lib/...") so this module can run
// directly under Node's TypeScript stripping in scripts/check-design-step.mjs.
import { getMetalPreset } from "./metals.ts";
import {
  BAND_PROFILES,
  RING_PARAM_KEYS,
  STONE_COLORS,
  STONE_SHAPES,
  type RingParams,
} from "./ring-params.ts";

const NUMBER_WORDS: Record<number, string> = { 0: "no", 4: "four", 6: "six" };

function shapeLabel(params: RingParams): string {
  return (
    STONE_SHAPES.find((option) => option.value === params.stoneShape)?.label ??
    params.stoneShape
  ).toLowerCase();
}

/** One-line summary of the whole design — badge, footer, and fallback notes. */
export function describeRingParams(params: RingParams): string {
  const metal = getMetalPreset(params.metal).label.toLowerCase();

  const parts =
    params.stoneShape === "none"
      ? ["Plain band"]
      : [`${params.stoneCarat.toFixed(2)}ct ${shapeLabel(params)}`];

  parts.push(
    metal,
    `size ${params.ringSize % 1 === 0 ? params.ringSize : params.ringSize.toFixed(2)}`,
  );
  if (params.stoneShape !== "none") {
    if (params.settingType === "bezel") parts.push("bezel");
    else if (params.prongCount > 0) parts.push(`${params.prongCount} prong`);
  }
  if (params.cathedral) parts.push("cathedral");
  if (params.haloStyle !== "none" && params.stoneShape !== "none") {
    parts.push(params.haloStyle === "hidden" ? "hidden halo" : "halo");
  }
  if (params.paveCoverage !== "none") {
    parts.push(params.paveCoverage === "full" ? "eternity pavé" : "pavé");
  }

  return parts.join(" · ");
}

function phraseFor(field: keyof RingParams, params: RingParams): string {
  switch (field) {
    case "ringSize":
      return `size ${params.ringSize % 1 === 0 ? params.ringSize : params.ringSize.toFixed(2)}`;
    case "bandWidthMm":
      return `a ${params.bandWidthMm.toFixed(1)}mm wide band`;
    case "bandThicknessMm":
      return `a ${params.bandThicknessMm.toFixed(2)}mm thick band`;
    case "bandProfile":
      return `a ${(
        BAND_PROFILES.find((option) => option.value === params.bandProfile)?.label ??
        params.bandProfile
      ).toLowerCase()} profile`;
    case "metal":
      return getMetalPreset(params.metal).label.toLowerCase();
    case "stoneShape":
      return params.stoneShape === "none"
        ? "no centre stone"
        : `${shapeLabel(params)} cut`;
    case "stoneCarat":
      return `${params.stoneCarat.toFixed(2)}ct`;
    case "stoneColor":
      return (
        STONE_COLORS.find((option) => option.value === params.stoneColor)?.label ??
        params.stoneColor
      ).toLowerCase();
    case "prongCount":
      return params.prongCount === 0
        ? "no prongs"
        : `${NUMBER_WORDS[params.prongCount] ?? params.prongCount} prongs`;
    case "cathedral":
      return params.cathedral ? "a cathedral shank" : "a straight shank";
    case "settingType":
      return params.settingType === "bezel" ? "a bezel setting" : "a prong setting";
    case "haloStyle":
      return params.haloStyle === "none"
        ? "no halo"
        : params.haloStyle === "hidden"
          ? "a hidden halo"
          : "a halo";
    case "paveCoverage":
      return params.paveCoverage === "none"
        ? "no pavé"
        : params.paveCoverage === "full"
          ? "pavé all the way around"
          : params.paveCoverage === "three_quarter"
            ? "three-quarter pavé"
            : "a half pavé band";
  }
}

/** A note built from the applied params — true by construction. */
export function describeChangedFields(
  applied: RingParams,
  changed: readonly (keyof RingParams)[],
): string {
  if (changed.length === 0) {
    return "Nothing changed — the design already matches that.";
  }
  const phrases = changed.map((field) => phraseFor(field, applied));
  const listed =
    phrases.length === 1
      ? phrases[0]
      : `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
  return `Set ${listed}.`;
}

export interface ClampAdjustment {
  field: keyof RingParams;
  requested: string;
  applied: string;
}

/** Fields the clamp had to move, for surfacing "carat capped at 5.00"-style notices. */
export function listClampAdjustments(
  requested: RingParams,
  applied: RingParams,
): ClampAdjustment[] {
  return RING_PARAM_KEYS.filter((field) => requested[field] !== applied[field]).map(
    (field) => ({
      field,
      requested: String(requested[field]),
      applied: String(applied[field]),
    }),
  );
}

/**
 * Numeric claims we can check against the applied params without guessing.
 * Millimetre figures are deliberately excluded: a note may legitimately quote
 * the stone's mm spread rather than a band dimension.
 */
const CLAIM_PATTERNS: {
  label: string;
  pattern: RegExp;
  actual: (params: RingParams) => number;
  tolerance: number;
  parse?: (raw: string) => number;
}[] = [
  {
    label: "carat",
    pattern: /(\d+(?:\.\d+)?)\s*(?:ct\b|carats?\b)/gi,
    actual: (params) => params.stoneCarat,
    tolerance: 0.011,
  },
  {
    label: "ring size",
    pattern: /\bsize\s+(\d+(?:\.\d+)?)/gi,
    actual: (params) => params.ringSize,
    tolerance: 0.26,
  },
  {
    label: "prong count",
    pattern: /\b(\d+|two|three|four|five|six)[\s-]*prong/gi,
    actual: (params) => params.prongCount,
    tolerance: 0.01,
    parse: (raw) => {
      const words: Record<string, number> = {
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
      };
      return words[raw.toLowerCase()] ?? Number(raw);
    },
  },
];

export interface NoteAudit {
  /** The note to show the customer. */
  note: string;
  /** True when the model's note contradicted the applied params and was replaced. */
  rewritten: boolean;
  /** Human-readable description of each contradiction found. */
  conflicts: string[];
}

/**
 * The customer-facing note has to describe what was applied, not what was asked
 * for. The model writes the prose, but any numeric claim that disagrees with the
 * applied params disqualifies it — then we fall back to a generated note.
 */
export function reconcileNote(
  modelNote: string,
  applied: RingParams,
  changed: readonly (keyof RingParams)[],
): NoteAudit {
  const conflicts: string[] = [];

  for (const claim of CLAIM_PATTERNS) {
    // Fresh regex per pass: the shared /g literal carries lastIndex.
    const pattern = new RegExp(claim.pattern.source, claim.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(modelNote)) !== null) {
      const stated = claim.parse ? claim.parse(match[1]) : Number(match[1]);
      if (!Number.isFinite(stated)) continue;
      const actual = claim.actual(applied);
      if (Math.abs(stated - actual) > claim.tolerance) {
        conflicts.push(`note says ${claim.label} ${match[1]}, applied ${actual}`);
      }
    }
  }

  if (conflicts.length === 0) {
    return { note: modelNote, rewritten: false, conflicts };
  }
  return {
    note: describeChangedFields(applied, changed),
    rewritten: true,
    conflicts,
  };
}
