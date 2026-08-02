"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import ViewerShell from "@/components/ViewerShell";
import { filesFromDrop } from "@/lib/file-drop";
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
  /**
   * Controlled mode: when supplied (including `null`), the viewer renders this
   * model and does no loading of its own. Uncontrolled callers — passing only
   * `src` or dropping a file — keep the original behaviour.
   */
  model?: LoadedModel | null;
  /** Controlled loading indicator. */
  busy?: boolean;
  /** Replaces the empty state, e.g. an actionable message about the last file. */
  notice?: ReactNode;
  /**
   * Receives every dropped or browsed file, including the contents of dropped
   * folders. Supplying this switches drops from single-file to multi-file.
   */
  onFiles?: (files: File[]) => void;
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
  model: controlledModel,
  busy,
  notice,
  onFiles,
}: RingViewerProps) {
  const isControlled = controlledModel !== undefined;
  const [dropped, setDropped] = useState<{
    file: File;
    id: string;
    /** The `src` this drop takes precedence over; a new `src` wins again. */
    overrides: string;
  } | null>(null);
  const [entry, setEntry] = useState<LoadedEntry | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [metalId, setMetalId] = useState<MetalId>(DEFAULT_METAL);
  const [isDragging, setIsDragging] = useState(false);

  const dragDepth = useRef(0);
  const dropCount = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  });

  const srcId = src ? `url:${srcKey ?? src}` : "none";

  // The active source is derived, never mirrored into state: a drop wins until
  // the caller points the viewer at a different model.
  const source = useMemo<ModelSource | null>(() => {
    if (isControlled) return null;
    if (dropped && dropped.overrides === srcId) {
      return { id: dropped.id, kind: "file", file: dropped.file };
    }
    return src ? { id: srcId, kind: "url", url: src } : null;
  }, [dropped, isControlled, src, srcId]);

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

  const metal = getMetalPreset(metalId);
  const model = isControlled ? controlledModel : (entry?.model ?? null);
  const errorMessage = isControlled
    ? null
    : error && (error.sourceId === null || error.sourceId === source?.id)
      ? error.message
      : null;
  const status: "empty" | "loading" | "ready" | "error" = isControlled
    ? busy
      ? "loading"
      : model
        ? "ready"
        : "empty"
    : errorMessage
      ? "error"
      : entry && source && entry.sourceId === source.id
        ? "ready"
        : source
          ? "loading"
          : "empty";

  function acceptFiles(files: File[]) {
    if (files.length === 0) return;
    if (onFiles) {
      onFiles(files);
      return;
    }

    const file = files[0];
    if (!isSupportedFile(file.name)) {
      const message = `${file.name} isn't supported — use an ${SUPPORTED_EXTENSIONS.join(", ")} file.`;
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

    if (!onFiles) {
      acceptFiles(Array.from(event.dataTransfer.files));
      return;
    }
    // Folders only surface through the entries API, and the DataTransfer is
    // neutered once this handler returns — so hand it over before awaiting.
    void filesFromDrop(event.dataTransfer).then(acceptFiles);
  }

  const label = title ?? model?.label ?? null;

  return (
    <ViewerShell
      className={className}
      canReset={Boolean(model)}
      scene={model ? <RingModel model={model} metal={metal} /> : null}
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      badge={
        label ? (
          <div className="pointer-events-auto max-w-full truncate rounded-full bg-white/70 px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm backdrop-blur">
            {label}
            {model ? (
              <span className="ml-2 text-xs font-normal text-zinc-500">
                {model.triangleCount.toLocaleString()} tris
              </span>
            ) : null}
          </div>
        ) : null
      }
      footer={METAL_PRESETS.map((preset) => (
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
      overlay={
        <>
          {!model && status !== "loading" ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
              <div className="pointer-events-auto max-w-md rounded-2xl border border-dashed border-zinc-400/70 bg-white/70 px-8 py-7 text-center backdrop-blur">
                {notice ?? (
                  <>
                    <p className="text-base font-medium text-zinc-800">
                      {onFiles
                        ? "Drop ring models or a folder here"
                        : "Drop a ring model here"}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      STL, OBJ or 3DM — auto-centered and scaled to fit
                    </p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-4 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
                    >
                      Browse files
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : null}

          {status === "loading" ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/30 backdrop-blur-[2px]">
              <div className="flex items-center gap-3 rounded-full bg-white/85 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm">
                <span className="size-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-800" />
                Loading model…
              </div>
            </div>
          ) : null}

          {/* Errors stay non-blocking, so the last good model stays on screen */}
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

          {isDragging ? (
            <div className="pointer-events-none absolute inset-4 flex items-center justify-center rounded-xl border-2 border-dashed border-zinc-900/40 bg-white/50 backdrop-blur-[1px]">
              <p className="text-base font-medium text-zinc-800">
                {onFiles ? "Release to add to this session" : "Release to load model"}
              </p>
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            multiple={Boolean(onFiles)}
            accept={SUPPORTED_EXTENSIONS.join(",")}
            className="hidden"
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </>
      }
    />
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
