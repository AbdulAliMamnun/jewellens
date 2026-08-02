"use client";

import { useEffect, useState } from "react";

import DesignChat from "@/components/DesignChat";
import ParametricRing from "@/components/ParametricRing";
import RingControlsPanel from "@/components/RingControlsPanel";
import ViewerShell, { ChromeButton } from "@/components/ViewerShell";
import { useDesignStore } from "@/lib/design-store";
import { getMetalPreset } from "@/lib/metals";
import { STONE_SHAPES, type RingParams } from "@/lib/ring-params";

/**
 * Looking down at ~58° — elongated cuts read as elongated from here, which they
 * do not from the archive viewer's near-horizontal default.
 */
const DESIGNER_CAMERA: [number, number, number] = [0, 3.05, 1.9];
const DESIGNER_TARGET: [number, number, number] = [0, 0.15, 0];

/** How long changed controls stay lit after a conversational turn. */
const HIGHLIGHT_MS = 2600;

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

  parts.push(
    metal,
    `size ${params.ringSize % 1 === 0 ? params.ringSize : params.ringSize.toFixed(2)}`,
  );
  if (params.stoneShape !== "none" && params.prongCount > 0) {
    parts.push(`${params.prongCount} prong`);
  }
  if (params.halo && params.stoneShape !== "none") parts.push("halo");
  if (params.paveBand) parts.push("pavé");

  return parts.join(" · ");
}

/**
 * The parametric ring in the shared viewer chrome. Manual controls and the chat
 * are two faces of one Zustand store, so either can drive the design and both
 * always agree.
 */
export default function DesignerViewer({ className }: DesignerViewerProps) {
  const params = useDesignStore((state) => state.params);
  const changed = useDesignStore((state) => state.changed);
  const error = useDesignStore((state) => state.error);
  const updateParams = useDesignStore((state) => state.updateParams);
  const resetParams = useDesignStore((state) => state.resetParams);
  const clearChanged = useDesignStore((state) => state.clearChanged);
  const dismissError = useDesignStore((state) => state.dismissError);

  const [panelOpen, setPanelOpen] = useState(true);

  // The glow is a brief signal, not a mode — let it fade on its own.
  useEffect(() => {
    if (changed.length === 0) return;
    const timer = window.setTimeout(clearChanged, HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [changed, clearChanged]);

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
        <div
          className={[
            "w-full transition-[padding] duration-200",
            panelOpen ? "pr-[22rem]" : "",
          ].join(" ")}
        >
          <div className="mx-auto w-full max-w-2xl">
            <DesignChat />
          </div>
        </div>
      }
      overlay={
        <>
          <RingControlsPanel
            params={params}
            onChange={updateParams}
            onReset={resetParams}
            open={panelOpen}
            onClose={() => setPanelOpen(false)}
            highlighted={changed}
          />

          {error ? (
            <div className="pointer-events-none absolute inset-x-0 top-16 flex justify-center px-4">
              <div className="pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border border-red-200 bg-white/95 px-4 py-3 shadow-lg">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-red-700">
                    Design step failed
                  </p>
                  <p className="mt-0.5 text-sm text-zinc-600">{error}</p>
                </div>
                <button
                  type="button"
                  onClick={dismissError}
                  aria-label="Dismiss error"
                  className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                >
                  ✕
                </button>
              </div>
            </div>
          ) : null}
        </>
      }
    />
  );
}
