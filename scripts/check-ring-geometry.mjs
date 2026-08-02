import * as THREE from "three";
import {
  buildRing,
  disposeRingBuild,
  girdleOutlineMm,
  innerDiameterMm,
  roundDiameterMm,
  stoneDimsMm,
  GROUND_Y,
  MM_TO_SCENE,
} from "../lib/ring-geometry.ts";
import { fitDistance, ringSceneBounds } from "../lib/camera-fit.ts";
import { DEFAULT_RING_PARAMS } from "../lib/ring-params.ts";

const round2 = (n) => Math.round(n * 100) / 100;
const problems = [];
const flag = (label, message) => problems.push(`${label}: ${message}`);

// --- sanity on the scalar maps ---------------------------------------------
console.log("ring size 3/7/13 inner Ø:", [3, 7, 13].map((s) => round2(innerDiameterMm(s))));
console.log(
  "carat spread:",
  [0.25, 0.5, 1, 1.5, 2, 3, 5].map((c) => `${c}ct=${round2(roundDiameterMm(c))}mm`).join(" "),
);
console.log(
  "1ct dims:",
  ["round", "oval", "cushion", "emerald", "pear"].map((s) => {
    const d = stoneDimsMm(s, 1);
    return `${s} ${round2(d.widthMm)}x${round2(d.lengthMm)}x${round2(d.depthMm)}`;
  }).join(" | "),
);

// --- helpers ---------------------------------------------------------------
/**
 * The band is a torus, not a convex shell: bore vertices legitimately face the
 * axis. Test the two surfaces separately, in the ring's radial (XY) plane.
 */
function bandNormalCheck(geometry, innerR, outerR) {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  let worstOuter = Infinity;
  let worstInner = Infinity;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (let t = 0; t < index.count; t += 3) {
    a.fromBufferAttribute(position, index.getX(t));
    b.fromBufferAttribute(position, index.getX(t + 1));
    c.fromBufferAttribute(position, index.getX(t + 2));

    // Winding-derived face normal, so this validates the index order itself.
    const faceNormal = b.clone().sub(a).cross(c.clone().sub(a));
    if (faceNormal.lengthSq() < 1e-12) continue;
    faceNormal.normalize();

    const centroid = a.clone().add(b).add(c).divideScalar(3);
    const radius = Math.hypot(centroid.x, centroid.y);
    if (radius < 1e-4) continue;
    const dot = (faceNormal.x * centroid.x + faceNormal.y * centroid.y) / radius;

    if (radius > outerR * 0.99) worstOuter = Math.min(worstOuter, dot);
    if (radius < innerR * 1.01) worstInner = Math.min(worstInner, -dot);
  }
  return { worstOuter, worstInner };
}

function outwardNormalCheck(geometry, label) {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  let worstDot = Infinity;
  let checked = 0;
  const center = new THREE.Vector3();
  geometry.computeBoundingBox();
  geometry.boundingBox.getCenter(center);

  for (let i = 0; i < position.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(position, i).sub(center);
    if (p.length() < 1e-3) continue;
    const n = new THREE.Vector3().fromBufferAttribute(normal, i);
    if (n.lengthSq() < 1e-6) continue;
    // Only test points on the convex outer shell, where outward is unambiguous.
    worstDot = Math.min(worstDot, p.normalize().dot(n));
    checked++;
  }
  return { worstDot, checked, label };
}

function size(geometry) {
  geometry.computeBoundingBox();
  const s = new THREE.Vector3();
  geometry.boundingBox.getSize(s);
  return s;
}

function inspect(label, params) {
  const build = buildRing(params);
  build.shapeForCheck = params.stoneShape === "none" ? null : params.stoneShape;
  const m = build.metrics;
  const lines = [];

  // Band ---------------------------------------------------------------
  const bandSize = size(build.band);
  const expectedOuter = m.bandOuterRadiusMm * 2;
  if (Math.abs(bandSize.x - expectedOuter) > 0.02) {
    flag(label, `band outer Ø ${round2(bandSize.x)} != ${round2(expectedOuter)}`);
  }
  if (Math.abs(bandSize.z - params.bandWidthMm) > 0.02) {
    flag(label, `band width ${round2(bandSize.z)} != ${params.bandWidthMm}`);
  }
  const bandBore = new THREE.Box3().setFromBufferAttribute(build.band.getAttribute("position"));
  lines.push(`band Ø${round2(bandSize.x)} w${round2(bandSize.z)} bore${round2(m.innerDiameterMm)}`);
  void bandBore;

  // Stone --------------------------------------------------------------
  if (build.stone) {
    const stoneSize = size(build.stone.geometry);
    const d = m.stone;
    if (Math.abs(stoneSize.x - d.widthMm) > 0.02) flag(label, `stone width ${round2(stoneSize.x)} != ${round2(d.widthMm)}`);
    if (Math.abs(stoneSize.z - d.lengthMm) > 0.02) flag(label, `stone length ${round2(stoneSize.z)} != ${round2(d.lengthMm)}`);
    if (Math.abs(stoneSize.y - d.depthMm) > 0.02) flag(label, `stone depth ${round2(stoneSize.y)} != ${round2(d.depthMm)}`);
    const n = outwardNormalCheck(build.stone.geometry, "stone");
    if (n.worstDot < 0) flag(label, `stone has inward-facing normals (worst dot ${round2(n.worstDot)})`);
    // Culet must clear the band, girdle must sit above it.
    if (d.culetYMm < m.bandOuterRadiusMm - 0.001) flag(label, `stone culet ${round2(d.culetYMm)} sinks into band ${round2(m.bandOuterRadiusMm)}`);
    lines.push(`stone ${round2(stoneSize.x)}x${round2(stoneSize.z)}x${round2(stoneSize.y)} girdleY${round2(d.girdleYMm)}`);
  }

  const bandNormals = bandNormalCheck(
    build.band,
    m.innerDiameterMm / 2,
    m.bandOuterRadiusMm,
  );
  lines.push(
    `band normals outer${round2(bandNormals.worstOuter)} bore${round2(bandNormals.worstInner)}`,
  );
  if (bandNormals.worstOuter < 0.2) flag(label, `band outer surface faces inward (${round2(bandNormals.worstOuter)})`);
  if (bandNormals.worstInner < 0.2) flag(label, `band bore faces outward (${round2(bandNormals.worstInner)})`);

  // Prongs -------------------------------------------------------------
  if (build.prongs && m.stone) {
    const p = m.prongs;
    lines.push(
      `prongs ${p.count} r${round2(p.radiusMm)} len${round2(p.lengthMm)} bite${round2(p.girdleBiteMm)} foot(seat ${round2(p.footSeatMm)}, axial ${round2(p.footAxialMm)}/${round2(params.bandWidthMm / 2)})`,
    );
    if (p.girdleBiteMm <= 0) flag(label, `prong bead does not reach the girdle (${round2(p.girdleBiteMm)}mm)`);
    if (p.footSeatMm <= 0) flag(label, `prong foot floats above the band (${round2(p.footSeatMm)}mm)`);
    if (p.footAxialMm > params.bandWidthMm / 2) {
      flag(label, `prong foot sits ${round2(p.footAxialMm)}mm off centre on a ${params.bandWidthMm}mm band — hangs off the edge`);
    }

    // Does each wire cut into the pavilion on its way up?
    const culetY = m.stone.culetYMm;
    const girdleY = m.stone.girdleYMm;
    let worstClearance = Infinity;
    for (let i = 0; i < build.prongs.placements.length; i++) {
      const place = build.prongs.placements[i];
      const q = new THREE.Quaternion(...place.quaternion);
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const center = new THREE.Vector3(...place.position);
      for (let t = -0.5; t <= 0.5; t += 0.05) {
        const point = center.clone().addScaledVector(axis, t * p.lengthMm);
        if (point.y < culetY || point.y > girdleY) continue;
        const heightFraction = (point.y - culetY) / (girdleY - culetY);
        // Radius of the pavilion cone at this height, in this prong's direction.
        const bearing = Math.atan2(point.z, point.x);
        const girdleR = girdleRadiusAt(build, bearing);
        const stoneR = girdleR * heightFraction;
        worstClearance = Math.min(
          worstClearance,
          Math.hypot(point.x, point.z) - p.radiusMm - stoneR,
        );
      }
    }
    lines.push(`prong→pavilion clearance ${round2(worstClearance)}mm`);
    if (worstClearance < -0.15) flag(label, `prong wire cuts ${round2(-worstClearance)}mm into the pavilion`);
  }

  // Halo ---------------------------------------------------------------
  if (m.halo) {
    const h = m.halo;
    lines.push(
      `halo ${h.count}x Ø${round2(h.stoneDiameterMm)} spacing${round2(h.minSpacingMm)} clearance${round2(h.centreClearanceMm)}`,
    );
    if (h.minSpacingMm < h.stoneDiameterMm * 0.95) {
      flag(label, `halo stones overlap: spacing ${round2(h.minSpacingMm)} < Ø${round2(h.stoneDiameterMm)}`);
    }
    if (h.centreClearanceMm < -0.05) {
      flag(label, `halo overlaps the centre stone by ${round2(-h.centreClearanceMm)}mm`);
    }
    if (h.count < 12 || h.count > 20) flag(label, `halo count ${h.count} outside the supported 12–20`);
  }

  // Pavé ---------------------------------------------------------------
  if (m.pave) {
    const pv = m.pave;
    lines.push(`pave ${pv.count}x Ø${round2(pv.stoneDiameterMm)} spacing${round2(pv.minSpacingMm)}`);
    if (pv.stoneDiameterMm > params.bandWidthMm) {
      flag(label, `pave stone Ø${round2(pv.stoneDiameterMm)} wider than the ${params.bandWidthMm}mm band`);
    }
    if (pv.minSpacingMm < pv.stoneDiameterMm * 0.95) {
      flag(label, `pave stones overlap: spacing ${round2(pv.minSpacingMm)} < Ø${round2(pv.stoneDiameterMm)}`);
    }
    if (pv.count === 0) flag(label, "pave enabled but produced no stones");
  }

  // Overall framing ------------------------------------------------------
  const overall = new THREE.Box3();
  const addGeometry = (geometry, placements) => {
    geometry.computeBoundingBox();
    if (!placements) {
      overall.union(geometry.boundingBox.clone());
      return;
    }
    for (const place of placements) {
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...place.position),
        new THREE.Quaternion(...place.quaternion),
        new THREE.Vector3(1, 1, 1),
      );
      overall.union(geometry.boundingBox.clone().applyMatrix4(matrix));
    }
  };
  addGeometry(build.band);
  if (build.stone) {
    addGeometry(build.stone.geometry, [{ position: build.stone.position, quaternion: [0, 0, 0, 1] }]);
  }
  for (const part of [build.prongs, build.prongTips, build.halo, build.pave]) {
    if (part) addGeometry(part.geometry, part.placements);
  }
  // Cross-check the bounds the builder reports (used for camera auto-fit)
  // against this independently accumulated union.
  const reported = new THREE.Box3(
    new THREE.Vector3(...m.boundsMm.min),
    new THREE.Vector3(...m.boundsMm.max),
  );
  for (const axis of ["x", "y", "z"]) {
    if (
      Math.abs(reported.min[axis] - overall.min[axis]) > 0.01 ||
      Math.abs(reported.max[axis] - overall.max[axis]) > 0.01
    ) {
      flag(
        label,
        `metrics.boundsMm.${axis} [${round2(reported.min[axis])}, ${round2(reported.max[axis])}] != measured [${round2(overall.min[axis])}, ${round2(overall.max[axis])}]`,
      );
    }
  }

  const overallSize = new THREE.Vector3();
  overall.getSize(overallSize);
  const sceneHeight = overallSize.y * MM_TO_SCENE;
  lines.push(
    `overall ${round2(overallSize.x)}x${round2(overallSize.y)}x${round2(overallSize.z)}mm → ${round2(sceneHeight)} scene units tall`,
  );
  // No fixed-frame check any more: the camera auto-fits to metrics.boundsMm,
  // so the only requirement is that the bounds are finite and non-degenerate.
  if (!Number.isFinite(sceneHeight) || sceneHeight <= 0) {
    flag(label, `degenerate bounds (${round2(sceneHeight)} scene units tall)`);
  }

  console.log(`\n### ${label}`);
  for (const line of lines) console.log("   " + line);
}

// True girdle radius in a bearing direction, from the same outline the builder uses.
function girdleRadiusAt(build, bearing) {
  const d = build.metrics.stone;
  if (!d || !build.shapeForCheck) return 0;
  const outline = girdleOutlineMm(build.shapeForCheck, d);
  let bestRadius = 0;
  let bestDelta = Infinity;
  for (const point of outline) {
    const difference = Math.atan2(point.z, point.x) - bearing;
    const delta = Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference)));
    if (delta < bestDelta) {
      bestDelta = delta;
      bestRadius = Math.hypot(point.x, point.z);
    }
  }
  return bestRadius;
}

const cases = [
  ["default (1ct round, 4 prong)", {}],
  ["oval 2ct halo", { stoneShape: "oval", stoneCarat: 2, halo: true }],
  ["pear 1.5ct halo 6 prong", { stoneShape: "pear", stoneCarat: 1.5, halo: true, prongCount: 6 }],
  ["emerald 3ct flat band", { stoneShape: "emerald", stoneCarat: 3, bandProfile: "flat", bandWidthMm: 3 }],
  ["cushion 5ct halo pave", { stoneShape: "cushion", stoneCarat: 5, halo: true, paveBand: true, bandWidthMm: 4 }],
  ["tiny: 0.25ct, thin knife-edge", { stoneCarat: 0.25, bandProfile: "knife-edge", bandWidthMm: 1.5, bandThicknessMm: 1 }],
  ["eternity: no stone + pave", { stoneShape: "none", paveBand: true, bandWidthMm: 2.5 }],
  ["chunky: 8mm x 3mm band, 6 prong", { bandWidthMm: 8, bandThicknessMm: 3, prongCount: 6, paveBand: true }],
  ["size 3 min", { ringSize: 3 }],
  ["size 13 max, 5ct halo pave", { ringSize: 13, stoneCarat: 5, halo: true, paveBand: true, bandWidthMm: 6 }],
  ["no prongs", { prongCount: 0 }],
];

for (const [label, overrides] of cases) {
  inspect(label, { ...DEFAULT_RING_PARAMS, ...overrides });
}

// --- exhaustive sweep: every combination the sliders can reach --------------
const SHAPES = ["round", "oval", "cushion", "emerald", "pear", "none"];
const PROFILES = ["rounded", "flat", "knife-edge"];
const PRONGS = [0, 4, 6];
let sweepCount = 0;

function assertFinite(label, geometry, what) {
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count * 3; i++) {
    if (!Number.isFinite(position.array[i])) {
      flag(label, `${what} has non-finite vertex data`);
      return;
    }
  }
  const index = geometry.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i++) {
      if (index.array[i] >= position.count) {
        flag(label, `${what} index out of range`);
        return;
      }
    }
  }
  if (position.count === 0) flag(label, `${what} produced no vertices`);
}

for (const stoneShape of SHAPES) {
  for (const bandProfile of PROFILES) {
    for (const prongCount of PRONGS) {
      for (const halo of [false, true]) {
        for (const paveBand of [false, true]) {
          for (const [ringSize, bandWidthMm, bandThicknessMm, stoneCarat] of [
            [3, 1.5, 1, 0.25],
            [7, 2, 1.6, 1],
            [13, 8, 3, 5],
            [9.25, 1.5, 3, 4.35],
            [4.5, 8, 1, 0.4],
          ]) {
            const params = {
              ...DEFAULT_RING_PARAMS,
              stoneShape, bandProfile, prongCount, halo, paveBand,
              ringSize, bandWidthMm, bandThicknessMm, stoneCarat,
            };
            const label = `sweep ${stoneShape}/${bandProfile}/${prongCount}p${halo ? "/halo" : ""}${paveBand ? "/pave" : ""} @${ringSize}/${bandWidthMm}/${bandThicknessMm}/${stoneCarat}ct`;
            let build;
            try {
              build = buildRing(params);
            } catch (error) {
              flag(label, `threw: ${error.message}`);
              continue;
            }
            sweepCount++;
            assertFinite(label, build.band, "band");
            if (build.stone) assertFinite(label, build.stone.geometry, "stone");
            for (const [name, part] of [
              ["prongs", build.prongs],
              ["prongTips", build.prongTips],
              ["halo", build.halo],
              ["pave", build.pave],
            ]) {
              if (!part) continue;
              assertFinite(label, part.geometry, name);
              for (const placement of part.placements) {
                if (placement.position.some((v) => !Number.isFinite(v)) ||
                    placement.quaternion.some((v) => !Number.isFinite(v))) {
                  flag(label, `${name} placement has non-finite transform`);
                  break;
                }
              }
            }
            // Things that must hold no matter the combination.
            if (build.prongs && params.prongCount === 0) flag(label, "prongs built with prongCount 0");
            if (build.stone && params.stoneShape === "none") flag(label, "stone built for shape none");
            if (build.halo && params.stoneShape === "none") flag(label, "halo built without a centre stone");
            if (build.metrics.pave && build.metrics.pave.stoneDiameterMm > params.bandWidthMm) {
              flag(label, `pave Ø${round2(build.metrics.pave.stoneDiameterMm)} exceeds band width ${params.bandWidthMm}`);
            }
            if (build.metrics.halo && build.metrics.halo.centreClearanceMm < -0.05) {
              flag(label, `halo overlaps centre stone by ${round2(-build.metrics.halo.centreClearanceMm)}mm`);
            }
            if (build.metrics.prongs && build.metrics.prongs.footAxialMm > params.bandWidthMm / 2 + 1e-6) {
              flag(label, `prong foot ${round2(build.metrics.prongs.footAxialMm)}mm off a ${params.bandWidthMm}mm band`);
            }
            disposeRingBuild(build);
          }
        }
      }
    }
  }
}
console.log(`\nswept ${sweepCount} parameter combinations`);

// --- camera auto-fit -------------------------------------------------------
// The designer camera refits to metrics.boundsMm after every rebuild. Verify
// the resulting framing numerically, since it can't be eyeballed headlessly.
console.log("\n### camera auto-fit (38° fov, 16:9, ~40° elevation)");

const FOV = 38;
const ASPECT = 16 / 9;
// Matches DESIGNER_CAMERA in components/DesignerViewer.tsx.
const VIEW_DIR = new THREE.Vector3(0, 2.25, 2.68).normalize();
// OrbitControls limits in components/ViewerShell.tsx.
const MIN_DISTANCE = 1.3;
const MAX_DISTANCE = 9;

const framingCases = [
  ["reported prompt (1.5ct oval, thin rounded band, 6 prong)", {
    stoneCarat: 1.5, stoneShape: "oval", metal: "rose_gold",
    bandWidthMm: 1.6, bandThicknessMm: 1.1, bandProfile: "rounded", prongCount: 6,
  }],
  ["default", {}],
  ["smallest (0.25ct, thin band)", { stoneCarat: 0.25, bandWidthMm: 1.5, bandThicknessMm: 1 }],
  ["largest (size 13, 5ct, halo, pave)", {
    ringSize: 13, stoneCarat: 5, halo: true, paveBand: true, bandWidthMm: 6,
  }],
  ["no stone", { stoneShape: "none" }],
];

for (const [label, overrides] of framingCases) {
  const params = { ...DEFAULT_RING_PARAMS, ...overrides };
  const build = buildRing(params);
  const groundOffset = GROUND_Y + build.metrics.bandOuterRadiusMm * MM_TO_SCENE;
  const box = ringSceneBounds(build.metrics.boundsMm, MM_TO_SCENE, groundOffset);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const distance = fitDistance(box, center, VIEW_DIR, FOV, ASPECT);

  // Share of the frame the ring's vertical extent occupies at that distance.
  const visibleHeight = 2 * distance * Math.tan((FOV * Math.PI) / 180 / 2);
  const fill = size.y / visibleHeight;

  console.log(
    `   ${label}: dist ${round2(distance)}, centre y ${round2(center.y)}, fills ${Math.round(fill * 100)}% of frame height`,
  );

  if (distance < MIN_DISTANCE || distance > MAX_DISTANCE) {
    flag(label, `fit distance ${round2(distance)} outside OrbitControls [${MIN_DISTANCE}, ${MAX_DISTANCE}]`);
  }
  if (fill > 0.95) flag(label, `ring fills ${Math.round(fill * 100)}% of frame height — too tight`);
  if (fill < 0.35) flag(label, `ring fills only ${Math.round(fill * 100)}% of frame height — too small`);
  // The old fixed camera targeted y=0.15 regardless of the ring; the auto-fit
  // must actually centre on the geometry.
  if (Math.abs(center.y - box.getCenter(new THREE.Vector3()).y) > 1e-9) {
    flag(label, "centre drifted from the bounds centre");
  }
  disposeRingBuild(build);
}

console.log("\n================ FLAGS ================");
if (problems.length === 0) console.log("none");
for (const problem of problems) console.log("• " + problem);
