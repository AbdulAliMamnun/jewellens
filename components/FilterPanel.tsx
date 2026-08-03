"use client";

import {
  activeFilters,
  filterColumns,
  rangeInUse,
  valuesInUse,
} from "@/lib/catalog-filter";
import type { ColumnProfile } from "@/lib/catalog-schema";
import { useCatalogStore } from "@/lib/catalog-store";

/** Carats and millimetres deserve a finer step than prices do. */
function stepFor(span: number): number {
  if (span <= 5) return 0.05;
  if (span <= 100) return 1;
  return Math.max(1, Math.round(span / 100));
}

function round(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function ChipGroup({ column }: { column: ColumnProfile }) {
  const rows = useCatalogStore((state) => state.rows);
  const selected = useCatalogStore((state) => state.filters.categorical[column.name]);
  const toggleValue = useCatalogStore((state) => state.toggleValue);
  const setValues = useCatalogStore((state) => state.setValues);

  const values = valuesInUse(column, rows);
  if (values.length === 0) return null;

  const chosen = selected ?? [];

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {column.canonical_label.replace(/_/g, " ")}
        </h3>
        {chosen.length > 0 ? (
          <button
            type="button"
            onClick={() => setValues(column.name, [])}
            className="text-xs text-zinc-400 transition hover:text-zinc-700"
          >
            any
          </button>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {values.map((value) => {
          const active = chosen.includes(value);
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => toggleValue(column.name, value)}
              className={[
                "rounded-full border px-2.5 py-1 text-xs font-medium transition",
                active
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400",
              ].join(" ")}
            >
              {value}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RangeSlider({ column }: { column: ColumnProfile }) {
  const rows = useCatalogStore((state) => state.rows);
  const range = useCatalogStore((state) => state.filters.numeric[column.name]);
  const setRange = useCatalogStore((state) => state.setRange);

  const bounds = rangeInUse(column, rows);
  if (!bounds || bounds.min === bounds.max) return null;

  const step = stepFor(bounds.max - bounds.min);
  const current = range ?? bounds;
  const label = column.canonical_label.replace(/_/g, " ");

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {label}
        </h3>
        {range ? (
          <button
            type="button"
            onClick={() => setRange(column.name, null)}
            className="text-xs text-zinc-400 transition hover:text-zinc-700"
          >
            any
          </button>
        ) : null}
      </div>

      <p className="mt-1 text-sm text-zinc-800">
        {current.min} – {current.max}
      </p>

      <div className="mt-1 flex flex-col gap-1">
        <input
          type="range"
          aria-label={`Minimum ${label}`}
          min={bounds.min}
          max={bounds.max}
          step={step}
          value={current.min}
          onChange={(event) => {
            const min = round(Number(event.target.value), step);
            setRange(column.name, { min, max: Math.max(min, current.max) });
          }}
          className="w-full accent-zinc-900"
        />
        <input
          type="range"
          aria-label={`Maximum ${label}`}
          min={bounds.min}
          max={bounds.max}
          step={step}
          value={current.max}
          onChange={(event) => {
            const max = round(Number(event.target.value), step);
            setRange(column.name, { min: Math.min(max, current.min), max });
          }}
          className="w-full accent-zinc-900"
        />
      </div>
    </div>
  );
}

/**
 * The dashboard, generated from the confirmed schema — no hard-coded jewellery
 * vocabulary, so a studio that tracks "shank style" gets a shank-style filter.
 */
export default function FilterPanel() {
  const schema = useCatalogStore((state) => state.schema);
  const filters = useCatalogStore((state) => state.filters);
  const rows = useCatalogStore((state) => state.rows);
  const results = useCatalogStore((state) => state.results);
  const clearFilters = useCatalogStore((state) => state.clearFilters);

  if (!schema) return null;

  const columns = filterColumns(schema);
  const active = activeFilters(filters).length;

  return (
    <aside className="flex w-full min-w-0 flex-col gap-4 rounded-2xl border border-zinc-200 bg-white px-4 py-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900">Filters</h2>
        {active > 0 ? (
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-full px-2 py-0.5 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
          >
            Clear all
          </button>
        ) : null}
      </div>

      {columns.length === 0 ? (
        <p className="text-sm text-zinc-400">
          No column was marked as a filter or a range. Edit the columns to add one.
        </p>
      ) : (
        columns.map((column) =>
          column.role === "categorical_filter" ? (
            <ChipGroup key={column.name} column={column} />
          ) : (
            <RangeSlider key={column.name} column={column} />
          ),
        )
      )}

      <p className="mt-auto border-t border-zinc-100 pt-3 text-xs text-zinc-500">
        {results.rows.length} of {rows.length} designs
        {results.exact ? "" : " (nearest match)"}
      </p>
    </aside>
  );
}
