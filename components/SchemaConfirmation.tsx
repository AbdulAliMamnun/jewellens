"use client";

import { useMemo } from "react";

import {
  COLUMN_ROLES,
  ROLE_HINTS,
  ROLE_LABELS,
  canonicalFor,
  cellText,
  parseNumeric,
  type ColumnProfile,
  type ColumnRole,
} from "@/lib/catalog-schema";
import { useCatalogStore } from "@/lib/catalog-store";
import { resolveLink } from "@/lib/file-resolution";

/** Stable identity, so a catalog-less render doesn't invalidate every useMemo. */
const NO_ROWS: Record<string, string>[] = [];

/**
 * How many rows carry each canonical value. Counted over the WHOLE sheet, not the
 * sample — the rows are already here in the browser, so the confirmation screen
 * can show real coverage even though Claude only saw 30 rows.
 */
function useValueCounts(column: ColumnProfile, rows: Record<string, string>[]) {
  return useMemo(() => {
    const counts = new Map<string, number>();
    let blank = 0;
    for (const row of rows) {
      const raw = cellText(row, column.name);
      if (!raw) {
        blank += 1;
        continue;
      }
      const canonical = canonicalFor(column, raw);
      counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
    }
    return { counts, blank };
  }, [column, rows]);
}

function CategoricalEditor({ column }: { column: ColumnProfile }) {
  const rows = useCatalogStore((state) => state.parsed?.rows ?? NO_ROWS);
  const renameGroup = useCatalogStore((state) => state.renameGroup);
  const mergeGroups = useCatalogStore((state) => state.mergeGroups);
  const splitVariant = useCatalogStore((state) => state.splitVariant);

  const { counts, blank } = useValueCounts(column, rows);

  // Values Claude never saw — the sample was 30 rows, the sheet may be 3,000.
  const unlisted = [...counts.keys()].filter(
    (value) => !column.values.some((group) => group.canonical === value),
  );

  return (
    <div className="mt-3 flex flex-col gap-2">
      {column.values.map((group) => (
        <div
          key={group.canonical}
          className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={group.canonical}
              onChange={(event) =>
                renameGroup(column.name, group.canonical, event.target.value)
              }
              aria-label={`Name for ${group.canonical}`}
              className="min-w-32 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm font-medium text-zinc-900"
            />
            <span className="shrink-0 text-xs text-zinc-500">
              {counts.get(group.canonical) ?? 0} rows
            </span>
            {column.values.length > 1 ? (
              <select
                value=""
                aria-label={`Merge ${group.canonical} into another value`}
                onChange={(event) => {
                  if (event.target.value) {
                    mergeGroups(column.name, group.canonical, event.target.value);
                  }
                }}
                className="shrink-0 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-600"
              >
                <option value="">Merge into…</option>
                {column.values
                  .filter((other) => other.canonical !== group.canonical)
                  .map((other) => (
                    <option key={other.canonical} value={other.canonical}>
                      {other.canonical}
                    </option>
                  ))}
              </select>
            ) : null}
          </div>

          {group.variants.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <span className="text-xs text-zinc-400">written as</span>
              {group.variants.map((variant) => (
                <button
                  key={variant}
                  type="button"
                  onClick={() => splitVariant(column.name, group.canonical, variant)}
                  title={`Split “${variant}” into its own value`}
                  className="group rounded-full border border-zinc-300 bg-white px-2 py-0.5 text-xs text-zinc-600 transition hover:border-zinc-400"
                >
                  {variant}
                  <span className="ml-1 text-zinc-300 group-hover:text-zinc-600">✕</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}

      {unlisted.length > 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs leading-snug text-amber-900">
          Also present outside the sample, kept as-is:{" "}
          {unlisted.slice(0, 8).join(", ")}
          {unlisted.length > 8 ? `, +${unlisted.length - 8} more` : ""}.
        </p>
      ) : null}

      {blank > 0 ? (
        <p className="text-xs text-zinc-400">
          {blank} row{blank > 1 ? "s" : ""} leave this blank — they match any filter
          on it.
        </p>
      ) : null}
    </div>
  );
}

function NumericSummary({ column }: { column: ColumnProfile }) {
  const rows = useCatalogStore((state) => state.parsed?.rows ?? NO_ROWS);

  const summary = useMemo(() => {
    const numbers = rows
      .map((row) => parseNumeric(cellText(row, column.name)))
      .filter((value): value is number => value !== null);
    if (numbers.length === 0) return null;
    return {
      min: Math.min(...numbers),
      max: Math.max(...numbers),
      unreadable: rows.length - numbers.length,
    };
  }, [column.name, rows]);

  if (!summary) {
    return (
      <p className="mt-2 text-xs text-amber-800">
        No numbers could be read from this column — it may be better as text.
      </p>
    );
  }

  return (
    <p className="mt-2 text-xs text-zinc-500">
      {summary.min} – {summary.max} across the sheet
      {summary.unreadable > 0
        ? ` · ${summary.unreadable} row${summary.unreadable > 1 ? "s" : ""} with no readable number`
        : ""}
    </p>
  );
}

function FileLinkSummary({ column }: { column: ColumnProfile }) {
  const rows = useCatalogStore((state) => state.parsed?.rows ?? NO_ROWS);
  const pool = useCatalogStore((state) => state.pool);

  const summary = useMemo(() => {
    let resolved = 0;
    let missing = 0;
    let empty = 0;
    const examples: string[] = [];
    for (const row of rows) {
      const resolution = resolveLink(cellText(row, column.name), pool);
      if (resolution.status === "resolved") resolved += 1;
      else if (resolution.status === "empty") empty += 1;
      else {
        missing += 1;
        if (resolution.fileName && examples.length < 3) examples.push(resolution.fileName);
      }
    }
    return { resolved, missing, empty, examples };
  }, [column.name, rows, pool]);

  return (
    <div className="mt-2 text-xs">
      <p className="text-zinc-500">
        {summary.resolved} of {rows.length} link
        {rows.length === 1 ? "" : "s"} found in the archive
        {summary.empty > 0 ? ` · ${summary.empty} blank` : ""}
      </p>
      {summary.missing > 0 ? (
        <p className="mt-1 rounded-lg bg-amber-50 px-3 py-1.5 leading-snug text-amber-900">
          {summary.missing} file{summary.missing > 1 ? "s" : ""} not found
          {summary.examples.length > 0 ? ` (${summary.examples.join(", ")})` : ""}.
          Those rows still show up — greyed, with a “file not found” badge — and
          resolve as soon as the file is dropped in.
        </p>
      ) : null}
    </div>
  );
}

export default function SchemaConfirmation() {
  const draft = useCatalogStore((state) => state.draft);
  const parsed = useCatalogStore((state) => state.parsed);
  const updateColumn = useCatalogStore((state) => state.updateColumn);
  const commit = useCatalogStore((state) => state.commit);
  const reset = useCatalogStore((state) => state.reset);

  if (!draft || !parsed) return null;

  return (
    <section className="mx-auto w-full max-w-4xl">
      <header className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
          Does this look right?
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          This is what Claude made of{" "}
          <span className="font-medium text-zinc-800">{parsed.fileName}</span>.
          Rename anything, merge values that mean the same thing, split ones that
          don&apos;t, and change what each column is for. Nothing is used until you
          confirm.
        </p>
      </header>

      {draft.notes ? (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm leading-snug text-amber-900">
          {draft.notes}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {draft.columns.map((column) => (
          <div
            key={column.name}
            className="rounded-2xl border border-zinc-200 bg-white px-4 py-3"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold text-zinc-900">
                  {column.name}
                </h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {ROLE_HINTS[column.role]}
                </p>
              </div>

              <label className="shrink-0 text-xs text-zinc-500">
                <span className="sr-only">Role for {column.name}</span>
                <select
                  value={column.role}
                  onChange={(event) =>
                    updateColumn(column.name, {
                      role: event.target.value as ColumnRole,
                    })
                  }
                  className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-800"
                >
                  {COLUMN_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {column.role === "categorical_filter" ? (
              <CategoricalEditor column={column} />
            ) : null}
            {column.role === "numeric_range" ? <NumericSummary column={column} /> : null}
            {column.role === "file_link" ? <FileLinkSummary column={column} /> : null}
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={commit}
          className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
        >
          Use this catalog
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
        >
          Start over
        </button>
        {!draft.file_link_column ? (
          <p className="text-xs text-amber-800">
            No column is set as the file link — set one to load rings from the
            catalog.
          </p>
        ) : null}
      </div>
    </section>
  );
}
