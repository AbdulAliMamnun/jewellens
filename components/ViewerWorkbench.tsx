"use client";

import { useState } from "react";

import DesignerViewer from "@/components/DesignerViewer";
import RingViewer from "@/components/RingViewer";

/**
 * Placeholder until F4 drops real ring STLs into /public/models/.
 * F3 will drive the viewer the same way: pass the catalog row's file link as `src`.
 */
const SAMPLE_MODELS = [
  { id: "placeholder-ring", label: "Placeholder ring", url: "/models/placeholder-ring.stl" },
] as const;

type Mode = "archive" | "design";

export default function ViewerWorkbench() {
  const [mode, setMode] = useState<Mode>("archive");
  const [selected, setSelected] = useState<{ url: string; key: number } | null>(
    null,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-500">Archive:</span>
        {SAMPLE_MODELS.map((sample) => (
          <button
            key={sample.id}
            type="button"
            onClick={() => {
              setMode("archive");
              // The bumped key re-loads the same URL after a manual drop.
              setSelected((current) => ({
                url: sample.url,
                key: (current?.key ?? 0) + 1,
              }));
            }}
            className="rounded-full border border-zinc-300 bg-white px-3.5 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50"
          >
            {sample.label}
          </button>
        ))}
        <span className="text-sm text-zinc-400">…or drag an STL/OBJ onto the viewer</span>

        <button
          type="button"
          onClick={() => setMode("design")}
          aria-pressed={mode === "design"}
          className={[
            "ml-auto rounded-full px-4 py-2 text-sm font-medium transition",
            mode === "design"
              ? "bg-zinc-900 text-white shadow-sm ring-2 ring-zinc-900/20"
              : "bg-zinc-900 text-white hover:bg-zinc-700",
          ].join(" ")}
        >
          Design something new
        </button>
      </div>

      {mode === "design" ? (
        <DesignerViewer />
      ) : (
        <RingViewer src={selected?.url} srcKey={selected?.key} />
      )}
    </div>
  );
}
