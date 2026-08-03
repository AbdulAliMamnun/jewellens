import { create } from "zustand";

import { useArchiveStore } from "@/lib/archive-store";
import {
  parseCatalogFile,
  sampleForProfiling,
  CatalogParseError,
  type ParsedCatalog,
} from "@/lib/catalog-parse";
import {
  canonicalFor,
  cellText,
  parseNumeric,
  schemaProfileSchema,
  type ColumnProfile,
  type ColumnRole,
  type SchemaProfile,
} from "@/lib/catalog-schema";
import {
  EMPTY_FILTERS,
  bestMatch,
  matchRows,
  type FilterState,
  type MatchResult,
} from "@/lib/catalog-filter";
import {
  resolveLink,
  type LinkResolution,
  type ResolvableFile,
} from "@/lib/file-resolution";

/** A catalog row with everything the dashboard needs precomputed. */
export interface CatalogRow {
  index: number;
  raw: Record<string, string>;
  /** Canonical value per categorical column, keyed by column name. */
  canonical: Record<string, string>;
  /** Parsed number per numeric column, keyed by column name. */
  numeric: Record<string, number | null>;
  identifier: string;
  link: LinkResolution;
}

export type CatalogStage = "empty" | "parsed" | "profiling" | "confirming" | "committed";

interface CatalogStore {
  stage: CatalogStage;
  parsed: ParsedCatalog | null;
  /** Editable profile shown on the confirmation screen. */
  draft: SchemaProfile | null;
  /** What was committed — what the dashboard and the query parser use. */
  schema: SchemaProfile | null;
  rows: CatalogRow[];
  /** Files a link can resolve against: the archive folder plus session uploads. */
  pool: ResolvableFile[];
  error: string | null;
  busy: boolean;

  /** Filter state — the widgets and the chat both drive exactly this. */
  filters: FilterState;
  /** Rows on screen, plus what (if anything) had to be given up to find them. */
  results: MatchResult<CatalogRow>;
  /** The row the viewer is showing. */
  selectedIndex: number | null;

  loadFile: (file: File) => Promise<void>;
  loadFromUrl: (url: string, label: string) => Promise<void>;
  profile: () => Promise<void>;
  updateColumn: (name: string, patch: Partial<ColumnProfile>) => void;
  renameGroup: (column: string, canonical: string, next: string) => void;
  mergeGroups: (column: string, from: string, into: string) => void;
  splitVariant: (column: string, canonical: string, variant: string) => void;
  setFileLinkColumn: (name: string | null) => void;
  commit: () => void;
  reopen: () => void;
  reset: () => void;
  setPool: (pool: ResolvableFile[]) => void;
  refreshArchivePool: () => Promise<void>;

  toggleValue: (column: string, value: string) => void;
  setValues: (column: string, values: string[]) => void;
  setRange: (column: string, range: { min: number; max: number } | null) => void;
  setFilters: (filters: FilterState) => void;
  clearFilters: () => void;
  selectRow: (index: number) => void;
}

/**
 * Puts a catalog row's file in the viewer. A row whose file is missing is not an
 * error — the viewer simply keeps showing what it had, and the results strip
 * says why that row can't be opened.
 */
async function loadRow(row: CatalogRow): Promise<void> {
  const source = row.link.source;
  if (!source) return;
  const archive = useArchiveStore.getState();
  if (source.kind === "session") await archive.select(source.entryId);
  else await archive.addSample(source.url, row.identifier || source.name);
}

/** Recomputes the per-row projections whenever the schema or the pool changes. */
function buildRows(
  parsed: ParsedCatalog,
  schema: SchemaProfile,
  pool: readonly ResolvableFile[],
): CatalogRow[] {
  const identifierColumn =
    schema.columns.find((column) => column.role === "identifier")?.name ??
    parsed.headers[0];

  return parsed.rows.map((raw, index) => {
    const canonical: Record<string, string> = {};
    const numeric: Record<string, number | null> = {};

    for (const column of schema.columns) {
      if (column.role === "categorical_filter") {
        canonical[column.name] = canonicalFor(column, cellText(raw, column.name));
      } else if (column.role === "numeric_range") {
        numeric[column.name] = parseNumeric(cellText(raw, column.name));
      }
    }

    const link = resolveLink(
      schema.file_link_column ? cellText(raw, schema.file_link_column) : "",
      pool,
    );

    return {
      index,
      raw,
      canonical,
      numeric,
      identifier: cellText(raw, identifierColumn) || `Row ${index + 1}`,
      link,
    };
  });
}

export const useCatalogStore = create<CatalogStore>((set, get) => {
  /**
   * Re-runs the filters and puts the best match in the viewer. Every path that
   * can change what should be on screen ends here — a chip, a slider, the chat,
   * a newly resolved file — so the widgets and the conversation can never
   * disagree about what is being shown.
   */
  function applyFilters() {
    const { rows, filters, selectedIndex } = get();
    const results = matchRows(rows, filters);

    // Keep the current design if it survived the change; otherwise open the best
    // match immediately. A filter that doesn't load a ring isn't a filter.
    const keep =
      selectedIndex !== null &&
      results.rows.some((row) => row.index === selectedIndex);
    const target = keep ? (rows[selectedIndex] ?? null) : bestMatch(results.rows);

    set({ results, selectedIndex: target ? target.index : null });
    if (!keep && target) void loadRow(target);
  }

  function rebuild() {
    const { parsed, schema, pool } = get();
    if (!parsed || !schema) return;
    set({ rows: buildRows(parsed, schema, pool) });
    applyFilters();
  }

  /** Applies a change to one column of the draft. */
  function editColumn(name: string, edit: (column: ColumnProfile) => ColumnProfile) {
    set((state) => {
      if (!state.draft) return {};
      return {
        draft: {
          ...state.draft,
          columns: state.draft.columns.map((column) =>
            column.name === name ? edit(column) : column,
          ),
        },
      };
    });
  }

  async function ingest(parsed: ParsedCatalog) {
    set({ parsed, stage: "parsed", draft: null, schema: null, rows: [], error: null });
    await get().refreshArchivePool();
    await get().profile();
  }

  return {
    stage: "empty",
    parsed: null,
    draft: null,
    schema: null,
    rows: [],
    pool: [],
    error: null,
    busy: false,
    filters: EMPTY_FILTERS,
    results: { rows: [], relaxed: [], exact: true },
    selectedIndex: null,

    setPool: (pool) => {
      set({ pool });
      rebuild();
    },

    refreshArchivePool: async () => {
      try {
        const response = await fetch("/api/archive-files");
        if (!response.ok) return;
        const data = (await response.json()) as {
          files?: { name: string; url: string }[];
        };
        const archive: ResolvableFile[] = (data.files ?? []).map((file) => ({
          kind: "archive",
          name: file.name,
          url: file.url,
        }));
        set((state) => ({
          pool: [...state.pool.filter((file) => file.kind !== "archive"), ...archive],
        }));
        rebuild();
      } catch {
        // An unreachable listing just means nothing resolves from the folder.
      }
    },

    loadFile: async (file) => {
      set({ busy: true, error: null });
      try {
        const parsed = parseCatalogFile(file.name, await file.arrayBuffer());
        await ingest(parsed);
      } catch (cause) {
        set({
          busy: false,
          stage: "empty",
          error:
            cause instanceof CatalogParseError || cause instanceof Error
              ? cause.message
              : "Could not read that spreadsheet.",
        });
      }
    },

    loadFromUrl: async (url, label) => {
      set({ busy: true, error: null });
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not load ${label} (HTTP ${response.status}).`);
        const parsed = parseCatalogFile(label, await response.arrayBuffer());
        await ingest(parsed);
      } catch (cause) {
        set({
          busy: false,
          stage: "empty",
          error: cause instanceof Error ? cause.message : "Could not load that catalog.",
        });
      }
    },

    profile: async () => {
      const parsed = get().parsed;
      if (!parsed) return;

      set({ stage: "profiling", busy: true, error: null });
      try {
        const response = await fetch("/api/profile-schema", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Only the headers and the sample leave the browser.
          body: JSON.stringify({
            headers: parsed.headers,
            sampleRows: sampleForProfiling(parsed),
          }),
        });

        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            payload && typeof payload === "object" && "error" in payload
              ? String((payload as { error: unknown }).error)
              : `Profiling failed (${response.status}).`;
          throw new Error(message);
        }

        const validated = schemaProfileSchema.safeParse(payload);
        if (!validated.success) throw new Error("The profiler returned an unexpected shape.");

        set({ draft: validated.data, stage: "confirming", busy: false });
      } catch (cause) {
        set({
          busy: false,
          stage: "parsed",
          error: cause instanceof Error ? cause.message : "Could not profile that catalog.",
        });
      }
    },

    updateColumn: (name, patch) => {
      editColumn(name, (column) => {
        const next = { ...column, ...patch };
        // Roles carry different payloads; drop the parts that no longer apply.
        if (next.role !== "categorical_filter") next.values = [];
        if (next.role !== "numeric_range") next.range = null;
        return next;
      });
      // Only one column can be the file link, and it has to still hold that role.
      if (patch.role === "file_link") {
        get().setFileLinkColumn(name);
      } else if (patch.role && get().draft?.file_link_column === name) {
        set((state) =>
          state.draft ? { draft: { ...state.draft, file_link_column: null } } : {},
        );
      }
    },

    renameGroup: (column, canonical, next) =>
      editColumn(column, (current) => ({
        ...current,
        values: current.values.map((value) =>
          value.canonical === canonical ? { ...value, canonical: next } : value,
        ),
      })),

    mergeGroups: (column, from, into) =>
      editColumn(column, (current) => {
        const source = current.values.find((value) => value.canonical === from);
        if (!source || from === into) return current;
        return {
          ...current,
          values: current.values
            .filter((value) => value.canonical !== from)
            .map((value) =>
              value.canonical === into
                ? {
                    ...value,
                    // The merged group's own name becomes a variant of the target.
                    variants: [
                      ...new Set([...value.variants, source.canonical, ...source.variants]),
                    ],
                  }
                : value,
            ),
        };
      }),

    splitVariant: (column, canonical, variant) =>
      editColumn(column, (current) => {
        const group = current.values.find((value) => value.canonical === canonical);
        if (!group) return current;
        return {
          ...current,
          values: [
            ...current.values.map((value) =>
              value.canonical === canonical
                ? { ...value, variants: value.variants.filter((item) => item !== variant) }
                : value,
            ),
            { canonical: variant, variants: [] },
          ],
        };
      }),

    setFileLinkColumn: (name) =>
      set((state) => {
        if (!state.draft) return {};
        return {
          draft: {
            ...state.draft,
            file_link_column: name,
            columns: state.draft.columns.map((column) => {
              if (column.name === name) {
                return { ...column, role: "file_link" as ColumnRole, values: [], range: null };
              }
              return column.role === "file_link"
                ? { ...column, role: "text" as ColumnRole }
                : column;
            }),
          },
        };
      }),

    commit: () => {
      const { draft, parsed, pool } = get();
      if (!draft || !parsed) return;
      set({
        schema: draft,
        rows: buildRows(parsed, draft, pool),
        stage: "committed",
        error: null,
        filters: EMPTY_FILTERS,
        selectedIndex: null,
      });
      // Unfiltered is still a result set: the studio lands on a ring, not a blank
      // viewer waiting to be told what to do.
      applyFilters();
    },

    toggleValue: (column, value) => {
      const current = get().filters.categorical[column] ?? [];
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      get().setValues(column, next);
    },

    setValues: (column, values) => {
      set((state) => {
        const categorical = { ...state.filters.categorical };
        if (values.length === 0) delete categorical[column];
        else categorical[column] = values;
        return { filters: { ...state.filters, categorical } };
      });
      applyFilters();
    },

    setRange: (column, range) => {
      set((state) => {
        const numeric = { ...state.filters.numeric };
        if (range === null) delete numeric[column];
        else numeric[column] = range;
        return { filters: { ...state.filters, numeric } };
      });
      applyFilters();
    },

    setFilters: (filters) => {
      set({ filters });
      applyFilters();
    },

    clearFilters: () => {
      set({ filters: EMPTY_FILTERS });
      applyFilters();
    },

    selectRow: (index) => {
      const row = get().rows[index];
      if (!row) return;
      set({ selectedIndex: index });
      void loadRow(row);
    },

    reopen: () => set({ stage: "confirming" }),

    reset: () =>
      set({
        stage: "empty",
        parsed: null,
        draft: null,
        schema: null,
        rows: [],
        error: null,
        busy: false,
        filters: EMPTY_FILTERS,
        results: { rows: [], relaxed: [], exact: true },
        selectedIndex: null,
      }),
  };
});

/**
 * A file dropped on the viewer mid-meeting should make its catalog row load, so
 * session uploads join the resolvable pool as they become ready. Subscribing at
 * module scope keeps this out of a render effect — the two stores stay
 * independent, and no component has to remember to wire them together.
 */
useArchiveStore.subscribe((state) => {
  const session: ResolvableFile[] = state.entries
    .filter((entry) => entry.status === "ready")
    .map((entry) => ({ kind: "session", name: entry.name, entryId: entry.id }));

  const current = useCatalogStore
    .getState()
    .pool.filter((file) => file.kind === "session");

  const same =
    current.length === session.length &&
    current.every(
      (file, index) =>
        file.name === session[index].name &&
        file.kind === "session" &&
        file.entryId === (session[index] as { entryId: string }).entryId,
    );
  if (same) return;

  const catalog = useCatalogStore.getState();
  catalog.setPool([...catalog.pool.filter((file) => file.kind !== "session"), ...session]);
});
