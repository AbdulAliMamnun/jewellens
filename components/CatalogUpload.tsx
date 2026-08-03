"use client";

import { useRef, useState } from "react";

import { PREVIEW_ROWS } from "@/lib/catalog-parse";
import { useCatalogStore } from "@/lib/catalog-store";

/** The synthetic fixture, so the app is demonstrable with no studio file at hand. */
const SAMPLE_CATALOG_URL = "/test-catalog.xlsx";

export default function CatalogUpload() {
  const stage = useCatalogStore((state) => state.stage);
  const parsed = useCatalogStore((state) => state.parsed);
  const busy = useCatalogStore((state) => state.busy);
  const error = useCatalogStore((state) => state.error);
  const loadFile = useCatalogStore((state) => state.loadFile);
  const loadFromUrl = useCatalogStore((state) => state.loadFromUrl);
  const profile = useCatalogStore((state) => state.profile);
  const reset = useCatalogStore((state) => state.reset);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const previewRows = parsed ? parsed.rows.slice(0, PREVIEW_ROWS) : [];

  return (
    <section className="mx-auto w-full max-w-4xl">
      <header className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
          Load your catalog
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Drop the spreadsheet you already keep your designs in — .xlsx or .csv. It
          is read in your browser; only the column names and a{" "}
          <strong className="font-medium text-zinc-800">30-row sample</strong> are
          sent to Claude to work out the shape of the sheet. The catalog itself
          never leaves this machine.
        </p>
      </header>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void loadFile(file);
        }}
        className={[
          "flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition",
          dragging ? "border-zinc-900 bg-zinc-100" : "border-zinc-300 bg-white",
        ].join(" ")}
      >
        <p className="text-sm font-medium text-zinc-800">
          Drop a spreadsheet here
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50"
          >
            Choose file
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void loadFromUrl(SAMPLE_CATALOG_URL, "test-catalog.xlsx")}
            className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50"
          >
            Load sample catalog
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadFile(file);
            event.target.value = "";
          }}
        />
        {busy ? (
          <p className="text-xs text-zinc-500">
            {stage === "profiling"
              ? "Reading the columns with Claude…"
              : "Parsing…"}
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-800">{error}</p>
          {stage === "parsed" ? (
            <button
              type="button"
              onClick={() => void profile()}
              className="mt-2 rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-800 transition hover:bg-red-100"
            >
              Try profiling again
            </button>
          ) : null}
        </div>
      ) : null}

      {parsed ? (
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white">
          <div className="flex items-baseline justify-between border-b border-zinc-200 px-4 py-3">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-zinc-900">
                {parsed.fileName}
              </h3>
              <p className="mt-0.5 text-xs text-zinc-500">
                {parsed.rows.length.toLocaleString()} rows · {parsed.headers.length}{" "}
                columns
                {parsed.sheetName ? ` · sheet “${parsed.sheetName}”` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={reset}
              className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
            >
              Clear
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 text-zinc-500">
                <tr>
                  {parsed.headers.map((header) => (
                    <th key={header} className="whitespace-nowrap px-3 py-2 font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-zinc-700">
                {previewRows.map((row, index) => (
                  <tr key={index} className="border-t border-zinc-100">
                    {parsed.headers.map((header) => (
                      <td key={header} className="whitespace-nowrap px-3 py-1.5">
                        {row[header] || (
                          <span className="text-zinc-300">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {parsed.rows.length > previewRows.length ? (
            <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-400">
              Showing the first {previewRows.length} of{" "}
              {parsed.rows.length.toLocaleString()} rows.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
