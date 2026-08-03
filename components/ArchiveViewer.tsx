"use client";

import type { ReactNode } from "react";

import ArchiveChat from "@/components/ArchiveChat";
import PartsPanel from "@/components/PartsPanel";
import RingViewer from "@/components/RingViewer";
import { useArchiveStore } from "@/lib/archive-store";

/**
 * The viewer half of the workspace: whatever design is currently active, its
 * parts panel, and the chat that edits it. Extracted from the old standalone
 * workbench so the catalog screen can host it directly.
 */
export default function ArchiveViewer({ footerExtra }: { footerExtra?: ReactNode }) {
  const entries = useArchiveStore((state) => state.entries);
  const activeId = useArchiveStore((state) => state.activeId);
  const models = useArchiveStore((state) => state.models);
  const addFiles = useArchiveStore((state) => state.addFiles);
  const setAllMetalParts = useArchiveStore((state) => state.setAllMetalParts);

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

  return (
    <div className="flex min-w-0 flex-1 gap-4">
      <div className="min-w-0 flex-1">
        <RingViewer
          model={activeModel}
          busy={busy}
          notice={notice}
          onFiles={(files) => void addFiles(files)}
          title={activeEntry?.name ?? null}
          partStates={activeEntry?.partStates}
          modelScale={activeEntry?.modelScale ?? 1}
          onMetalChange={(metal) => {
            if (activeEntry) {
              setAllMetalParts(activeEntry.id, { kind: "metal", metal });
            }
          }}
          footerExtra={
            footerExtra ??
            (activeEntry?.status === "ready" ? (
              <div className="mx-auto w-full max-w-2xl">
                <ArchiveChat hasParts={activeEntry.hasParts} />
              </div>
            ) : null)
          }
        />
      </div>
      {activeEntry?.status === "ready" ? <PartsPanel entryId={activeEntry.id} /> : null}
    </div>
  );
}
