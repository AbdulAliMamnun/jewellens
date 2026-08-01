"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Instance, Instances } from "@react-three/drei";
import * as THREE from "three";

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
  ior: number;
  dispersion: number;
}

const STONE_APPEARANCE: Record<StoneColor, StoneAppearance> = {
  diamond: {
    color: "#ffffff",
    attenuationColor: "#ffffff",
    attenuationDistanceMm: 12,
    transmission: 0.95,
    ior: 2.42,
    dispersion: 3,
  },
  sapphire: {
    color: "#3358cc",
    attenuationColor: "#1b3ba8",
    attenuationDistanceMm: 4,
    transmission: 0.85,
    ior: 1.77,
    dispersion: 1,
  },
  ruby: {
    color: "#c8203f",
    attenuationColor: "#8f0f2c",
    attenuationDistanceMm: 4,
    transmission: 0.85,
    ior: 1.77,
    dispersion: 1,
  },
  emerald: {
    color: "#14956a",
    attenuationColor: "#0a6b45",
    attenuationDistanceMm: 4,
    transmission: 0.82,
    ior: 1.58,
    dispersion: 0.6,
  },
};

/** How long the scale-in tween runs after geometry is regenerated. */
const REBUILD_TWEEN_SECONDS = 0.18;
const REBUILD_START_SCALE = 0.96;

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
    <group
      ref={groupRef}
      scale={MM_TO_SCENE * REBUILD_START_SCALE}
      position={[0, GROUND_Y + build.metrics.bandOuterRadiusMm * MM_TO_SCENE, 0]}
    >
      <mesh geometry={build.band} material={metalMaterial} />

      {build.stone ? (
        <mesh geometry={build.stone.geometry} position={build.stone.position}>
          <meshPhysicalMaterial
            color={stoneLook.color}
            attenuationColor={stoneLook.attenuationColor}
            attenuationDistance={stoneLook.attenuationDistanceMm}
            transmission={stoneLook.transmission}
            ior={stoneLook.ior}
            dispersion={stoneLook.dispersion}
            thickness={build.metrics.stone?.depthMm ?? 1}
            metalness={0}
            roughness={0.02}
            clearcoat={1}
            clearcoatRoughness={0.02}
            envMapIntensity={2}
            flatShading
          />
        </mesh>
      ) : null}

      <PartInstances part={build.prongs} material={metalMaterial} />
      <PartInstances part={build.prongTips} material={metalMaterial} />
      <PartInstances part={build.halo} material={accentMaterial} />
      <PartInstances part={build.pave} material={accentMaterial} />
    </group>
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
