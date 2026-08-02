/**
 * US ring size ↔ inner diameter. Its own module because both the parametric
 * geometry and the archive resizing path need it, and the archive path must not
 * drag three.js in behind it.
 */
export const RING_SIZE_7_INNER_DIAMETER_MM = 17.35;
const MM_PER_RING_SIZE = 0.8128;

export function innerDiameterMm(ringSize: number): number {
  return RING_SIZE_7_INNER_DIAMETER_MM + (ringSize - 7) * MM_PER_RING_SIZE;
}

/**
 * Uniform scale that takes a ring from one US size to another. Resizing a mesh
 * this way scales the whole piece, not just the shank — which is why the note
 * has to state the assumed starting size out loud.
 */
export function ringSizeScaleFactor(from: number, to: number): number {
  const fromDiameter = innerDiameterMm(from);
  if (!Number.isFinite(fromDiameter) || fromDiameter <= 0) return 1;
  return innerDiameterMm(to) / fromDiameter;
}
