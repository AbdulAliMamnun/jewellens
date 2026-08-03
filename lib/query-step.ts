import { z } from "zod";

// Relative + extension-bearing so the Node check scripts can import this module.
import {
  activeFilters,
  rangeInUse,
  valuesInUse,
  type FilterState,
  type FilterableRow,
} from "./catalog-filter.ts";
import { normalizeValue, type ColumnProfile, type SchemaProfile } from "./catalog-schema.ts";

/**
 * What one prompt box can mean. Retrieval and editing are different engines —
 * one changes which design is on screen, the other changes the design itself —
 * so the classification has to be explicit rather than guessed downstream.
 */
export const queryIntents = ["retrieve", "edit", "other"] as const;
export type QueryIntent = (typeof queryIntents)[number];

const rangeSchema = z.object({ min: z.number().finite(), max: z.number().finite() });

export const queryResponseSchema = z.object({
  intent: z.enum(queryIntents),
  /** Only meaningful for "retrieve": selections keyed by column NAME. */
  filters: z
    .object({
      categorical: z.record(z.string(), z.array(z.string())).default({}),
      numeric: z.record(z.string(), rangeSchema).default({}),
    })
    .default({ categorical: {}, numeric: {} }),
  /** Whether this narrows the current filters or replaces them. */
  replace: z.boolean().default(true),
  assistantNote: z.string().min(1),
  unhandled: z.array(z.string()).default([]),
});

export type QueryResponse = z.infer<typeof queryResponseSchema>;

export const queryRequestSchema = z.object({
  userMessage: z.string().min(1).max(2000),
  vocabulary: z.object({
    categorical: z.array(
      z.object({
        column: z.string(),
        label: z.string(),
        values: z.array(z.string()),
      }),
    ),
    numeric: z.array(
      z.object({
        column: z.string(),
        label: z.string(),
        min: z.number(),
        max: z.number(),
      }),
    ),
  }),
  hasDesignLoaded: z.boolean().default(false),
  briefHistory: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(8)
    .default([]),
});

export type QueryRequest = z.infer<typeof queryRequestSchema>;

export interface Vocabulary {
  categorical: { column: string; label: string; values: string[] }[];
  numeric: { column: string; label: string; min: number; max: number }[];
}

/**
 * What the model is allowed to filter on: the confirmed columns and the values
 * the sheet actually contains. Aggregate only — the rows themselves stay here.
 */
export function buildVocabulary(
  schema: SchemaProfile,
  rows: readonly FilterableRow[],
): Vocabulary {
  const categorical: Vocabulary["categorical"] = [];
  const numeric: Vocabulary["numeric"] = [];

  for (const column of schema.columns) {
    if (column.role === "categorical_filter") {
      const values = valuesInUse(column, rows);
      if (values.length > 0) {
        categorical.push({ column: column.name, label: column.canonical_label, values });
      }
    } else if (column.role === "numeric_range") {
      const bounds = rangeInUse(column, rows);
      if (bounds) {
        numeric.push({
          column: column.name,
          label: column.canonical_label,
          min: bounds.min,
          max: bounds.max,
        });
      }
    }
  }

  return { categorical, numeric };
}

export interface ReconciledQuery {
  filters: FilterState;
  /** Terms the model asked for that this catalog has no column or value for. */
  unmatched: string[];
}

/** Case- and punctuation-insensitive lookup of a value the sheet really has. */
function matchValue(column: ColumnProfile | undefined, wanted: string, known: string[]) {
  const normalized = normalizeValue(wanted);
  const direct = known.find((value) => normalizeValue(value) === normalized);
  if (direct) return direct;
  // A model may answer with a variant it saw in the sample ("RG") rather than
  // the canonical name the studio confirmed.
  const group = column?.values.find((value) =>
    value.variants.some((variant) => normalizeValue(variant) === normalized),
  );
  return group && known.includes(group.canonical) ? group.canonical : null;
}

/**
 * Forces a model's filter selection onto this catalog: unknown columns and
 * values are dropped and reported rather than silently filtering to nothing,
 * and ranges are clamped to what the sheet contains.
 */
export function reconcileQuery(
  response: QueryResponse,
  schema: SchemaProfile,
  rows: readonly FilterableRow[],
  current: FilterState,
): ReconciledQuery {
  const vocabulary = buildVocabulary(schema, rows);
  const unmatched: string[] = [];

  const categorical: FilterState["categorical"] = response.replace
    ? {}
    : { ...current.categorical };
  const numeric: FilterState["numeric"] = response.replace ? {} : { ...current.numeric };

  for (const [name, wanted] of Object.entries(response.filters.categorical)) {
    const known = vocabulary.categorical.find((entry) => entry.column === name);
    if (!known) {
      unmatched.push(...wanted);
      continue;
    }
    const profile = schema.columns.find((column) => column.name === name);
    const resolved: string[] = [];
    for (const value of wanted) {
      const match = matchValue(profile, value, known.values);
      if (match) resolved.push(match);
      else unmatched.push(value);
    }
    if (resolved.length > 0) categorical[name] = [...new Set(resolved)];
    else delete categorical[name];
  }

  for (const [name, range] of Object.entries(response.filters.numeric)) {
    const known = vocabulary.numeric.find((entry) => entry.column === name);
    if (!known) {
      unmatched.push(name);
      continue;
    }
    const min = Math.max(known.min, Math.min(range.min, range.max));
    const max = Math.min(known.max, Math.max(range.min, range.max));
    if (min > max) {
      // The whole requested band sits outside the catalog — say so instead of
      // filtering to an empty set that looks like a bug.
      unmatched.push(`${known.label} ${range.min}–${range.max}`);
      continue;
    }
    numeric[name] = { min, max };
  }

  return { filters: { categorical, numeric }, unmatched };
}

/** Plain-language summary of a filter state, for the reply. */
export function describeFilters(
  filters: FilterState,
  schema: SchemaProfile,
): string {
  const labelFor = (name: string) =>
    schema.columns.find((column) => column.name === name)?.canonical_label.replace(
      /_/g,
      " ",
    ) ?? name;

  const parts = [
    ...Object.entries(filters.categorical)
      .filter(([, values]) => values.length > 0)
      .map(([name, values]) => `${labelFor(name)}: ${values.join(" or ")}`),
    ...Object.entries(filters.numeric).map(
      ([name, range]) => `${labelFor(name)}: ${range.min}–${range.max}`,
    ),
  ];

  if (parts.length === 0) return "no filters";
  return parts.join(", ");
}

export function isFilterEmpty(filters: FilterState): boolean {
  return activeFilters(filters).length === 0;
}
