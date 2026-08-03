"use client";

import CatalogUpload from "@/components/CatalogUpload";
import SchemaConfirmation from "@/components/SchemaConfirmation";
import ViewerWorkbench from "@/components/ViewerWorkbench";
import { useCatalogStore } from "@/lib/catalog-store";

/** One row per committed column, so the studio can see what the app is filtering on. */
function CommittedSummary() {
  const schema = useCatalogStore((state) => state.schema);
  const rows = useCatalogStore((state) => state.rows);
  const parsed = useCatalogStore((state) => state.parsed);
  const reopen = useCatalogStore((state) => state.reopen);
  const reset = useCatalogStore((state) => state.reset);

  if (!schema || !parsed) return null;

  const filters = schema.columns.filter((column) => column.role === "categorical_filter");
  const ranges = schema.columns.filter((column) => column.role === "numeric_range");
  const missing = rows.filter((row) => row.link.status === "missing").length;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900">
          {parsed.fileName}
        </h2>
        <p className="text-xs text-zinc-500">
          {rows.length.toLocaleString()} designs · {filters.length} filter
          {filters.length === 1 ? "" : "s"} · {ranges.length} range
          {ranges.length === 1 ? "" : "s"}
          {missing > 0 ? ` · ${missing} file${missing > 1 ? "s" : ""} not found` : ""}
        </p>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={reopen}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100"
          >
            Edit columns
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-full px-3 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
          >
            Load another
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {filters.map((column) => (
          <span
            key={column.name}
            className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-700"
          >
            {column.canonical_label}
            <span className="ml-1 text-zinc-400">{column.values.length}</span>
          </span>
        ))}
        {ranges.map((column) => (
          <span
            key={column.name}
            className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-700"
          >
            {column.canonical_label}
            <span className="ml-1 text-zinc-400">range</span>
          </span>
        ))}
      </div>

      {/* Step 2 replaces this line with the generated dashboard. */}
      <p className="mt-2 text-xs text-zinc-400">
        Filters and results appear here next.
      </p>
    </div>
  );
}

/**
 * The app's primary screen. A studio starts by loading its catalog; the viewer
 * and the archive tools live inside this screen rather than beside it.
 */
export default function CatalogWorkspace() {
  const stage = useCatalogStore((state) => state.stage);

  if (stage === "confirming") return <SchemaConfirmation />;

  if (stage === "committed") {
    return (
      <div className="flex flex-col gap-4">
        <CommittedSummary />
        <ViewerWorkbench />
      </div>
    );
  }

  return <CatalogUpload />;
}
