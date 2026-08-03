import { readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { NextResponse } from "next/server";

import { isSupportedFile } from "@/lib/model-loader";

/**
 * Everything this deployment can serve as a model: the studio's archive folder
 * plus whatever else lives under /public/models. Catalog links resolve by
 * filename, so the subfolder a design sits in doesn't have to match the
 * spreadsheet's paths — studios' paths point at their own drive, not at us.
 */
const MODELS_DIR = join(process.cwd(), "public", "models");

/** Deep enough for a foldered archive, shallow enough not to walk a mounted drive. */
const MAX_DEPTH = 4;

async function walk(
  absolute: string,
  relative: string,
  depth: number,
  out: { name: string; url: string }[],
) {
  const entries = await readdir(absolute, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH) {
        await walk(join(absolute, entry.name), posix.join(relative, entry.name), depth + 1, out);
      }
    } else if (entry.isFile() && isSupportedFile(entry.name)) {
      out.push({
        name: entry.name,
        url: `/models/${posix.join(relative, entry.name)}`
          .split("/")
          .map((segment, index) => (index < 2 ? segment : encodeURIComponent(segment)))
          .join("/"),
      });
    }
  }
}

/**
 * A static directory can't be listed from the browser, and a build-time manifest
 * would go stale the moment a studio drops a file in.
 */
export async function GET() {
  const files: { name: string; url: string }[] = [];
  try {
    await walk(MODELS_DIR, "", 0, files);
    return NextResponse.json({ files });
  } catch (cause) {
    // A missing folder is the normal state before a studio has loaded anything.
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ files: [] });
    }
    return NextResponse.json(
      { files: [], error: "Could not read the model folder." },
      { status: 500 },
    );
  }
}
