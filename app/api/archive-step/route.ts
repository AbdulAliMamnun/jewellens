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
/** Per-call deadline, kept under the browser's own. */
const CALL_TIMEOUT_MS = 12_000;

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
      { error: "The assistant isn't connected on this machine — add an API key and restart." },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Something was wrong with that request." }, { status: 400 });
  }

  const parsedRequest = archiveStepRequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: "Something was wrong with that request." },
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

  // Give up before the browser does (it waits 15s), so a stalled call comes
  // back as a sentence rather than a spinner that never stops.
  const client = new Anthropic({ apiKey, timeout: CALL_TIMEOUT_MS, maxRetries: 0 });
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
          { error: "Too many requests just now — give it a moment and try again." },
          { status: 429 },
        );
      }
      if (cause instanceof Anthropic.AuthenticationError) {
        return NextResponse.json({ error: "The assistant's API key was rejected." }, { status: 401 });
      }
      // Detail goes to the server log, not to the person in the meeting.
      console.error("Claude call failed:", cause);
      return NextResponse.json({ error: "Couldn't reach the assistant — try again." }, { status: 502 });
    }

    if (message.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "The assistant couldn't take that one on — try rephrasing the edit." },
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
    { error: "The answer came back garbled — try again." },
    { status: 502 },
  );
}
