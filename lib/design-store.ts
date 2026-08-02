import { create } from "zustand";

import { designStepResponseSchema } from "@/lib/design-step";
import {
  DEFAULT_RING_PARAMS,
  clampRingParams,
  isRingParamKey,
  type RingParams,
} from "@/lib/ring-params";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/** How many prior turns are sent as context with each design step. */
const HISTORY_TURNS = 6;

let messageCounter = 0;
const nextMessageId = () => `m${(messageCounter += 1)}`;

interface DesignStore {
  params: RingParams;
  messages: ChatMessage[];
  /** A design step is in flight. */
  pending: boolean;
  /** Fields the last design step changed — drives the glow on the controls. */
  changed: (keyof RingParams)[];
  /** Terms the last step couldn't express in the schema. */
  unhandled: string[];
  error: string | null;

  /** Manual control edits. Same entry point the chat ends up at. */
  updateParams: (patch: Partial<RingParams>) => void;
  resetParams: () => void;
  sendMessage: (text: string) => Promise<void>;
  clearChanged: () => void;
  dismissUnhandled: () => void;
  dismissError: () => void;
}

/**
 * One store for the whole designer: the sliders and the conversation both write
 * `params` here, so a chat turn moves the sliders and a slider drag is visible
 * to the next chat turn.
 */
export const useDesignStore = create<DesignStore>((set, get) => ({
  params: DEFAULT_RING_PARAMS,
  messages: [],
  pending: false,
  changed: [],
  unhandled: [],
  error: null,

  updateParams: (patch) =>
    set((state) => ({
      params: clampRingParams({ ...state.params, ...patch }),
      // A manual edit supersedes whatever the last chat turn highlighted.
      changed: [],
    })),

  resetParams: () => set({ params: DEFAULT_RING_PARAMS, changed: [] }),

  clearChanged: () => set({ changed: [] }),
  dismissUnhandled: () => set({ unhandled: [] }),
  dismissError: () => set({ error: null }),

  sendMessage: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().pending) return;

    const currentParams = get().params;
    const briefHistory = get()
      .messages.slice(-HISTORY_TURNS)
      .map((message) => ({ role: message.role, content: message.content }));

    set((state) => ({
      messages: [
        ...state.messages,
        { id: nextMessageId(), role: "user", content: trimmed },
      ],
      pending: true,
      error: null,
      changed: [],
      unhandled: [],
    }));

    try {
      const response = await fetch("/api/design-step", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentParams, userMessage: trimmed, briefHistory }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error: unknown }).error)
            : `Design step failed (${response.status}).`;
        throw new Error(message);
      }

      const parsed = designStepResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("The designer returned an unexpected response.");
      }

      set((state) => ({
        // Clamp again on the way in — the store is the last line of defence.
        params: clampRingParams(parsed.data.updatedParams),
        changed: parsed.data.changed.filter(isRingParamKey),
        unhandled: parsed.data.unhandled,
        messages: [
          ...state.messages,
          {
            id: nextMessageId(),
            role: "assistant",
            content: parsed.data.assistantNote,
          },
        ],
        pending: false,
      }));
    } catch (cause) {
      set({
        pending: false,
        error: cause instanceof Error ? cause.message : "Something went wrong.",
      });
    }
  },
}));
