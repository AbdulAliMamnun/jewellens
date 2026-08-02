import { z } from "zod";

// Relative + extension-bearing so the Node check scripts can import this module.
import {
  listPartNames,
  matchParts,
  type PartIdentity,
  type PartMaterial,
} from "./archive-parts.ts";
import { ringSizeScaleFactor } from "./ring-size.ts";

const MATERIAL_VALUES = [
  "yellow_gold",
  "rose_gold",
  "white_gold",
  "platinum",
  "diamond",
  "sapphire",
  "ruby",
  "emerald",
] as const;

export type ArchiveMaterialValue = (typeof MATERIAL_VALUES)[number];

export function materialFromValue(value: ArchiveMaterialValue): PartMaterial {
  switch (value) {
    case "diamond":
    case "sapphire":
    case "ruby":
    case "emerald":
      return { kind: "stone", color: value };
    default:
      return { kind: "metal", metal: value };
  }
}

/**
 * What an archive piece supports: showing, hiding, re-materialing and scaling
 * the parts that are already there. Anything that needs new geometry is a
 * rebuild, and the model is told to say so rather than emit an operation.
 */
export const archiveOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("hide_parts"), match: z.string().min(1) }),
  z.object({ op: z.literal("show_parts"), match: z.string().min(1) }),
  z.object({
    op: z.literal("set_part_material"),
    match: z.string().min(1),
    material: z.enum(MATERIAL_VALUES),
  }),
  z.object({
    op: z.literal("scale_part"),
    match: z.string().min(1),
    factor: z.number().finite(),
  }),
  z.object({
    op: z.literal("set_ring_size"),
    from: z.number().finite(),
    to: z.number().finite(),
  }),
]);

export type ArchiveOperation = z.infer<typeof archiveOperationSchema>;

export const archiveStepResponseSchema = z.object({
  operations: z.array(archiveOperationSchema).max(8).default([]),
  assistantNote: z.string().min(1),
  unhandled: z.array(z.string()).default([]),
});

export const archivePartSchema = z.object({
  id: z.string(),
  name: z.string(),
  layerPath: z.string().nullable().default(null),
  definitionName: z.string().nullable().default(null),
  objectNames: z.array(z.string()).default([]),
});

export const archiveStepRequestSchema = z.object({
  parts: z.array(archivePartSchema).max(200),
  /** False for STL/OBJ, which have no structure to address. */
  hasParts: z.boolean(),
  /** What the piece is currently assumed to be, for set_ring_size. */
  assumedRingSize: z.number().finite().default(7),
  userMessage: z.string().min(1).max(2000),
  briefHistory: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(20)
    .default([]),
});

export type ArchiveStepRequest = z.infer<typeof archiveStepRequestSchema>;

/** An operation with its `match` already resolved to concrete parts. */
export type ResolvedOperation =
  | { op: "hide_parts" | "show_parts"; partIds: string[]; partNames: string[] }
  | {
      op: "set_part_material";
      partIds: string[];
      partNames: string[];
      material: PartMaterial;
    }
  | { op: "scale_part"; partIds: string[]; partNames: string[]; factor: number }
  | { op: "set_ring_size"; from: number; to: number; factor: number };

export interface ResolutionResult {
  resolved: ResolvedOperation[];
  /** Set when a match hit several differently-named parts; nothing is applied. */
  disambiguation: string | null;
  /** Matches that hit nothing at all. */
  unmatched: string[];
}

/** Scale factors are clamped: a runaway factor would throw the piece off screen. */
const MIN_FACTOR = 0.25;
const MAX_FACTOR = 4;

const clampFactor = (factor: number) =>
  Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, factor));

/**
 * Turns free-text `match` references into part ids. A reference that hits
 * several parts with different names is a real ambiguity: nothing is applied and
 * the caller asks which one was meant.
 */
export function resolveOperations(
  parts: readonly PartIdentity[],
  operations: readonly ArchiveOperation[],
): ResolutionResult {
  const resolved: ResolvedOperation[] = [];
  const unmatched: string[] = [];

  for (const operation of operations) {
    if (operation.op === "set_ring_size") {
      resolved.push({
        op: "set_ring_size",
        from: operation.from,
        to: operation.to,
        factor: clampFactor(ringSizeScaleFactor(operation.from, operation.to)),
      });
      continue;
    }

    let match = matchParts(parts, operation.match);
    // A structureless file has exactly one thing to address, so any reference
    // resolves to it — the flat prompt says to use "model", but the part is
    // named after the file.
    if (match.kind === "none" && parts.length === 1) {
      match = { kind: "resolved", query: operation.match, parts: [parts[0]] };
    }
    if (match.kind === "ambiguous") {
      return {
        resolved: [],
        disambiguation: `"${operation.match}" could mean ${listPartNames(
          match.candidates,
        )} — which did you mean?`,
        unmatched,
      };
    }
    if (match.kind === "none") {
      unmatched.push(operation.match);
      continue;
    }

    const partIds = match.parts.map((part) => part.id);
    const partNames = [...new Set(match.parts.map((part) => part.name))];

    switch (operation.op) {
      case "hide_parts":
      case "show_parts":
        resolved.push({ op: operation.op, partIds, partNames });
        break;
      case "set_part_material":
        resolved.push({
          op: "set_part_material",
          partIds,
          partNames,
          material: materialFromValue(operation.material),
        });
        break;
      case "scale_part":
        resolved.push({
          op: "scale_part",
          partIds,
          partNames,
          factor: clampFactor(operation.factor),
        });
        break;
    }
  }

  return { resolved, disambiguation: null, unmatched };
}
