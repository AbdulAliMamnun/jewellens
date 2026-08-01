"use client";

import { useState } from "react";

import ParametricRing from "@/components/ParametricRing";
import RingControlsPanel from "@/components/RingControlsPanel";
import ViewerShell, { ChromeButton } from "@/components/ViewerShell";
import { getMetalPreset } from "@/lib/metals";
import {
  DEFAULT_RING_PARAMS,
  STONE_SHAPES,
  clampRingParams,
  type RingParams,
} from "@/lib/ring-params";

/**
 * Looking down at ~58° — elongated cuts read as elongated from here, which they
 * do not from the archive viewer's near-horizontal default.
 */
const DESIGNER_CAMERA: [number, number, number] = [0, 3.05, 1.9];
const DESIGNER_TARGET: [number, number, number] = [0, 0.15, 0];

export interface DesignerViewerProps {
  className?: string;
}

function describe(params: RingParams): string {
  const metal = getMetalPreset(params.metal).label.toLowerCase();
  const shape =
    STONE_SHAPES.find((option) => option.value === params.stoneShape)?.label ??
    params.stoneShape;

  const parts =
    params.stoneShape === "none"
      ? ["Plain band"]
      : [`${params.stoneCarat.toFixed(2)}ct ${shape.toLowerCase()}`];

  parts.push(metal, `size ${params.ringSize % 1 === 0 ? params.ringSize : params.ringSize.toFixed(2)}`);
  if (params.stoneShape !== "none" && params.prongCount > 0) {
    parts.push(`${params.prongCount} prong`);
  }
  if (params.halo && params.stoneShape !== "none") parts.push("halo");
  if (params.paveBand) parts.push("pavé");

  return parts.join(" · ");
}

/**
 * D1: the parametric ring in the shared viewer chrome, driven by manual
 * controls. D2 lifts `params` into the conversational store; the controls panel
 * already accepts a `highlighted` list for showing what a chat turn changed.
 */
export default function DesignerViewer({ className }: DesignerViewerProps) {
  const [params, setParams] = useState<RingParams>(DEFAULT_RING_PARAMS);
  const [panelOpen, setPanelOpen] = useState(true);

  function update(patch: Partial<RingParams>) {
    // Clamp on every update — the same guard D2 applies to model output.
    setParams((current) => clampRingParams({ ...current, ...patch }));
  }

  return (
    <ViewerShell
      className={className}
      cameraPosition={DESIGNER_CAMERA}
      cameraTarget={DESIGNER_TARGET}
      scene={<ParametricRing params={params} />}
      badge={
        <div className="pointer-events-auto max-w-full truncate rounded-full bg-white/70 px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm backdrop-blur">
          Template design
          <span className="ml-2 text-xs font-normal text-zinc-500">
            {describe(params)}
          </span>
        </div>
      }
      actions={
        <ChromeButton onClick={() => setPanelOpen((open) => !open)}>
          {panelOpen ? "Hide controls" : "Customize"}
        </ChromeButton>
      }
      footer={
        <span className="pointer-events-auto rounded-full bg-white/70 px-3.5 py-1.5 text-sm font-medium text-zinc-600 shadow-sm backdrop-blur">
          {describe(params)}
        </span>
      }
      overlay={
        <RingControlsPanel
          params={params}
          onChange={update}
          onReset={() => setParams(DEFAULT_RING_PARAMS)}
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
        />
      }
    />
  );
}
