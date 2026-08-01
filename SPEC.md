# SPEC — JewelLens MVP (Weekend Build)

## Product
This app is called **JewelLens**. Brand name lives in `lib/brand.ts` (export APP_NAME = "JewelLens") and is used in the page title and header. Keep all branding referenced from that one file.

## Goal
A demo-ready web app for a custom jewelry studio: upload their Excel catalog + CAD/mesh files, then during sales meetings, type a natural-language prompt to instantly retrieve and display matching ring designs in an interactive 3D viewer.

**Demo success criterion:** upload Excel → type "oval solitaire, rose gold, around 2 carats" → matching ring renders in 3D, rotatable/zoomable, in under 3 seconds.

## Out of scope for this build (do NOT implement)
- CAD editing / regeneration of any kind
- User accounts, auth, billing
- Cloud storage (local/in-memory is fine for the demo)
- .3dm parsing (STL/OBJ only this weekend; rhino3dm integration is a later ticket)

## Stack
- Next.js 14+ (App Router, TypeScript, Tailwind) — single app, API routes for LLM calls
- three.js (with @react-three/fiber + @react-three/drei for OrbitControls, staging)
- SheetJS (xlsx) for Excel parsing, client-side
- Anthropic API (claude-sonnet-4-6) via API route; structured JSON outputs only

## Features

### F1 — 3D Viewer
- Component: `<RingViewer />`
- Loads STL (and OBJ) files; drag-and-drop plus programmatic load by file path/URL
- OrbitControls (rotate/zoom/pan), soft studio lighting (drei `<Stage>` or 3-point setup)
- Material presets toggleable in UI: yellow gold, rose gold, white gold/platinum (metalness ~1.0, tuned roughness; rose gold ≈ #b76e79, yellow gold ≈ #d4a843)
- Neutral gradient background; subtle ground shadow; auto-center and auto-scale loaded mesh to fit view
- "Meeting mode" button: full-screen viewer, minimal chrome

### F2 — Excel Ingestion + Learned Schema
- Upload .xlsx/.csv; parse client-side; show raw preview table (first 10 rows)
- API route `/api/profile-schema`: send headers + up to 30 sample rows to Claude; response must be strict JSON:
```json
{
  "columns": [
    {
      "name": "Metal",
      "role": "categorical_filter" | "numeric_range" | "identifier" | "file_link" | "text",
      "canonical_label": "metal",
      "values": [{"canonical": "rose gold", "variants": ["RG", "Rose Gold", "14k rose"]}],
      "range": {"min": 0.5, "max": 4.0}
    }
  ],
  "file_link_column": "CAD Link",
  "notes": "..."
}
```
- Confirmation screen: show inferred roles + proposed value groupings; user can rename labels, merge/split groups, override roles; then commit
- Committed catalog held in app state (Zustand or React context); persist to localStorage is NOT allowed (Claude.ai artifact rule does not apply here — this is a local Next.js app, so localStorage IS fine if convenient)

### F3 — Prompt → Retrieval
- Search bar, prominent, meeting-friendly (large text)
- API route `/api/parse-query`: prompt + committed schema (columns, canonical values, ranges) → strict JSON filter:
```json
{
  "filters": {"stone_shape": ["oval"], "metal": ["rose gold"]},
  "ranges": {"carat": {"min": 1.7, "max": 2.3}},
  "sort": null,
  "unmatched_terms": ["hidden halo"]
}
```
- "around X" on numeric columns → ±15% band
- Apply filter to catalog rows; show results as a card grid (design id + key attributes); clicking a card loads its linked model file into `<RingViewer />`
- If `unmatched_terms` non-empty, show them as a dismissible chip ("couldn't match: hidden halo") — never silently drop
- Zero results → show nearest relaxation suggestion (drop one filter, widen range)

### F4 — Demo assets
- `/public/models/` with 3 sample ring STLs (placeholder note: download from Thingiverse manually)
- `/public/demo-catalog.xlsx` generator script (`scripts/make-mock-catalog.ts`): 30 rows, columns: Design ID, Style, Metal, Stone Shape, Carat, Setting, Notes, CAD Link (pointing at the 3 STLs, cycled); deliberately messy values: mixed casing, abbreviations ("RG", "YG"), one typo, one blank cell

## API route rules
- ANTHROPIC_API_KEY from env (.env.local, gitignored)
- Every Claude call: system prompt demands JSON only, no markdown fences; parse with fence-stripping fallback; on parse failure retry once, then surface an error toast
- Temperature 0 for both schema profiling and query parsing

## Quality bar
- Type-safe throughout; no `any` on the schema/filter types
- Loading states on every async action; errors as toasts, never blank screens
- Works in Chrome desktop; don't spend time on mobile
- Commit after each feature (F1–F4) with a working state

## Build order
F1 → F4 (mock assets) → F2 → F3 → polish meeting mode → record demo
