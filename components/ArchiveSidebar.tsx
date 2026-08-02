"use client";

import { useArchiveStore, type ArchiveEntry } from "@/lib/archive-store";
import { LARGE_FILE_BYTES } from "@/lib/model-loader";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDimensions(entry: ArchiveEntry): string | null {
  if (!entry.sizeMm) return null;
  const { x, y, z } = entry.sizeMm;
  const round = (value: number) => (value >= 10 ? value.toFixed(0) : value.toFixed(1));
  return `${round(x)} × ${round(y)} × ${round(z)} mm${entry.unitAssumed ? " (assumed)" : ""}`;
}

export default function ArchiveSidebar() {
  const entries = useArchiveStore((state) => state.entries);
  const activeId = useArchiveStore((state) => state.activeId);
  const notice = useArchiveStore((state) => state.notice);
  const select = useArchiveStore((state) => state.select);
  const confirmOversized = useArchiveStore((state) => state.confirmOversized);
  const retry = useArchiveStore((state) => state.retry);
  const remove = useArchiveStore((state) => state.remove);
  const clearAll = useArchiveStore((state) => state.clearAll);
  const dismissNotice = useArchiveStore((state) => state.dismissNotice);

  const ready = entries.filter((entry) => entry.status === "ready").length;

  return (
    <aside className="flex w-72 shrink-0 flex-col rounded-2xl border border-zinc-200 bg-white">
      <div className="flex items-baseline justify-between border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900">
          This session
        </h2>
        {entries.length > 0 ? (
          <button
            type="button"
            onClick={clearAll}
            className="rounded-full px-2 py-0.5 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
          >
            Clear
          </button>
        ) : null}
      </div>

      {notice ? (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          <span className="min-w-0">{notice}</span>
          <button
            type="button"
            onClick={dismissNotice}
            aria-label="Dismiss"
            className="ml-auto shrink-0 text-amber-500 transition hover:text-amber-900"
          >
            ✕
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {entries.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-zinc-400">
            Uploaded designs appear here. Drop files or a folder onto the viewer.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {entries.map((entry) => {
              const isActive = entry.id === activeId;
              const dimensions = formatDimensions(entry);

              return (
                <li key={entry.id}>
                  <div
                    className={[
                      "group rounded-xl border px-3 py-2 transition",
                      isActive
                        ? "border-zinc-900 bg-zinc-50"
                        : "border-transparent hover:border-zinc-200 hover:bg-zinc-50",
                    ].join(" ")}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => void select(entry.id)}
                        disabled={entry.status !== "ready"}
                        className="min-w-0 flex-1 text-left disabled:cursor-default"
                      >
                        <span className="block truncate text-sm font-medium text-zinc-800">
                          {entry.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-zinc-500">
                          {entry.status === "ready" && entry.triangleCount !== null
                            ? `${entry.triangleCount.toLocaleString()} tris`
                            : entry.status === "loading"
                              ? `Loading… ${Math.round(entry.progress * 100)}%`
                              : entry.status === "queued"
                                ? "Queued"
                                : entry.status === "oversized"
                                  ? `${formatBytes(entry.sizeBytes)} — large file`
                                  : "Failed"}
                          {entry.sizeBytes > 0 && entry.status === "ready"
                            ? ` · ${formatBytes(entry.sizeBytes)}`
                            : ""}
                        </span>
                        {dimensions && entry.status === "ready" ? (
                          <span className="mt-0.5 block text-xs text-zinc-400">
                            {dimensions}
                          </span>
                        ) : null}
                      </button>

                      <span className="mt-0.5 shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                        {entry.format ?? "?"}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(entry.id)}
                        aria-label={`Remove ${entry.name}`}
                        className="mt-0.5 shrink-0 rounded px-1 text-zinc-300 opacity-0 transition group-hover:opacity-100 hover:text-zinc-700"
                      >
                        ✕
                      </button>
                    </div>

                    {entry.status === "loading" ? (
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-200">
                        <div
                          className="h-full rounded-full bg-zinc-800 transition-[width] duration-150"
                          style={{ width: `${Math.max(4, entry.progress * 100)}%` }}
                        />
                      </div>
                    ) : null}

                    {entry.status === "oversized" ? (
                      <div className="mt-2">
                        <p className="text-xs text-amber-700">
                          Over {Math.round(LARGE_FILE_BYTES / 1024 / 1024)}MB — parsing
                          runs on the main thread and may freeze the tab for a few
                          seconds.
                        </p>
                        <button
                          type="button"
                          onClick={() => void confirmOversized(entry.id)}
                          className="mt-1.5 rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white transition hover:bg-zinc-700"
                        >
                          Load anyway
                        </button>
                      </div>
                    ) : null}

                    {entry.status === "error" && entry.error ? (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-red-700">
                          {entry.error.message}
                        </p>
                        {entry.error.detail ? (
                          <p className="mt-1 text-xs leading-snug text-zinc-600">
                            {entry.error.detail}
                          </p>
                        ) : null}
                        {entry.error.code !== "no-render-meshes" ? (
                          <button
                            type="button"
                            onClick={() => void retry(entry.id)}
                            className="mt-1.5 rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100"
                          >
                            Try again
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {entries.length > 0 ? (
        <p className="border-t border-zinc-200 px-4 py-2 text-xs text-zinc-400">
          {ready} of {entries.length} ready
        </p>
      ) : null}
    </aside>
  );
}
