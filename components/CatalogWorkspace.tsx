"use client";

import { useRef, useState } from "react";

import ArchiveSidebar from "@/components/ArchiveSidebar";
import ArchiveViewer from "@/components/ArchiveViewer";
import CatalogChat from "@/components/CatalogChat";
import CatalogUpload from "@/components/CatalogUpload";
import DesignerViewer from "@/components/DesignerViewer";
import FilterPanel from "@/components/FilterPanel";
import ResultsStrip from "@/components/ResultsStrip";
import SchemaConfirmation from "@/components/SchemaConfirmation";
import { useArchiveStore } from "@/lib/archive-store";
import { useCatalogStore } from "@/lib/catalog-store";
import { SUPPORTED_EXTENSIONS } from "@/lib/model-loader";

/** One line about the loaded catalog, with the way back to the column editor. */
function CatalogBar({ onDesign }: { onDesign: () => void }) {
  const parsed = useCatalogStore((state) => state.parsed);
  const rows = useCatalogStore((state) => state.rows);
  const reopen = useCatalogStore((state) => state.reopen);
  const reset = useCatalogStore((state) => state.reset);
  const addFiles = useArchiveStore((state) => state.addFiles);

  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const missing = rows.filter((row) => row.link.status === "missing").length;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 className="text-sm font-semibold tracking-tight text-zinc-900">
        {parsed?.fileName}
      </h2>
      <p className="text-xs text-zinc-500">
        {rows.length.toLocaleString()} designs
        {missing > 0 ? ` · ${missing} file${missing > 1 ? "s" : ""} not found` : ""}
      </p>
      <button
        type="button"
        onClick={reopen}
        className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100"
      >
        Edit columns
      </button>
      <button
        type="button"
        onClick={reset}
        className="rounded-full px-3 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
      >
        Load another catalog
      </button>

      {/* Dropping a file mid-meeting is still first-class here: it joins the pool
          the catalog resolves against, so a row that was missing lights up. */}
      <button
        type="button"
        onClick={() => filesInputRef.current?.click()}
        className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100"
      >
        Add files
      </button>
      <button
        type="button"
        onClick={() => folderInputRef.current?.click()}
        className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100"
      >
        Add folder
      </button>

      <button
        type="button"
        onClick={onDesign}
        className="ml-auto rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700"
      >
        Design something new
      </button>

      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept={SUPPORTED_EXTENSIONS.join(",")}
        className="hidden"
        onChange={(event) => {
          void addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      {/* webkitdirectory is the only way to pick a whole folder from a dialog. */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error — non-standard but supported in every target browser
        webkitdirectory=""
        className="hidden"
        onChange={(event) => {
          void addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </div>
  );
}

/**
 * The app's primary screen. A studio starts by loading its catalog; filtering,
 * the viewer and the archive tools all live inside this one screen rather than
 * beside it.
 */
export default function CatalogWorkspace() {
  const stage = useCatalogStore((state) => state.stage);
  const [designing, setDesigning] = useState(false);

  if (stage === "confirming") return <SchemaConfirmation />;
  if (stage !== "committed") return <CatalogUpload />;

  if (designing) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setDesigning(false)}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100"
          >
            ← Back to the catalog
          </button>
        </div>
        <DesignerViewer />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <CatalogBar onDesign={() => setDesigning(true)} />

      <div className="flex min-w-0 gap-4">
        <div className="flex w-64 shrink-0 flex-col gap-4">
          <FilterPanel />
          <ArchiveSidebar />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <ResultsStrip />
          {/* One prompt box under the viewer — it both retrieves and edits. */}
          <ArchiveViewer
            footerExtra={
              <div className="mx-auto w-full max-w-2xl">
                <CatalogChat />
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
