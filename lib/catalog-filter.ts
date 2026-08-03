// Relative + extension-bearing so the Node check scripts can import this module.
import type { ColumnProfile, SchemaProfile } from "./catalog-schema.ts";

/** What a row needs to carry to be filterable — the store's CatalogRow satisfies it. */
export interface FilterableRow {
  index: number;
  identifier: string;
  canonical: Record<string, string>;
  numeric: Record<string, number | null>;
  link: { status: string };
}

/**
 * Selections per column. Values within a column are OR'd (rose gold OR platinum);
 * columns are AND'd (rose gold AND oval) — the way a person reads a filter panel.
 */
export interface FilterState {
  categorical: Record<string, string[]>;
  numeric: Record<string, { min: number; max: number }>;
}

export const EMPTY_FILTERS: FilterState = { categorical: {}, numeric: {} };

/** The columns a person can actually filter on, in sheet order. */
export function filterColumns(schema: SchemaProfile): ColumnProfile[] {
  return schema.columns.filter(
    (column) => column.role === "categorical_filter" || column.role === "numeric_range",
  );
}

/** Every canonical value present in the sheet for a column, in profile order first. */
export function valuesInUse(
  column: ColumnProfile,
  rows: readonly FilterableRow[],
): string[] {
  const present = new Set(
    rows.map((row) => row.canonical[column.name]).filter((value) => Boolean(value)),
  );
  const ordered = column.values
    .map((value) => value.canonical)
    .filter((value) => present.has(value));
  const extra = [...present].filter((value) => !ordered.includes(value)).sort();
  return [...ordered, ...extra];
}

/** The full span of a numeric column across the sheet — the slider's bounds. */
export function rangeInUse(
  column: ColumnProfile,
  rows: readonly FilterableRow[],
): { min: number; max: number } | null {
  const numbers = rows
    .map((row) => row.numeric[column.name])
    .filter((value): value is number => value !== null && value !== undefined);
  if (numbers.length === 0) return null;
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

/** Which filters are actually narrowing anything, as `column` keys. */
export function activeFilters(state: FilterState): string[] {
  return [
    ...Object.entries(state.categorical)
      .filter(([, values]) => values.length > 0)
      .map(([column]) => column),
    ...Object.keys(state.numeric),
  ];
}

function matchesColumn(row: FilterableRow, column: string, state: FilterState): boolean {
  const selected = state.categorical[column];
  if (selected && selected.length > 0) {
    // A blank cell is unknown, not a match: filtering to "bezel" should not
    // surface a design whose setting nobody recorded.
    return selected.includes(row.canonical[column] ?? "");
  }
  const range = state.numeric[column];
  if (range) {
    const value = row.numeric[column];
    if (value === null || value === undefined) return false;
    return value >= range.min && value <= range.max;
  }
  return true;
}

export function filterRows<T extends FilterableRow>(
  rows: readonly T[],
  state: FilterState,
): T[] {
  const columns = activeFilters(state);
  return rows.filter((row) => columns.every((column) => matchesColumn(row, column, state)));
}

/** Drops one column's selection, leaving the rest intact. */
function without(state: FilterState, column: string): FilterState {
  const categorical = { ...state.categorical };
  const numeric = { ...state.numeric };
  delete categorical[column];
  delete numeric[column];
  return { categorical, numeric };
}

export interface MatchResult<T extends FilterableRow = FilterableRow> {
  rows: T[];
  /** Columns that had to be given up to find anything. Empty on an exact match. */
  relaxed: string[];
  exact: boolean;
}

/**
 * Exact matches if there are any; otherwise the nearest thing, giving up one
 * filter at a time. A dead-end filter panel is worse than useless in front of a
 * client — but so is quietly widening the search, so the caller is told exactly
 * what was let go.
 */
export function matchRows<T extends FilterableRow>(
  rows: readonly T[],
  state: FilterState,
): MatchResult<T> {
  const exact = filterRows(rows, state);
  if (exact.length > 0) return { rows: exact, relaxed: [], exact: true };

  const columns = activeFilters(state);
  if (columns.length === 0) return { rows: [], relaxed: [], exact: true };

  // Widening one filter at a time, then two, and so on. The nearest match is the
  // one that gives up the least: fewest filters dropped, then the tightest result.
  for (let depth = 1; depth <= columns.length; depth++) {
    let best: { rows: T[]; relaxed: string[] } | null = null;

    for (const combination of combinations(columns, depth)) {
      let relaxedState = state;
      for (const column of combination) relaxedState = without(relaxedState, column);

      const found = filterRows(rows, relaxedState);
      if (found.length === 0) continue;
      if (!best || found.length < best.rows.length) {
        best = { rows: found, relaxed: combination };
      }
    }

    if (best) return { rows: best.rows, relaxed: best.relaxed, exact: false };
  }

  return { rows: [...rows], relaxed: columns, exact: false };
}

/** Column subsets of a given size, in stable order. */
function combinations(items: readonly string[], size: number): string[][] {
  if (size === 0) return [[]];
  if (size > items.length) return [];
  const out: string[][] = [];
  const walk = (start: number, picked: string[]) => {
    if (picked.length === size) {
      out.push([...picked]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      picked.push(items[i]);
      walk(i + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);
  return out;
}

/**
 * The row to put on screen: the first match whose file can actually be loaded.
 * A row with a missing file still shows in the results — it just isn't the one
 * the viewer opens on.
 */
export function bestMatch<T extends FilterableRow>(rows: readonly T[]): T | null {
  return rows.find((row) => row.link.status === "resolved") ?? rows[0] ?? null;
}

/** What to tell the user when the exact request had no answer. */
export function relaxationNote(
  result: MatchResult<FilterableRow>,
  labelFor: (column: string) => string,
): string | null {
  if (result.exact || result.relaxed.length === 0) return null;
  const labels = result.relaxed.map(labelFor);
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `Nothing matched exactly. Showing ${result.rows.length} design${
    result.rows.length === 1 ? "" : "s"
  } with ${list} relaxed.`;
}
