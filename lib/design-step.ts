import { z } from "zod";

// Relative + extension-bearing so the Node check scripts can import this module.
import { migrateRingParams, type RingParams } from "./ring-params.ts";

/**
 * Shape validation only — ranges are deliberately not enforced here. The model's
 * arithmetic is never trusted: everything goes through `clampRingParams` after
 * validation, so an out-of-range number is corrected rather than rejected.
 *
 * Wrapped in the v1 → v2 migration so a model that answers with the old boolean
 * `halo`/`paveBand` fields still validates instead of burning the retry.
 */
export const ringParamsSchema = z.preprocess(
  migrateRingParams,
  z.object({
    ringSize: z.number().finite(),
    bandWidthMm: z.number().finite(),
    bandThicknessMm: z.number().finite(),
    bandProfile: z.enum(["flat", "rounded", "knife-edge"]),
    cathedral: z.boolean(),
    metal: z.enum(["yellow_gold", "rose_gold", "white_gold", "platinum"]),
    stoneShape: z.enum([
      "round",
      "oval",
      "cushion",
      "emerald",
      "pear",
      "princess",
      "radiant",
      "marquise",
      "none",
    ]),
    stoneCarat: z.number().finite(),
    stoneColor: z.enum(["diamond", "sapphire", "ruby", "emerald"]),
    settingType: z.enum(["prong", "bezel"]),
    prongCount: z.union([z.literal(0), z.literal(4), z.literal(6)]),
    haloStyle: z.enum(["none", "standard", "hidden"]),
    paveCoverage: z.enum(["none", "half", "three_quarter", "full"]),
  }),
) as unknown as z.ZodType<RingParams>;

export const designStepResponseSchema = z.object({
  updatedParams: ringParamsSchema,
  /** The model's own claim; the route replaces it with a real diff. */
  changed: z.array(z.string()).default([]),
  assistantNote: z.string().min(1),
  unhandled: z.array(z.string()).default([]),
});

export type DesignStepResponse = z.infer<typeof designStepResponseSchema>;

export const clampAdjustmentSchema = z.object({
  field: z.string(),
  requested: z.string(),
  applied: z.string(),
});

/**
 * What the route returns: the validated model reply after clamping, with the
 * note reconciled against the applied params and any clamp corrections listed.
 */
export const designStepResultSchema = designStepResponseSchema.extend({
  adjusted: z.array(clampAdjustmentSchema).default([]),
});

export type DesignStepResult = z.infer<typeof designStepResultSchema>;

export const chatTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

export const designStepRequestSchema = z.object({
  currentParams: ringParamsSchema,
  userMessage: z.string().min(1).max(2000),
  briefHistory: z.array(chatTurnSchema).max(20).default([]),
});

export type DesignStepRequest = z.infer<typeof designStepRequestSchema>;

/**
 * Pulls the JSON object out of a model reply. The system prompt demands bare
 * JSON, but a stray ```json fence or a sentence of preamble shouldn't cost a
 * retry — strip fences, then fall back to the outermost braces.
 */
export function extractJsonObject(raw: string): string {
  let text = raw.trim();

  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
  }

  if (text.startsWith("{") && text.endsWith("}")) return text;

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);

  return text;
}
