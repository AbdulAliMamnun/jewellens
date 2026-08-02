/**
 * Exercises lib/rhino-extract.ts against synthetic .3dm fixtures.
 *
 *   node scripts/make-test-3dm.mjs && node scripts/check-3dm.mjs
 *
 * COVERED here: mesh objects, multi-object docs, unit systems and their mm
 * conversion, Z-up → Y-up rotation, quad triangulation, meshless Breps and
 * Extrusions (the "re-save with render meshes" path), curves being ignored,
 * empty documents, and files with no declared units.
 *
 * NOT COVERED — needs a real Rhino/Matrix export:
 *   - Breps whose faces carry cached render meshes. rhino3dm's WASM build
 *     aborts inside BrepFace.setMesh, so a fixture cannot be authored here.
 *     This is the shape a real Matrix solid takes, and the Brep branch of
 *     meshesFromBrep() is therefore unproven against real data.
 *   - Instance definitions / block references (Matrix uses these for repeated
 *     components such as prongs and pavé stones); their geometry lives in a
 *     separate table that this extractor does not walk.
 *   - SubD objects, and per-object transforms applied at the document level.
 *   - Real file sizes: the largest fixture is 28KB, so nothing here exercises
 *     the >50MB warning path or the read-progress UI with real timings.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import rhino3dm from "rhino3dm";

import {
  extractRenderMeshes,
  noRenderMeshesMessage,
  skippedSummary,
} from "../lib/rhino-extract.ts";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "models",
  "test-3dm",
);

let failures = 0;
const check = (name, condition, detail = "") => {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const rhino = await rhino3dm();

function load(name) {
  const path = join(FIXTURES, name);
  if (!existsSync(path)) {
    console.error(`missing fixture ${name} — run: node scripts/make-test-3dm.mjs`);
    process.exit(1);
  }
  const doc = rhino.File3dm.fromByteArray(new Uint8Array(readFileSync(path)));
  return extractRenderMeshes(rhino, doc);
}

/** Bounding box of every extracted mesh, in file units. */
function bounds(extraction) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of extraction.meshes) {
    for (let i = 0; i < mesh.position.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], mesh.position[i + axis]);
        max[axis] = Math.max(max[axis], mesh.position[i + axis]);
      }
    }
  }
  return { min, max, size: max.map((v, i) => v - min[i]) };
}

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

/** Bounding box of a single extracted mesh. */
function meshBounds(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.position.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], mesh.position[i + axis]);
      max[axis] = Math.max(max[axis], mesh.position[i + axis]);
    }
  }
  return { min, max, size: max.map((v, i) => v - min[i]) };
}

// --- 1. millimetres, single mesh -------------------------------------------
console.log("\nband-mm.3dm (Millimeters, 1 mesh object)");
{
  const e = load("band-mm.3dm");
  check("one object, one mesh", e.objectCount === 1 && e.meshes.length === 1);
  check("nothing skipped", e.skipped.length === 0, JSON.stringify(e.skipped));
  check("unit detected as Millimeters", e.unit?.name === "Millimeters", e.unit?.name);
  check("scale to mm is 1", e.unit?.scaleToMm === 1);

  const mesh = e.meshes[0];
  check("triangles counted", mesh.triangleCount === 32 * 12 * 2, String(mesh.triangleCount));
  check("normals present", mesh.normal !== null && mesh.normal.length === mesh.position.length);
  check("index covers every triangle", mesh.index.length === mesh.triangleCount * 3);
  check(
    "quads were triangulated",
    mesh.index.length / 3 === 768,
    `${mesh.index.length / 3} triangles`,
  );

  // The band is authored flat in Rhino's XY plane (Z-up). After the Y-up
  // rotation the thin axis must be Y, not Z.
  const { size } = bounds(e);
  check(
    "Z-up rotated into Y-up (thin axis is Y)",
    size[1] < size[0] && size[1] < size[2],
    `size ${size.map(round2).join(" x ")}`,
  );
  check(
    "outer diameter preserved (~20.4mm)",
    Math.abs(size[0] - 20.4) < 0.2,
    String(round2(size[0])),
  );
}

// --- 2. inches --------------------------------------------------------------
console.log("\nband-inches.3dm (Inches)");
{
  const e = load("band-inches.3dm");
  check("unit detected as Inches", e.unit?.name === "Inches", e.unit?.name);
  check("scale to mm is 25.4", e.unit?.scaleToMm === 25.4);

  const { size } = bounds(e);
  check(
    "raw coordinates are in inches (~0.80)",
    Math.abs(size[0] - 0.803) < 0.02,
    String(round2(size[0])),
  );
  check(
    "converts to the same ~20.4mm as the mm fixture",
    Math.abs(size[0] * e.unit.scaleToMm - 20.4) < 0.2,
    String(round2(size[0] * e.unit.scaleToMm)),
  );
}

// --- 3. multiple objects ----------------------------------------------------
console.log("\ntwo-objects-cm.3dm (Centimeters, 2 mesh objects)");
{
  const e = load("two-objects-cm.3dm");
  check("both objects meshed", e.objectCount === 2 && e.meshedObjectCount === 2);
  check("two meshes returned", e.meshes.length === 2, String(e.meshes.length));
  check("unit scale is 10", e.unit?.scaleToMm === 10);
  check(
    "combined triangle count",
    e.meshes.reduce((sum, m) => sum + m.triangleCount, 0) === 32 * 12 * 2 + 6,
    String(e.meshes.reduce((sum, m) => sum + m.triangleCount, 0)),
  );
}

// --- 4. the actionable no-render-mesh path ----------------------------------
console.log("\nbrep-no-render-mesh.3dm (Brep + Extrusion, no cached meshes)");
{
  const e = load("brep-no-render-mesh.3dm");
  check("parses without throwing", e.objectCount === 2);
  check("no meshes extracted", e.meshes.length === 0);
  check("no object meshed", e.meshedObjectCount === 0);
  check(
    "skipped inventory names the geometry types",
    e.skipped.some((s) => s.type === "Brep") &&
      e.skipped.some((s) => s.type === "Extrusion"),
    JSON.stringify(e.skipped),
  );

  const message = noRenderMeshesMessage(e);
  check("message names what was found", message.includes("Brep") && message.includes("Extrusion"), message);
  check("message tells the user to re-save", /re-save/i.test(message));
  check("message names Rhino and Matrix", /Rhino/.test(message) && /Matrix/.test(message));
  check("message names the Save Small setting", /Save Small/i.test(message));
  check("message is not a generic parse error", !/parse|corrupt|invalid/i.test(message));
  console.log(`       → "${message}"`);
}

// --- 5. mixed content -------------------------------------------------------
console.log("\nmixed-mm.3dm (mesh + meshless Brep + curve)");
{
  const e = load("mixed-mm.3dm");
  check("the drawable mesh is still returned", e.meshes.length === 1);
  check("only one object meshed", e.meshedObjectCount === 1);
  check(
    "meshless Brep reported as skipped",
    e.skipped.some((s) => s.type === "Brep"),
    JSON.stringify(e.skipped),
  );
  check(
    "curve is ignored, not reported as skipped",
    !e.skipped.some((s) => s.type === "Curve"),
    JSON.stringify(e.skipped),
  );
}

// --- 6. empty document ------------------------------------------------------
console.log("\nempty.3dm (no objects)");
{
  const e = load("empty.3dm");
  check("no objects, no meshes", e.objectCount === 0 && e.meshes.length === 0);
  const message = noRenderMeshesMessage(e);
  check("message says the file is empty", message.includes("no objects"), message);
}

// --- 7. no declared units ---------------------------------------------------
console.log("\nno-units.3dm (UnitSystem.None)");
{
  const e = load("no-units.3dm");
  check("unit resolves to null rather than guessing", e.unit === null);
  check("geometry still extracted", e.meshes.length === 1);
}

// --- 8. instance references -------------------------------------------------
console.log("\ninstances-mm.3dm (1 definition, 2 references with distinct transforms)");
{
  const e = load("instances-mm.3dm");

  check("two top-level objects counted", e.objectCount === 2, String(e.objectCount));
  check("both references resolved", e.instancePlacements === 2, String(e.instancePlacements));
  check("two meshes extracted", e.meshes.length === 2, String(e.meshes.length));
  check("nothing skipped", e.skipped.length === 0, JSON.stringify(e.skipped));

  // The definition's member mesh also sits in the object table. Drawing it
  // directly would add a third, untransformed cube at the origin.
  const atOrigin = e.meshes.filter((mesh) => {
    const b = meshBounds(mesh);
    return Math.abs(b.min[0]) < 1e-6 && Math.abs(b.min[1]) < 1e-6 && Math.abs(b.min[2]) < 1e-6;
  });
  check("definition member not drawn untransformed", atOrigin.length === 0, `${atOrigin.length} at origin`);

  // Rhino translations (10,0,0) and (0,20,5) become, after Z-up → Y-up
  // (x, y, z) → (x, z, -y): (10, 0, 0) and (0, 5, -20).
  const placements = e.meshes
    .map((mesh) => meshBounds(mesh).min.map(round3))
    .sort((a, b) => a[0] - b[0]);

  // The cube spans 0..1, so under (x, y, z) → (x, z, -y) the min corner of a
  // placement at Rhino (tx, ty, tz) is (tx, tz, -(ty + 1)).
  check(
    "placement at Rhino (10,0,0) lands at scene min (10,0,-1)",
    placements.some((p) => p[0] === 10 && p[1] === 0 && p[2] === -1),
    JSON.stringify(placements),
  );
  check(
    "placement at Rhino (0,20,5) lands at scene min (0,5,-21)",
    placements.some((p) => p[0] === 0 && p[1] === 5 && p[2] === -21),
    JSON.stringify(placements),
  );
  check(
    "the two placements are distinct",
    JSON.stringify(placements[0]) !== JSON.stringify(placements[1]),
    JSON.stringify(placements),
  );
  check(
    "each placement is a 1mm cube",
    e.meshes.every((mesh) => meshBounds(mesh).size.every((s) => Math.abs(s - 1) < 1e-6)),
    JSON.stringify(e.meshes.map((m) => meshBounds(m).size.map(round3))),
  );
  check(
    "normals survive the transform (unit length)",
    e.meshes.every((mesh) => {
      if (!mesh.normal) return false;
      for (let i = 0; i < mesh.normal.length; i += 3) {
        const length = Math.hypot(mesh.normal[i], mesh.normal[i + 1], mesh.normal[i + 2]);
        if (Math.abs(length - 1) > 1e-3) return false;
      }
      return true;
    }),
  );
}

// --- 9. nested instance references ------------------------------------------
console.log("\nnested-instances-mm.3dm (reference → definition → reference → mesh)");
{
  const e = load("nested-instances-mm.3dm");
  check("one mesh extracted", e.meshes.length === 1, String(e.meshes.length));
  check("nothing skipped", e.skipped.length === 0, JSON.stringify(e.skipped));

  // Outer places the inner reference at x=100; inner is itself offset x=3.
  const b = meshBounds(e.meshes[0]);
  check(
    "composed transform puts the cube at x=103",
    Math.abs(b.min[0] - 103) < 1e-6,
    String(round3(b.min[0])),
  );
  check("cube is still 1mm", b.size.every((s) => Math.abs(s - 1) < 1e-6), JSON.stringify(b.size.map(round3)));
}

// --- 10. meshless Brep with a meshed duplicate on the same layer -------------
console.log("\nbrep-with-meshed-duplicate.3dm (partial success + skip reporting)");
{
  const e = load("brep-with-meshed-duplicate.3dm");

  check("the drawable mesh is rendered", e.meshes.length === 1, String(e.meshes.length));
  check("three top-level objects", e.objectCount === 3, String(e.objectCount));
  check("one object meshed", e.meshedObjectCount === 1);

  const brep = e.skipped.find((s) => s.type === "Brep");
  const extrusion = e.skipped.find((s) => s.type === "Extrusion");
  check("meshless Brep reported", brep?.count === 1, JSON.stringify(e.skipped));
  check(
    "Brep recognised as covered by the meshed duplicate on its layer",
    brep?.coveredByDuplicate === 1,
    JSON.stringify(brep),
  );
  check("meshless Extrusion reported", extrusion?.count === 1, JSON.stringify(e.skipped));
  check(
    "Extrusion on an unmeshed layer is not marked covered",
    extrusion?.coveredByDuplicate === 0,
    JSON.stringify(extrusion),
  );

  const summary = skippedSummary(e);
  check("summary mentions both types", /Brep/.test(summary) && /Extrusion/.test(summary), summary);
  check("summary reports the covered count", /covered by a meshed copy/.test(summary), summary);
  console.log(`       → "${summary}"`);
}

// --- 11. skippedSummary shapes ----------------------------------------------
console.log("\nskippedSummary");
{
  check("null when nothing was skipped", skippedSummary(load("band-mm.3dm")) === null);

  // mixed-mm.3dm has a Brep and a torus mesh on the same (default) layer, but
  // they are different parts — a shared layer alone must not claim coverage.
  const mixed = skippedSummary(load("mixed-mm.3dm"));
  check("mixed doc reports the un-drawn Brep", /Brep/.test(mixed), mixed);
  check(
    "unrelated mesh on the same layer is not treated as a duplicate",
    /not shown/.test(mixed),
    mixed,
  );
}

// --- 12. the staged browser assets ------------------------------------------
// public/rhino3dm/ is what the browser actually fetches. Instantiating that
// exact pair here proves the copy step produced a complete, working module.
console.log("\npublic/rhino3dm staged assets");
{
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const gluePath = join(root, "public", "rhino3dm", "rhino3dm.module.min.js");
  const wasmPath = join(root, "public", "rhino3dm", "rhino3dm.wasm");

  if (!existsSync(gluePath) || !existsSync(wasmPath)) {
    check("staged assets present", false, "run: node scripts/copy-rhino3dm.mjs");
  } else {
    const staged = await import(pathToFileURL(gluePath).href);
    const stagedRhino = await staged.default({
      locateFile: (file) => join(root, "public", "rhino3dm", file),
    });
    check("staged module instantiates", typeof stagedRhino.File3dm?.fromByteArray === "function");

    const bytes = new Uint8Array(readFileSync(join(FIXTURES, "band-mm.3dm")));
    const extraction = extractRenderMeshes(
      stagedRhino,
      stagedRhino.File3dm.fromByteArray(bytes),
    );
    check(
      "staged module extracts the same mesh",
      extraction.meshes.length === 1 && extraction.meshes[0].triangleCount === 768,
      `${extraction.meshes.length} meshes`,
    );
  }
}

// --- 9. STL/OBJ regression --------------------------------------------------
// The .3dm work must not disturb the existing archive formats.
console.log("\nSTL / OBJ still load unchanged");
{
  const { loadModelFromFile, formatFromName, isSupportedFile, ModelLoadError } =
    await import("../lib/model-loader.ts");

  check("formatFromName maps .3dm", formatFromName("Ring.3DM") === "3dm");
  check("formatFromName still maps .stl", formatFromName("ring.stl") === "stl");
  check("formatFromName still maps .obj", formatFromName("ring.obj") === "obj");
  check("unsupported extension rejected", !isSupportedFile("ring.step"));

  const stlPath = join(FIXTURES, "..", "placeholder-ring.stl");
  if (existsSync(stlPath)) {
    const file = new File([readFileSync(stlPath)], "placeholder-ring.stl");
    const model = await loadModelFromFile(file);
    check("STL parses", model.format === "stl" && model.geometries.length === 1);
    check("STL triangle count intact", model.triangleCount === 5384, String(model.triangleCount));
    const box = model.geometries[0].boundingBox;
    const longestAxis = Math.max(
      box.max.x - box.min.x,
      box.max.y - box.min.y,
      box.max.z - box.min.z,
    );
    check(
      "STL normalized to the 2-unit fit box",
      Math.abs(longestAxis - 2) < 1e-4,
      String(longestAxis),
    );
    check("STL reports assumed mm units", model.unitAssumed === true && model.unitLabel === "mm");
    check(
      "STL sizeMm equals sourceSize (1:1)",
      Math.abs(model.sizeMm.x - model.sourceSize.x) < 1e-6,
    );
  } else {
    check("placeholder STL fixture present", false, `missing ${stlPath}`);
  }

  const objSource = `
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`;
  const objModel = await loadModelFromFile(new File([objSource], "tri.obj"));
  check("OBJ parses", objModel.format === "obj" && objModel.triangleCount === 1);

  let unsupported = null;
  try {
    await loadModelFromFile(new File(["x"], "ring.step"));
  } catch (error) {
    unsupported = error;
  }
  check(
    "unsupported file throws a typed error",
    unsupported instanceof ModelLoadError && unsupported.code === "unsupported",
    String(unsupported?.code),
  );
}

console.log(
  failures === 0 ? "\nAll .3dm checks passed." : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
