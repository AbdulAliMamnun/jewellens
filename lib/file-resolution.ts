// Relative + extension-bearing so the Node check scripts can import this module.
import { isSupportedFile } from "./model-loader.ts";

/**
 * A file a catalog row can point at. Rows resolve by filename, not by path: a
 * studio's spreadsheet says "R-1042.3dm" or "C:\\Designs\\R-1042.3dm", and the
 * same design might arrive from the archive folder or be dropped in mid-meeting.
 */
export type ResolvableFile =
  | { kind: "archive"; name: string; url: string }
  | { kind: "session"; name: string; entryId: string };

export interface LinkResolution {
  /** The raw cell value. */
  raw: string;
  /** Filename pulled out of it, lower-cased. */
  fileName: string | null;
  source: ResolvableFile | null;
  status: "resolved" | "missing" | "empty" | "unsupported";
}

/** Last path segment of a link, tolerating Windows paths, URLs and query strings. */
export function fileNameFromLink(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withoutQuery = trimmed.split(/[?#]/)[0];
  const segments = withoutQuery.split(/[\\/]+/).filter(Boolean);
  const last = segments[segments.length - 1];
  return last ? last.toLowerCase() : null;
}

/**
 * Resolves a link against everything currently available. Nothing here throws:
 * an unresolved row is a normal state the dashboard shows greyed out, not an
 * error — a studio's archive is always partly elsewhere.
 */
export function resolveLink(
  raw: string,
  pool: readonly ResolvableFile[],
): LinkResolution {
  const fileName = fileNameFromLink(raw);
  if (!fileName) return { raw, fileName: null, source: null, status: "empty" };

  if (!isSupportedFile(fileName)) {
    return { raw, fileName, source: null, status: "unsupported" };
  }

  // Session uploads win: a file dropped in the meeting is the one being shown.
  const session = pool.find(
    (candidate) => candidate.kind === "session" && candidate.name.toLowerCase() === fileName,
  );
  if (session) return { raw, fileName, source: session, status: "resolved" };

  const archive = pool.find(
    (candidate) => candidate.kind === "archive" && candidate.name.toLowerCase() === fileName,
  );
  if (archive) return { raw, fileName, source: archive, status: "resolved" };

  return { raw, fileName, source: null, status: "missing" };
}

export function isResolved(resolution: LinkResolution): boolean {
  return resolution.status === "resolved";
}

/** Short badge text for a row whose file could not be found. */
export function resolutionBadge(resolution: LinkResolution): string | null {
  switch (resolution.status) {
    case "resolved":
      return null;
    case "empty":
      return "no file link";
    case "unsupported":
      return "unsupported file type";
    case "missing":
      return "file not found";
  }
}
