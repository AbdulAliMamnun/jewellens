/**
 * Pulls embedded render meshes out of a parsed .3dm document.
 *
 * rhino3dm has no meshing kernel: it can only hand back meshes Rhino already
 * baked into the file. A NURBS surface with no cached render mesh is invisible
 * here and always will be — which is why "no render meshes" is a distinct,
 * actionable outcome rather than a parse failure.
 *
 * Deliberately free of three.js and of "@/" aliases so scripts/check-3dm.mjs
 * can exercise it directly under Node.
 */

type RhinoModule = Awaited<ReturnType<typeof import("rhino3dm").default>>;
type File3dm = ReturnType<RhinoModule["File3dm"]["fromByteArray"]>;

/** A triangulated mesh in the file's own units, rotated Z-up → Y-up. */
export interface RawMesh {
  position: Float32Array;
  normal: Float32Array | null;
  index: Uint32Array | Uint16Array;
  triangleCount: number;
}

export interface RhinoUnit {
  /** Rhino's name for the unit, e.g. "Millimeters". */
  name: string;
  /** Multiply file coordinates by this to get millimetres. */
  scaleToMm: number;
}

export interface SkippedGroup {
  type: string;
  count: number;
  /**
   * How many of those sit on a layer that also carries a drawable mesh — a
   * meshed duplicate of the same part, so the geometry is probably on screen
   * anyway. Common in Matrix files where a solid and its mesh are both kept.
   */
  coveredByDuplicate: number;
}

/**
 * One editable component of an archive design. Rhino files carry their own
 * structure — layers per component, instance definitions for repeated parts —
 * and that structure is what makes part-level editing possible at all, so it is
 * preserved rather than flattened into one mesh soup.
 */
export interface ExtractedPart {
  /** Stable across reloads: derived from the layer path and definition name. */
  id: string;
  /** Best human label: definition name, else layer name, else object name. */
  name: string;
  /** Full layer path as Rhino stores it, e.g. "Ring::Head::Prongs". */
  layerPath: string | null;
  layerName: string | null;
  /** Set when the geometry arrived through an instance reference. */
  definitionName: string | null;
  /** Names of the objects that contributed, in file order. */
  objectNames: string[];
  /** Rhino geometry types seen, e.g. ["Mesh"] or ["Brep"]. */
  geometryTypes: string[];
  meshes: RawMesh[];
  triangleCount: number;
}

export interface RhinoExtraction {
  /** Grouped geometry. Flatten with `part.meshes` when structure is irrelevant. */
  parts: ExtractedPart[];
  /** null when the file declares None/Unset/CustomUnits. */
  unit: RhinoUnit | null;
  /** Top-level objects considered — instance-definition members are not counted. */
  objectCount: number;
  /** Objects that yielded at least one mesh. */
  meshedObjectCount: number;
  /** Instance references successfully resolved to geometry. */
  instancePlacements: number;
  /** Geometry we found but could not draw, by Rhino type name. */
  skipped: SkippedGroup[];
}

/** Every mesh in the file, structure discarded — for bounds and triangle counts. */
export function flattenParts(parts: readonly ExtractedPart[]): RawMesh[] {
  return parts.flatMap((part) => part.meshes);
}

/**
 * Millimetres per unit. Rhino's UnitSystem enum values are compared by identity
 * against the loaded module rather than by number, so this can't silently
 * mis-map if the enum is ever reordered.
 */
const UNIT_SCALES: readonly [name: string, scaleToMm: number][] = [
  ["Angstroms", 1e-7],
  ["Nanometers", 1e-6],
  ["Microns", 1e-3],
  ["Millimeters", 1],
  ["Centimeters", 10],
  ["Decimeters", 100],
  ["Meters", 1000],
  ["Dekameters", 10_000],
  ["Hectometers", 100_000],
  ["Kilometers", 1_000_000],
  ["Microinches", 2.54e-5],
  ["Mils", 2.54e-2],
  ["Inches", 25.4],
  ["Feet", 304.8],
  ["Yards", 914.4],
  ["Miles", 1_609_344],
  ["PrinterPoints", 25.4 / 72],
  ["PrinterPicas", 25.4 / 6],
  ["NauticalMiles", 1_852_000],
];

export function resolveUnit(rhino: RhinoModule, unitSystem: unknown): RhinoUnit | null {
  const table = rhino.UnitSystem as unknown as Record<string, unknown>;
  for (const [name, scaleToMm] of UNIT_SCALES) {
    if (table[name] !== undefined && unitSystem === table[name]) {
      return { name, scaleToMm };
    }
  }
  // None, Unset, CustomUnits, or an enum this build doesn't expose.
  return null;
}

// ---------------------------------------------------------------------------
// Transforms
//
// Instance transforms live in Rhino's Z-up space, so they are composed and
// applied there; the Z-up → Y-up swap happens once, last, per vertex. Rhino
// geometry is never mutated — a definition's mesh is shared by every reference
// to it, so transforming it in place would corrupt the next placement.
// ---------------------------------------------------------------------------

/** Row-major 4x4. */
export type Mat4 = number[];

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function matrixFromXform(xform: unknown): Mat4 {
  const m = xform as Record<string, number>;
  return [
    m.m00, m.m01, m.m02, m.m03,
    m.m10, m.m11, m.m12, m.m13,
    m.m20, m.m21, m.m22, m.m23,
    m.m30, m.m31, m.m32, m.m33,
  ];
}

/** a ∘ b — b applied first. */
function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[row * 4 + k] * b[k * 4 + col];
      out[row * 4 + col] = sum;
    }
  }
  return out;
}

function isIdentity(m: Mat4): boolean {
  for (let i = 0; i < 16; i++) {
    if (Math.abs(m[i] - IDENTITY[i]) > 1e-12) return false;
  }
  return true;
}

function determinant3(m: Mat4): number {
  return (
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[1] * (m[4] * m[10] - m[6] * m[8]) +
    m[2] * (m[4] * m[9] - m[5] * m[8])
  );
}

/**
 * Inverse-transpose of the linear part, so normals stay perpendicular under
 * non-uniform scale. Falls back to the linear part when the matrix is singular.
 */
function normalMatrix(m: Mat4): number[] {
  const det = determinant3(m);
  if (Math.abs(det) < 1e-12) return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];

  const inv = [
    (m[5] * m[10] - m[6] * m[9]) / det,
    (m[2] * m[9] - m[1] * m[10]) / det,
    (m[1] * m[6] - m[2] * m[5]) / det,
    (m[6] * m[8] - m[4] * m[10]) / det,
    (m[0] * m[10] - m[2] * m[8]) / det,
    (m[2] * m[4] - m[0] * m[6]) / det,
    (m[4] * m[9] - m[5] * m[8]) / det,
    (m[1] * m[8] - m[0] * m[9]) / det,
    (m[0] * m[5] - m[1] * m[4]) / det,
  ];
  // Transpose of the inverse.
  return [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]];
}

// ---------------------------------------------------------------------------
// Mesh conversion
// ---------------------------------------------------------------------------

interface ThreeBuffers {
  position?: ArrayLike<number>;
  normal?: ArrayLike<number>;
  index?: ArrayLike<number>;
}

/**
 * @param transform world transform in Rhino space, or null for an object placed
 *   directly in the document.
 */
function toRawMesh(mesh: unknown, transform: Mat4 | null): RawMesh | null {
  const source = mesh as {
    toThreejsBuffers?: (rotateToYUp: boolean) => ThreeBuffers;
  };
  if (!source?.toThreejsBuffers) return null;

  // Raw Rhino coordinates: the Y-up swap is applied below, after the transform.
  const buffers = source.toThreejsBuffers(false);
  const rawPosition = buffers.position;
  const rawIndex = buffers.index;
  if (!rawPosition || rawPosition.length < 9 || !rawIndex || rawIndex.length < 3) {
    return null;
  }

  const vertexCount = Math.floor(rawPosition.length / 3);
  const position = new Float32Array(vertexCount * 3);
  const hasNormals = Boolean(buffers.normal && buffers.normal.length === rawPosition.length);
  const normal = hasNormals ? new Float32Array(vertexCount * 3) : null;
  const linear = transform ? normalMatrix(transform) : null;

  for (let i = 0; i < vertexCount; i++) {
    const x = rawPosition[i * 3];
    const y = rawPosition[i * 3 + 1];
    const z = rawPosition[i * 3 + 2];

    let px = x;
    let py = y;
    let pz = z;
    if (transform) {
      const m = transform;
      px = m[0] * x + m[1] * y + m[2] * z + m[3];
      py = m[4] * x + m[5] * y + m[6] * z + m[7];
      pz = m[8] * x + m[9] * y + m[10] * z + m[11];
    }

    // Rhino Z-up → three Y-up, matching rhino3dm's own rotateToYUp.
    position[i * 3] = px;
    position[i * 3 + 1] = pz;
    position[i * 3 + 2] = -py;

    if (normal && buffers.normal) {
      const nx = buffers.normal[i * 3];
      const ny = buffers.normal[i * 3 + 1];
      const nz = buffers.normal[i * 3 + 2];

      let tx = nx;
      let ty = ny;
      let tz = nz;
      if (linear) {
        tx = linear[0] * nx + linear[1] * ny + linear[2] * nz;
        ty = linear[3] * nx + linear[4] * ny + linear[5] * nz;
        tz = linear[6] * nx + linear[7] * ny + linear[8] * nz;
        const length = Math.hypot(tx, ty, tz) || 1;
        tx /= length;
        ty /= length;
        tz /= length;
      }

      normal[i * 3] = tx;
      normal[i * 3 + 1] = tz;
      normal[i * 3 + 2] = -ty;
    }
  }

  const triangleCount = Math.floor(rawIndex.length / 3);
  const index =
    vertexCount > 65535 ? new Uint32Array(rawIndex.length) : new Uint16Array(rawIndex.length);
  // A mirrored instance flips handedness; without reversing the winding the
  // placement renders inside-out.
  const mirrored = transform !== null && determinant3(transform) < 0;
  for (let t = 0; t < triangleCount; t++) {
    const a = rawIndex[t * 3];
    const b = rawIndex[t * 3 + 1];
    const c = rawIndex[t * 3 + 2];
    index[t * 3] = a;
    index[t * 3 + 1] = mirrored ? c : b;
    index[t * 3 + 2] = mirrored ? b : c;
  }

  return { position, normal, index, triangleCount };
}

// ---------------------------------------------------------------------------
// Geometry walking
// ---------------------------------------------------------------------------

/** Meshes cached on a Brep's faces — how Rhino stores a solid's render mesh. */
function meshesFromBrep(
  rhino: RhinoModule,
  brep: unknown,
  transform: Mat4 | null,
): RawMesh[] {
  const faces = (brep as { faces?: () => { count: number; get: (i: number) => unknown } })
    .faces?.();
  if (!faces) return [];

  const meshes: RawMesh[] = [];
  for (let i = 0; i < faces.count; i++) {
    const face = faces.get(i) as { getMesh?: (meshType: unknown) => unknown } | null;
    if (!face?.getMesh) continue;
    const mesh = face.getMesh(rhino.MeshType.Render) ?? face.getMesh(rhino.MeshType.Any);
    const raw = mesh ? toRawMesh(mesh, transform) : null;
    if (raw) meshes.push(raw);
  }
  return meshes;
}

function meshesFromExtrusion(
  rhino: RhinoModule,
  extrusion: unknown,
  transform: Mat4 | null,
): RawMesh[] {
  const source = extrusion as { getMesh?: (meshType: unknown) => unknown };
  if (!source.getMesh) return [];
  const mesh =
    source.getMesh(rhino.MeshType.Render) ?? source.getMesh(rhino.MeshType.Any);
  const raw = mesh ? toRawMesh(mesh, transform) : null;
  return raw ? [raw] : [];
}

function typeName(rhino: RhinoModule, objectType: unknown): string {
  const table = rhino.ObjectType as unknown as Record<string, unknown>;
  for (const key of Object.keys(table)) {
    if (table[key] === objectType) return key;
  }
  return "Unknown";
}

/** Construction geometry that is never renderable and not worth reporting. */
function isIgnorable(rhino: RhinoModule, objectType: unknown): boolean {
  return (
    objectType === rhino.ObjectType.Curve ||
    objectType === rhino.ObjectType.Point ||
    objectType === rhino.ObjectType.PointSet ||
    objectType === rhino.ObjectType.Annotation ||
    objectType === rhino.ObjectType.TextDot ||
    objectType === rhino.ObjectType.Light
  );
}

/** Guards against a definition that references itself, directly or via a chain. */
const MAX_INSTANCE_DEPTH = 8;

/** A mesh plus where in the file's structure it came from. */
interface WalkedMesh {
  mesh: RawMesh;
  /** Instance definition it was placed from, or null for direct geometry. */
  definitionName: string | null;
  geometryType: string;
}

interface WalkResult {
  meshes: WalkedMesh[];
  /** Types encountered with no drawable mesh, in walk order. */
  skipped: string[];
  instancePlacements: number;
}

function walkGeometry(
  rhino: RhinoModule,
  doc: File3dm,
  geometry: { objectType: unknown } | null | undefined,
  transform: Mat4 | null,
  activeDefinitions: Set<string>,
  depth: number,
  /** Name of the innermost instance definition this geometry came from. */
  definitionName: string | null = null,
): WalkResult {
  const result: WalkResult = { meshes: [], skipped: [], instancePlacements: 0 };
  if (!geometry) return result;

  const objectType = geometry.objectType;

  if (objectType === rhino.ObjectType.Mesh) {
    const raw = toRawMesh(geometry, transform);
    if (raw) result.meshes.push({ mesh: raw, definitionName, geometryType: "Mesh" });
    else result.skipped.push("Mesh");
    return result;
  }

  if (objectType === rhino.ObjectType.Brep) {
    const meshes = meshesFromBrep(rhino, geometry, transform);
    for (const mesh of meshes) {
      result.meshes.push({ mesh, definitionName, geometryType: "Brep" });
    }
    if (meshes.length === 0) result.skipped.push("Brep");
    return result;
  }

  if (objectType === rhino.ObjectType.Extrusion) {
    const meshes = meshesFromExtrusion(rhino, geometry, transform);
    for (const mesh of meshes) {
      result.meshes.push({ mesh, definitionName, geometryType: "Extrusion" });
    }
    if (meshes.length === 0) result.skipped.push("Extrusion");
    return result;
  }

  if (objectType === rhino.ObjectType.InstanceReference) {
    if (depth >= MAX_INSTANCE_DEPTH) return result;

    const reference = geometry as { parentIdefId?: string; xform?: unknown };
    const definitionId = reference.parentIdefId;
    if (!definitionId || activeDefinitions.has(definitionId)) {
      // Self-referential definition — bail rather than recurse forever.
      result.skipped.push("InstanceReference");
      return result;
    }

    const definition = doc.instanceDefinitions().findId(definitionId) as {
      getObjectIds?: () => ArrayLike<string>;
      name?: string;
    } | null;
    if (!definition?.getObjectIds) {
      result.skipped.push("InstanceReference");
      return result;
    }

    const local = reference.xform ? matrixFromXform(reference.xform) : IDENTITY;
    const composed = transform ? multiply(transform, local) : local;
    const nextActive = new Set(activeDefinitions).add(definitionId);

    const memberIds = Array.from(definition.getObjectIds() ?? []);
    let placed = 0;
    for (const memberId of memberIds) {
      const member = doc.objects().findId(memberId) as
        | { geometry: () => { objectType: unknown } | null }
        | null
        | undefined;
      if (!member) continue;

      const nested = walkGeometry(
        rhino,
        doc,
        member.geometry(),
        isIdentity(composed) ? null : composed,
        nextActive,
        depth + 1,
        definition.name || definitionName,
      );
      result.meshes.push(...nested.meshes);
      result.skipped.push(...nested.skipped);
      result.instancePlacements += nested.instancePlacements;
      if (nested.meshes.length > 0) placed++;
    }

    if (placed > 0) result.instancePlacements++;
    else if (memberIds.length === 0) result.skipped.push("InstanceReference");

    return result;
  }

  if (!isIgnorable(rhino, objectType)) {
    result.skipped.push(typeName(rhino, objectType));
  }
  return result;
}

interface Box {
  min: number[];
  max: number[];
}

function boundingBoxOf(geometry: unknown): Box | null {
  const source = geometry as { getBoundingBox?: (accurate: boolean) => Box | null };
  if (!source?.getBoundingBox) return null;
  try {
    const box = source.getBoundingBox(true);
    if (!box?.min || !box?.max || box.min.length < 3) return null;
    return { min: [...box.min], max: [...box.max] };
  } catch {
    return null;
  }
}

/**
 * Whether two boxes describe the same part: a meshed duplicate of a solid
 * occupies the same space, so matching extents and centres is a far stronger
 * signal than a shared layer alone (everything tends to sit on layer 0).
 */
function boxesMatch(a: Box, b: Box): boolean {
  const sizeA = [a.max[0] - a.min[0], a.max[1] - a.min[1], a.max[2] - a.min[2]];
  const sizeB = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const scale = Math.max(...sizeA, ...sizeB, 1e-6);
  const tolerance = scale * 0.05;

  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(sizeA[axis] - sizeB[axis]) > tolerance) return false;
    const centerA = (a.min[axis] + a.max[axis]) / 2;
    const centerB = (b.min[axis] + b.max[axis]) / 2;
    if (Math.abs(centerA - centerB) > tolerance) return false;
  }
  return true;
}

interface LayerInfo {
  name: string | null;
  fullPath: string | null;
}

/** Layer name and full path by index, or nulls when the file has no layer table. */
function layerInfo(doc: File3dm, layerIndex: number): LayerInfo {
  if (layerIndex < 0) return { name: null, fullPath: null };
  const layers = doc.layers();
  if (layerIndex >= layers.count) return { name: null, fullPath: null };
  const layer = layers.get(layerIndex) as { name?: string; fullPath?: string } | null;
  if (!layer) return { name: null, fullPath: null };
  return {
    name: layer.name || null,
    // fullPath carries the nesting ("Ring::Head::Prongs"); fall back to the leaf.
    fullPath: layer.fullPath || layer.name || null,
  };
}

/** Every object id that belongs to an instance definition rather than the model. */
function definitionMemberIds(doc: File3dm): Set<string> {
  const ids = new Set<string>();
  const definitions = doc.instanceDefinitions();
  for (let i = 0; i < definitions.count; i++) {
    const definition = definitions.get(i) as { getObjectIds?: () => ArrayLike<string> };
    for (const id of Array.from(definition?.getObjectIds?.() ?? [])) ids.add(id);
  }
  return ids;
}

export function extractRenderMeshes(
  rhino: RhinoModule,
  doc: File3dm,
): RhinoExtraction {
  const objects = doc.objects();
  // Definition members also live in the object table. Drawing them directly
  // would place an untransformed copy at the origin alongside every reference.
  const memberIds = definitionMemberIds(doc);

  /** Grouped by layer path + instance definition — the file's own structure. */
  const groups = new Map<string, ExtractedPart>();
  const skips: { type: string; layerIndex: number; box: Box | null }[] = [];
  /** Standalone Mesh objects that drew — the only thing that can be a duplicate. */
  const drawnMeshObjects: { layerIndex: number; box: Box | null }[] = [];
  let objectCount = 0;
  let meshedObjectCount = 0;
  let instancePlacements = 0;

  for (let i = 0; i < objects.count; i++) {
    const object = objects.get(i) as {
      geometry: () => { objectType: unknown } | null;
      attributes?: () => { id?: string; layerIndex?: number; name?: string } | null;
    } | null;
    if (!object) continue;

    const attributes = object.attributes?.();
    const id = attributes?.id;
    if (id && memberIds.has(id)) continue;

    const geometry = object.geometry();
    if (!geometry) continue;
    if (isIgnorable(rhino, geometry.objectType)) continue;

    objectCount++;
    const layerIndex = attributes?.layerIndex ?? -1;
    const layer = layerInfo(doc, layerIndex);
    const objectName = attributes?.name || null;
    const walked = walkGeometry(rhino, doc, geometry, null, new Set(), 0);

    if (walked.meshes.length > 0) {
      meshedObjectCount++;
      if (geometry.objectType === rhino.ObjectType.Mesh) {
        drawnMeshObjects.push({ layerIndex, box: boundingBoxOf(geometry) });
      }

      for (const walkedMesh of walked.meshes) {
        // One part per (layer, instance definition): a definition placed six
        // times is one editable component, not six.
        const key = `${layer.fullPath ?? `layer${layerIndex}`}\u0000${walkedMesh.definitionName ?? ""}`;
        let part = groups.get(key);
        if (!part) {
          part = {
            id: key,
            name:
              walkedMesh.definitionName ||
              layer.name ||
              objectName ||
              `Part ${groups.size + 1}`,
            layerPath: layer.fullPath,
            layerName: layer.name,
            definitionName: walkedMesh.definitionName,
            objectNames: [],
            geometryTypes: [],
            meshes: [],
            triangleCount: 0,
          };
          groups.set(key, part);
        }
        if (objectName && !part.objectNames.includes(objectName)) {
          part.objectNames.push(objectName);
        }
        if (!part.geometryTypes.includes(walkedMesh.geometryType)) {
          part.geometryTypes.push(walkedMesh.geometryType);
        }
        part.meshes.push(walkedMesh.mesh);
        part.triangleCount += walkedMesh.mesh.triangleCount;
      }
    }
    instancePlacements += walked.instancePlacements;
    for (const type of walked.skipped) {
      skips.push({ type, layerIndex, box: boundingBoxOf(geometry) });
    }
  }

  // Second pass: a skipped solid counts as covered when a standalone mesh on
  // the same layer occupies the same space — i.e. a meshed duplicate of that
  // part, which is already on screen.
  const grouped = new Map<string, SkippedGroup>();
  for (const skip of skips) {
    const group = grouped.get(skip.type) ?? {
      type: skip.type,
      count: 0,
      coveredByDuplicate: 0,
    };
    group.count++;

    const covered =
      skip.box !== null &&
      drawnMeshObjects.some(
        (candidate) =>
          candidate.layerIndex === skip.layerIndex &&
          candidate.box !== null &&
          boxesMatch(candidate.box, skip.box as Box),
      );
    if (covered) group.coveredByDuplicate++;
    grouped.set(skip.type, group);
  }

  return {
    parts: [...groups.values()],
    unit: resolveUnit(rhino, doc.settings().modelUnitSystem),
    objectCount,
    meshedObjectCount,
    instancePlacements,
    skipped: [...grouped.values()],
  };
}

function inventory(extraction: RhinoExtraction): string {
  return extraction.skipped
    .map((entry) => `${entry.count} ${entry.type}${entry.count > 1 ? "s" : ""}`)
    .join(", ");
}

/**
 * The message shown when a .3dm parsed cleanly but carried nothing drawable.
 * This is the common case for files saved with "Save Small" — the geometry is
 * all there, just without the cached meshes any viewer needs.
 */
export function noRenderMeshesMessage(extraction: RhinoExtraction): string {
  const found =
    extraction.objectCount === 0
      ? "The file contains no objects."
      : `Found ${inventory(extraction) || `${extraction.objectCount} objects`}, but none carry a saved render mesh.`;

  return `${found} Re-save from Rhino or Matrix with render meshes included: File → Save As, and untick "Save Small" (or run the Mesh command on the solids first). Viewers can only draw meshes that are already in the file.`;
}

/**
 * One line about what was left out of an otherwise successful load, for the
 * session list. Returns null when everything drew.
 */
export function skippedSummary(extraction: RhinoExtraction): string | null {
  const total = extraction.skipped.reduce((sum, entry) => sum + entry.count, 0);
  if (total === 0) return null;

  const covered = extraction.skipped.reduce(
    (sum, entry) => sum + entry.coveredByDuplicate,
    0,
  );
  const detail = inventory(extraction);

  if (covered === total) {
    return `${detail} had no render mesh — a meshed copy on the same layer is shown instead.`;
  }
  if (covered > 0) {
    return `${detail} had no render mesh (${covered} covered by a meshed copy on the same layer).`;
  }
  return `${detail} had no render mesh and ${total > 1 ? "are" : "is"} not shown.`;
}
