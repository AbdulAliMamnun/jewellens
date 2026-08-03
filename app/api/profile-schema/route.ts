import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

import {
  profileRequestSchema,
  reconcileProfile,
  schemaProfileSchema,
} from "@/lib/catalog-schema";
import { extractJsonObject } from "@/lib/design-step";
import { PROFILE_SCHEMA_SYSTEM_PROMPT } from "@/lib/profile-prompt";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;
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

  const parsedRequest = profileRequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: "Something was wrong with that request." },
      { status: 400 },
    );
  }

  const { headers, sampleRows } = parsedRequest.data;

  // Give up before the browser does (it waits 15s), so a stalled call comes
  // back as a sentence rather than a spinner that never stops.
  const client = new Anthropic({ apiKey, timeout: CALL_TIMEOUT_MS, maxRetries: 0 });
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Columns: ${JSON.stringify(headers)}

Sample rows (${sampleRows.length} of the catalog; the rest stays on the studio's machine):
${JSON.stringify(sampleRows, null, 1)}

Return the JSON object only.`,
    },
  ];

  let lastProblem = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    let message: Anthropic.Message;
    try {
      message = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: PROFILE_SCHEMA_SYSTEM_PROMPT,
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
        { error: "The assistant couldn't take that one on." },
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

    const validated = schemaProfileSchema.safeParse(candidate);
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

    // The profile has to describe the sheet that was actually uploaded.
    return NextResponse.json(reconcileProfile(validated.data, headers));
  }

  return NextResponse.json(
    { error: "The answer came back garbled — try again." },
    { status: 502 },
  );
}
