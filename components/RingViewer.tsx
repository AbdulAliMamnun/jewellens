"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { Canvas } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Lightformer,
  OrbitControls,
} from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import {
  DEFAULT_METAL,
  METAL_PRESETS,
  getMetalPreset,
  type MetalId,
  type MetalPreset,
} from "@/lib/metals";
import {
  SUPPORTED_EXTENSIONS,
  disposeModel,
  isSupportedFile,
  loadModelFromFile,
  loadModelFromUrl,
  type LoadedModel,
} from "@/lib/model-loader";

export interface RingViewerProps {
  /** URL or /public path of an .stl/.obj to load. Dropping a file overrides it. */
  src?: string | null;
  /**
   * Bump whenever `src` should be (re)loaded — e.g. the design id of the card
   * that was clicked. Lets the same URL be re-selected after a manual drop.
   */
  srcKey?: string | number;
  /** Shown in the viewer chrome instead of the derived file name. */
  title?: string | null;
  className?: string;
  /** Called with a human-readable message whenever a load fails. */
  onError?: (message: string) => void;
}

type ModelSource =
  | { id: string; kind: "url"; url: string }
  | { id: string; kind: "file"; file: File };

interface LoadedEntry {
  sourceId: string;
  model: LoadedModel;
}

interface LoadError {
  /** Which source failed; `null` for errors raised before a load started. */
  sourceId: string | null;
  message: string;
}

export default function RingViewer({
  src,
  srcKey,
  title,
  className,
  onError,
}: RingViewerProps) {
  const [dropped, setDropped] = useState<{
    file: File;
    id: string;
    /** The `src` this drop takes precedence over; a new `src` wins again. */
    overrides: string;
  } | null>(null);
  const [entry, setEntry] = useState<LoadedEntry | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [metalId, setMetalId] = useState<MetalId>(DEFAULT_METAL);
  const [meetingMode, setMeetingMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const dragDepth = useRef(0);
  const dropCount = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  });

  const srcId = src ? `url:${srcKey ?? src}` : "none";

  // The active source is derived, never mirrored into state: a drop wins until
  // the caller points the viewer at a different model.
  const source = useMemo<ModelSource | null>(() => {
    if (dropped && dropped.overrides === srcId) {
      return { id: dropped.id, kind: "file", file: dropped.file };
    }
    return src ? { id: srcId, kind: "url", url: src } : null;
  }, [dropped, src, srcId]);

  useEffect(() => {
    if (!source) return;

    let cancelled = false;
    const abort = new AbortController();

    const load =
      source.kind === "file"
        ? loadModelFromFile(source.file)
        : loadModelFromUrl(source.url, abort.signal);

    load
      .then((model) => {
        if (cancelled) {
          disposeModel(model);
          return;
        }
        setEntry({ sourceId: source.id, model });
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const message =
          cause instanceof Error ? cause.message : "Could not load that model.";
        setError({ sourceId: source.id, message });
        onErrorRef.current?.(message);
      });

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [source]);

  // Release GPU memory when a model is swapped out, and on unmount.
  useEffect(() => {
    const model = entry?.model;
    if (!model) return;
    return () => disposeModel(model);
  }, [entry]);

  useEffect(() => {
    if (!meetingMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMeetingMode(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [meetingMode]);

  const metal = getMetalPreset(metalId);
  const model = entry?.model ?? null;
  const errorMessage =
    error && (error.sourceId === null || error.sourceId === source?.id)
      ? error.message
      : null;
  const status: "empty" | "loading" | "ready" | "error" = errorMessage
    ? "error"
    : entry && source && entry.sourceId === source.id
      ? "ready"
      : source
        ? "loading"
        : "empty";

  function acceptFile(file: File | undefined) {
    if (!file) return;
    if (!isSupportedFile(file.name)) {
      const message = `${file.name} isn't supported — use an ${SUPPORTED_EXTENSIONS.join(" or ")} file.`;
      setError({ sourceId: null, message });
      onErrorRef.current?.(message);
      return;
    }
    dropCount.current += 1;
    setError(null);
    setDropped({
      file,
      id: `file:${dropCount.current}:${file.name}`,
      overrides: srcId,
    });
  }

  function onDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    acceptFile(event.dataTransfer.files[0]);
  }

  const label = title ?? model?.label ?? null;

  return (
    <div
      className={[
        "relative isolate select-none overflow-hidden",
        "bg-[radial-gradient(120%_100%_at_50%_0%,#f8f8f9_0%,#e9e9ee_45%,#d3d3dc_100%)]",
        meetingMode
          ? "fixed inset-0 z-50 rounded-none"
          : `rounded-2xl border border-black/10 shadow-sm ${className ?? "h-[560px] w-full"}`,
      ].join(" ")}
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        camera={{ position: [0, 0.8, 3.4], fov: 38, near: 0.1, far: 100 }}
      >
        <StudioLighting />
        {model ? <RingModel model={model} metal={metal} /> : null}
        <ContactShadows
          position={[0, -1.08, 0]}
          scale={7}
          opacity={0.42}
          blur={2.6}
          far={2.5}
          resolution={512}
          color="#2a2a33"
        />
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={1.3}
          maxDistance={9}
          target={[0, 0, 0]}
        />
      </Canvas>

      {/* Top chrome */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          {label && !meetingMode ? (
            <div className="pointer-events-auto max-w-full truncate rounded-full bg-white/70 px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm backdrop-blur">
              {label}
              {model ? (
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  {model.triangleCount.toLocaleString()} tris
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          <ChromeButton
            onClick={() => controlsRef.current?.reset()}
            disabled={!model}
          >
            Reset view
          </ChromeButton>
          <ChromeButton onClick={() => setMeetingMode((on) => !on)}>
            {meetingMode ? "Exit (Esc)" : "Meeting mode"}
          </ChromeButton>
        </div>
      </div>

      {/* Material presets */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-2 p-4">
        {METAL_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => setMetalId(preset.id)}
            aria-pressed={preset.id === metalId}
            className={[
              "pointer-events-auto flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-sm font-medium backdrop-blur transition",
              preset.id === metalId
                ? "bg-white/90 text-zinc-900 shadow-md ring-1 ring-zinc-900/15"
                : "bg-white/55 text-zinc-600 hover:bg-white/80",
            ].join(" ")}
          >
            <span
              className="size-5 rounded-full ring-1 ring-black/10"
              style={{ background: preset.swatch }}
            />
            {preset.label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {!model && status !== "loading" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
          <div className="pointer-events-auto rounded-2xl border border-dashed border-zinc-400/70 bg-white/60 px-8 py-7 text-center backdrop-blur">
            <p className="text-base font-medium text-zinc-800">
              Drop a ring model here
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              STL or OBJ — auto-centered and scaled to fit
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
            >
              Browse files
            </button>
          </div>
        </div>
      ) : null}

      {/* Loading */}
      {status === "loading" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/30 backdrop-blur-[2px]">
          <div className="flex items-center gap-3 rounded-full bg-white/85 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm">
            <span className="size-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-800" />
            Loading model…
          </div>
        </div>
      ) : null}

      {/* Error — non-blocking, so the last good model stays on screen */}
      {errorMessage ? (
        <div className="pointer-events-none absolute inset-x-0 top-16 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border border-red-200 bg-white/95 px-4 py-3 shadow-lg">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-700">
                Couldn&apos;t load that model
              </p>
              <p className="mt-0.5 text-sm text-zinc-600">{errorMessage}</p>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      {/* Drag overlay */}
      {isDragging ? (
        <div className="pointer-events-none absolute inset-4 flex items-center justify-center rounded-xl border-2 border-dashed border-zinc-900/40 bg-white/50 backdrop-blur-[1px]">
          <p className="text-base font-medium text-zinc-800">
            Release to load model
          </p>
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept={SUPPORTED_EXTENSIONS.join(",")}
        className="hidden"
        onChange={(event) => {
          acceptFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}

function ChromeButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full bg-white/70 px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm backdrop-blur transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/**
 * Soft 3-point key/fill/rim plus a procedural studio environment built from
 * lightformers — polished metal is almost entirely reflection, and this keeps
 * those reflections local (no HDRI download at demo time).
 */
function StudioLighting() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[4, 6, 5]} intensity={2.4} />
      <directionalLight position={[-5, 2, 3]} intensity={0.9} />
      <directionalLight position={[0, 3, -6]} intensity={1.6} />
      <Environment resolution={256} frames={1}>
        <color attach="background" args={["#2b2b33"]} />
        <Lightformer form="rect" intensity={6} scale={[10, 4, 1]} position={[0, 6, 1]} />
        <Lightformer form="rect" intensity={3} scale={[8, 6, 1]} position={[-6, 1, 2]} />
        <Lightformer form="rect" intensity={2} scale={[8, 6, 1]} position={[6, 1, -2]} />
        <Lightformer form="ring" intensity={4} scale={4} position={[0, 1, -7]} />
      </Environment>
    </>
  );
}

function RingModel({
  model,
  metal,
}: {
  model: LoadedModel;
  metal: MetalPreset;
}) {
  return (
    <group>
      {model.geometries.map((geometry, index) => (
        <mesh key={index} geometry={geometry}>
          <meshStandardMaterial
            color={metal.color}
            metalness={metal.metalness}
            roughness={metal.roughness}
            envMapIntensity={metal.envMapIntensity}
          />
        </mesh>
      ))}
    </group>
  );
}
