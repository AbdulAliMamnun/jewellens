"use client";

import { useRef, useState } from "react";

import ArchiveChat from "@/components/ArchiveChat";
import ArchiveSidebar from "@/components/ArchiveSidebar";
import PartsPanel from "@/components/PartsPanel";
import DesignerViewer from "@/components/DesignerViewer";
import RingViewer from "@/components/RingViewer";
import { useArchiveStore } from "@/lib/archive-store";
import { SUPPORTED_EXTENSIONS } from "@/lib/model-loader";

/**
 * Placeholder until F4 drops real ring STLs into /public/models/.
 * F3 will drive the viewer the same way: pass the catalog row's file link as `src`.
 */
const SAMPLE_MODELS = [
  {
    id: "placeholder-ring",
    label: "Placeholder ring",
    url: "/models/placeholder-ring.stl",
  },
] as const;

type Mode = "archive" | "design";

export default function ViewerWorkbench() {
  const [mode, setMode] = useState<Mode>("archive");

  const entries = useArchiveStore((state) => state.entries);
  const activeId = useArchiveStore((state) => state.activeId);
  const models = useArchiveStore((state) => state.models);
  const addFiles = useArchiveStore((state) => state.addFiles);
  const addSample = useArchiveStore((state) => state.addSample);
  const setAllMetalParts = useArchiveStore((state) => state.setAllMetalParts);

  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const activeEntry = entries.find((entry) => entry.id === activeId) ?? null;
  const activeModel = activeId ? (models[activeId] ?? null) : null;
  const busy = activeEntry?.status === "loading" || activeEntry?.status === "queued";

  // A .3dm with nothing drawable isn't a failure to hide in a toast — it's the
  // one thing the user has to act on, so it takes over the empty state.
  const notice =
    activeEntry?.status === "error" && activeEntry.error ? (
      <div className="text-left">
        <p className="text-base font-medium text-zinc-900">
          {activeEntry.error.message}
        </p>
        {activeEntry.error.detail ? (
          <p className="mt-2 text-sm leading-relaxed text-zinc-600">
            {activeEntry.error.detail}
          </p>
        ) : null}
      </div>
    ) : undefined;

  function handleFiles(files: File[]) {
    setMode("archive");
    void addFiles(files);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-500">Archive:</span>
        {SAMPLE_MODELS.map((sample) => (
          <button
            key={sample.id}
            type="button"
            onClick={() => {
              setMode("archive");
              void addSample(sample.url, sample.label);
            }}
            className="rounded-full border border-zinc-300 bg-white px-3.5 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50"
          >
            {sample.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => filesInputRef.current?.click()}
          className="rounded-full border border-zinc-300 bg-white px-3.5 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50"
        >
          Upload files
        </button>
        <button
          type="button"
          onClick={() => folderInputRef.current?.click()}
          className="rounded-full border border-zinc-300 bg-white px-3.5 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50"
        >
          Upload folder
        </button>
        <span className="text-sm text-zinc-400">…or drop files/folders on the viewer</span>

        <button
          type="button"
          onClick={() => setMode("design")}
          aria-pressed={mode === "design"}
          className={[
            "ml-auto rounded-full px-4 py-2 text-sm font-medium transition",
            mode === "design"
              ? "bg-zinc-900 text-white shadow-sm ring-2 ring-zinc-900/20"
              : "bg-zinc-900 text-white hover:bg-zinc-700",
          ].join(" ")}
        >
          Design something new
        </button>
      </div>

      {mode === "design" ? (
        <DesignerViewer />
      ) : (
        <div className="flex gap-4">
          <ArchiveSidebar />
          <div className="min-w-0 flex-1">
            <RingViewer
              model={activeModel}
              busy={busy}
              notice={notice}
              onFiles={handleFiles}
              title={activeEntry?.name ?? null}
              partStates={activeEntry?.partStates}
              modelScale={activeEntry?.modelScale ?? 1}
              onMetalChange={(metal) => {
                if (activeEntry) {
                  setAllMetalParts(activeEntry.id, { kind: "metal", metal });
                }
              }}
              footerExtra={
                activeEntry?.status === "ready" ? (
                  <div className="mx-auto w-full max-w-2xl">
                    <ArchiveChat hasParts={activeEntry.hasParts} />
                  </div>
                ) : null
              }
            />
          </div>
          {activeEntry?.status === "ready" ? (
            <PartsPanel entryId={activeEntry.id} />
          ) : null}
        </div>
      )}

      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept={SUPPORTED_EXTENSIONS.join(",")}
        className="hidden"
        onChange={(event) => {
          handleFiles(Array.from(event.target.files ?? []));
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
          handleFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </div>
  );
}
