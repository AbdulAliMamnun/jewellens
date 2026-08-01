# SPEC ADDENDUM — Conversational Ring Designer (Monday Demo Centerpiece)

Extends SPEC.md. This feature is the priority; if time runs out, cut F2 (Excel ingestion) before cutting any of this.

## Goal
The user describes a ring in natural language, piece by piece, and a procedurally generated 3D ring updates live after each message. Also supports basic live edits on loaded archive (STL) files.

**Demo success criterion:** "oval solitaire, rose gold" → ring appears → "make the band thinner" → band thins → "six prongs" → prongs update → "add a halo" → halo appears. Each change renders in under 3 seconds with a smooth transition.

## D1 — Parametric Ring Generator (procedural three.js)
A `ParametricRing` component that generates ring geometry entirely in code from a typed parameter object:

```ts
interface RingParams {
  ringSize: number;            // US size 3–13, maps to inner diameter (size 7 = 17.35mm)
  bandWidthMm: number;         // 1.5–8
  bandThicknessMm: number;     // 1–3
  bandProfile: "flat" | "rounded" | "knife-edge";
  metal: "yellow_gold" | "rose_gold" | "white_gold" | "platinum";
  stoneShape: "round" | "oval" | "cushion" | "emerald" | "pear" | "none";
  stoneCarat: number;          // 0.25–5, maps to stone dimensions via lookup table
  stoneColor: "diamond" | "sapphire" | "ruby" | "emerald";
  prongCount: 0 | 4 | 6;
  halo: boolean;
  paveBand: boolean;           // small stones along top half of band
}
```

Implementation notes:
- Band: swept/lathed geometry (TorusGeometry acceptable for rounded; ExtrudeGeometry along a circle for profiles)
- Stones: approximations are fine — round = cone+pavilion or IcosahedronGeometry with flat table; oval/cushion/emerald/pear = scaled/modified variants. Faceted look via flatShading + high-refraction-look material (MeshPhysicalMaterial, transmission or high clearcoat)
- Prongs: small tapered cylinders positioned around the stone, count from params
- Halo: ring of ~12–16 small round stones around the center stone
- Pavé: small stones instanced along the band's top arc
- Carat → mm lookup (round: 0.5ct=5.1mm, 1ct=6.4mm, 1.5ct=7.4mm, 2ct=8.1mm, 3ct=9.3mm; interpolate; other shapes scale from round)
- All geometry regenerates on param change; animate transitions where cheap (material color lerp, scale tweens). Full regeneration with a 200ms crossfade is acceptable.

## D2 — Conversational parameter engine
- Zustand store holds `currentParams: RingParams` (sensible defaults: size 7, 2mm rounded band, yellow gold, 1ct round, 4 prongs, no halo)
- Chat-style input under/beside the viewer with running message history displayed
- API route `/api/design-step`: request = { currentParams, userMessage, briefHistory }. Claude (claude-sonnet-4-6, temperature 0) returns STRICT JSON:
```json
{
  "updatedParams": { ...full RingParams object... },
  "changed": ["stoneShape", "metal"],
  "assistantNote": "Switched to an oval stone in rose gold.",
  "unhandled": ["filigree"]
}
```
- System prompt for the route: you are a jewelry design parameter mapper; map the user's request onto the RingParams schema ONLY; never invent fields; if a request is outside the schema, list it in "unhandled" and leave params unchanged for that aspect; interpret jewelry vocabulary (solitaire = single stone no halo/pavé; dainty = thin band; chunky/bold = wide thick band; hidden halo ≈ halo=true; eternity band ≈ paveBand=true stoneShape=none).
- UI: highlight what changed after each step (brief glow on the changed controls); show assistantNote as the reply; show unhandled terms as a neutral chip ("not yet supported: filigree — phase 2")
- Every param also gets a manual control (sliders/toggles in a collapsible panel) that stays in sync — lets him grab a slider mid-demo, and proves the state is real

## D3 — Archive edit mode (mesh transforms on loaded STLs)
When an STL from the catalog is loaded (vs the parametric ring), the same chat input routes to a reduced operation set:
```json
{ "operations": [
  {"op": "set_metal", "value": "rose_gold"},
  {"op": "scale_uniform", "factor": 1.1},
  {"op": "scale_axis", "axis": "y", "factor": 1.2},
  {"op": "set_ring_size", "from": 7, "to": 8}
]}
```
- set_ring_size = uniform scale by diameter ratio (state assumption visibly: "assuming current size 7")
- Unsupported requests on meshes ("change the prongs") → assistantNote explains: "detailed edits work on template designs — this archive piece supports size, proportions, and metal" and offers to open the parametric designer
- A clear mode indicator: "Archive piece — basic edits" vs "Template design — full editing"

## Demo flow (wire as the default home experience)
1. Search bar → catalog retrieval (F3) → archive ring loads → D3 edits ("rose gold", "size 8")
2. "Design something new" button → parametric ring (D1) → conversational design (D2)
3. Meeting Mode covers both.

## Guardrails
- All Claude calls: strict JSON, temperature 0, validate against a zod schema; on validation failure retry once then show error toast — never apply unvalidated params
- Params clamp to bounds after every update (never trust the model's arithmetic)
- No localStorage requirement; in-memory state is fine for the demo
