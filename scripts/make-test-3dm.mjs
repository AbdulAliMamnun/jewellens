/**
 * Writes synthetic .3dm fixtures with rhino3dm itself, so the extraction path
 * can be exercised without a real Matrix export.
 *
 *   node scripts/make-test-3dm.mjs
 *
 * Output: public/models/test-3dm/*.3dm (gitignored; regenerate on demand)
 *
 * What these can and cannot stand in for is documented in scripts/check-3dm.mjs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import rhino3dm from "rhino3dm";

const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "models",
  "test-3dm",
);

const rhino = await rhino3dm();

/** A closed-ish band-like mesh: a coarse torus, in whatever units the doc declares. */
function torusMesh(majorRadius, minorRadius, majorSegments = 32, minorSegments = 12) {
  const mesh = new rhino.Mesh();
  const vertices = mesh.vertices();
  const faces = mesh.faces();

  for (let i = 0; i < majorSegments; i++) {
    const u = (i / majorSegments) * Math.PI * 2;
    for (let j = 0; j < minorSegments; j++) {
      const v = (j / minorSegments) * Math.PI * 2;
      const ring = majorRadius + minorRadius * Math.cos(v);
      // Rhino is Z-up; build the band in the XY plane as Rhino would.
      vertices.add(ring * Math.cos(u), ring * Math.sin(u), minorRadius * Math.sin(v));
    }
  }

  const index = (i, j) => (i % majorSegments) * minorSegments + (j % minorSegments);
  for (let i = 0; i < majorSegments; i++) {
    for (let j = 0; j < minorSegments; j++) {
      faces.addQuadFace(
        index(i, j),
        index(i + 1, j),
        index(i + 1, j + 1),
        index(i, j + 1),
      );
    }
  }

  mesh.normals().computeNormals();
  return mesh;
}

function pyramidMesh(size) {
  const mesh = new rhino.Mesh();
  const v = mesh.vertices();
  v.add(0, 0, 0);
  v.add(size, 0, 0);
  v.add(size, size, 0);
  v.add(0, size, 0);
  v.add(size / 2, size / 2, size);
  const f = mesh.faces();
  f.addQuadFace(0, 1, 2, 3);
  f.addTriFace(0, 1, 4);
  f.addTriFace(1, 2, 4);
  f.addTriFace(2, 3, 4);
  f.addTriFace(3, 0, 4);
  mesh.normals().computeNormals();
  return mesh;
}

function write(name, build) {
  const doc = new rhino.File3dm();
  build(doc);
  const bytes = doc.toByteArray();
  const path = join(OUT_DIR, name);
  writeFileSync(path, Buffer.from(bytes));
  console.log(`  ${name}  ${(bytes.length / 1024).toFixed(1)} KB`);
  return path;
}

mkdirSync(OUT_DIR, { recursive: true });
console.log("writing .3dm fixtures:");

// 1. Millimetres, one mesh object — the happy path.
write("band-mm.3dm", (doc) => {
  doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters;
  doc.objects().addMesh(torusMesh(9, 1.2), null);
});

// 2. Inches — same geometry authored at inch scale, to prove unit conversion.
//    9mm major radius ≈ 0.35433in.
write("band-inches.3dm", (doc) => {
  doc.settings().modelUnitSystem = rhino.UnitSystem.Inches;
  doc.objects().addMesh(torusMesh(9 / 25.4, 1.2 / 25.4), null);
});

// 3. Centimetres, multiple mesh objects.
write("two-objects-cm.3dm", (doc) => {
  doc.settings().modelUnitSystem = rhino.UnitSystem.Centimeters;
  doc.objects().addMesh(torusMesh(0.9, 0.12), null);
  doc.objects().addMesh(pyramidMesh(0.4), null);
});

// 4. Solids with no cached render mesh — the "re-save from Rhino" path.
write("brep-no-render-mesh.3dm", (doc) => {
  doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters;
  doc.objects().addBrep(
    rhino.Brep.createFromBoundingBox(new rhino.BoundingBox([0, 0, 0], [4, 5, 6])),
    null,
  );
  doc.objects().addExtrusion(
    rhino.Extrusion.createCylinderExtrusion(
      new rhino.Cylinder(new rhino.Circle(3), 8),
      true,
      true,
    ),
    null,
  );
});

// 5. Mixed: one drawable mesh plus meshless solids and a curve.
write("mixed-mm.3dm", (doc) => {
  doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters;
  doc.objects().addMesh(torusMesh(9, 1.2), null);
  doc.objects().addBrep(
    rhino.Brep.createFromBoundingBox(new rhino.BoundingBox([0, 0, 0], [2, 2, 2])),
    null,
  );
  doc.objects().addCircle(new rhino.Circle(5), null);
});

// 6. No objects at all.
write("empty.3dm", (doc) => {
  doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters;
});

// 7. Unitless — exercises the "no declared unit" fallback.
write("no-units.3dm", (doc) => {
  doc.settings().modelUnitSystem = rhino.UnitSystem.None;
  doc.objects().addMesh(torusMesh(9, 1.2), null);
});

/**
 * A unit cube mesh spanning 0..1 on every axis, so a placement's position can
 * be read straight off the extracted bounding box.
 */
function unitCubeMesh() {
  return boxMesh([0, 0, 0], [1, 1, 1]);
}

/** Axis-aligned box mesh spanning min..max. */
function boxMesh([x0, y0, z0], [x1, y1, z1]) {
  const mesh = new rhino.Mesh();
  const v = mesh.vertices();
  v.add(x0, y0, z0); v.add(x1, y0, z0); v.add(x1, y1, z0); v.add(x0, y1, z0);
  v.add(x0, y0, z1); v.add(x1, y0, z1); v.add(x1, y1, z1); v.add(x0, y1, z1);
  const f = mesh.faces();
  f.addQuadFace(0, 3, 2, 1); // bottom
  f.addQuadFace(4, 5, 6, 7); // top
  f.addQuadFace(0, 1, 5, 4);
  f.addQuadFace(1, 2, 6, 5);
  f.addQuadFace(2, 3, 7, 6);
  f.addQuadFace(3, 0, 4, 7);
  mesh.normals().computeNormals();
  return mesh;
}

// 8. Instance definition placed twice with distinct transforms — how Matrix
//    stores repeated components such as prongs and pavé stones.
write("instances-mm.3dm", (doc) => {
  doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters;
  doc.instanceDefinitions().add(
    "Prong",
    "unit cube stand-in for a repeated component",
    "",
    "",
    [0, 0, 0],
    [unitCubeMesh()],
    [new rhino.ObjectAttributes()],
  );
  const definition = doc.instanceDefinitions().get(0);

  doc.objects().addInstanceObject(
    new rhino.InstanceReference(definition.id, rhino.Transform.translationXYZ(10, 0, 0)),
    new rhino.ObjectAttributes(),
  );
  doc.objects().addInstanceObject(
    new rhino.InstanceReference(definition.id, rhino.Transform.translationXYZ(0, 20, 5)),
    new rhino.ObjectAttributes(),
  );
});

// 9. Nested references: an outer definition that contains a reference to the
//    inner one, so transforms have to compose.
write("nested-instances-mm.3dm", (doc) => {
  doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters;

  doc.instanceDefinitions().add(
    "Inner",
    "",
    "",
    "",
    [0, 0, 0],
    [unitCubeMesh()],
    [new rhino.ObjectAttributes()],
  );
  const inner = doc.instanceDefinitions().get(0);

  // The outer definition's member is itself an instance reference, offset by 3
  // on X relative to the outer definition's own origin.
  doc.instanceDefinitions().add(
    "Outer",
    "",
    "",
    "",
    [0, 0, 0],
    [new rhino.InstanceReference(inner.id, rhino.Transform.translationXYZ(3, 0, 0))],
    [new rhino.ObjectAttributes()],
  );
  const outer = doc.instanceDefinitions().findId(
    doc.instanceDefinitions().get(1).id,
  );

  doc.objects().addInstanceObject(
    new rhino.InstanceReference(outer.id, rhino.Transform.translationXYZ(100, 0, 0)),
    new rhino.ObjectAttributes(),
  );
});

// 10. A meshless Brep sharing a layer with a separately meshed duplicate —
//     the "render what's drawable, report the rest" fallback.
write("brep-with-meshed-duplicate.3dm", (doc) => {
  doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters;

  const layerIndex = doc.layers().addLayer("Band", { r: 200, g: 160, b: 60, a: 255 });
  const onBand = new rhino.ObjectAttributes();
  onBand.layerIndex = layerIndex;

  // The solid, with no cached render mesh...
  doc.objects().addBrep(
    rhino.Brep.createFromBoundingBox(new rhino.BoundingBox([0, 0, 0], [4, 5, 6])),
    onBand,
  );
  // ...and its meshed duplicate: the same box, in the same place, as a mesh.
  doc.objects().addMesh(boxMesh([0, 0, 0], [4, 5, 6]), onBand);

  // A meshless solid on a different layer, which nothing covers.
  const otherLayer = doc.layers().addLayer("Gallery", { r: 40, g: 40, b: 40, a: 255 });
  const onOther = new rhino.ObjectAttributes();
  onOther.layerIndex = otherLayer;
  doc.objects().addExtrusion(
    rhino.Extrusion.createCylinderExtrusion(
      new rhino.Cylinder(new rhino.Circle(3), 8),
      true,
      true,
    ),
    onOther,
  );
});

console.log(`\nwrote fixtures to ${OUT_DIR}`);
