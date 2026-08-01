"use client";

import { useState } from "react";
import RingViewer from "@/components/RingViewer";

/**
 * Placeholder until F4 drops real ring STLs into /public/models/.
 * F3 will drive the viewer the same way: pass the catalog row's file link as `src`.
 */
const SAMPLE_MODELS = [
  { id: "placeholder-ring", label: "Placeholder ring", url: "/models/placeholder-ring.stl" },
] as const;

export default function ViewerWorkbench() {
  const [selected, setSelected] = useState<{ url: string; key: number } | null>(
    null,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-500">Load a model:</span>
        {SAMPLE_MODELS.map((sample) => (
          <button
            key={sample.id}
            type="button"
            onClick={() =>
              // The bumped key re-loads the same URL after a manual drop.
              setSelected((current) => ({
                url: sample.url,
                key: (current?.key ?? 0) + 1,
              }))
            }
            className="rounded-full border border-zinc-300 bg-white px-3.5 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50"
          >
            {sample.label}
          </button>
        ))}
        <span className="text-sm text-zinc-400">
          …or drag an STL/OBJ onto the viewer
        </span>
      </div>

      <RingViewer src={selected?.url} srcKey={selected?.key} />
    </div>
  );
}
