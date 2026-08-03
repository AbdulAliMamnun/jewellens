import { z } from "zod";

/**
 * The learned shape of a studio's spreadsheet. Every studio names its columns
 * differently, so the roles and value groupings are inferred per upload and then
 * confirmed by a human before anything depends on them.
 *
 * Relative + extension-bearing imports elsewhere in this file's neighbourhood so
 * the Node check scripts can exercise it directly.
 */
export const COLUMN_ROLES = [
  "categorical_filter",
  "numeric_range",
  "identifier",
  "file_link",
  "text",
] as const;

export type ColumnRole = (typeof COLUMN_ROLES)[number];

export const ROLE_LABELS: Record<ColumnRole, string> = {
  categorical_filter: "Filter",
  numeric_range: "Range",
  identifier: "ID",
  file_link: "File link",
  text: "Text",
};

export const ROLE_HINTS: Record<ColumnRole, string> = {
  categorical_filter: "A set of known values — becomes filter chips.",
  numeric_range: "A number — becomes a range slider.",
  identifier: "Names the design; shown on every result.",
  file_link: "Points at the CAD file for each design.",
  text: "Free notes. Kept, but not something you can filter on.",
};

export const canonicalValueSchema = z.object({
  canonical: z.string().min(1),
  variants: z.array(z.string()).default([]),
});

export type CanonicalValue = z.infer<typeof canonicalValueSchema>;

export const columnProfileSchema = z.object({
  name: z.string().min(1),
  role: z.enum(COLUMN_ROLES),
  canonical_label: z.string().min(1),
  values: z.array(canonicalValueSchema).default([]),
  range: z
    .object({ min: z.number().finite(), max: z.number().finite() })
    .nullable()
    .default(null),
});

export type ColumnProfile = z.infer<typeof columnProfileSchema>;

export const schemaProfileSchema = z.object({
  columns: z.array(columnProfileSchema).min(1),
  file_link_column: z.string().nullable().default(null),
  notes: z.string().default(""),
});

export type SchemaProfile = z.infer<typeof schemaProfileSchema>;

export const profileRequestSchema = z.object({
  headers: z.array(z.string().min(1)).min(1).max(60),
  /** Up to 30 sample rows. The rest of the catalog never leaves the browser. */
  sampleRows: z.array(z.record(z.string(), z.string())).max(30),
});

export type ProfileRequest = z.infer<typeof profileRequestSchema>;

/** Cheap comparison key for value grouping: case- and punctuation-insensitive. */
export function normalizeValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9./]+/g, " ")
    .trim();
}

/**
 * Forces a model-produced profile to describe the sheet that was actually
 * uploaded: unknown columns are dropped, missing ones are added as text, and a
 * file_link_column that names nothing is cleared. Confirmation shows the result,
 * so a wrong guess is visible and correctable rather than silently load-bearing.
 */
export function reconcileProfile(
  profile: SchemaProfile,
  headers: readonly string[],
): SchemaProfile {
  const byName = new Map(profile.columns.map((column) => [column.name, column]));

  const columns: ColumnProfile[] = headers.map((header) => {
    const found = byName.get(header);
    if (found) return { ...found, name: header };
    return {
      name: header,
      role: "text",
      canonical_label: header.toLowerCase().replace(/\s+/g, "_"),
      values: [],
      range: null,
    };
  });

  // At most one file-link column, and it has to exist.
  let fileLink =
    profile.file_link_column && headers.includes(profile.file_link_column)
      ? profile.file_link_column
      : (columns.find((column) => column.role === "file_link")?.name ?? null);

  for (const column of columns) {
    if (column.role === "file_link" && column.name !== fileLink) {
      column.role = "text";
    }
  }
  if (fileLink) {
    const column = columns.find((candidate) => candidate.name === fileLink);
    if (column) column.role = "file_link";
    else fileLink = null;
  }

  return { columns, file_link_column: fileLink, notes: profile.notes };
}

/** The value a row carries for a column, as a trimmed string. */
export function cellText(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * Maps a raw cell onto its canonical value, e.g. "RG" → "rose gold". Falls back
 * to the raw text so an unlisted value is still filterable rather than lost.
 */
export function canonicalFor(column: ColumnProfile, raw: string): string {
  const normalized = normalizeValue(raw);
  if (!normalized) return "";
  for (const value of column.values) {
    if (normalizeValue(value.canonical) === normalized) return value.canonical;
    if (value.variants.some((variant) => normalizeValue(variant) === normalized)) {
      return value.canonical;
    }
  }
  return raw.trim();
}

/**
 * Numbers as spreadsheets actually carry them: 1.5, "1.00 ct", ".75", "1 1/2".
 * Returns null when there is no number in the cell at all.
 */
export function parseNumeric(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;

  const fraction = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (fraction) {
    const whole = Number(fraction[1]);
    const numerator = Number(fraction[2]);
    const denominator = Number(fraction[3]);
    if (denominator !== 0) return whole + numerator / denominator;
  }

  const bare = text.match(/^(\d+)\s*\/\s*(\d+)/);
  if (bare && Number(bare[2]) !== 0) return Number(bare[1]) / Number(bare[2]);

  const decimal = text.match(/-?\d*\.?\d+/);
  return decimal ? Number(decimal[0]) : null;
}
