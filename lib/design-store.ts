import { create } from "zustand";

import { postJson } from "@/lib/api-call";
import { designStepResultSchema } from "@/lib/design-step";
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
  /** Values the clamp had to correct on the last step. */
  adjusted: { field: string; requested: string; applied: string }[];
  error: string | null;
  /** The last thing asked for, so a failed turn can be retried in one click. */
  lastMessage: string | null;

  /** Manual control edits. Same entry point the chat ends up at. */
  updateParams: (patch: Partial<RingParams>) => void;
  resetParams: () => void;
  sendMessage: (text: string) => Promise<void>;
  retryLastMessage: () => Promise<void>;
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
  adjusted: [],
  error: null,
  lastMessage: null,

  updateParams: (patch) =>
    set((state) => ({
      params: clampRingParams({ ...state.params, ...patch }),
      // A manual edit supersedes whatever the last chat turn highlighted.
      changed: [],
    })),

  /** Also the demo reset: the designer goes back to a blank conversation. */
  resetParams: () =>
    set({
      params: DEFAULT_RING_PARAMS,
      changed: [],
      messages: [],
      unhandled: [],
      adjusted: [],
      error: null,
      lastMessage: null,
      pending: false,
    }),

  /** Re-sends the last thing asked for, without retyping it. */
  retryLastMessage: async () => {
    const last = get().lastMessage;
    if (!last) return;
    set((state) => ({
      // Drop the failed turn so the transcript doesn't show it twice.
      messages: state.messages.filter(
        (message, index) =>
          !(index === state.messages.length - 1 && message.content === last),
      ),
    }));
    await get().sendMessage(last);
  },

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
      adjusted: [],
      lastMessage: trimmed,
    }));

    try {
      const payload = await postJson<unknown>("/api/design-step", {
        currentParams,
        userMessage: trimmed,
        briefHistory,
      });

      const parsed = designStepResultSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("That answer came back garbled — try again.");
      }

      set((state) => ({
        // Clamp again on the way in — the store is the last line of defence.
        params: clampRingParams(parsed.data.updatedParams),
        changed: parsed.data.changed.filter(isRingParamKey),
        unhandled: parsed.data.unhandled,
        adjusted: parsed.data.adjusted,
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
        error:
          cause instanceof Error ? cause.message : "That didn't go through — try again.",
      });
    }
  },
}));
