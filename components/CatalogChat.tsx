"use client";

import { useEffect, useRef, useState } from "react";

import { useArchiveStore } from "@/lib/archive-store";
import { useCatalogStore } from "@/lib/catalog-store";

const STARTERS = ["show me the rose gold ovals", "under 1.5 carats", "size 8"];

/**
 * One box for the whole meeting: find a different design, change the one on
 * screen, or be told plainly that neither is possible. Retrieval writes the same
 * filter state the panel does, so the chips visibly move when it answers.
 */
export default function CatalogChat() {
  const messages = useCatalogStore((state) => state.messages);
  const pending = useCatalogStore((state) => state.pending);
  const unhandled = useCatalogStore((state) => state.unhandled);
  const chatError = useCatalogStore((state) => state.chatError);
  const send = useCatalogStore((state) => state.sendQuery);
  const dismissChatError = useCatalogStore((state) => state.dismissChatError);

  // The archive engine keeps its own transcript for edits; surface its progress
  // here so a handed-over edit doesn't look like nothing happened.
  const archivePending = useArchiveStore((state) => state.pending);
  const archiveMessages = useArchiveStore((state) => state.messages);
  const archiveError = useArchiveStore((state) => state.chatError);
  const archiveUnhandled = useArchiveStore((state) => state.unhandled);

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, pending, archiveMessages, archivePending]);

  const busy = pending || archivePending;
  const lastEdit =
    archiveMessages.length > 0 && archiveMessages[archiveMessages.length - 1].role === "assistant"
      ? archiveMessages[archiveMessages.length - 1]
      : null;
  const chips = [...unhandled, ...archiveUnhandled];
  const error = chatError ?? archiveError;

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setDraft("");
    void send(trimmed);
  }

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

            {/* The edit engine's own reply, once it has one. */}
            {!archivePending && lastEdit ? (
              <div className="flex justify-start">
                <p className="max-w-[85%] rounded-2xl bg-white px-3.5 py-2 text-[15px] leading-snug text-zinc-800 shadow-sm">
                  {lastEdit.content}
                </p>
              </div>
            ) : null}

            {busy ? (
              <div className="flex justify-start">
                <p className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2 text-[15px] text-zinc-500 shadow-sm">
                  <span className="size-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700" />
                  {archivePending ? "Applying the edit…" : "Looking…"}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mb-2 flex items-start justify-center gap-2">
          <span className="flex items-center gap-2 rounded-full bg-white/95 px-3 py-1 text-xs font-medium text-red-700 shadow-sm">
            {error}
            <button
              type="button"
              onClick={() => {
                dismissChatError();
                useArchiveStore.getState().dismissChatError();
              }}
              aria-label="Dismiss error"
              className="text-zinc-400 transition hover:text-zinc-700"
            >
              ✕
            </button>
          </span>
        </div>
      ) : null}

      {chips.length > 0 ? (
        <div className="mb-2 flex flex-wrap justify-center gap-2">
          {chips.map((term) => (
            <span
              key={term}
              className="rounded-full bg-zinc-800/85 px-3 py-1 text-xs font-medium text-zinc-100 backdrop-blur"
            >
              not in this catalog: {term}
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
          placeholder="Find or change a design — “rose gold ovals”, “hide the halo”"
          aria-label="Find or change a design"
          className="min-w-0 flex-1 bg-transparent py-2 text-base text-zinc-900 outline-none placeholder:text-zinc-400"
        />
        <button
          type="submit"
          disabled={busy || draft.trim().length === 0}
          className="shrink-0 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
