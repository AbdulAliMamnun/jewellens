import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

export type ModelFormat = "stl" | "obj";

export const SUPPORTED_EXTENSIONS = [".stl", ".obj"] as const;

/** Every loaded model is normalized to fit a box of this size, centered on the origin. */
export const FIT_SIZE = 2;

export interface LoadedModel {
  /** Normalized, world-space geometry — render each as a plain `<mesh>`. */
  geometries: THREE.BufferGeometry[];
  label: string;
  format: ModelFormat;
  triangleCount: number;
  /** Bounding box of the source model before normalization, in file units. */
  sourceSize: { x: number; y: number; z: number };
}

export function formatFromName(name: string): ModelFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".stl")) return "stl";
  if (lower.endsWith(".obj")) return "obj";
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
    throw new Error("The file parsed, but contains no geometry.");
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

function build(format: ModelFormat, label: string, data: ArrayBuffer): LoadedModel {
  let parsed: THREE.Object3D;
  try {
    parsed = parse(format, data);
  } catch {
    throw new Error(`Could not parse ${label} as ${format.toUpperCase()}.`);
  }

  const geometries = collectGeometries(parsed);
  const sourceSize = normalize(geometries);

  return {
    geometries,
    label,
    format,
    triangleCount: countTriangles(geometries),
    sourceSize: { x: sourceSize.x, y: sourceSize.y, z: sourceSize.z },
  };
}

export async function loadModelFromFile(file: File): Promise<LoadedModel> {
  const format = formatFromName(file.name);
  if (!format) {
    throw new Error(
      `${file.name} is not a supported model — use ${SUPPORTED_EXTENSIONS.join(" or ")}.`,
    );
  }
  return build(format, file.name, await file.arrayBuffer());
}

export async function loadModelFromUrl(
  url: string,
  signal?: AbortSignal,
): Promise<LoadedModel> {
  const label = decodeURIComponent(url.split("/").pop() || url);
  const format = formatFromName(label);
  if (!format) {
    throw new Error(
      `${label} is not a supported model — use ${SUPPORTED_EXTENSIONS.join(" or ")}.`,
    );
  }

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new Error(`Could not reach ${url}.`);
  }
  if (!response.ok) {
    throw new Error(`Could not load ${label} (HTTP ${response.status}).`);
  }

  return build(format, label, await response.arrayBuffer());
}

/** Releases GPU memory. Call when a model is swapped out or the viewer unmounts. */
export function disposeModel(model: LoadedModel): void {
  for (const geometry of model.geometries) geometry.dispose();
}
