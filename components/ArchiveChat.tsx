"use client";

import { useEffect, useRef, useState } from "react";

import { useArchiveStore } from "@/lib/archive-store";

const STRUCTURED_STARTERS = [
  "hide the halo",
  "make the centre stone a sapphire",
  "size 8",
];
const FLAT_STARTERS = ["rose gold", "size 8", "make it 5% bigger"];

/**
 * The same meeting-friendly chat as the designer, pointed at the archive piece.
 * Edits here are mesh operations on finished geometry, not a rebuild.
 */
export default function ArchiveChat({ hasParts }: { hasParts: boolean }) {
  const messages = useArchiveStore((state) => state.messages);
  const pending = useArchiveStore((state) => state.pending);
  const unhandled = useArchiveStore((state) => state.unhandled);
  const chatError = useArchiveStore((state) => state.chatError);
  const send = useArchiveStore((state) => state.sendArchiveMessage);
  const dismissChatError = useArchiveStore((state) => state.dismissChatError);
  const retryLastMessage = useArchiveStore((state) => state.retryLastMessage);

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, pending]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setDraft("");
    void send(trimmed);
  }

  const starters = hasParts ? STRUCTURED_STARTERS : FLAT_STARTERS;

  return (
    <div className="pointer-events-auto w-full">
      {messages.length > 0 ? (
        <div
          ref={scrollRef}
          className="mx-auto mb-2 max-h-48 w-full overflow-y-auto rounded-2xl bg-white/55 px-3 py-2.5 backdrop-blur-md"
        >
          <div className="flex flex-col gap-2">
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "user" ? "flex justify-end" : "flex justify-start"
                }
              >
                <p
                  className={[
                    "max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug",
                    message.role === "user"
                      ? "bg-zinc-900 text-white"
                      : "bg-white text-zinc-800 shadow-sm",
                  ].join(" ")}
                >
                  {message.content}
                </p>
              </div>
            ))}
            {pending ? (
              <div className="flex justify-start">
                <p className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2 text-[15px] text-zinc-500 shadow-sm">
                  <span className="size-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700" />
                  Applying the edit…
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {chatError ? (
        <div className="mb-2 flex items-start justify-center gap-2">
          <span className="flex items-center gap-2 rounded-full bg-white/95 px-3 py-1 text-xs font-medium text-amber-900 shadow-sm">
            {chatError}
            <button
              type="button"
              onClick={() => void retryLastMessage()}
              className="rounded-full bg-zinc-900 px-2.5 py-0.5 text-[11px] font-medium text-white transition hover:bg-zinc-700"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={dismissChatError}
              aria-label="Dismiss"
              className="text-zinc-400 transition hover:text-zinc-700"
            >
              ✕
            </button>
          </span>
        </div>
      ) : null}

      {unhandled.length > 0 ? (
        <div className="mb-2 flex flex-wrap justify-center gap-2">
          {unhandled.map((term) => (
            <span
              key={term}
              className="rounded-full bg-zinc-800/85 px-3 py-1 text-xs font-medium text-zinc-100 backdrop-blur"
            >
              needs a rebuild: {term}
            </span>
          ))}
        </div>
      ) : null}

      {messages.length === 0 ? (
        <div className="mb-2 flex flex-wrap justify-center gap-2">
          {starters.map((starter) => (
            <button
              key={starter}
              type="button"
              onClick={() => submit(starter)}
              className="rounded-full bg-white/70 px-3 py-1.5 text-sm font-medium text-zinc-600 shadow-sm backdrop-blur transition hover:bg-white"
            >
              {starter}
            </button>
          ))}
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
        className="flex items-center gap-2 rounded-full bg-white/90 p-1.5 pl-5 shadow-lg ring-1 ring-black/5 backdrop-blur"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            hasParts
              ? "Edit this piece — “hide the halo”, “size 8”"
              : "Whole-piece edits — “rose gold”, “size 8”"
          }
          aria-label="Edit this archive piece"
          className="min-w-0 flex-1 bg-transparent py-2 text-base text-zinc-900 outline-none placeholder:text-zinc-400"
        />
        <button
          type="submit"
          disabled={pending || draft.trim().length === 0}
          className="shrink-0 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Editing…" : "Send"}
        </button>
      </form>
    </div>
  );
}
