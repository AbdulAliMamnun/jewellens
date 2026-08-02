import { z } from "zod";

import type { RingParams } from "@/lib/ring-params";

/**
 * Shape validation only — ranges are deliberately not enforced here. The model's
 * arithmetic is never trusted: everything goes through `clampRingParams` after
 * validation, so an out-of-range number is corrected rather than rejected.
 */
export const ringParamsSchema = z.object({
  ringSize: z.number().finite(),
  bandWidthMm: z.number().finite(),
  bandThicknessMm: z.number().finite(),
  bandProfile: z.enum(["flat", "rounded", "knife-edge"]),
  metal: z.enum(["yellow_gold", "rose_gold", "white_gold", "platinum"]),
  stoneShape: z.enum(["round", "oval", "cushion", "emerald", "pear", "none"]),
  stoneCarat: z.number().finite(),
  stoneColor: z.enum(["diamond", "sapphire", "ruby", "emerald"]),
  prongCount: z.union([z.literal(0), z.literal(4), z.literal(6)]),
  halo: z.boolean(),
  paveBand: z.boolean(),
}) satisfies z.ZodType<RingParams>;

export const designStepResponseSchema = z.object({
  updatedParams: ringParamsSchema,
  /** The model's own claim; the route replaces it with a real diff. */
  changed: z.array(z.string()).default([]),
  assistantNote: z.string().min(1),
  unhandled: z.array(z.string()).default([]),
});

export type DesignStepResponse = z.infer<typeof designStepResponseSchema>;

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
