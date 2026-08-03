import * as XLSX from "xlsx";

/** How many rows are shown before commit. */
export const PREVIEW_ROWS = 10;
/** How many rows are sent to the profiler. Nothing else ever leaves the browser. */
export const SAMPLE_ROWS = 30;

export interface ParsedCatalog {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: Record<string, string>[];
}

export class CatalogParseError extends Error {}

/**
 * Reads an .xlsx/.csv entirely in the browser. Values are kept as text: a
 * catalog's "1 1/2" and "1.00 ct" are meaningful as written, and coercing them
 * here would throw away what the confirmation screen needs to show.
 */
export function parseCatalogFile(fileName: string, data: ArrayBuffer): ParsedCatalog {
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(data, { type: "array", raw: false });
  } catch {
    // The underlying reason is never actionable for the person holding the file.
    throw new CatalogParseError(`Couldn't open ${fileName} — is it an .xlsx or .csv?`);
  }

  const sheetName = book.SheetNames[0];
  if (!sheetName) throw new CatalogParseError(`${fileName} has nothing in it.`);

  const sheet = book.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });

  if (matrix.length === 0) throw new CatalogParseError(`${fileName} is empty.`);

  const headers = (matrix[0] ?? [])
    .map((cell) => String(cell ?? "").trim())
    .filter((header) => header.length > 0);
  if (headers.length === 0) {
    throw new CatalogParseError(
      `The first row of ${fileName} needs the column names — it looks blank.`,
    );
  }

  const rows: Record<string, string>[] = [];
  for (const line of matrix.slice(1)) {
    const row: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      const value = String(line[index] ?? "").trim();
      row[header] = value;
      if (value) hasValue = true;
    });
    if (hasValue) rows.push(row);
  }

  if (rows.length === 0) {
    throw new CatalogParseError(`${fileName} has column names but no designs under them.`);
  }

  return { fileName, sheetName, headers, rows };
}

/**
 * The slice sent for profiling. Spread across the sheet rather than taken from
 * the top, so a catalog sorted by metal doesn't hand the profiler one value.
 */
export function sampleForProfiling(
  catalog: ParsedCatalog,
  limit = SAMPLE_ROWS,
): Record<string, string>[] {
  if (catalog.rows.length <= limit) return catalog.rows;

  const step = catalog.rows.length / limit;
  const sample: Record<string, string>[] = [];
  for (let i = 0; i < limit; i++) sample.push(catalog.rows[Math.floor(i * step)]);
  return sample;
}
