// Relative + extension-bearing imports so the Node check scripts can run this
// module directly under type stripping.
import type { MetalId } from "./metals.ts";
import type { StoneColor } from "./ring-params.ts";

/** What a part is made of. Archive files carry no materials we can trust, so this is assigned. */
export type PartMaterial =
  | { kind: "metal"; metal: MetalId }
  | { kind: "stone"; color: StoneColor };

/** The identifying fields of a part — everything matching and heuristics need. */
export interface PartIdentity {
  id: string;
  name: string;
  layerPath: string | null;
  layerName?: string | null;
  definitionName: string | null;
  objectNames: string[];
}

export interface PartState {
  visible: boolean;
  material: PartMaterial;
  /** Uniform scale about the part's own centre. 1 = as authored. */
  scale: number;
}

// ---------------------------------------------------------------------------
// Material heuristics
// ---------------------------------------------------------------------------

const STONE_WORDS = [
  "gem",
  "gemstone",
  "diamond",
  "stone",
  "brilliant",
  "melee",
  "pave",
  "pavé",
  "cz",
  "cubic zirconia",
  "moissanite",
  "ruby",
  "sapphire",
  "emerald",
  "topaz",
  "opal",
  "pearl",
  "amethyst",
  "garnet",
  "aquamarine",
  "morganite",
];

const METAL_WORDS = [
  "metal",
  "gold",
  "silver",
  "platinum",
  "palladium",
  "shank",
  "band",
  "prong",
  "claw",
  "bezel",
  "head",
  "basket",
  "gallery",
  "mount",
  "setting",
  "rail",
  "bail",
  "collet",
  "peg",
];

const COLOR_WORDS: [keyword: string, color: StoneColor][] = [
  ["ruby", "ruby"],
  ["sapphire", "sapphire"],
  ["emerald", "emerald"],
];

export function normalizeTerm(value: string): string {
  return value
    .toLowerCase()
    .replace(/centre/g, "center")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchableText(part: PartIdentity): string {
  return normalizeTerm(
    [part.name, part.layerPath, part.definitionName, ...part.objectNames]
      .filter(Boolean)
      .join(" "),
  );
}

function countHits(text: string, words: readonly string[]): number {
  return words.filter((word) => text.includes(normalizeTerm(word))).length;
}

function stoneColorFor(text: string): StoneColor {
  for (const [keyword, color] of COLOR_WORDS) {
    if (!text.includes(keyword)) continue;
    // "emerald cut" describes the outline, not the gem — that is still a diamond.
    if (color === "emerald" && /emerald cut/.test(text)) continue;
    return color;
  }
  return "diamond";
}

/**
 * Guesses what a part is made of from its layer and object names. Studios name
 * their layers for humans ("Center Stone", "Prongs", "Shank"), and that naming
 * is the only material signal a render mesh carries — without it every part
 * renders as metal, stones included.
 *
 * The leaf layer is consulted first: in "Ring::Head::Prongs" the last segment is
 * the specific one, and "Head" would otherwise drag a prong toward the wrong
 * answer. Ambiguous names ("Stone Setting") resolve toward stone and can be
 * corrected in one click in the Parts panel.
 */
export function guessPartMaterial(
  part: PartIdentity,
  defaultMetal: MetalId = "yellow_gold",
): PartMaterial {
  const leaf = normalizeTerm(
    part.definitionName || part.layerPath?.split(/::|\//).pop() || part.name,
  );
  const full = searchableText(part);

  for (const text of [leaf, full]) {
    const stone = countHits(text, STONE_WORDS);
    const metal = countHits(text, METAL_WORDS);
    if (stone > 0 && stone >= metal) return { kind: "stone", color: stoneColorFor(text) };
    if (metal > 0) return { kind: "metal", metal: defaultMetal };
  }

  return { kind: "metal", metal: defaultMetal };
}

export function describeMaterial(material: PartMaterial): string {
  if (material.kind === "stone") return material.color;
  return material.metal.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export type PartMatch<T extends PartIdentity> =
  | { kind: "none"; query: string }
  | { kind: "resolved"; query: string; parts: T[] }
  /** Several differently-named parts matched — the caller has to ask. */
  | { kind: "ambiguous"; query: string; candidates: T[] };

/**
 * Resolves a free-text part reference against layer, object and definition
 * names. Several parts sharing one name (six prongs) resolve together; parts
 * with different names are a genuine ambiguity and are handed back for the
 * caller to ask about.
 */
export function matchParts<T extends PartIdentity>(
  parts: readonly T[],
  query: string,
): PartMatch<T> {
  const normalized = normalizeTerm(query);
  if (!normalized) return { kind: "none", query };

  const exact = parts.filter((part) => normalizeTerm(part.name) === normalized);
  if (exact.length > 0) return { kind: "resolved", query, parts: exact };

  const tokens = normalized.split(" ").filter(Boolean);
  const hits = parts.filter((part) => {
    const text = searchableText(part);
    return tokens.every((token) => text.includes(token));
  });

  if (hits.length === 0) return { kind: "none", query };

  const distinctNames = new Set(hits.map((part) => normalizeTerm(part.name)));
  if (distinctNames.size === 1) return { kind: "resolved", query, parts: hits };
  return { kind: "ambiguous", query, candidates: hits };
}

/** "Center Stone, Halo, or Prongs?" — the tail of a disambiguation question. */
export function listPartNames(parts: readonly PartIdentity[]): string {
  const names = [...new Set(parts.map((part) => part.name))];
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}
