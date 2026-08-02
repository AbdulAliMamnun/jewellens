/**
 * Stages the rhino3dm WASM build into public/ so the browser can load it
 * directly. The emscripten glue resolves its own .wasm sibling relative to the
 * script URL, which does not survive bundling — so it is served as a static
 * asset instead and imported at runtime.
 *
 * Runs automatically via the `predev` / `prebuild` npm scripts.
 */
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "rhino3dm");
const destination = join(root, "public", "rhino3dm");

const FILES = ["rhino3dm.module.min.js", "rhino3dm.wasm"];

function isUpToDate(from, to) {
  try {
    const a = statSync(from);
    const b = statSync(to);
    return b.size === a.size && b.mtimeMs >= a.mtimeMs;
  } catch {
    return false;
  }
}

mkdirSync(destination, { recursive: true });

let copied = 0;
for (const file of FILES) {
  const from = join(source, file);
  const to = join(destination, file);
  if (isUpToDate(from, to)) continue;
  copyFileSync(from, to);
  copied++;
}

console.log(
  copied === 0
    ? "rhino3dm assets already staged in public/rhino3dm/"
    : `staged ${copied} rhino3dm asset(s) in public/rhino3dm/`,
);
