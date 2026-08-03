"use client";

import { useCallback, useEffect, useState } from "react";

import { resetDemo } from "@/lib/demo-reset";

/** Written for both platforms — the label is rendered on the server too. */
const SHORTCUT_LABEL = "⌘/Ctrl + ⇧ + 0";

/**
 * Puts everything back to the opening screen in one action, so the next demo
 * starts where the last one did — no reload, no stale ring left on screen, no
 * half-applied filters.
 */
export default function ResetDemo() {
  const [confirmed, setConfirmed] = useState(false);

  const reset = useCallback(() => {
    resetDemo();
    setConfirmed(true);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // event.code, not event.key: Shift turns "0" into ")".
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "Digit0") {
        event.preventDefault();
        reset();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reset]);

  useEffect(() => {
    if (!confirmed) return;
    const timer = setTimeout(() => setConfirmed(false), 2000);
    return () => clearTimeout(timer);
  }, [confirmed]);

  return (
    <div className="flex items-center gap-2">
      {confirmed ? (
        <span className="text-xs font-medium text-zinc-500">Back to the start.</span>
      ) : null}
      <button
        type="button"
        onClick={reset}
        title={`Start over (${SHORTCUT_LABEL})`}
        className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
      >
        Start over
        <span className="ml-1.5 hidden text-zinc-400 sm:inline">{SHORTCUT_LABEL}</span>
      </button>
    </div>
  );
}
