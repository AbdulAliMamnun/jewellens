import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

// Relative + extension-bearing so scripts/check-3dm.mjs can import this module
// under Node's type stripping.
import {
  extractRenderMeshes,
  flattenParts,
  noRenderMeshesMessage,
  skippedSummary,
  type RawMesh,
} from "./rhino-extract.ts";
import { guessPartMaterial, type PartMaterial } from "./archive-parts.ts";

export type ModelFormat = "stl" | "obj" | "3dm";

export const SUPPORTED_EXTENSIONS = [".stl", ".obj", ".3dm"] as const;

/** Every loaded model is normalized to fit a box of this size, centered on the origin. */
export const FIT_SIZE = 2;

/** Files above this size get an explicit confirmation before they are parsed. */
export const LARGE_FILE_BYTES = 50 * 1024 * 1024;

export type ModelLoadErrorCode =
  | "unsupported"
  | "no-render-meshes"
  | "parse"
  | "fetch"
  | "empty";

/** Carries a machine-readable cause so the UI can react to each failure differently. */
export class ModelLoadError extends Error {
  readonly code: ModelLoadErrorCode;
  /** Extra guidance shown under the headline message. */
  readonly detail?: string;

  constructor(code: ModelLoadErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "ModelLoadError";
    this.code = code;
    this.detail = detail;
  }
}

/**
 * One editable component. STL and OBJ carry no structure, so they arrive as a
 * single part covering the whole model; .3dm files arrive grouped by layer and
 * instance definition.
 */
export interface LoadedPart {
  id: string;
  name: string;
  layerPath: string | null;
  definitionName: string | null;
  objectNames: string[];
  geometries: THREE.BufferGeometry[];
  triangleCount: number;
  /** Assigned from the part's naming — see guessPartMaterial. */
  material: PartMaterial;
}

export interface LoadedModel {
  /** Every geometry, flattened. Same objects the parts reference. */
  geometries: THREE.BufferGeometry[];
  /** The file's own structure, or a single whole-model part. */
  parts: LoadedPart[];
  /** True when the file carried real structure to edit. */
  hasParts: boolean;
  label: string;
  format: ModelFormat;
  triangleCount: number;
  /** Bounding box of the source model before normalization, in file units. */
  sourceSize: { x: number; y: number; z: number };
  /**
   * Real-world size in millimetres. Exact for .3dm (converted from the file's
   * declared unit system); assumed for STL/OBJ, which carry no units.
   */
  sizeMm: { x: number; y: number; z: number };
  /** What the millimetre figures are based on — shown next to the dimensions. */
  unitLabel: string;
  unitAssumed: boolean;
  /**
   * Geometry the file contained but that could not be drawn, when the load
   * still succeeded. null when everything rendered.
   */
  skippedSummary: string | null;
  /** Instance references resolved into placements (.3dm only). */
  instancePlacements: number;
}

/**
 * What the loader is doing right now. A 50MB .3dm spends most of its time
 * getting to the browser and the rest being turned into geometry — and the
 * second stretch blocks the tab, so it has to be announced rather than looking
 * like a freeze.
 */
export type LoadPhase = "downloading" | "reading" | "preparing";

export interface LoadOptions {
  /** 0..1 across reading and preparing. */
  onProgress?: (progress: number) => void;
  onPhase?: (phase: LoadPhase) => void;
  signal?: AbortSignal;
}

export function formatFromName(name: string): ModelFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".stl")) return "stl";
  if (lower.endsWith(".obj")) return "obj";
  if (lower.endsWith(".3dm")) return "3dm";
  return null;
}

export function isSupportedFile(name: string): boolean {
  return formatFromName(name) !== null;
}

function parse(format: ModelFormat, data: ArrayBuffer): THREE.Object3D {
  if (format === "stl") {
    const geometry = new STLLoader().parse(data);
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    return new THREE.Mesh(geometry);
  }
  return new OBJLoader().parse(new TextDecoder().decode(data));
}

/** Flattens the parsed scene graph, baking each mesh's transform into its geometry. */
function collectGeometries(root: THREE.Object3D): THREE.BufferGeometry[] {
  root.updateMatrixWorld(true);

  const geometries: THREE.BufferGeometry[] = [];
  const seen = new Set<THREE.BufferGeometry>();

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry as THREE.BufferGeometry;
    if (seen.has(geometry)) return;
    seen.add(geometry);
    geometry.applyMatrix4(child.matrixWorld);
    geometries.push(geometry);
  });

  return geometries;
}

/**
 * Recenters on the bounding-box center and scales uniformly so the longest axis
 * measures FIT_SIZE — the camera setup then works whether the CAD file was
 * authored in millimeters, inches, or meters.
 */
function normalize(geometries: THREE.BufferGeometry[]): THREE.Vector3 {
  const bounds = new THREE.Box3();
  for (const geometry of geometries) {
    geometry.computeBoundingBox();
    if (geometry.boundingBox) bounds.union(geometry.boundingBox);
  }
  if (bounds.isEmpty()) {
    throw new ModelLoadError("empty", "The file opened, but there's nothing in it to show.");
  }

  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const longestAxis = Math.max(size.x, size.y, size.z) || 1;
  const scale = FIT_SIZE / longestAxis;

  const transform = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));

  for (const geometry of geometries) {
    geometry.applyMatrix4(transform);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }

  return size;
}

function countTriangles(geometries: THREE.BufferGeometry[]): number {
  let vertices = 0;
  for (const geometry of geometries) {
    const index = geometry.getIndex();
    vertices += index ? index.count : (geometry.getAttribute("position")?.count ?? 0);
  }
  return Math.round(vertices / 3);
}

function finish(
  parts: LoadedPart[],
  format: ModelFormat,
  label: string,
  unit: { scaleToMm: number; label: string; assumed: boolean },
  extras: { skippedSummary?: string | null; instancePlacements?: number } = {},
): LoadedModel {
  const geometries = parts.flatMap((part) => part.geometries);
  // Normalizing mutates the geometries in place, and the parts hold the same
  // objects — so this centres and scales every part together.
  const sourceSize = normalize(geometries);

  return {
    geometries,
    parts,
    hasParts: parts.length > 1,
    label,
    format,
    triangleCount: countTriangles(geometries),
    sourceSize: { x: sourceSize.x, y: sourceSize.y, z: sourceSize.z },
    sizeMm: {
      x: sourceSize.x * unit.scaleToMm,
      y: sourceSize.y * unit.scaleToMm,
      z: sourceSize.z * unit.scaleToMm,
    },
    unitLabel: unit.label,
    unitAssumed: unit.assumed,
    skippedSummary: extras.skippedSummary ?? null,
    instancePlacements: extras.instancePlacements ?? 0,
  };
}

/** STL and OBJ carry no unit declaration; jewelry CAD exports are millimetres. */
const ASSUMED_MM = { scaleToMm: 1, label: "mm", assumed: true };

function buildMesh(format: "stl" | "obj", label: string, data: ArrayBuffer): LoadedModel {
  let parsed: THREE.Object3D;
  try {
    parsed = parse(format, data);
  } catch {
    throw new ModelLoadError(
      "parse",
      `Could not parse ${label} as ${format.toUpperCase()}.`,
    );
  }
  const geometries = collectGeometries(parsed);
  return finish(
    [
      {
        id: "model",
        name: "Whole model",
        layerPath: null,
        definitionName: null,
        objectNames: [],
        geometries,
        triangleCount: countTriangles(geometries),
        material: { kind: "metal", metal: "yellow_gold" },
      },
    ],
    format,
    label,
    ASSUMED_MM,
  );
}

// ---------------------------------------------------------------------------
// .3dm (Rhino / Matrix)
// ---------------------------------------------------------------------------

type RhinoModule = Awaited<ReturnType<typeof import("rhino3dm").default>>;

/** Where scripts/copy-rhino3dm.mjs stages the WASM build. */
const RHINO_MODULE_URL = "/rhino3dm/rhino3dm.module.min.js";

let rhinoPromise: Promise<RhinoModule> | null = null;

/**
 * Loads the 2.6MB rhino3dm WASM on first use only, straight from /public rather
 * than through the bundler — the emscripten glue resolves its own .wasm sibling
 * and does not survive being bundled.
 */
function getRhino(): Promise<RhinoModule> {
  if (!rhinoPromise) {
    rhinoPromise = (async () => {
      const specifier = RHINO_MODULE_URL;
      const loaded = (await import(/* turbopackIgnore: true */ specifier)) as {
        default: (config?: { locateFile?: (path: string) => string }) => Promise<RhinoModule>;
      };
      return loaded.default({ locateFile: (path) => `/rhino3dm/${path}` });
    })().catch((cause) => {
      rhinoPromise = null;
      throw new ModelLoadError(
        "parse",
        "Could not load the Rhino reader.",
        cause instanceof Error ? cause.message : undefined,
      );
    });
  }
  return rhinoPromise;
}

function geometryFromRawMesh(mesh: RawMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.position, 3));
  if (mesh.normal && mesh.normal.length === mesh.position.length) {
    geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normal, 3));
  }
  geometry.setIndex(new THREE.BufferAttribute(mesh.index, 1));
  if (!mesh.normal) geometry.computeVertexNormals();
  return geometry;
}

async function build3dm(label: string, data: ArrayBuffer): Promise<LoadedModel> {
  const rhino = await getRhino();

  let doc: ReturnType<RhinoModule["File3dm"]["fromByteArray"]> | null;
  try {
    doc = rhino.File3dm.fromByteArray(new Uint8Array(data));
  } catch (cause) {
    throw new ModelLoadError(
      "parse",
      `Could not read ${label} as a Rhino file.`,
      cause instanceof Error ? cause.message : undefined,
    );
  }
  if (!doc) {
    throw new ModelLoadError(
      "parse",
      `Could not read ${label} as a Rhino file.`,
      "The file may be damaged, or saved by a Rhino version this app can't open yet.",
    );
  }

  const extraction = extractRenderMeshes(rhino, doc);

  if (flattenParts(extraction.parts).length === 0) {
    throw new ModelLoadError(
      "no-render-meshes",
      `${label} has no render meshes to display.`,
      noRenderMeshesMessage(extraction),
    );
  }

  const parts: LoadedPart[] = extraction.parts.map((part) => ({
    id: part.id,
    name: part.name,
    layerPath: part.layerPath,
    definitionName: part.definitionName,
    objectNames: part.objectNames,
    geometries: part.meshes.map(geometryFromRawMesh),
    triangleCount: part.triangleCount,
    material: guessPartMaterial(part),
  }));
  const unit = extraction.unit;

  return finish(
    parts,
    "3dm",
    label,
    {
      scaleToMm: unit?.scaleToMm ?? 1,
      label: unit ? unitAbbreviation(unit.name) : "mm",
      assumed: unit === null,
    },
    {
      // Partial success is reported, not swallowed: the session list says what
      // was left out and whether a meshed duplicate is covering for it.
      skippedSummary: skippedSummary(extraction),
      instancePlacements: extraction.instancePlacements,
    },
  );
}

function unitAbbreviation(name: string): string {
  const abbreviations: Record<string, string> = {
    Millimeters: "mm",
    Centimeters: "cm",
    Decimeters: "dm",
    Meters: "m",
    Inches: "in",
    Feet: "ft",
    Microns: "µm",
    Mils: "mil",
  };
  return abbreviations[name] ?? name;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Reads a File with progress. `file.arrayBuffer()` reports none, which is no use for 50MB CAD. */
function readWithProgress(
  file: File,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (!onProgress) return file.arrayBuffer();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () =>
      reject(new ModelLoadError("parse", `Could not read ${file.name} from disk.`));
    reader.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => reader.abort(), { once: true });
    reader.readAsArrayBuffer(file);
  });
}

export async function loadModelFromFile(
  file: File,
  options: LoadOptions = {},
): Promise<LoadedModel> {
  const format = formatFromName(file.name);
  if (!format) {
    throw new ModelLoadError(
      "unsupported",
      `${file.name} isn't a design file — use ${SUPPORTED_EXTENSIONS.join(", ")}.`,
    );
  }

  // Reading is most of the wall clock on big files; preparing is the last stretch.
  options.onPhase?.("reading");
  const data = await readWithProgress(
    file,
    options.onProgress ? (progress) => options.onProgress?.(progress * 0.85) : undefined,
    options.signal,
  );
  options.onProgress?.(0.85);
  options.onPhase?.("preparing");

  if (format === "3dm") {
    const model = await build3dm(file.name, data);
    options.onProgress?.(1);
    return model;
  }

  const model = buildMesh(format, file.name, data);
  options.onProgress?.(1);
  return model;
}

export async function loadModelFromUrl(
  url: string,
  options: LoadOptions = {},
): Promise<LoadedModel> {
  const { onProgress, onPhase, signal } = options;
  const label = decodeURIComponent(url.split("/").pop() || url);
  const format = formatFromName(label);
  if (!format) {
    throw new ModelLoadError(
      "unsupported",
      `${label} isn't a design file — use ${SUPPORTED_EXTENSIONS.join(", ")}.`,
    );
  }

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ModelLoadError("fetch", `Could not reach ${url}.`);
  }
  if (!response.ok) {
    throw new ModelLoadError(
      "fetch",
      `Could not load ${label} (HTTP ${response.status}).`,
    );
  }

  onPhase?.("downloading");
  const data = await readResponseWithProgress(response, onProgress);
  onProgress?.(0.85);
  onPhase?.("preparing");

  // Let the browser paint the "preparing" state before the parse blocks it.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const model = format === "3dm" ? await build3dm(label, data) : buildMesh(format, label, data);
  onProgress?.(1);
  return model;
}

/**
 * Streams a response so a catalog row backed by a big archive file shows the
 * same progress an uploaded one does. Falls back to a plain read when the
 * server sends no length.
 */
async function readResponseWithProgress(
  response: Response,
  onProgress?: (progress: number) => void,
): Promise<ArrayBuffer> {
  const total = Number(response.headers.get("content-length") ?? 0);
  if (!onProgress || !response.body || !total) return response.arrayBuffer();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(0.85, (received / total) * 0.85));
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged.buffer;
}

/** Releases GPU memory. Call when a model is swapped out or the viewer unmounts. */
export function disposeModel(model: LoadedModel): void {
  for (const geometry of model.geometries) geometry.dispose();
}
