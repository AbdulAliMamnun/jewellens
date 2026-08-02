"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Instance, Instances } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";

import { fitDistance, ringSceneBounds } from "@/lib/camera-fit";
import { getMetalPreset } from "@/lib/metals";
import {
  GROUND_Y,
  MM_TO_SCENE,
  buildRing,
  disposeRingBuild,
  type InstancedPart,
} from "@/lib/ring-geometry";
import type { RingParams, StoneColor } from "@/lib/ring-params";

interface StoneAppearance {
  color: string;
  attenuationColor: string;
  attenuationDistanceMm: number;
  transmission: number;
  roughness: number;
  ior: number;
  dispersion: number;
}

/**
 * Transmission has to stay low here. three mixes the refracted sample straight
 * over the diffuse term (`totalDiffuse = mix(totalDiffuse, transmitted, transmission)`),
 * and behind this stone there is nothing to refract — the canvas is alpha and
 * the scene has no background — so a near-1.0 transmission erases exactly the
 * shading that makes the facets readable, leaving a mirror-flat silhouette.
 * Keeping it low lets the per-facet diffuse and specular do the work.
 */
const STONE_APPEARANCE: Record<StoneColor, StoneAppearance> = {
  diamond: {
    color: "#eef2fb",
    attenuationColor: "#ffffff",
    attenuationDistanceMm: 18,
    transmission: 0.3,
    roughness: 0.07,
    ior: 2.42,
    dispersion: 2.5,
  },
  sapphire: {
    color: "#2b4fc4",
    attenuationColor: "#16307f",
    attenuationDistanceMm: 3,
    transmission: 0.45,
    roughness: 0.07,
    ior: 1.77,
    dispersion: 1,
  },
  ruby: {
    color: "#c01f40",
    attenuationColor: "#82102a",
    attenuationDistanceMm: 3,
    transmission: 0.45,
    roughness: 0.07,
    ior: 1.77,
    dispersion: 1,
  },
  emerald: {
    color: "#12946c",
    attenuationColor: "#0a6b45",
    attenuationDistanceMm: 3,
    transmission: 0.42,
    roughness: 0.08,
    ior: 1.58,
    dispersion: 0.6,
  },
};

/** How long the scale-in tween runs after geometry is regenerated. */
const REBUILD_TWEEN_SECONDS = 0.18;
const REBUILD_START_SCALE = 0.96;

/** Refits below this much drift are ignored, so slider drags don't crawl the camera. */
const FIT_TOLERANCE = 0.08;
const FIT_SECONDS = 0.3;

/**
 * Keeps the whole ring framed as it is rebuilt. The ring is authored at real
 * scale, so a 5ct halo is genuinely bigger than a 0.25ct solitaire and a fixed
 * camera either crops it or leaves it stranded high in the frame. Refits keep
 * the user's orbit direction and only fire when the bounds actually move.
 */
function AutoFrame({ box }: { box: THREE.Box3 }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const controls = useThree(
    (state) => state.controls,
  ) as OrbitControlsImpl | null;
  const viewport = useThree((state) => state.size);

  const goalTarget = useRef(new THREE.Vector3());
  const goalDistance = useRef(0);
  const hasGoal = useRef(false);
  const firstFit = useRef(true);

  useEffect(() => {
    if (!controls) return;

    const center = box.getCenter(new THREE.Vector3());
    const direction = camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 1e-8) direction.set(0, 0.64, 0.77);
    direction.normalize();

    const distance = fitDistance(
      box,
      center,
      direction,
      camera.fov,
      camera.aspect,
    );
    const currentDistance = camera.position.distanceTo(controls.target);
    const distanceDrift =
      Math.abs(distance - currentDistance) / Math.max(currentDistance, 1e-6);

    if (
      !firstFit.current &&
      distanceDrift < FIT_TOLERANCE &&
      controls.target.distanceTo(center) < 0.04
    ) {
      return;
    }

    goalTarget.current.copy(center);
    goalDistance.current = distance;
    hasGoal.current = true;
  }, [box, camera, controls, viewport]);

  useFrame((_, delta) => {
    if (!controls || !hasGoal.current) return;

    const alpha = firstFit.current
      ? 1
      : 1 - Math.pow(0.0001, Math.min(delta, 0.1) / FIT_SECONDS);

    controls.target.lerp(goalTarget.current, alpha);
    const direction = camera.position.clone().sub(controls.target).normalize();
    const desired = controls.target
      .clone()
      .addScaledVector(direction, goalDistance.current);
    camera.position.lerp(desired, alpha);
    controls.update();

    firstFit.current = false;
    if (
      camera.position.distanceTo(desired) < 1e-3 &&
      controls.target.distanceTo(goalTarget.current) < 1e-3
    ) {
      hasGoal.current = false;
    }
  });

  return null;
}

export interface ParametricRingProps {
  params: RingParams;
}

/**
 * Generates the whole ring — band, centre stone, prongs, halo, pavé — from
 * RingParams. Everything is authored in millimetres and scaled into the scene
 * once, so the band bottom always rests on the shell's ground plane.
 */
export default function ParametricRing({ params }: ParametricRingProps) {
  const build = useMemo(() => buildRing(params), [params]);
  useEffect(() => () => disposeRingBuild(build), [build]);

  const metal = getMetalPreset(params.metal);
  const metalMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(metal.color),
        metalness: metal.metalness,
        roughness: metal.roughness,
        envMapIntensity: metal.envMapIntensity,
      }),
    [metal],
  );
  useEffect(() => () => metalMaterial.dispose(), [metalMaterial]);

  // Accent stones stay diamond-white and skip transmission: each transmissive
  // material costs an extra scene pass, and there can be 40 of them.
  const accentMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color("#ffffff"),
        metalness: 0,
        roughness: 0.05,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        envMapIntensity: 2.4,
        flatShading: true,
      }),
    [],
  );
  useEffect(() => () => accentMaterial.dispose(), [accentMaterial]);

  const stoneLook = STONE_APPEARANCE[params.stoneColor];

  // The group's own transform, applied to the millimetre bounds so the camera
  // fit works in the same space it orbits in.
  const groundOffset = GROUND_Y + build.metrics.bandOuterRadiusMm * MM_TO_SCENE;
  const sceneBounds = useMemo(
    () => ringSceneBounds(build.metrics.boundsMm, MM_TO_SCENE, groundOffset),
    [build, groundOffset],
  );

  // Cheap "something changed" tween: scale back up after every rebuild.
  const groupRef = useRef<THREE.Group>(null);
  const tween = useRef(0);
  useEffect(() => {
    tween.current = 0;
  }, [build]);
  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group || tween.current >= 1) return;
    tween.current = Math.min(1, tween.current + delta / REBUILD_TWEEN_SECONDS);
    const eased = 1 - (1 - tween.current) ** 3;
    group.scale.setScalar(
      MM_TO_SCENE * (REBUILD_START_SCALE + (1 - REBUILD_START_SCALE) * eased),
    );
  });

  return (
    <>
      <AutoFrame box={sceneBounds} />
      <group
        ref={groupRef}
        scale={MM_TO_SCENE * REBUILD_START_SCALE}
        position={[0, groundOffset, 0]}
      >
        <mesh geometry={build.band} material={metalMaterial} />

        {build.stone ? (
          <mesh geometry={build.stone.geometry} position={build.stone.position}>
            <meshPhysicalMaterial
              color={stoneLook.color}
              attenuationColor={stoneLook.attenuationColor}
              // Attenuation is measured along the world-space refraction ray, so
              // this has to be in scene units — in millimetres the ray never
              // travels far enough to pick up any body colour.
              attenuationDistance={
                stoneLook.attenuationDistanceMm * MM_TO_SCENE
              }
              transmission={stoneLook.transmission}
              ior={stoneLook.ior}
              dispersion={stoneLook.dispersion}
              // three scales thickness by the model matrix, so millimetres are
              // correct here.
              thickness={build.metrics.stone?.depthMm ?? 1}
              metalness={0}
              roughness={stoneLook.roughness}
              clearcoat={0.7}
              clearcoatRoughness={0.12}
              envMapIntensity={1.4}
              flatShading
            />
          </mesh>
        ) : null}

        <PartInstances part={build.prongs} material={metalMaterial} />
        <PartInstances part={build.prongTips} material={metalMaterial} />
        <PartInstances part={build.halo} material={accentMaterial} />
        <PartInstances part={build.pave} material={accentMaterial} />
      </group>
    </>
  );
}

function PartInstances({
  part,
  material,
}: {
  part: InstancedPart | null;
  material: THREE.Material;
}) {
  if (!part || part.placements.length === 0) return null;
  return (
    <Instances
      geometry={part.geometry}
      material={material}
      limit={part.placements.length}
      range={part.placements.length}
    >
      {part.placements.map((placement, index) => (
        <Instance
          key={index}
          position={placement.position}
          quaternion={placement.quaternion}
        />
      ))}
    </Instances>
  );
}
