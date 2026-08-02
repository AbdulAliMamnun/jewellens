"use client";

import { useEffect, useRef, useState } from "react";

import { useDesignStore } from "@/lib/design-store";

const STARTERS = [
  "oval solitaire, rose gold",
  "make the band thinner",
  "add a halo",
];

/**
 * Meeting-friendly chat: large input, running history, and the unhandled terms
 * from the last turn shown as a dismissible chip so nothing is silently dropped.
 */
export default function DesignChat() {
  const messages = useDesignStore((state) => state.messages);
  const pending = useDesignStore((state) => state.pending);
  const unhandled = useDesignStore((state) => state.unhandled);
  const sendMessage = useDesignStore((state) => state.sendMessage);
  const dismissUnhandled = useDesignStore((state) => state.dismissUnhandled);

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
    void sendMessage(trimmed);
  }

  return (
    <div className="pointer-events-auto w-full">
      {messages.length > 0 ? (
        <div
          ref={scrollRef}
          className="mx-auto mb-2 max-h-56 w-full overflow-y-auto rounded-2xl bg-white/55 px-3 py-2.5 backdrop-blur-md"
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
                  Updating the design…
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {unhandled.length > 0 ? (
        <div className="mb-2 flex flex-wrap justify-center gap-2">
          {unhandled.map((term) => (
            <span
              key={term}
              className="flex items-center gap-2 rounded-full bg-zinc-800/85 px-3 py-1 text-xs font-medium text-zinc-100 backdrop-blur"
            >
              not yet supported: {term} — phase 2
              <button
                type="button"
                onClick={dismissUnhandled}
                aria-label={`Dismiss ${term}`}
                className="text-zinc-400 transition hover:text-white"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {messages.length === 0 ? (
        <div className="mb-2 flex flex-wrap justify-center gap-2">
          {STARTERS.map((starter) => (
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
          placeholder="Describe the ring — “oval solitaire, rose gold, six prongs”"
          aria-label="Describe the ring"
          className="min-w-0 flex-1 bg-transparent py-2 text-base text-zinc-900 outline-none placeholder:text-zinc-400"
        />
        <button
          type="submit"
          disabled={pending || draft.trim().length === 0}
          className="shrink-0 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Designing…" : "Send"}
        </button>
      </form>
    </div>
  );
}
