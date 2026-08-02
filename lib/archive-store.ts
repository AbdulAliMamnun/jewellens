import { create } from "zustand";

import {
  LARGE_FILE_BYTES,
  ModelLoadError,
  disposeModel,
  formatFromName,
  isSupportedFile,
  loadModelFromFile,
  loadModelFromUrl,
  type LoadedModel,
  type ModelFormat,
  type ModelLoadErrorCode,
} from "@/lib/model-loader";

/**
 * How many parsed models stay resident. Geometry for a 50MB .3dm can be tens of
 * megabytes on the GPU, and a studio archive drop can be dozens of files — so
 * older ones are released and re-parsed from the retained File on demand.
 */
const MAX_RETAINED_MODELS = 4;

export type EntryStatus =
  | "queued"
  | "loading"
  | "ready"
  | "error"
  /** Over the size threshold: parsed only after the user confirms. */
  | "oversized";

export interface ArchiveEntry {
  id: string;
  name: string;
  format: ModelFormat | null;
  sizeBytes: number;
  status: EntryStatus;
  /** 0..1 while loading. */
  progress: number;
  triangleCount: number | null;
  sizeMm: { x: number; y: number; z: number } | null;
  unitLabel: string | null;
  unitAssumed: boolean;
  /** Geometry the file carried but that could not be drawn — null when all of it rendered. */
  skippedSummary: string | null;
  /** Instance references resolved into placements (.3dm only). */
  instancePlacements: number;
  error: { code: ModelLoadErrorCode; message: string; detail?: string } | null;
  /** Retained so an evicted model can be re-parsed without a re-upload. */
  file: File | null;
  url: string | null;
}

interface ArchiveStore {
  entries: ArchiveEntry[];
  activeId: string | null;
  /** Parsed geometry, keyed by entry id. Capped at MAX_RETAINED_MODELS. */
  models: Record<string, LoadedModel>;
  /** Transient message about the last drop, e.g. files that were skipped. */
  notice: string | null;

  addFiles: (files: File[]) => Promise<void>;
  addSample: (url: string, name: string) => Promise<void>;
  select: (id: string) => Promise<void>;
  confirmOversized: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  remove: (id: string) => void;
  clearAll: () => void;
  dismissNotice: () => void;
}

let entryCounter = 0;
const nextEntryId = () => `entry-${(entryCounter += 1)}`;

/** Most-recently-viewed first; drives eviction. */
let recency: string[] = [];

function touch(id: string) {
  recency = [id, ...recency.filter((entry) => entry !== id)];
}

/** Lets the browser paint progress between synchronous parses. */
const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

function toEntryError(cause: unknown): ArchiveEntry["error"] {
  if (cause instanceof ModelLoadError) {
    return { code: cause.code, message: cause.message, detail: cause.detail };
  }
  return {
    code: "parse",
    message: cause instanceof Error ? cause.message : "Could not load that file.",
  };
}

export const useArchiveStore = create<ArchiveStore>((set, get) => {
  /** Applies a partial update to one entry. */
  function patch(id: string, changes: Partial<ArchiveEntry>) {
    set((state) => ({
      entries: state.entries.map((entry) =>
        entry.id === id ? { ...entry, ...changes } : entry,
      ),
    }));
  }

  /** Stores a parsed model, evicting the least-recently-viewed beyond the cap. */
  function retain(id: string, model: LoadedModel) {
    touch(id);
    set((state) => {
      const models = { ...state.models, [id]: model };
      const keep = new Set(recency.slice(0, MAX_RETAINED_MODELS));
      for (const key of Object.keys(models)) {
        if (!keep.has(key) && key !== state.activeId) {
          disposeModel(models[key]);
          delete models[key];
        }
      }
      return { models };
    });
  }

  async function load(id: string) {
    const entry = get().entries.find((candidate) => candidate.id === id);
    if (!entry) return;

    patch(id, { status: "loading", progress: 0, error: null });
    await yieldToBrowser();

    try {
      const model = entry.file
        ? await loadModelFromFile(entry.file, {
            onProgress: (progress) => patch(id, { progress }),
          })
        : entry.url
          ? await loadModelFromUrl(entry.url)
          : null;

      if (!model) throw new ModelLoadError("parse", `${entry.name} is no longer available.`);

      retain(id, model);
      patch(id, {
        status: "ready",
        progress: 1,
        triangleCount: model.triangleCount,
        sizeMm: model.sizeMm,
        unitLabel: model.unitLabel,
        unitAssumed: model.unitAssumed,
        skippedSummary: model.skippedSummary,
        instancePlacements: model.instancePlacements,
        error: null,
      });
      if (!get().activeId) set({ activeId: id });
    } catch (cause) {
      patch(id, { status: "error", progress: 0, error: toEntryError(cause) });
    }
  }

  return {
    entries: [],
    activeId: null,
    models: {},
    notice: null,

    dismissNotice: () => set({ notice: null }),

    addFiles: async (files) => {
      const supported = files.filter((file) => isSupportedFile(file.name));
      const skipped = files.length - supported.length;

      if (supported.length === 0) {
        set({
          notice:
            files.length === 0
              ? "No files found in that drop."
              : `None of those ${files.length} file(s) are STL, OBJ or 3DM.`,
        });
        return;
      }

      const created: ArchiveEntry[] = supported.map((file) => ({
        id: nextEntryId(),
        name: file.name,
        format: formatFromName(file.name),
        sizeBytes: file.size,
        // Big files wait for a deliberate click rather than freezing the tab.
        status: file.size > LARGE_FILE_BYTES ? "oversized" : "queued",
        progress: 0,
        triangleCount: null,
        sizeMm: null,
        unitLabel: null,
        unitAssumed: false,
        skippedSummary: null,
        instancePlacements: 0,
        error: null,
        file,
        url: null,
      }));

      set((state) => ({
        entries: [...state.entries, ...created],
        notice: skipped > 0 ? `Skipped ${skipped} unsupported file(s).` : null,
      }));

      // Sequential: parsing is synchronous and CPU-bound, so running these in
      // parallel would just make every progress bar stall together.
      for (const entry of created) {
        if (entry.status === "queued") await load(entry.id);
      }
    },

    addSample: async (url, name) => {
      const existing = get().entries.find((entry) => entry.url === url);
      if (existing) {
        await get().select(existing.id);
        return;
      }

      const entry: ArchiveEntry = {
        id: nextEntryId(),
        name,
        format: formatFromName(name),
        sizeBytes: 0,
        status: "queued",
        progress: 0,
        triangleCount: null,
        sizeMm: null,
        unitLabel: null,
        unitAssumed: false,
        skippedSummary: null,
        instancePlacements: 0,
        error: null,
        file: null,
        url,
      };
      set((state) => ({ entries: [...state.entries, entry] }));
      await load(entry.id);
      set({ activeId: entry.id });
    },

    select: async (id) => {
      const entry = get().entries.find((candidate) => candidate.id === id);
      if (!entry) return;

      set({ activeId: id });
      touch(id);

      // Re-parse if this entry's geometry was evicted while it sat unviewed.
      if (!get().models[id] && entry.status === "ready") await load(id);
    },

    confirmOversized: async (id) => {
      patch(id, { status: "queued" });
      set({ activeId: id });
      await load(id);
    },

    retry: async (id) => {
      set({ activeId: id });
      await load(id);
    },

    remove: (id) => {
      recency = recency.filter((entry) => entry !== id);
      set((state) => {
        const models = { ...state.models };
        if (models[id]) {
          disposeModel(models[id]);
          delete models[id];
        }
        const entries = state.entries.filter((entry) => entry.id !== id);
        const activeId =
          state.activeId === id
            ? (entries.find((entry) => entry.status === "ready")?.id ?? null)
            : state.activeId;
        return { entries, models, activeId };
      });
    },

    clearAll: () => {
      recency = [];
      set((state) => {
        for (const model of Object.values(state.models)) disposeModel(model);
        return { entries: [], models: {}, activeId: null, notice: null };
      });
    },
  };
});
