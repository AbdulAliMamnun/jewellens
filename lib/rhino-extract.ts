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

/** A triangulated mesh in the file's own units, already rotated Z-up → Y-up. */
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

export interface RhinoExtraction {
  meshes: RawMesh[];
  /** null when the file declares None/Unset/CustomUnits. */
  unit: RhinoUnit | null;
  objectCount: number;
  /** Objects that yielded at least one mesh. */
  meshedObjectCount: number;
  /** Geometry we found but could not draw, by Rhino type name. */
  skipped: { type: string; count: number }[];
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

function toRawMesh(mesh: unknown): RawMesh | null {
  const source = mesh as {
    toThreejsBuffers?: (rotateToYUp: boolean) => {
      position?: ArrayLike<number>;
      normal?: ArrayLike<number>;
      index?: ArrayLike<number>;
    };
  };
  if (!source?.toThreejsBuffers) return null;

  // `true` rotates Rhino's Z-up into three's Y-up and triangulates quads.
  const buffers = source.toThreejsBuffers(true);
  const position = buffers.position;
  const index = buffers.index;
  if (!position || position.length < 9 || !index || index.length < 3) return null;

  const positions = Float32Array.from(position);
  const indices =
    positions.length / 3 > 65535
      ? Uint32Array.from(index)
      : Uint16Array.from(index);

  return {
    position: positions,
    normal: buffers.normal ? Float32Array.from(buffers.normal) : null,
    index: indices,
    triangleCount: Math.floor(indices.length / 3),
  };
}

/** Meshes cached on a Brep's faces — how Rhino stores a solid's render mesh. */
function meshesFromBrep(rhino: RhinoModule, brep: unknown): RawMesh[] {
  const faces = (brep as { faces?: () => { count: number; get: (i: number) => unknown } })
    .faces?.();
  if (!faces) return [];

  const meshes: RawMesh[] = [];
  for (let i = 0; i < faces.count; i++) {
    const face = faces.get(i) as {
      getMesh?: (meshType: unknown) => unknown;
    } | null;
    if (!face?.getMesh) continue;
    const mesh =
      face.getMesh(rhino.MeshType.Render) ?? face.getMesh(rhino.MeshType.Any);
    const raw = mesh ? toRawMesh(mesh) : null;
    if (raw) meshes.push(raw);
  }
  return meshes;
}

function meshesFromExtrusion(rhino: RhinoModule, extrusion: unknown): RawMesh[] {
  const source = extrusion as { getMesh?: (meshType: unknown) => unknown };
  if (!source.getMesh) return [];
  const mesh =
    source.getMesh(rhino.MeshType.Render) ?? source.getMesh(rhino.MeshType.Any);
  const raw = mesh ? toRawMesh(mesh) : null;
  return raw ? [raw] : [];
}

function typeName(rhino: RhinoModule, objectType: unknown): string {
  const table = rhino.ObjectType as unknown as Record<string, unknown>;
  for (const key of Object.keys(table)) {
    if (table[key] === objectType) return key;
  }
  return "Unknown";
}

export function extractRenderMeshes(
  rhino: RhinoModule,
  doc: File3dm,
): RhinoExtraction {
  const objects = doc.objects();
  const meshes: RawMesh[] = [];
  const skipped = new Map<string, number>();
  let meshedObjectCount = 0;

  for (let i = 0; i < objects.count; i++) {
    const geometry = objects.get(i)?.geometry() as
      | { objectType: unknown }
      | null
      | undefined;
    if (!geometry) continue;

    const objectType = geometry.objectType;
    let found: RawMesh[] = [];

    if (objectType === rhino.ObjectType.Mesh) {
      const raw = toRawMesh(geometry);
      if (raw) found = [raw];
    } else if (objectType === rhino.ObjectType.Brep) {
      found = meshesFromBrep(rhino, geometry);
    } else if (objectType === rhino.ObjectType.Extrusion) {
      found = meshesFromExtrusion(rhino, geometry);
    } else if (
      objectType === rhino.ObjectType.Curve ||
      objectType === rhino.ObjectType.Point ||
      objectType === rhino.ObjectType.Annotation ||
      objectType === rhino.ObjectType.TextDot ||
      objectType === rhino.ObjectType.Light
    ) {
      // Construction geometry — never renderable, and not worth reporting.
      continue;
    }

    if (found.length > 0) {
      meshes.push(...found);
      meshedObjectCount++;
    } else {
      const name = typeName(rhino, objectType);
      skipped.set(name, (skipped.get(name) ?? 0) + 1);
    }
  }

  return {
    meshes,
    unit: resolveUnit(rhino, doc.settings().modelUnitSystem),
    objectCount: objects.count,
    meshedObjectCount,
    skipped: [...skipped.entries()].map(([type, count]) => ({ type, count })),
  };
}

/**
 * The message shown when a .3dm parsed cleanly but carried nothing drawable.
 * This is the common case for files saved with "Save Small" — the geometry is
 * all there, just without the cached meshes any viewer needs.
 */
export function noRenderMeshesMessage(extraction: RhinoExtraction): string {
  const inventory = extraction.skipped
    .map((entry) => `${entry.count} ${entry.type}${entry.count > 1 ? "s" : ""}`)
    .join(", ");

  const found =
    extraction.objectCount === 0
      ? "The file contains no objects."
      : `Found ${inventory || `${extraction.objectCount} objects`}, but none carry a saved render mesh.`;

  return `${found} Re-save from Rhino or Matrix with render meshes included: File → Save As, and untick "Save Small" (or run the Mesh command on the solids first). Viewers can only draw meshes that are already in the file.`;
}
