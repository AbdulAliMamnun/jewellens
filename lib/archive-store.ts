import { create } from "zustand";

import { postJson } from "@/lib/api-call";

import {
  guessPartMaterial,
  type PartIdentity,
  type PartMaterial,
  type PartState,
} from "@/lib/archive-parts";
import type { ResolvedOperation } from "@/lib/archive-step";
import {
  LARGE_FILE_BYTES,
  ModelLoadError,
  disposeModel,
  formatFromName,
  isSupportedFile,
  loadModelFromFile,
  loadModelFromUrl,
  type LoadedModel,
  type LoadPhase,
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
  /** What the loader is doing, so a blocking parse doesn't look like a freeze. */
  phase: LoadPhase | null;
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

  /** The file's own structure. Empty until the model has been parsed once. */
  parts: (PartIdentity & { triangleCount: number })[];
  /** True when the file carried more than one addressable component. */
  hasParts: boolean;
  /** Per-part visibility, material and scale — the archive edit state. */
  partStates: Record<string, PartState>;
  /** Whole-piece scale, from set_ring_size. */
  modelScale: number;
  /** What the piece is assumed to be before any resize. */
  assumedRingSize: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ArchiveStore {
  entries: ArchiveEntry[];
  activeId: string | null;
  /** Parsed geometry, keyed by entry id. Capped at MAX_RETAINED_MODELS. */
  models: Record<string, LoadedModel>;
  /** Transient message about the last drop, e.g. files that were skipped. */
  notice: string | null;

  /** Conversation about the active piece. */
  messages: ChatMessage[];
  pending: boolean;
  chatError: string | null;
  unhandled: string[];
  /** The last edit asked for, so a failed turn can be retried in one click. */
  lastMessage: string | null;

  addFiles: (files: File[]) => Promise<void>;
  addSample: (url: string, name: string) => Promise<void>;
  select: (id: string) => Promise<void>;
  confirmOversized: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  remove: (id: string) => void;
  clearAll: () => void;
  dismissNotice: () => void;

  setPartState: (entryId: string, partId: string, patch: Partial<PartState>) => void;
  setAllMetalParts: (entryId: string, metal: PartMaterial) => void;
  resetEdits: (entryId: string) => void;
  applyOperations: (entryId: string, operations: ResolvedOperation[]) => void;
  sendArchiveMessage: (text: string) => Promise<void>;
  retryLastMessage: () => Promise<void>;
  dismissChatError: () => void;
}

let entryCounter = 0;
const nextEntryId = () => `entry-${(entryCounter += 1)}`;

let messageCounter = 0;
const nextMessageId = () => `am${(messageCounter += 1)}`;

/** How many prior turns are sent as context with each archive step. */
const HISTORY_TURNS = 6;

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

    patch(id, { status: "loading", progress: 0, phase: "reading", error: null });
    await yieldToBrowser();

    try {
      const onProgress = (progress: number) => patch(id, { progress });
      const onPhase = (phase: LoadPhase) => patch(id, { phase });

      const model = entry.file
        ? await loadModelFromFile(entry.file, { onProgress, onPhase })
        : entry.url
          ? await loadModelFromUrl(entry.url, { onProgress, onPhase })
          : null;

      if (!model) throw new ModelLoadError("parse", `${entry.name} is no longer available.`);

      retain(id, model);
      const parts = model.parts.map((part) => ({
        id: part.id,
        name: part.name,
        layerPath: part.layerPath,
        definitionName: part.definitionName,
        objectNames: part.objectNames,
        triangleCount: part.triangleCount,
      }));
      // Keep any edits the user already made to this piece across a re-parse
      // (an LRU eviction re-reads the file, and part ids are deterministic).
      const existing = get().entries.find((candidate) => candidate.id === id);
      const partStates: Record<string, PartState> = {};
      for (const part of model.parts) {
        partStates[part.id] = existing?.partStates[part.id] ?? {
          visible: true,
          material: part.material,
          scale: 1,
        };
      }

      patch(id, {
        parts,
        hasParts: model.hasParts,
        partStates,
        status: "ready",
        progress: 1,
        phase: null,
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
      patch(id, { status: "error", progress: 0, phase: null, error: toEntryError(cause) });
    }
  }

  return {
    entries: [],
    activeId: null,
    models: {},
    notice: null,
    messages: [],
    pending: false,
    chatError: null,
    unhandled: [],
    lastMessage: null,

    dismissNotice: () => set({ notice: null }),

    addFiles: async (files) => {
      const supported = files.filter((file) => isSupportedFile(file.name));
      const skipped = files.length - supported.length;

      if (supported.length === 0) {
        set({
          notice:
            files.length === 0
              ? "Nothing came through in that drop."
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
        phase: null,
        triangleCount: null,
        sizeMm: null,
        unitLabel: null,
        unitAssumed: false,
        skippedSummary: null,
        instancePlacements: 0,
        error: null,
        parts: [],
        hasParts: false,
        partStates: {},
        modelScale: 1,
        assumedRingSize: 7,
        file,
        url: null,
      }));

      set((state) => ({
        entries: [...state.entries, ...created],
        notice:
          skipped > 0
            ? `Left out ${skipped} file(s) that aren't STL, OBJ or 3DM.`
            : null,
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
        phase: null,
        triangleCount: null,
        sizeMm: null,
        unitLabel: null,
        unitAssumed: false,
        skippedSummary: null,
        instancePlacements: 0,
        error: null,
        parts: [],
        hasParts: false,
        partStates: {},
        modelScale: 1,
        assumedRingSize: 7,
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

    setPartState: (entryId, partId, patch_) =>
      set((state) => ({
        entries: state.entries.map((entry) =>
          entry.id === entryId
            ? {
                ...entry,
                partStates: {
                  ...entry.partStates,
                  [partId]: { ...entry.partStates[partId], ...patch_ },
                },
              }
            : entry,
        ),
      })),

    setAllMetalParts: (entryId, material) =>
      set((state) => ({
        entries: state.entries.map((entry) => {
          if (entry.id !== entryId) return entry;
          const partStates = { ...entry.partStates };
          for (const [partId, partState] of Object.entries(partStates)) {
            // Only metal parts follow the metal chips; stones keep their colour.
            if (partState.material.kind === "metal") {
              partStates[partId] = { ...partState, material };
            }
          }
          return { ...entry, partStates };
        }),
      })),

    resetEdits: (entryId) =>
      set((state) => ({
        entries: state.entries.map((entry) => {
          if (entry.id !== entryId) return entry;
          const model = state.models[entryId];
          const partStates: Record<string, PartState> = {};
          for (const part of entry.parts) {
            const fromModel = model?.parts.find((candidate) => candidate.id === part.id);
            partStates[part.id] = {
              visible: true,
              material: fromModel?.material ?? guessPartMaterial(part),
              scale: 1,
            };
          }
          return { ...entry, partStates, modelScale: 1, assumedRingSize: 7 };
        }),
      })),

    applyOperations: (entryId, operations) =>
      set((state) => ({
        entries: state.entries.map((entry) => {
          if (entry.id !== entryId) return entry;
          const partStates = { ...entry.partStates };
          let modelScale = entry.modelScale;
          let assumedRingSize = entry.assumedRingSize;

          const update = (partId: string, patch_: Partial<PartState>) => {
            const current = partStates[partId];
            if (!current) return;
            partStates[partId] = { ...current, ...patch_ };
          };

          for (const operation of operations) {
            switch (operation.op) {
              case "hide_parts":
                for (const id of operation.partIds) update(id, { visible: false });
                break;
              case "show_parts":
                for (const id of operation.partIds) update(id, { visible: true });
                break;
              case "set_part_material":
                for (const id of operation.partIds) {
                  update(id, { material: operation.material });
                }
                break;
              case "scale_part":
                for (const id of operation.partIds) {
                  update(id, { scale: partStates[id]?.scale ?? 1 });
                  update(id, { scale: (partStates[id]?.scale ?? 1) * operation.factor });
                }
                break;
              case "set_ring_size":
                // Resizing scales the whole piece, stones included.
                modelScale = operation.factor;
                assumedRingSize = operation.to;
                break;
            }
          }

          return { ...entry, partStates, modelScale, assumedRingSize };
        }),
      })),

    dismissChatError: () => set({ chatError: null }),

    sendArchiveMessage: async (text) => {
      const trimmed = text.trim();
      if (!trimmed || get().pending) return;

      const entry = get().entries.find((candidate) => candidate.id === get().activeId);
      if (!entry || entry.status !== "ready") {
        set({ chatError: "Load a design before editing it." });
        return;
      }

      const briefHistory = get()
        .messages.slice(-HISTORY_TURNS)
        .map((message) => ({ role: message.role, content: message.content }));

      set((state) => ({
        messages: [
          ...state.messages,
          { id: nextMessageId(), role: "user", content: trimmed },
        ],
        pending: true,
        chatError: null,
        unhandled: [],
        lastMessage: trimmed,
      }));

      try {
        const payload = await postJson<unknown>("/api/archive-step", {
          parts: entry.parts.map((part) => ({
            id: part.id,
            name: part.name,
            layerPath: part.layerPath,
            definitionName: part.definitionName,
            objectNames: part.objectNames,
          })),
          hasParts: entry.hasParts,
          assumedRingSize: entry.assumedRingSize,
          userMessage: trimmed,
          briefHistory,
        });

        const data = payload as {
          operations: ResolvedOperation[];
          assistantNote: string;
          unhandled?: string[];
        };

        if (data.operations?.length) get().applyOperations(entry.id, data.operations);

        set((state) => ({
          messages: [
            ...state.messages,
            { id: nextMessageId(), role: "assistant", content: data.assistantNote },
          ],
          unhandled: data.unhandled ?? [],
          pending: false,
        }));
      } catch (cause) {
        set({
          pending: false,
          chatError:
            cause instanceof Error ? cause.message : "That didn't go through — try again.",
        });
      }
    },

    /** Re-sends the last edit asked for, without retyping it. */
    retryLastMessage: async () => {
      const last = get().lastMessage;
      if (!last) return;
      set((state) => ({
        messages: state.messages.filter(
          (message, index) =>
            !(index === state.messages.length - 1 && message.content === last),
        ),
      }));
      await get().sendArchiveMessage(last);
    },

    clearAll: () => {
      recency = [];
      set((state) => {
        for (const model of Object.values(state.models)) disposeModel(model);
        return {
          entries: [],
          models: {},
          activeId: null,
          notice: null,
          messages: [],
          unhandled: [],
          chatError: null,
          lastMessage: null,
          pending: false,
        };
      });
    },
  };
});
