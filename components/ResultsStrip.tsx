"use client";

import { relaxationNote } from "@/lib/catalog-filter";
import { useCatalogStore } from "@/lib/catalog-store";
import { resolutionBadge } from "@/lib/file-resolution";

/**
 * What matched, and which one is on screen. Rows whose file can't be found stay
 * in the list — a studio's archive is always partly elsewhere, and hiding those
 * designs would quietly misrepresent the catalog.
 */
export default function ResultsStrip() {
  const results = useCatalogStore((state) => state.results);
  const schema = useCatalogStore((state) => state.schema);
  const selectedIndex = useCatalogStore((state) => state.selectedIndex);
  const selectRow = useCatalogStore((state) => state.selectRow);

  const labelFor = (column: string) =>
    schema?.columns.find((candidate) => candidate.name === column)?.canonical_label.replace(
      /_/g,
      " ",
    ) ?? column;

  const note = relaxationNote(results, labelFor);

  // Which columns to print on a card — the filterable ones, so the strip shows
  // exactly the attributes the client is choosing between.
  const summaryColumns = (schema?.columns ?? [])
    .filter(
      (column) =>
        column.role === "categorical_filter" || column.role === "numeric_range",
    )
    .slice(0, 3);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
      {note ? (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs leading-snug text-amber-900">
          {note}
        </p>
      ) : null}

      {results.rows.length === 0 ? (
        <p className="py-2 text-sm text-zinc-400">
          Nothing in the catalog matches — and nothing came close enough to show.
        </p>
      ) : (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {results.rows.map((row) => {
            const badge = resolutionBadge(row.link);
            const active = row.index === selectedIndex;
            return (
              <li key={row.index} className="shrink-0">
                <button
                  type="button"
                  onClick={() => selectRow(row.index)}
                  aria-pressed={active}
                  className={[
                    "w-44 rounded-xl border px-3 py-2 text-left transition",
                    active
                      ? "border-zinc-900 bg-zinc-50"
                      : "border-zinc-200 hover:border-zinc-400",
                    badge ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <span className="block truncate text-sm font-medium text-zinc-900">
                    {row.identifier}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-zinc-500">
                    {summaryColumns
                      .map((column) =>
                        column.role === "numeric_range"
                          ? row.numeric[column.name]
                          : row.canonical[column.name],
                      )
                      .filter((value) => value !== null && value !== undefined && value !== "")
                      .join(" · ") || "—"}
                  </span>
                  {badge ? (
                    <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                      {badge}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
