/**
 * Generates a placeholder ring STL so the viewer's programmatic-load path is
 * testable before real demo assets land (F4 replaces these with proper models).
 *
 *   node scripts/make-placeholder-ring-stl.mjs
 *
 * Output: public/models/placeholder-ring.stl (binary STL, millimeters)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "models",
  "placeholder-ring.stl",
);

const BAND_RADIUS = 9;
const BAND_THICKNESS = 1.15;
const MAJOR_SEGMENTS = 96;
const MINOR_SEGMENTS = 28;

/** @type {number[][][]} each triangle is [v0, v1, v2], each vertex [x, y, z] */
const triangles = [];

// Band: a torus in the XY plane, so the ring stands upright with the hole facing +Z.
const torusPoint = (i, j) => {
  const u = (i / MAJOR_SEGMENTS) * Math.PI * 2;
  const v = (j / MINOR_SEGMENTS) * Math.PI * 2;
  const ring = BAND_RADIUS + BAND_THICKNESS * Math.cos(v);
  return [ring * Math.cos(u), ring * Math.sin(u), BAND_THICKNESS * Math.sin(v)];
};

for (let i = 0; i < MAJOR_SEGMENTS; i++) {
  for (let j = 0; j < MINOR_SEGMENTS; j++) {
    const a = torusPoint(i, j);
    const b = torusPoint(i + 1, j);
    const c = torusPoint(i + 1, j + 1);
    const d = torusPoint(i, j + 1);
    triangles.push([a, b, c], [a, c, d]);
  }
}

// Stone: an octahedron set at the top of the band.
const STONE_CENTER = [0, BAND_RADIUS + 2.3, 0];
const STONE_HALF_WIDTH = 2.4;
const STONE_HALF_HEIGHT = 3.0;

const stoneVertex = ([x, y, z]) => [
  STONE_CENTER[0] + x * STONE_HALF_WIDTH,
  STONE_CENTER[1] + y * STONE_HALF_HEIGHT,
  STONE_CENTER[2] + z * STONE_HALF_WIDTH,
];

const top = stoneVertex([0, 1, 0]);
const bottom = stoneVertex([0, -1, 0]);
const girdle = [
  stoneVertex([1, 0, 0]),
  stoneVertex([0, 0, 1]),
  stoneVertex([-1, 0, 0]),
  stoneVertex([0, 0, -1]),
];

for (let i = 0; i < girdle.length; i++) {
  const p = girdle[i];
  const q = girdle[(i + 1) % girdle.length];
  triangles.push([top, p, q], [bottom, q, p]);
}

const normalOf = ([a, b, c]) => {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const length = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / length, n[1] / length, n[2] / length];
};

const buffer = Buffer.alloc(84 + triangles.length * 50);
buffer.write("JewelLens placeholder ring - replace with a real CAD model", 0, 80, "ascii");
buffer.writeUInt32LE(triangles.length, 80);

let offset = 84;
for (const triangle of triangles) {
  for (const value of normalOf(triangle)) {
    buffer.writeFloatLE(value, offset);
    offset += 4;
  }
  for (const vertex of triangle) {
    for (const value of vertex) {
      buffer.writeFloatLE(value, offset);
      offset += 4;
    }
  }
  buffer.writeUInt16LE(0, offset);
  offset += 2;
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, buffer);
console.log(`Wrote ${OUT} (${triangles.length} triangles)`);
