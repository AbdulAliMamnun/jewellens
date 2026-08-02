import * as THREE from "three";

/** Margin left around the subject when the camera refits. */
export const FIT_PADDING = 1.22;

/**
 * Smallest camera distance that keeps every corner of `box` on screen from the
 * given view direction, accounting for both fov axes and the box's depth along
 * the view. Pure math so it can be checked without a browser.
 *
 * @param direction unit vector pointing from the target toward the camera
 */
export function fitDistance(
  box: THREE.Box3,
  center: THREE.Vector3,
  direction: THREE.Vector3,
  fovDegrees: number,
  aspect: number,
): number {
  const forward = direction.clone().negate();
  let right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < 1e-8) right = new THREE.Vector3(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  const corner = new THREE.Vector3();
  let maxRight = 0;
  let maxUp = 0;
  let maxDepth = 0;

  for (let i = 0; i < 8; i++) {
    corner
      .set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      )
      .sub(center);
    maxRight = Math.max(maxRight, Math.abs(corner.dot(right)));
    maxUp = Math.max(maxUp, Math.abs(corner.dot(up)));
    maxDepth = Math.max(maxDepth, Math.abs(corner.dot(forward)));
  }

  const halfFov = THREE.MathUtils.degToRad(fovDegrees) / 2;
  const forVertical = maxUp / Math.tan(halfFov);
  const forHorizontal = maxRight / (Math.tan(halfFov) * aspect);
  return Math.max(forVertical, forHorizontal) * FIT_PADDING + maxDepth;
}

/**
 * The ring's millimetre bounds placed into scene space: scaled, then lifted so
 * the band's lowest point rests on the ground plane.
 */
export function ringSceneBounds(
  boundsMm: { min: [number, number, number]; max: [number, number, number] },
  scale: number,
  groundOffsetY: number,
): THREE.Box3 {
  const { min, max } = boundsMm;
  return new THREE.Box3(
    new THREE.Vector3(min[0] * scale, min[1] * scale + groundOffsetY, min[2] * scale),
    new THREE.Vector3(max[0] * scale, max[1] * scale + groundOffsetY, max[2] * scale),
  );
}
