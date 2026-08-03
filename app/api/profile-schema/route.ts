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

  const parsedRequest = profileRequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: "Request did not match the profile-schema schema." },
      { status: 400 },
    );
  }

  const { headers, sampleRows } = parsedRequest.data;

  const client = new Anthropic({ apiKey });
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
        { error: "Claude declined to profile that sheet." },
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
    { error: `Claude returned an unusable profile (${lastProblem}).` },
    { status: 502 },
  );
}
