import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

import {
  designStepRequestSchema,
  designStepResponseSchema,
  extractJsonObject,
} from "@/lib/design-step";
import { listClampAdjustments, reconcileNote } from "@/lib/design-note";
import { DESIGN_STEP_SYSTEM_PROMPT } from "@/lib/design-prompt";
import { clampRingParams, diffRingParams } from "@/lib/ring-params";

/**
 * The spec pins the designer to Sonnet 4.6 at temperature 0. Both halves matter:
 * this is a deterministic parameter-mapping task, and the newer Opus/Sonnet 5
 * models reject `temperature` outright.
 */
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;
/** Per-call deadline, kept under the browser's own. */
const CALL_TIMEOUT_MS = 12_000;

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

  const parsedRequest = designStepRequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: "Something was wrong with that request." },
      { status: 400 },
    );
  }

  const { currentParams, userMessage, briefHistory } = parsedRequest.data;
  // Give up before the browser does (it waits 15s), so a stalled call comes
  // back as a sentence rather than a spinner that never stops.
  const client = new Anthropic({ apiKey, timeout: CALL_TIMEOUT_MS, maxRetries: 0 });

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
        system: DESIGN_STEP_SYSTEM_PROMPT,
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
        return NextResponse.json(
          { error: "The assistant's API key was rejected." },
          { status: 401 },
        );
      }
      // Detail goes to the server log, not to the person in the meeting.
      console.error("Claude call failed:", cause);
      return NextResponse.json(
        { error: "Couldn't reach the assistant — try again." },
        { status: 502 },
      );
    }

    if (message.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "The assistant couldn't take that one on — try rephrasing the change." },
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
          content: `That JSON did not match the schema (${lastProblem}). Reply with ONLY a corrected JSON object containing all 13 parameter fields.`,
        },
      );
      continue;
    }

    // Never trust the model's arithmetic or its own "changed" list.
    const requestedParams = validated.data.updatedParams;
    const updatedParams = clampRingParams(requestedParams);
    const changed = diffRingParams(currentParams, updatedParams);
    const adjusted = listClampAdjustments(requestedParams, updatedParams);

    // The note has to describe the applied state. If any numeric claim in it
    // disagrees with what was actually applied, it is replaced with a note
    // generated from the applied params.
    const audit = reconcileNote(validated.data.assistantNote, updatedParams, changed);
    if (audit.rewritten) {
      console.warn(
        `[design-step] replaced note that contradicted applied params: ${audit.conflicts.join("; ")}`,
      );
    }

    return NextResponse.json({
      updatedParams,
      changed,
      assistantNote: audit.note,
      unhandled: validated.data.unhandled,
      adjusted,
    });
  }

  return NextResponse.json(
    { error: "The answer came back garbled — try again." },
    { status: 502 },
  );
}
