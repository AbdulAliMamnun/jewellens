"use client";

import type { ReactNode } from "react";

import { METAL_PRESETS } from "@/lib/metals";
import {
  BAND_PROFILES,
  HALO_STYLES,
  PAVE_COVERAGES,
  PRONG_COUNTS,
  RING_PARAM_BOUNDS,
  SETTING_TYPES,
  STONE_COLORS,
  STONE_SHAPES,
  type RingParams,
} from "@/lib/ring-params";
import { innerDiameterMm, roundDiameterMm, stoneDimsMm } from "@/lib/ring-geometry";

export interface RingControlsPanelProps {
  params: RingParams;
  onChange: (patch: Partial<RingParams>) => void;
  onReset: () => void;
  open: boolean;
  onClose: () => void;
  /** Fields to flash after a change — D2 uses this to show what Claude edited. */
  highlighted?: readonly (keyof RingParams)[];
}

/**
 * Every RingParams field gets a manual control. Grabbing a slider mid-meeting
 * has to work, and it proves the design state is real rather than scripted.
 */
export default function RingControlsPanel({
  params,
  onChange,
  onReset,
  open,
  onClose,
  highlighted,
}: RingControlsPanelProps) {
  if (!open) return null;

  const isHighlighted = (field: keyof RingParams) =>
    highlighted?.includes(field) ?? false;

  const noStone = params.stoneShape === "none";
  const stoneSize =
    params.stoneShape === "none"
      ? null
      : stoneDimsMm(params.stoneShape, params.stoneCarat);

  return (
    <div className="pointer-events-auto absolute inset-y-0 right-0 z-10 flex w-[22rem] max-w-full flex-col border-l border-black/10 bg-white/85 shadow-xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900">
          Design controls
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            className="rounded-full px-2.5 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close design controls"
            className="rounded-full px-2.5 py-1 text-sm text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {/* Grouped the way the taxonomy groups a ring: what the eye goes to
            first (the stone), then how it is held, then the band it sits on. */}
        <Section title="Centre stone">
          <Choices
            label="Shape"
            options={STONE_SHAPES}
            value={params.stoneShape}
            highlighted={isHighlighted("stoneShape")}
            onChange={(stoneShape) => onChange({ stoneShape })}
          />
          <Slider
            label="Carat"
            value={params.stoneCarat}
            bound={RING_PARAM_BOUNDS.stoneCarat}
            disabled={noStone}
            format={(value) =>
              stoneSize
                ? `${value.toFixed(2)}ct · ${stoneSize.widthMm.toFixed(1)}×${stoneSize.lengthMm.toFixed(1)}mm`
                : `${value.toFixed(2)}ct · ${roundDiameterMm(value).toFixed(1)}mm`
            }
            highlighted={isHighlighted("stoneCarat")}
            onChange={(stoneCarat) => onChange({ stoneCarat })}
          />
          <Choices
            label="Stone"
            options={STONE_COLORS}
            value={params.stoneColor}
            disabled={noStone}
            highlighted={isHighlighted("stoneColor")}
            onChange={(stoneColor) => onChange({ stoneColor })}
          />
        </Section>

        <Section title="Setting">
          <Choices
            label="Type"
            options={SETTING_TYPES}
            value={params.settingType}
            disabled={noStone}
            highlighted={isHighlighted("settingType")}
            onChange={(settingType) => onChange({ settingType })}
          />
          {/* A bezel holds the stone on its own, so the prong count would be
              dead UI — it is hidden rather than shown doing nothing. */}
          {params.settingType === "prong" ? (
            <Choices
              label="Prongs"
              options={PRONG_COUNTS}
              value={params.prongCount}
              disabled={noStone}
              highlighted={isHighlighted("prongCount")}
              onChange={(prongCount) => onChange({ prongCount })}
            />
          ) : null}
          <Choices
            label="Halo"
            options={HALO_STYLES}
            value={params.haloStyle}
            disabled={noStone}
            highlighted={isHighlighted("haloStyle")}
            onChange={(haloStyle) => onChange({ haloStyle })}
          />
          <Toggle
            label="Cathedral"
            hint="Shoulders arch up to a raised head"
            checked={params.cathedral}
            disabled={noStone}
            highlighted={isHighlighted("cathedral")}
            onChange={(cathedral) => onChange({ cathedral })}
          />
        </Section>

        <Section title="Band">
          <Slider
            label="Width"
            value={params.bandWidthMm}
            bound={RING_PARAM_BOUNDS.bandWidthMm}
            format={(value) => `${value.toFixed(1)}mm`}
            highlighted={isHighlighted("bandWidthMm")}
            onChange={(bandWidthMm) => onChange({ bandWidthMm })}
          />
          <Slider
            label="Thickness"
            value={params.bandThicknessMm}
            bound={RING_PARAM_BOUNDS.bandThicknessMm}
            format={(value) => `${value.toFixed(2)}mm`}
            highlighted={isHighlighted("bandThicknessMm")}
            onChange={(bandThicknessMm) => onChange({ bandThicknessMm })}
          />
          <Choices
            label="Profile"
            options={BAND_PROFILES}
            value={params.bandProfile}
            highlighted={isHighlighted("bandProfile")}
            onChange={(bandProfile) => onChange({ bandProfile })}
          />
          <Choices
            label="Pavé"
            options={PAVE_COVERAGES}
            value={params.paveCoverage}
            highlighted={isHighlighted("paveCoverage")}
            onChange={(paveCoverage) => onChange({ paveCoverage })}
          />
        </Section>

        <Section title="Metal">
          <div
            className={`grid grid-cols-2 gap-2 ${flashClass(isHighlighted("metal"))}`}
          >
            {METAL_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChange({ metal: preset.id })}
                aria-pressed={params.metal === preset.id}
                className={[
                  "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition",
                  params.metal === preset.id
                    ? "border-zinc-900 bg-white text-zinc-900 shadow-sm"
                    : "border-zinc-200 bg-white/60 text-zinc-600 hover:border-zinc-300",
                ].join(" ")}
              >
                <span
                  className="size-5 shrink-0 rounded-full ring-1 ring-black/10"
                  style={{ background: preset.swatch }}
                />
                {preset.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Size">
          <Slider
            label="Ring size"
            value={params.ringSize}
            bound={RING_PARAM_BOUNDS.ringSize}
            format={(value) =>
              `US ${value % 1 === 0 ? value : value.toFixed(2)} · ${innerDiameterMm(value).toFixed(2)}mm inner`
            }
            highlighted={isHighlighted("ringSize")}
            onChange={(ringSize) => onChange({ ringSize })}
          />
        </Section>
      </div>
    </div>
  );
}

/** Brief glow marking a control the last conversational turn changed. */
function flashClass(highlighted: boolean): string {
  return highlighted
    ? "rounded-lg bg-amber-100/70 ring-2 ring-amber-400/80 transition-colors"
    : "rounded-lg transition-colors";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Slider({
  label,
  value,
  bound,
  format,
  onChange,
  disabled,
  highlighted,
}: {
  label: string;
  value: number;
  bound: { min: number; max: number; step: number };
  format: (value: number) => string;
  onChange: (value: number) => void;
  disabled?: boolean;
  highlighted?: boolean;
}) {
  return (
    <label className={`block ${disabled ? "opacity-40" : ""} ${flashClass(Boolean(highlighted))}`}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-zinc-700">{label}</span>
        <span className="text-xs tabular-nums text-zinc-500">{format(value)}</span>
      </span>
      <input
        type="range"
        min={bound.min}
        max={bound.max}
        step={bound.step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1.5 w-full accent-zinc-900"
      />
    </label>
  );
}

function Choices<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled,
  highlighted,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  highlighted?: boolean;
}) {
  return (
    <div className={disabled ? "opacity-40" : ""}>
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <div className={`mt-1.5 flex flex-wrap gap-1.5 ${flashClass(Boolean(highlighted))}`}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            aria-pressed={option.value === value}
            className={[
              "rounded-full border px-3 py-1 text-xs font-medium transition",
              option.value === value
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-200 bg-white/70 text-zinc-600 hover:border-zinc-300",
            ].join(" ")}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
  highlighted,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  highlighted?: boolean;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-3 ${disabled ? "opacity-40" : ""} ${flashClass(Boolean(highlighted))}`}
    >
      <span>
        <span className="block text-sm font-medium text-zinc-700">{label}</span>
        {hint ? <span className="block text-xs text-zinc-400">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={[
          "relative h-6 w-11 shrink-0 rounded-full transition",
          checked ? "bg-zinc-900" : "bg-zinc-300",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
            checked ? "left-[1.375rem]" : "left-0.5",
          ].join(" ")}
        />
      </button>
    </label>
  );
}
