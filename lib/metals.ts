/** Matches the `metal` field of RingParams so the designer and the viewer share one source of truth. */
export type MetalId = "yellow_gold" | "rose_gold" | "white_gold" | "platinum";

export interface MetalPreset {
  id: MetalId;
  label: string;
  /** Base color, sRGB hex. */
  color: string;
  metalness: number;
  roughness: number;
  /** Boosts reflections off the studio environment. */
  envMapIntensity: number;
  /** CSS background for the UI swatch. */
  swatch: string;
}

export const METAL_PRESETS: readonly MetalPreset[] = [
  {
    id: "yellow_gold",
    label: "Yellow gold",
    color: "#d4a843",
    metalness: 1.0,
    roughness: 0.18,
    envMapIntensity: 1.15,
    swatch: "linear-gradient(135deg, #f2dea0 0%, #d4a843 55%, #8f6d1f 100%)",
  },
  {
    id: "rose_gold",
    label: "Rose gold",
    color: "#b76e79",
    metalness: 1.0,
    roughness: 0.2,
    envMapIntensity: 1.1,
    swatch: "linear-gradient(135deg, #f0c3c4 0%, #b76e79 55%, #7d4149 100%)",
  },
  {
    id: "white_gold",
    label: "White gold",
    color: "#e8e8ec",
    metalness: 1.0,
    roughness: 0.12,
    envMapIntensity: 1.25,
    swatch: "linear-gradient(135deg, #ffffff 0%, #dcdce2 55%, #9b9ba4 100%)",
  },
  {
    id: "platinum",
    label: "Platinum",
    color: "#dcdcdd",
    metalness: 1.0,
    roughness: 0.2,
    envMapIntensity: 1.15,
    swatch: "linear-gradient(135deg, #f2f2f4 0%, #cfcfd3 55%, #8d8d93 100%)",
  },
];

export const DEFAULT_METAL: MetalId = "yellow_gold";

export function getMetalPreset(id: MetalId): MetalPreset {
  const preset = METAL_PRESETS.find((metal) => metal.id === id);
  if (!preset) {
    throw new Error(`Unknown metal preset: ${id}`);
  }
  return preset;
}
