"use client";

import { METAL_PRESETS } from "@/lib/metals";
import { STONE_COLORS } from "@/lib/ring-params";
import { useArchiveStore } from "@/lib/archive-store";
import type { PartMaterial } from "@/lib/archive-parts";

const MATERIAL_OPTIONS: { value: string; label: string; material: PartMaterial }[] = [
  ...METAL_PRESETS.map((preset) => ({
    value: `metal:${preset.id}`,
    label: preset.label,
    material: { kind: "metal", metal: preset.id } as PartMaterial,
  })),
  ...STONE_COLORS.map((stone) => ({
    value: `stone:${stone.value}`,
    label: stone.label,
    material: { kind: "stone", color: stone.value } as PartMaterial,
  })),
];

function materialValue(material: PartMaterial): string {
  return material.kind === "stone" ? `stone:${material.color}` : `metal:${material.metal}`;
}

export default function PartsPanel({ entryId }: { entryId: string }) {
  const entry = useArchiveStore((state) =>
    state.entries.find((candidate) => candidate.id === entryId),
  );
  const setPartState = useArchiveStore((state) => state.setPartState);
  const resetEdits = useArchiveStore((state) => state.resetEdits);

  if (!entry || entry.status !== "ready") return null;

  const hidden = entry.parts.filter(
    (part) => entry.partStates[part.id]?.visible === false,
  ).length;

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-2xl border border-zinc-200 bg-white">
      <div className="flex items-baseline justify-between border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900">Parts</h2>
        <button
          type="button"
          onClick={() => resetEdits(entry.id)}
          className="rounded-full px-2 py-0.5 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
        >
          Reset
        </button>
      </div>

      {!entry.hasParts ? (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs leading-snug text-amber-900">
          This {entry.format?.toUpperCase() ?? "file"} is a single mesh, so edits
          apply to the whole piece. Upload the .3dm for part-level control.
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <ul className="flex flex-col gap-1">
          {entry.parts.map((part) => {
            const state = entry.partStates[part.id];
            if (!state) return null;

            return (
              <li
                key={part.id}
                className={[
                  "rounded-xl border px-3 py-2 transition",
                  state.visible
                    ? "border-transparent hover:border-zinc-200 hover:bg-zinc-50"
                    : "border-transparent bg-zinc-50 opacity-60",
                ].join(" ")}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-800">
                      {part.name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-zinc-400">
                      {part.layerPath ?? "no layer"} ·{" "}
                      {part.triangleCount.toLocaleString()} tris
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setPartState(entry.id, part.id, { visible: !state.visible })
                    }
                    aria-pressed={!state.visible}
                    title={state.visible ? "Hide this part" : "Show this part"}
                    className="shrink-0 rounded-full border border-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
                  >
                    {state.visible ? "Hide" : "Show"}
                  </button>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <label className="flex-1">
                    <span className="sr-only">Material for {part.name}</span>
                    <select
                      value={materialValue(state.material)}
                      onChange={(event) => {
                        const option = MATERIAL_OPTIONS.find(
                          (candidate) => candidate.value === event.target.value,
                        );
                        if (option) {
                          setPartState(entry.id, part.id, { material: option.material });
                        }
                      }}
                      className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700"
                    >
                      <optgroup label="Metal">
                        {MATERIAL_OPTIONS.filter((option) =>
                          option.value.startsWith("metal:"),
                        ).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Stone">
                        {MATERIAL_OPTIONS.filter((option) =>
                          option.value.startsWith("stone:"),
                        ).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </label>
                  <span className="w-14 shrink-0 text-right text-xs tabular-nums text-zinc-400">
                    {state.scale === 1 ? "1.00×" : `${state.scale.toFixed(2)}×`}
                  </span>
                </div>

                <label className="mt-1.5 block">
                  <span className="sr-only">Scale {part.name}</span>
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.01}
                    value={state.scale}
                    onChange={(event) =>
                      setPartState(entry.id, part.id, {
                        scale: Number(event.target.value),
                      })
                    }
                    className="w-full accent-zinc-900"
                  />
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="border-t border-zinc-200 px-4 py-2 text-xs text-zinc-400">
        {entry.parts.length} part{entry.parts.length === 1 ? "" : "s"}
        {hidden > 0 ? ` · ${hidden} hidden` : ""}
        {entry.modelScale !== 1
          ? ` · resized to ${entry.assumedRingSize} (${entry.modelScale.toFixed(3)}×)`
          : ""}
      </p>
    </div>
  );
}
