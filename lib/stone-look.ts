import type { StoneColor } from "./ring-params.ts";

export interface StoneAppearance {
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
export const STONE_APPEARANCE: Record<StoneColor, StoneAppearance> = {
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
