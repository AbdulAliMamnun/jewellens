/**
 * Every call to a Claude-backed route goes through here. In a meeting the worst
 * outcome is a dead input and a spinner that never stops, so each call gets a
 * hard deadline and comes back as either data or one calm sentence — never a
 * stack trace, never nothing.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  /** True when trying the same thing again is a reasonable next move. */
  readonly retryable: boolean;

  constructor(message: string, retryable = true) {
    super(message);
    this.name = "ApiError";
    this.retryable = retryable;
  }
}

/** Server-sent messages are already written for a person; anything else isn't. */
function messageFromPayload(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  if (status === 429) return "Too many requests just now — give it a moment.";
  if (status >= 500) return "That didn't come back — try again.";
  return "That request didn't go through.";
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    // A timeout and a dropped connection look the same to the person waiting.
    if (cause instanceof DOMException && cause.name === "TimeoutError") {
      throw new ApiError("That's taking longer than it should — try again.");
    }
    throw new ApiError("Couldn't reach the server — check the connection.");
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(messageFromPayload(payload, response.status));
  return payload as T;
}
