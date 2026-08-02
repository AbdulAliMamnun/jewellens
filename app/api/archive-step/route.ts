import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

import { flatArchivePrompt, structuredArchivePrompt } from "@/lib/archive-prompt";
import {
  archiveStepRequestSchema,
  archiveStepResponseSchema,
  resolveOperations,
} from "@/lib/archive-step";
import { extractJsonObject } from "@/lib/design-step";

/** Same model and temperature as the design step — this is the same mapping job. */
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1536;

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

  const parsedRequest = archiveStepRequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: "Request did not match the archive-step schema." },
      { status: 400 },
    );
  }

  const { parts, hasParts, assumedRingSize, userMessage, briefHistory } =
    parsedRequest.data;

  const system = hasParts
    ? structuredArchivePrompt(parts, assumedRingSize)
    : flatArchivePrompt(assumedRingSize);

  const history =
    briefHistory.length > 0
      ? `Recent conversation:\n${briefHistory
          .map((turn) => `${turn.role}: ${turn.content}`)
          .join("\n")}\n\n`
      : "";

  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `${history}Request: ${userMessage}\n\nReturn the JSON object only.` },
  ];

  let lastProblem = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    let message: Anthropic.Message;
    try {
      message = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system,
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
        return NextResponse.json({ error: "ANTHROPIC_API_KEY was rejected." }, { status: 401 });
      }
      const detail = cause instanceof Error ? cause.message : "unknown error";
      return NextResponse.json({ error: `Could not reach Claude: ${detail}` }, { status: 502 });
    }

    if (message.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "Claude declined that request. Try rephrasing the edit." },
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

    const validated = archiveStepResponseSchema.safeParse(candidate);
    if (!validated.success) {
      lastProblem = validated.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      messages.push(
        { role: "assistant", content: raw },
        {
          role: "user",
          content: `That JSON did not match the schema (${lastProblem}). Reply with ONLY a corrected JSON object.`,
        },
      );
      continue;
    }

    // Resolution is ours, not the model's: it only ever names parts in words.
    const resolution = resolveOperations(parts, validated.data.operations);

    return NextResponse.json({
      operations: resolution.disambiguation ? [] : resolution.resolved,
      assistantNote: resolution.disambiguation ?? validated.data.assistantNote,
      unhandled: validated.data.unhandled,
      unmatched: resolution.unmatched,
      needsDisambiguation: Boolean(resolution.disambiguation),
    });
  }

  return NextResponse.json(
    { error: `Claude returned an unusable response (${lastProblem}).` },
    { status: 502 },
  );
}
