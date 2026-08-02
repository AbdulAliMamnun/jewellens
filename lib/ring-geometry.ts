import * as THREE from "three";
import type {
  BandProfile,
  PaveCoverage,
  RingParams,
  StoneShape,
} from "@/lib/ring-params";

/**
 * All ring geometry is authored in millimeters — real jewelry dimensions — and
 * scaled into scene units once, at the top of the component tree.
 */
export const MM_TO_SCENE = 0.075;

/** Scene-space Y the band's lowest point rests on (matches the archive viewer's ground). */
export const GROUND_Y = -1;

export const RING_SIZE_7_INNER_DIAMETER_MM = 17.35;
const MM_PER_RING_SIZE = 0.8128;

const TAU = Math.PI * 2;

export type CutShape = Exclude<StoneShape, "none">;

export function innerDiameterMm(ringSize: number): number {
  return RING_SIZE_7_INNER_DIAMETER_MM + (ringSize - 7) * MM_PER_RING_SIZE;
}

// ---------------------------------------------------------------------------
// Carat → millimeters
// ---------------------------------------------------------------------------

/** Round-brilliant spread table from the spec. */
const ROUND_CARAT_TO_MM: readonly (readonly [carat: number, mm: number])[] = [
  [0.5, 5.1],
  [1, 6.4],
  [1.5, 7.4],
  [2, 8.1],
  [3, 9.3],
];

/**
 * Interpolates the spread table; outside it, falls back to the physical
 * relationship d ∝ carat^(1/3) anchored on the nearest entry (within ~0.15mm
 * of published spread charts at 0.25ct and 5ct).
 */
export function roundDiameterMm(carat: number): number {
  const first = ROUND_CARAT_TO_MM[0];
  const last = ROUND_CARAT_TO_MM[ROUND_CARAT_TO_MM.length - 1];
  if (carat <= first[0]) return first[1] * Math.cbrt(carat / first[0]);
  if (carat >= last[0]) return last[1] * Math.cbrt(carat / last[0]);

  for (let i = 1; i < ROUND_CARAT_TO_MM.length; i++) {
    const [c0, d0] = ROUND_CARAT_TO_MM[i - 1];
    const [c1, d1] = ROUND_CARAT_TO_MM[i];
    if (carat <= c1) return d0 + ((carat - c0) / (c1 - c0)) * (d1 - d0);
  }
  return last[1];
}

/**
 * Width/length/depth of each cut relative to the round diameter of the same
 * weight — elongated cuts spread wider and cut narrower.
 */
const SHAPE_SPREAD: Record<
  CutShape,
  { width: number; length: number; depthOfWidth: number }
> = {
  round: { width: 1.0, length: 1.0, depthOfWidth: 0.62 },
  oval: { width: 0.86, length: 1.2, depthOfWidth: 0.62 },
  cushion: { width: 0.9, length: 0.9, depthOfWidth: 0.68 },
  emerald: { width: 0.72, length: 1.04, depthOfWidth: 0.66 },
  pear: { width: 0.8, length: 1.26, depthOfWidth: 0.62 },
  // Square brilliant: face-up spread is smaller than a round of the same weight
  // because the depth carries more of it.
  princess: { width: 0.86, length: 0.86, depthOfWidth: 0.73 },
  // Rectangular brilliant, cut corners; typical L/W around 1.25.
  radiant: { width: 0.79, length: 0.99, depthOfWidth: 0.69 },
  // Long and shallow — a marquise spreads further than any other cut.
  marquise: { width: 0.68, length: 1.36, depthOfWidth: 0.6 },
};

export interface StoneDimsMm {
  /** Across the hand (X). */
  widthMm: number;
  /** Along the finger (Z) — elongated cuts are set north–south. */
  lengthMm: number;
  /** Table to culet (Y). */
  depthMm: number;
}

/** Girdle outline of a cut, in millimetres, centred on the stone's axis. */
export function girdleOutlineMm(shape: CutShape, dims: StoneDimsMm): { x: number; z: number }[] {
  return scalePolygon(sampleOutline(OUTLINES[shape]), dims.widthMm, dims.lengthMm);
}

export function stoneDimsMm(shape: CutShape, carat: number): StoneDimsMm {
  const diameter = roundDiameterMm(carat);
  const spread = SHAPE_SPREAD[shape];
  const widthMm = diameter * spread.width;
  return {
    widthMm,
    lengthMm: diameter * spread.length,
    depthMm: widthMm * spread.depthOfWidth,
  };
}

// ---------------------------------------------------------------------------
// 2D outline helpers (girdle outlines, halo offsets, pavé arcs)
// ---------------------------------------------------------------------------

interface Point2 {
  x: number;
  z: number;
}

const OUTLINE_SAMPLES = 256;

type Outline = (u: number) => Point2;

const circleOutline: Outline = (u) => {
  const t = u * TAU;
  return { x: Math.cos(t) / 2, z: Math.sin(t) / 2 };
};

/** |x|^n + |z|^n = 1 — n=2 is a circle, higher n squares off the corners. */
function superellipseOutline(exponent: number): Outline {
  const power = 2 / exponent;
  return (u) => {
    const t = u * TAU;
    const c = Math.cos(t);
    const s = Math.sin(t);
    return {
      x: (Math.sign(c) * Math.abs(c) ** power) / 2,
      z: (Math.sign(s) * Math.abs(s) ** power) / 2,
    };
  };
}

/** Teardrop: point at +Z (toward the knuckle), belly at -Z. */
const pearOutline: Outline = (u) => {
  const t = u * TAU;
  return { x: Math.sin(t) * Math.sin(t / 2), z: Math.cos(t) };
};

/**
 * Boat/eye shape, pointed at both ends. sin·|sin| makes x fall off as the
 * square of the angle near t=0 and t=π, which is what produces a true point
 * rather than a rounded end.
 */
const marquiseOutline: Outline = (u) => {
  const t = u * TAU;
  return { x: Math.sin(t) * Math.abs(Math.sin(t)), z: Math.cos(t) };
};

/**
 * Outlines with real corners are given as polygons, not parametric curves:
 * sampling a parametric square rounds the corners off at any resolution, and a
 * princess is nothing but its corners.
 */
type OutlineSpec = Outline | { corners: Point2[] };

/** Rectangle with the corners cut off — the radiant/emerald family silhouette. */
function cutCornerRectangle(cut: number): { corners: Point2[] } {
  const outer = 0.5;
  const inner = 0.5 - cut;
  return {
    corners: [
      { x: outer, z: inner },
      { x: inner, z: outer },
      { x: -inner, z: outer },
      { x: -outer, z: inner },
      { x: -outer, z: -inner },
      { x: -inner, z: -outer },
      { x: inner, z: -outer },
      { x: outer, z: -inner },
    ],
  };
}

const OUTLINES: Record<CutShape, OutlineSpec> = {
  round: circleOutline,
  oval: circleOutline, // elongation comes from lengthMm
  cushion: superellipseOutline(3.4),
  emerald: superellipseOutline(6),
  pear: pearOutline,
  princess: {
    corners: [
      { x: 0.5, z: 0.5 },
      { x: -0.5, z: 0.5 },
      { x: -0.5, z: -0.5 },
      { x: 0.5, z: -0.5 },
    ],
  },
  radiant: cutCornerRectangle(0.16),
  marquise: marquiseOutline,
};

/** How many segments the girdle is faceted into — lower reads as a step cut. */
const OUTLINE_SEGMENTS: Record<CutShape, number> = {
  round: 24,
  oval: 28,
  cushion: 24,
  emerald: 16,
  pear: 40,
  princess: 8,
  radiant: 16,
  marquise: 40,
};

/**
 * Tips sharp enough that a plain prong would slide off, so a prong is forced
 * onto each one — the V-prong the trade uses to protect these cuts.
 * Angles are bearings in the stone's XZ plane; +Z is along the finger.
 */
function protectedAngles(shape: CutShape): number[] {
  if (shape === "pear") return [Math.PI / 2];
  if (shape === "marquise") return [Math.PI / 2, -Math.PI / 2];
  return [];
}

function signedArea(points: Point2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}

/**
 * Walks a corner list, subdividing each edge in proportion to its length. Every
 * corner is emitted exactly, at any sample count — a princess with softened
 * corners is not a princess.
 */
function samplePolygon(corners: Point2[], samples: number): Point2[] {
  const edgeLengths = corners.map((corner, i) => {
    const next = corners[(i + 1) % corners.length];
    return Math.hypot(next.x - corner.x, next.z - corner.z);
  });
  const perimeter = edgeLengths.reduce((sum, length) => sum + length, 0) || 1;

  const points: Point2[] = [];
  for (let i = 0; i < corners.length; i++) {
    const from = corners[i];
    const to = corners[(i + 1) % corners.length];
    const steps = Math.max(1, Math.round((edgeLengths[i] / perimeter) * samples));
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      points.push({
        x: from.x + (to.x - from.x) * t,
        z: from.z + (to.z - from.z) * t,
      });
    }
  }
  return points;
}

/**
 * Samples an outline into a polygon normalized to half-extents of 0.5 on both
 * axes and wound counter-clockwise (seen from +Y), which is what the surface
 * builders below assume for outward-facing normals.
 */
function sampleOutline(outline: OutlineSpec, samples = OUTLINE_SAMPLES): Point2[] {
  const raw: Point2[] =
    typeof outline === "function"
      ? Array.from({ length: samples }, (_, i) => outline(i / samples))
      : samplePolygon(outline.corners, samples);

  let maxX = 0;
  let maxZ = 0;
  for (const point of raw) {
    maxX = Math.max(maxX, Math.abs(point.x));
    maxZ = Math.max(maxZ, Math.abs(point.z));
  }

  const points = raw.map((point) => ({
    x: (point.x / (maxX || 1)) * 0.5,
    z: (point.z / (maxZ || 1)) * 0.5,
  }));

  return signedArea(points) < 0 ? points.reverse() : points;
}

function scalePolygon(points: Point2[], scaleX: number, scaleZ: number): Point2[] {
  return points.map((point) => ({ x: point.x * scaleX, z: point.z * scaleZ }));
}

function perimeterOf(points: Point2[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return total;
}

/** Andrew's monotone chain, on the (x, z) plane. */
function convexHull(points: Point2[]): Point2[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o: Point2, a: Point2, b: Point2) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

  const build = (input: Point2[]) => {
    const chain: Point2[] = [];
    for (const point of input) {
      while (
        chain.length >= 2 &&
        cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0
      ) {
        chain.pop();
      }
      chain.push(point);
    }
    chain.pop();
    return chain;
  };

  const lower = build(sorted);
  const upper = build([...sorted].reverse());
  const hull = [...lower, ...upper];
  return signedArea(hull) < 0 ? hull.reverse() : hull;
}

/**
 * Outward parallel offset of a convex outline. Every supported girdle outline is
 * convex, so taking the convex hull of the offset samples yields the true outer
 * offset and can never self-intersect — at a sharp tip (pear) the cusp is
 * replaced by a chord rather than looping back on itself.
 */
function offsetOutline(points: Point2[], distance: number): Point2[] {
  const offset: Point2[] = [];
  for (let i = 0; i < points.length; i++) {
    const previous = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];
    const tangentX = next.x - previous.x;
    const tangentZ = next.z - previous.z;
    const length = Math.hypot(tangentX, tangentZ) || 1;
    // Outward normal of a counter-clockwise polygon.
    const normalX = tangentZ / length;
    const normalZ = -tangentX / length;
    offset.push({
      x: points[i].x + normalX * distance,
      z: points[i].z + normalZ * distance,
    });
  }
  return convexHull(offset);
}

export interface CurvePlacement extends Point2 {
  /** Direction of travel along the curve, radians in the XZ plane. */
  tangentAngle: number;
}

/** Places `count` points at equal arc-length intervals around a closed polygon. */
function spaceAlongPolygon(points: Point2[], count: number): CurvePlacement[] {
  const segments: { start: Point2; end: Point2; length: number }[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const start = points[i];
    const end = points[(i + 1) % points.length];
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    segments.push({ start, end, length });
    total += length;
  }

  const placements: CurvePlacement[] = [];
  let segmentIndex = 0;
  let consumed = 0;

  for (let i = 0; i < count; i++) {
    const target = (i / count) * total;
    while (
      segmentIndex < segments.length - 1 &&
      consumed + segments[segmentIndex].length < target
    ) {
      consumed += segments[segmentIndex].length;
      segmentIndex++;
    }
    const segment = segments[segmentIndex];
    const t = segment.length > 0 ? (target - consumed) / segment.length : 0;
    placements.push({
      x: segment.start.x + (segment.end.x - segment.start.x) * t,
      z: segment.start.z + (segment.end.z - segment.start.z) * t,
      tangentAngle: Math.atan2(
        segment.end.z - segment.start.z,
        segment.end.x - segment.start.x,
      ),
    });
  }

  return placements;
}

/** Distance from the outline's center to its edge in direction `angle`. */
function radiusAtAngle(points: Point2[], angle: number): number {
  let bestRadius = 0;
  let bestDelta = Infinity;
  for (const point of points) {
    const difference = Math.atan2(point.z, point.x) - angle;
    // Wrap into [-π, π] before comparing.
    const delta = Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference)));
    if (delta < bestDelta) {
      bestDelta = delta;
      bestRadius = Math.hypot(point.x, point.z);
    }
  }
  return bestRadius;
}

// ---------------------------------------------------------------------------
// Surfaces of revolution
// ---------------------------------------------------------------------------

interface ProfilePoint {
  /** Radius from the axis. */
  x: number;
  /** Position along the axis. */
  y: number;
}

/**
 * Revolves a *closed* cross-section around the Y axis. The profile must be wound
 * clockwise in (radius, axial) — its outermost point travelling toward -y — so
 * the generated faces point outward.
 *
 * `creased` gives each profile edge its own vertices, so the corners of a flat
 * or knife-edge band stay crisp instead of being smoothed into a blob. Faces
 * stay smooth around the circumference either way.
 */
function revolveClosedProfile(
  profile: ProfilePoint[],
  segments: number,
  creased: boolean,
  /** Optional per-angle radial swell, e.g. cathedral shoulders. */
  radialExtension?: (radius: number, angle: number) => number,
): THREE.BufferGeometry {
  const rings = profile.length;
  const positions: number[] = [];
  const index: number[] = [];

  const pushRing = (point: ProfilePoint) => {
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * TAU;
      const radius = point.x + (radialExtension?.(point.x, angle) ?? 0);
      positions.push(radius * Math.cos(angle), point.y, radius * Math.sin(angle));
    }
  };

  if (creased) {
    for (let j = 0; j < rings; j++) {
      const base = positions.length / 3;
      pushRing(profile[j]);
      pushRing(profile[(j + 1) % rings]);
      for (let i = 0; i < segments; i++) {
        const nextI = (i + 1) % segments;
        const a = base + i;
        const b = base + nextI;
        const c = base + segments + nextI;
        const d = base + segments + i;
        index.push(a, b, c, a, c, d);
      }
    }
  } else {
    for (const point of profile) pushRing(point);
    for (let j = 0; j < rings; j++) {
      const nextJ = (j + 1) % rings;
      for (let i = 0; i < segments; i++) {
        const nextI = (i + 1) % segments;
        const a = j * segments + i;
        const b = j * segments + nextI;
        const c = nextJ * segments + nextI;
        const d = nextJ * segments + i;
        index.push(a, b, c, a, c, d);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A closed rim: two concentric outlines extruded between two heights, capped
 * top and bottom. This is the bezel — a wall of metal following the girdle.
 * Winding is chosen so every face points away from the metal.
 */
function buildRim(
  inner: Point2[],
  outer: Point2[],
  yBottom: number,
  yTop: number,
): THREE.BufferGeometry {
  const segments = Math.min(inner.length, outer.length);
  const positions: number[] = [];
  const index: number[] = [];

  // Four vertices per segment: inner/outer × bottom/top.
  for (let i = 0; i < segments; i++) {
    const innerPoint = inner[Math.floor((i / segments) * inner.length)];
    const outerPoint = outer[Math.floor((i / segments) * outer.length)];
    positions.push(innerPoint.x, yBottom, innerPoint.z);
    positions.push(innerPoint.x, yTop, innerPoint.z);
    positions.push(outerPoint.x, yBottom, outerPoint.z);
    positions.push(outerPoint.x, yTop, outerPoint.z);
  }

  const INNER_BOTTOM = 0;
  const INNER_TOP = 1;
  const OUTER_BOTTOM = 2;
  const OUTER_TOP = 3;

  for (let i = 0; i < segments; i++) {
    const base = i * 4;
    const next = ((i + 1) % segments) * 4;
    const quad = (a: number, b: number, c: number, d: number) => {
      index.push(a, b, c, a, c, d);
    };

    // Outer wall faces away from the axis.
    quad(
      base + OUTER_BOTTOM,
      base + OUTER_TOP,
      next + OUTER_TOP,
      next + OUTER_BOTTOM,
    );
    // Inner wall faces the stone.
    quad(
      base + INNER_BOTTOM,
      next + INNER_BOTTOM,
      next + INNER_TOP,
      base + INNER_TOP,
    );
    // Top rim faces up.
    quad(base + INNER_TOP, next + INNER_TOP, next + OUTER_TOP, base + OUTER_TOP);
    // Bottom rim faces down.
    quad(
      base + INNER_BOTTOM,
      base + OUTER_BOTTOM,
      next + OUTER_BOTTOM,
      next + INNER_BOTTOM,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** Vertical profile of a cut stone: radius as a fraction of the girdle, height in width units. */
interface StoneProfileRing {
  r: number;
  y: number;
}

/** Brilliant: 57% table, 16% crown, 43% pavilion — ~62% total depth. */
const BRILLIANT_PROFILE: StoneProfileRing[] = [
  { r: 0, y: 0.175 },
  { r: 0.57, y: 0.175 },
  { r: 1, y: 0.015 },
  { r: 1, y: -0.015 },
  { r: 0.04, y: -0.445 },
  { r: 0, y: -0.445 },
];

/** Step cut: bigger table, shallower crown, deeper pavilion. */
const STEP_PROFILE: StoneProfileRing[] = [
  { r: 0, y: 0.135 },
  { r: 0.66, y: 0.135 },
  { r: 1, y: 0.015 },
  { r: 1, y: -0.015 },
  { r: 0.1, y: -0.465 },
  { r: 0, y: -0.465 },
];

/**
 * Sweeps a girdle outline vertically through a cut profile. The girdle sits at
 * local y = 0 so callers can place stones by their girdle plane.
 */
function buildStoneGeometry(
  outline: Point2[],
  profile: StoneProfileRing[],
  dims: StoneDimsMm,
): THREE.BufferGeometry {
  const segments = outline.length;
  const rings = profile.length;
  const positions: number[] = [];

  for (const point of outline) {
    for (const ring of profile) {
      positions.push(point.x * ring.r, ring.y, point.z * ring.r);
    }
  }

  const index: number[] = [];
  for (let i = 0; i < segments; i++) {
    const nextI = (i + 1) % segments;
    for (let j = 0; j < rings - 1; j++) {
      const a = i * rings + j;
      const b = nextI * rings + j;
      const c = nextI * rings + j + 1;
      const d = i * rings + j + 1;
      // Skip the degenerate half of each quad at the table centre and culet.
      if (profile[j].r > 0) index.push(a, b, c);
      if (profile[j + 1].r > 0) index.push(a, c, d);
    }
  }

  const unitDepth = profile[0].y - profile[rings - 1].y;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.scale(dims.widthMm, dims.depthMm / unitDepth, dims.lengthMm);
  geometry.computeVertexNormals();
  return geometry;
}

function bandProfilePoints(
  profile: BandProfile,
  innerR: number,
  outerR: number,
  halfWidth: number,
): ProfilePoint[] {
  const thickness = outerR - innerR;

  if (profile === "knife-edge") {
    return [
      { x: innerR, y: halfWidth },
      { x: outerR, y: 0 },
      { x: innerR, y: -halfWidth },
    ];
  }

  if (profile === "flat") {
    const chamfer = Math.min(0.2, thickness * 0.25, halfWidth * 0.3);
    return [
      { x: innerR, y: halfWidth },
      { x: outerR - chamfer, y: halfWidth },
      { x: outerR, y: halfWidth - chamfer },
      { x: outerR, y: -halfWidth + chamfer },
      { x: outerR - chamfer, y: -halfWidth },
      { x: innerR, y: -halfWidth },
    ];
  }

  // Rounded: flat inner face against the finger, domed outer face.
  const steps = 14;
  const points: ProfilePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const phi = Math.PI / 2 - (i / steps) * Math.PI;
    points.push({
      x: innerR + thickness * Math.cos(phi),
      y: halfWidth * Math.sin(phi),
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface Placement {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

export interface InstancedPart {
  geometry: THREE.BufferGeometry;
  placements: Placement[];
}

export interface RingMetrics {
  innerDiameterMm: number;
  bandOuterRadiusMm: number;
  bandWidthMm: number;
  stone: (StoneDimsMm & { girdleYMm: number; culetYMm: number; tableYMm: number }) | null;
  prongs: {
    count: number;
    radiusMm: number;
    lengthMm: number;
    /** How far the claw bead reaches in past the girdle edge — must be > 0 to read as gripping. */
    girdleBiteMm: number;
    /** Depth the prong's foot is seated into the band; > 0 means it is anchored, not floating. */
    footSeatMm: number;
    /** Axial distance from the band's centre line to the prong's foot, vs. half the band width. */
    footAxialMm: number;
  } | null;
  halo: {
    count: number;
    stoneDiameterMm: number;
    /** Smallest centre-to-centre distance between neighbouring halo stones. */
    minSpacingMm: number;
    /** Smallest gap between a halo stone and the centre stone's girdle. */
    centreClearanceMm: number;
  } | null;
  pave: { count: number; stoneDiameterMm: number; minSpacingMm: number } | null;
  bezel: {
    wallMm: number;
    risesAboveGirdleMm: number;
    sitsBelowGirdleMm: number;
    girdleBiteMm: number;
  } | null;
  /** How far the cathedral shoulders lift the head above the shank. */
  cathedralRiseMm: number;
  /** Axis-aligned bounds of every part, in millimetres — drives camera auto-fit. */
  boundsMm: { min: [number, number, number]; max: [number, number, number] };
}

export interface RingBuild {
  band: THREE.BufferGeometry;
  stone: { geometry: THREE.BufferGeometry; position: [number, number, number] } | null;
  /** Tapered wires running from the band up to the girdle. */
  prongs: InstancedPart | null;
  /** Claw beads capping each prong, straddling the girdle edge. */
  prongTips: InstancedPart | null;
  /** Metal rim encircling the girdle, when settingType is "bezel". */
  bezel: THREE.BufferGeometry | null;
  halo: InstancedPart | null;
  pave: InstancedPart | null;
  metrics: RingMetrics;
}

function quaternionFromAxisAngle(
  axis: [number, number, number],
  angle: number,
): [number, number, number, number] {
  const half = angle / 2;
  const sin = Math.sin(half);
  return [axis[0] * sin, axis[1] * sin, axis[2] * sin, Math.cos(half)];
}

/** Rotation that takes the stone's +Y (table normal) onto `direction`. */
function quaternionFromUpTo(
  direction: [number, number, number],
): [number, number, number, number] {
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(...direction).normalize(),
  );
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

/** Upper bound on halo stones. See the note where the count is chosen. */
export const HALO_MAX_STONES = 20;

const ACCENT_STONE_SEGMENTS = 12;
const ACCENT_PROFILE = BRILLIANT_PROFILE;

/** Unit round brilliant used for halo and pavé stones, scaled to `diameter`. */
function buildAccentStone(diameter: number): THREE.BufferGeometry {
  return buildStoneGeometry(
    sampleOutline(circleOutline, ACCENT_STONE_SEGMENTS),
    ACCENT_PROFILE,
    { widthMm: diameter, lengthMm: diameter, depthMm: diameter * 0.62 },
  );
}

export function buildRing(params: RingParams): RingBuild {
  const innerDiameter = innerDiameterMm(params.ringSize);
  const innerR = innerDiameter / 2;
  const outerR = innerR + params.bandThicknessMm;
  const halfWidth = params.bandWidthMm / 2;

  const hasStone = params.stoneShape !== "none";
  const shape = hasStone ? (params.stoneShape as CutShape) : null;
  const dims = shape ? stoneDimsMm(shape, params.stoneCarat) : null;

  // A cathedral lifts the head and lets the shoulders sweep up to meet it. The
  // rise has to be known before the band is built, since it shapes the shank.
  const cathedralRise =
    params.cathedral && dims ? Math.min(2.4, Math.max(0.9, dims.depthMm * 0.4)) : 0;

  /**
   * Extra outer radius at revolve angle `phi`, tapering off away from the top.
   * The bore is untouched — `outerness` is 0 at the inner face.
   */
  const archExtension =
    cathedralRise > 0
      ? (radius: number, phi: number) => {
          // After the Z-axis rotation the top of the ring sits at phi = -π/2.
          const bump = Math.max(0, -Math.sin(phi)) ** 2;
          const outerness = Math.min(
            1,
            Math.max(0, (radius - innerR) / Math.max(1e-6, outerR - innerR)),
          );
          return cathedralRise * bump * outerness;
        }
      : undefined;

  const band = revolveClosedProfile(
    bandProfilePoints(params.bandProfile, innerR, outerR, halfWidth),
    128,
    params.bandProfile !== "rounded",
    archExtension,
  ).rotateX(Math.PI / 2); // hole axis Y → Z, so the ring stands upright

  /** Outer radius of the shank at a given horizontal offset from the ring's axis. */
  const archedRadiusAt = (offsetX: number) => {
    if (cathedralRise === 0) return outerR;
    const fromTop = Math.asin(Math.min(1, Math.max(-1, offsetX / outerR)));
    return outerR + cathedralRise * Math.cos(fromTop) ** 2;
  };

  let stone: RingBuild["stone"] = null;
  let girdleY = 0;
  let pavilionDepthMm = 0;
  let girdleOutline: Point2[] = [];
  let metricsStone: RingMetrics["stone"] = null;

  if (shape && dims) {
    const profile = shape === "emerald" ? STEP_PROFILE : BRILLIANT_PROFILE;
    const unitDepth = profile[0].y - profile[profile.length - 1].y;
    const depthScale = dims.depthMm / unitDepth;
    const pavilionDepth = -profile[profile.length - 1].y * depthScale;
    const crownHeight = profile[0].y * depthScale;

    // The culet rests just above the shank — higher when the arches lift it.
    const culetY = outerR + cathedralRise + 0.15;
    girdleY = culetY + pavilionDepth;
    pavilionDepthMm = pavilionDepth;

    const unitOutline = sampleOutline(OUTLINES[shape], OUTLINE_SEGMENTS[shape]);
    stone = {
      geometry: buildStoneGeometry(unitOutline, profile, dims),
      position: [0, girdleY, 0],
    };

    // Girdle outline in millimetres, centred on the stone's axis.
    girdleOutline = scalePolygon(
      sampleOutline(OUTLINES[shape]),
      dims.widthMm,
      dims.lengthMm,
    );

    metricsStone = {
      ...dims,
      girdleYMm: girdleY,
      culetYMm: culetY,
      tableYMm: girdleY + crownHeight,
    };
  }

  // --- Prongs -------------------------------------------------------------
  // Each prong is a basket wire: it starts seated in the band, splays outward
  // along (but clear of) the pavilion, and is capped by a claw bead that
  // straddles the girdle edge. A short cylinder floating at the girdle would
  // need a separate setting head to hang from, which the schema has no room for.
  let prongs: InstancedPart | null = null;
  let prongTips: InstancedPart | null = null;
  let metricsProngs: RingMetrics["prongs"] = null;

  if (shape && dims && params.settingType === "prong" && params.prongCount > 0) {
    const count = params.prongCount;
    const radius = Math.min(0.5, Math.max(0.18, dims.widthMm * 0.06));
    const beadRadius = radius * 1.15;
    // 4 prongs sit on the diagonals so they never cover the stone head-on;
    // 6 prongs start at the north tip, which is how elongated cuts are set.
    const startAngle = count === 4 ? Math.PI / 4 : Math.PI / 2;

    // Sharp tips get a prong whether or not the even spacing lands on one: the
    // nearest prong is pulled onto each tip, which is where a V-prong goes.
    const angles = Array.from({ length: count }, (_, i) => startAngle + (i / count) * TAU);
    const protectedTips = protectedAngles(shape);
    const claimed = new Set<number>();
    for (const tip of protectedTips) {
      let bestIndex = -1;
      let bestDelta = Infinity;
      for (let i = 0; i < angles.length; i++) {
        if (claimed.has(i)) continue;
        const difference = angles[i] - tip;
        const delta = Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference)));
        if (delta < bestDelta) {
          bestDelta = delta;
          bestIndex = i;
        }
      }
      if (bestIndex >= 0) {
        angles[bestIndex] = tip;
        claimed.add(bestIndex);
      }
    }
    const isProtected = (index: number) => claimed.has(index);

    const wires: Placement[] = [];
    const beads: Placement[] = [];
    const wireGeometries: { length: number }[] = [];
    let footSeat = Infinity;
    let footAxial = 0;

    for (let i = 0; i < count; i++) {
      const angle = angles[i];
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const girdleR = radiusAtAngle(girdleOutline, angle);

      // The wire runs up the outside of the girdle; only the claw bead capping
      // it reaches back in over the crown.
      const tipR = girdleR + radius * 0.75;
      const tipY = girdleY + radius * 0.2;

      // Keep the foot inside the band's width, or the wire lands on thin air.
      const maxFootR = (halfWidth * 0.85) / Math.max(0.2, Math.abs(sin));
      const footR = Math.min(girdleR * 0.38, maxFootR);
      const footX = footR * cos;
      // Seat the foot slightly below the band's outer surface — which the
      // cathedral arch has raised, if there is one.
      const shankR = archedRadiusAt(footX);
      const bandSurfaceY = Math.sqrt(Math.max(0.01, shankR * shankR - footX * footX));
      const footY = bandSurfaceY - 0.15;

      const deltaR = tipR - footR;
      const deltaY = tipY - footY;
      const length = Math.hypot(deltaR, deltaY);
      wireGeometries.push({ length });

      footSeat = Math.min(footSeat, bandSurfaceY - footY);
      footAxial = Math.max(footAxial, Math.abs(footR * sin));

      wires.push({
        position: [
          ((footR + tipR) / 2) * cos,
          (footY + tipY) / 2,
          ((footR + tipR) / 2) * sin,
        ],
        quaternion: quaternionFromUpTo([
          (deltaR / length) * cos,
          deltaY / length,
          (deltaR / length) * sin,
        ]),
      });
      if (isProtected(i)) {
        // V-prong: two claws pinching either side of the point, rather than one
        // bead sitting on a tip it would slide off.
        const spread = Math.min(0.5, (beadRadius * 1.15) / Math.max(0.4, girdleR));
        for (const offset of [-spread, spread]) {
          const bearing = angle + offset;
          const flankR = radiusAtAngle(girdleOutline, bearing) + radius * 0.5;
          beads.push({
            position: [flankR * Math.cos(bearing), tipY, flankR * Math.sin(bearing)],
            quaternion: [0, 0, 0, 1],
          });
        }
      } else {
        beads.push({
          position: [tipR * cos, tipY, tipR * sin],
          quaternion: [0, 0, 0, 1],
        });
      }
    }

    // Every wire is the same length within a build (the girdle radius only
    // varies on fancy shapes), so one geometry sized to the longest is enough.
    const wireLength = Math.max(...wireGeometries.map((wire) => wire.length));

    prongs = {
      geometry: new THREE.CylinderGeometry(radius * 0.8, radius * 0.95, wireLength, 12, 1),
      placements: wires,
    };
    prongTips = {
      geometry: new THREE.SphereGeometry(beadRadius, 14, 10),
      placements: beads,
    };
    metricsProngs = {
      count,
      radiusMm: radius,
      lengthMm: wireLength,
      girdleBiteMm: beadRadius - radius * 0.75,
      footSeatMm: footSeat,
      footAxialMm: footAxial,
    };
  }

  // --- Bezel ----------------------------------------------------------------
  // A rim of metal encircling the girdle, holding the stone on its own. It
  // replaces the prong head entirely rather than sitting alongside it.
  let bezel: THREE.BufferGeometry | null = null;
  let metricsBezel: RingMetrics["bezel"] = null;

  if (shape && dims && params.settingType === "bezel") {
    const wall = Math.min(0.9, Math.max(0.35, dims.widthMm * 0.09));
    const grip = 0.04;
    const inner = offsetOutline(girdleOutline, grip);
    const outer = offsetOutline(girdleOutline, grip + wall);
    const rise = Math.max(0.3, dims.depthMm * 0.1);
    const drop = Math.max(0.6, pavilionDepthMm * 0.55);

    bezel = buildRim(inner, outer, girdleY - drop, girdleY + rise);
    metricsBezel = {
      wallMm: wall,
      risesAboveGirdleMm: rise,
      sitsBelowGirdleMm: drop,
      // Positive means the rim overlaps the crown and actually retains the stone.
      girdleBiteMm: rise,
    };
  }

  // --- Halo ---------------------------------------------------------------
  let halo: InstancedPart | null = null;
  let metricsHalo: RingMetrics["halo"] = null;

  if (shape && dims && params.haloStyle === "hidden") {
    // A hidden halo rings the base of the head, tucked inside the stone's
    // silhouette so it reads from the side but not from directly above.
    const profile = shape === "emerald" ? STEP_PROFILE : BRILLIANT_PROFILE;
    const unitDepth = profile[0].y - profile[profile.length - 1].y;
    const pavilionDepth = (-profile[profile.length - 1].y * dims.depthMm) / unitDepth;

    const diameter = Math.min(1.6, Math.max(0.5, dims.widthMm * 0.13));
    // 0.78 keeps the accents (plus their own radius) inside the girdle outline.
    const ring = scalePolygon(girdleOutline, 0.78, 0.78);
    const count = Math.min(
      HALO_MAX_STONES,
      Math.max(10, Math.round(perimeterOf(ring) / (diameter * 1.1))),
    );
    const placements = spaceAlongPolygon(ring, count);
    const seatY = girdleY - pavilionDepth * 0.42;

    let minSpacing = Infinity;
    for (let i = 0; i < placements.length; i++) {
      const a = placements[i];
      const b = placements[(i + 1) % placements.length];
      minSpacing = Math.min(minSpacing, Math.hypot(b.x - a.x, b.z - a.z));
    }

    let hiddenClearance = Infinity;
    for (const placement of placements) {
      const bearing = Math.atan2(placement.z, placement.x);
      const girdleR = radiusAtAngle(girdleOutline, bearing);
      hiddenClearance = Math.min(
        hiddenClearance,
        girdleR - (Math.hypot(placement.x, placement.z) + diameter / 2),
      );
    }

    halo = {
      geometry: buildAccentStone(diameter),
      placements: placements.map((placement) => {
        const length = Math.hypot(placement.x, placement.z) || 1;
        return {
          position: [placement.x, seatY, placement.z] as [number, number, number],
          // Tables face outward, so the ring of stones catches light from the
          // side profile rather than from the top.
          quaternion: quaternionFromUpTo([
            placement.x / length,
            0,
            placement.z / length,
          ]),
        };
      }),
    };
    metricsHalo = {
      count,
      stoneDiameterMm: diameter,
      minSpacingMm: minSpacing,
      // For a hidden halo the meaningful clearance is how far inside the
      // stone's silhouette it hides.
      centreClearanceMm: hiddenClearance,
    };
  } else if (shape && dims && params.haloStyle === "standard") {
    const targetDiameter = Math.min(2.2, Math.max(0.7, dims.widthMm * 0.16));
    const gap = 0.12;
    const firstPass = offsetOutline(girdleOutline, targetDiameter / 2 + gap);
    // The spec asks for ~12–16 stones; the ceiling is raised to 20 because at 16
    // a halo around anything past ~1ct either gaps or needs oversized accents.
    const count = Math.min(
      HALO_MAX_STONES,
      Math.max(12, Math.round(perimeterOf(firstPass) / (targetDiameter * 1.06))),
    );
    // Size the accents to fill the ring so the halo always reads as continuous.
    const diameter = Math.min(
      targetDiameter * 1.35,
      perimeterOf(firstPass) / count / 1.06,
    );

    const ring = offsetOutline(girdleOutline, diameter / 2 + gap);
    const placements = spaceAlongPolygon(ring, count);

    let minSpacing = Infinity;
    for (let i = 0; i < placements.length; i++) {
      const a = placements[i];
      const b = placements[(i + 1) % placements.length];
      minSpacing = Math.min(minSpacing, Math.hypot(b.x - a.x, b.z - a.z));
    }

    let centreClearance = Infinity;
    for (const placement of placements) {
      const angle = Math.atan2(placement.z, placement.x);
      const girdleR = radiusAtAngle(girdleOutline, angle);
      centreClearance = Math.min(
        centreClearance,
        Math.hypot(placement.x, placement.z) - diameter / 2 - girdleR,
      );
    }

    halo = {
      geometry: buildAccentStone(diameter),
      placements: placements.map((placement) => ({
        position: [placement.x, girdleY, placement.z] as [number, number, number],
        quaternion: quaternionFromAxisAngle(
          [0, 1, 0],
          -Math.atan2(placement.z, placement.x),
        ),
      })),
    };
    metricsHalo = {
      count,
      stoneDiameterMm: diameter,
      minSpacingMm: minSpacing,
      centreClearanceMm: centreClearance,
    };
  }

  // --- Pavé ---------------------------------------------------------------
  let pave: InstancedPart | null = null;
  let metricsPave: RingMetrics["pave"] = null;

  if (params.paveCoverage !== "none") {
    // Never wider than the band it is set into, and never wider than it is deep.
    const diameter = Math.max(
      0.4,
      Math.min(1.6, params.bandWidthMm * 0.5, params.bandThicknessMm * 0.9),
    );
    const seatRadius = outerR - diameter * 0.25;
    const spacing = diameter * 1.06;
    const angularStep = spacing / seatRadius;

    // Leave room for the head: skip the arc the stone (or halo) sits over.
    let skipHalfAngle = 0;
    if (shape && dims) {
      const headHalfWidth =
        (params.haloStyle === "standard" && halo
          ? Math.max(...halo.placements.map((p) => Math.abs(p.position[0]))) +
            (metricsHalo?.stoneDiameterMm ?? 0) / 2
          : dims.widthMm / 2) + 0.35;
      skipHalfAngle = Math.asin(Math.min(0.95, headHalfWidth / seatRadius)) + 0.05;
    }

    // Coverage arcs, measured with the top of the ring at 90°.
    const COVERAGE_ARCS: Record<
      Exclude<PaveCoverage, "none">,
      { start: number; end: number }
    > = {
      half: { start: TAU / 24, end: Math.PI - TAU / 24 },
      three_quarter: { start: -Math.PI / 4, end: Math.PI * 1.25 },
      full: { start: 0, end: TAU },
    };
    const arc = COVERAGE_ARCS[params.paveCoverage];
    // A full band wraps, so the last seat must not land on top of the first.
    const wraps = params.paveCoverage === "full";
    const span = arc.end - arc.start;
    const intervals = Math.max(1, Math.round(span / angularStep));
    const step = span / intervals;
    const seats = wraps ? intervals : intervals + 1;
    const top = Math.PI / 2;

    const angles: number[] = [];
    for (let i = 0; i < seats; i++) {
      const angle = arc.start + i * step;
      const fromTop = Math.atan2(Math.sin(angle - top), Math.cos(angle - top));
      if (skipHalfAngle > 0 && Math.abs(fromTop) < skipHalfAngle) continue;
      angles.push(angle);
    }

    if (angles.length > 0) {
      pave = {
        geometry: buildAccentStone(diameter),
        placements: angles.map((angle) => ({
          position: [
            seatRadius * Math.cos(angle),
            seatRadius * Math.sin(angle),
            0,
          ] as [number, number, number],
          // Tables face radially outward, off the band's surface.
          quaternion: quaternionFromUpTo([Math.cos(angle), Math.sin(angle), 0]),
        })),
      };
      metricsPave = {
        count: angles.length,
        stoneDiameterMm: diameter,
        minSpacingMm: 2 * seatRadius * Math.sin(angularStep / 2),
      };
    }
  }

  const parts = { band, stone, prongs, prongTips, bezel, halo, pave };
  const bounds = measureBounds(parts);

  return {
    ...parts,
    metrics: {
      innerDiameterMm: innerDiameter,
      bandOuterRadiusMm: outerR,
      bandWidthMm: params.bandWidthMm,
      stone: metricsStone,
      prongs: metricsProngs,
      halo: metricsHalo,
      pave: metricsPave,
      bezel: metricsBezel,
      cathedralRiseMm: cathedralRise,
      boundsMm: {
        min: [bounds.min.x, bounds.min.y, bounds.min.z],
        max: [bounds.max.x, bounds.max.y, bounds.max.z],
      },
    },
  };
}

/**
 * Union of every part's bounds, with instance transforms applied. The camera
 * fit needs the real silhouette — a tall halo or a 5ct crown extends well past
 * the band, and framing on the band alone crops them.
 */
function measureBounds(build: Omit<RingBuild, "metrics">): THREE.Box3 {
  const bounds = new THREE.Box3();
  const scratch = new THREE.Box3();
  const matrix = new THREE.Matrix4();

  const add = (geometry: THREE.BufferGeometry, placements?: Placement[]) => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return;
    if (!placements) {
      bounds.union(box);
      return;
    }
    for (const placement of placements) {
      matrix.compose(
        new THREE.Vector3(...placement.position),
        new THREE.Quaternion(...placement.quaternion),
        new THREE.Vector3(1, 1, 1),
      );
      bounds.union(scratch.copy(box).applyMatrix4(matrix));
    }
  };

  add(build.band);
  if (build.bezel) add(build.bezel);
  if (build.stone) {
    add(build.stone.geometry, [
      { position: build.stone.position, quaternion: [0, 0, 0, 1] },
    ]);
  }
  for (const part of [build.prongs, build.prongTips, build.halo, build.pave]) {
    if (part) add(part.geometry, part.placements);
  }

  return bounds;
}

export function disposeRingBuild(build: RingBuild): void {
  build.band.dispose();
  build.stone?.geometry.dispose();
  build.prongs?.geometry.dispose();
  build.prongTips?.geometry.dispose();
  build.bezel?.dispose();
  build.halo?.geometry.dispose();
  build.pave?.geometry.dispose();
}
