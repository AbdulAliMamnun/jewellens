import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

import {
  designStepRequestSchema,
  designStepResponseSchema,
  extractJsonObject,
} from "@/lib/design-step";
import { clampRingParams, diffRingParams } from "@/lib/ring-params";

/**
 * The spec pins the designer to Sonnet 4.6 at temperature 0. Both halves matter:
 * this is a deterministic parameter-mapping task, and the newer Opus/Sonnet 5
 * models reject `temperature` outright.
 */
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;

const SYSTEM_PROMPT = `You are a jewelry design parameter mapper for a custom jewelry studio's 3D ring designer.

Your ONLY job is to translate what the customer says into the RingParams schema below. Never invent fields, never add keys, never change parameters the customer did not ask about.

SCHEMA — every response must contain all 11 fields:
  ringSize        number   3-13 (US size, quarter sizes allowed)
  bandWidthMm     number   1.5-8
  bandThicknessMm number   1-3
  bandProfile     "flat" | "rounded" | "knife-edge"
  metal           "yellow_gold" | "rose_gold" | "white_gold" | "platinum"
  stoneShape      "round" | "oval" | "cushion" | "emerald" | "pear" | "none"
  stoneCarat      number   0.25-5
  stoneColor      "diamond" | "sapphire" | "ruby" | "emerald"
  prongCount      0 | 4 | 6
  halo            boolean
  paveBand        boolean

JEWELRY VOCABULARY:
- solitaire = a single centre stone: halo=false, paveBand=false
- dainty / delicate / thin = thin band (bandWidthMm about 1.5-2, bandThicknessMm about 1-1.4)
- chunky / bold / substantial = wide, thick band (bandWidthMm about 5-8, bandThicknessMm about 2.4-3)
- hidden halo = halo true
- eternity band = paveBand true and stoneShape "none"
- "around X carats" / "about X" = set stoneCarat to X
- relative requests ("thinner", "wider", "bigger stone") adjust the CURRENT value by one noticeable step (band width about 0.5mm, thickness about 0.3mm, carat about 0.25-0.5) — never jump straight to the extreme
- classic / traditional = round stone, 6 prongs; modern = knife-edge or flat band

RULES:
1. Start from the current parameters in the message and change ONLY what the request implies.
2. Anything the schema cannot express (filigree, milgrain, engraving, a specific designer, a price) goes in "unhandled" as a short phrase, and changes nothing.
3. "changed" lists the field names you deliberately changed.
4. Keep every number inside the ranges above.
5. If a request is ambiguous, choose the most common interpretation for an engagement ring and state the assumption in assistantNote.
6. assistantNote is ONE short sentence for the customer. No markdown, no lists, no restating the whole design.

OUTPUT FORMAT — a single JSON object and nothing else. No markdown fences, no prose before or after:
{"updatedParams":{"ringSize":7,"bandWidthMm":2,"bandThicknessMm":1.6,"bandProfile":"rounded","metal":"yellow_gold","stoneShape":"round","stoneCarat":1,"stoneColor":"diamond","prongCount":4,"halo":false,"paveBand":false},"changed":[],"assistantNote":"...","unhandled":[]}`;

function buildUserTurn(
  currentParams: unknown,
  userMessage: string,
  briefHistory: { role: string; content: string }[],
): string {
  const history =
    briefHistory.length > 0
      ? `Recent conversation:\n${briefHistory
          .map((turn) => `${turn.role}: ${turn.content}`)
          .join("\n")}\n\n`
      : "";

  return `Current parameters:\n${JSON.stringify(currentParams)}\n\n${history}New request: ${userMessage}\n\nReturn the JSON object only.`;
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set — add it to .env.local and restart." },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const parsedRequest = designStepRequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: "Request did not match the design-step schema." },
      { status: 400 },
    );
  }

  const { currentParams, userMessage, briefHistory } = parsedRequest.data;
  const client = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildUserTurn(currentParams, userMessage, briefHistory) },
  ];

  // One retry: a malformed reply gets handed back to the model with the
  // validation error before we give up and surface a toast.
  let lastProblem = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    let message: Anthropic.Message;
    try {
      message = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages,
      });
    } catch (cause) {
      if (cause instanceof Anthropic.RateLimitError) {
        return NextResponse.json(
          { error: "Claude is rate limited right now — try again in a moment." },
          { status: 429 },
        );
      }
      if (cause instanceof Anthropic.AuthenticationError) {
        return NextResponse.json(
          { error: "ANTHROPIC_API_KEY was rejected." },
          { status: 401 },
        );
      }
      const detail = cause instanceof Error ? cause.message : "unknown error";
      return NextResponse.json(
        { error: `Could not reach Claude: ${detail}` },
        { status: 502 },
      );
    }

    if (message.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "Claude declined that request. Try rephrasing the design change." },
        { status: 422 },
      );
    }

    const raw = textOf(message);

    let candidate: unknown;
    try {
      candidate = JSON.parse(extractJsonObject(raw));
    } catch {
      lastProblem = "the reply was not valid JSON";
      messages.push(
        { role: "assistant", content: raw || "(empty)" },
        {
          role: "user",
          content:
            "That was not valid JSON. Reply with ONLY the JSON object described in the output format — no fences, no prose.",
        },
      );
      continue;
    }

    const validated = designStepResponseSchema.safeParse(candidate);
    if (!validated.success) {
      lastProblem = validated.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      messages.push(
        { role: "assistant", content: raw },
        {
          role: "user",
          content: `That JSON did not match the schema (${lastProblem}). Reply with ONLY a corrected JSON object containing all 11 parameter fields.`,
        },
      );
      continue;
    }

    // Never trust the model's arithmetic or its own "changed" list.
    const updatedParams = clampRingParams(validated.data.updatedParams);
    const changed = diffRingParams(currentParams, updatedParams);

    return NextResponse.json({
      updatedParams,
      changed,
      assistantNote: validated.data.assistantNote,
      unhandled: validated.data.unhandled,
    });
  }

  return NextResponse.json(
    { error: `Claude returned an unusable response (${lastProblem}).` },
    { status: 502 },
  );
}
