/**
 * Structure-aware archive editing, checked without a browser or an API key.
 *
 *   node scripts/make-test-3dm.mjs && node scripts/check-archive-parts.mjs
 *
 * COVERED: part grouping by layer and instance definition, layer paths, object
 * names, the material heuristics, free-text part matching, disambiguation, and
 * operation resolution including ring-size scaling.
 *
 * NOT COVERED: whether Claude emits sensible operations (no key here), and
 * anything visual — per-part scaling about a centre, stone shading, the panel.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import rhino3dm from "rhino3dm";

import { extractRenderMeshes } from "../lib/rhino-extract.ts";
import {
  guessPartMaterial,
  listPartNames,
  matchParts,
  normalizeTerm,
} from "../lib/archive-parts.ts";
import { resolveOperations, materialFromValue } from "../lib/archive-step.ts";
import { ringSizeScaleFactor } from "../lib/ring-size.ts";
import {
  flatArchivePrompt,
  structuredArchivePrompt,
} from "../lib/archive-prompt.ts";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "models",
  "test-3dm",
);

let failures = 0;
const check = (name, condition, detail = "") => {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const rhino = await rhino3dm();

function load(name) {
  const path = join(FIXTURES, name);
  if (!existsSync(path)) {
    console.error(`missing fixture ${name} — run: node scripts/make-test-3dm.mjs`);
    process.exit(1);
  }
  return extractRenderMeshes(
    rhino,
    rhino.File3dm.fromByteArray(new Uint8Array(readFileSync(path))),
  );
}

// --- 1. structure survives extraction --------------------------------------
console.log("\nstructured-ring-mm.3dm — part grouping");
const structured = load("structured-ring-mm.3dm");
const byName = Object.fromEntries(structured.parts.map((part) => [part.name, part]));

check("eight objects collapse into four parts", structured.parts.length === 4,
  `${structured.parts.length} parts`);
check("shank is its own part", Boolean(byName["Shank"]));
check("centre stone is its own part", Boolean(byName["Center Stone"]));
check("halo is its own part", Boolean(byName["Halo Stones"]));
check("the prong definition is one part, not four", Boolean(byName["Prong"]));

check(
  "nested layer paths are preserved",
  byName["Center Stone"]?.layerPath === "Ring::Head::Center Stone",
  byName["Center Stone"]?.layerPath,
);
check(
  "object names are kept",
  byName["Halo Stones"]?.objectNames.join(",") === "Halo Melee 1,Halo Melee 2",
  byName["Halo Stones"]?.objectNames.join(","),
);
check(
  "the instance definition name is recorded",
  byName["Prong"]?.definitionName === "Prong",
);
check(
  "all four prong placements land in the one part",
  byName["Prong"]?.objectNames.length === 4,
  String(byName["Prong"]?.objectNames.length),
);
check(
  "triangles are summed per part",
  byName["Halo Stones"]?.triangleCount === 12,
  String(byName["Halo Stones"]?.triangleCount),
);
check(
  "part ids are deterministic across reloads",
  load("structured-ring-mm.3dm").parts.map((p) => p.id).join("|") ===
    structured.parts.map((p) => p.id).join("|"),
);

// A file with no layer structure collapses to one part — nothing to edit.
const flat = load("band-mm.3dm");
check("an unstructured file yields a single part", flat.parts.length === 1);

// --- 2. material heuristics -------------------------------------------------
console.log("\nmaterial heuristics");
const material = (part) => guessPartMaterial(part);

check(
  "centre stone reads as a stone, not metal",
  material(byName["Center Stone"]).kind === "stone",
  JSON.stringify(material(byName["Center Stone"])),
);
check("halo melee reads as a stone", material(byName["Halo Stones"]).kind === "stone");
check("shank reads as metal", material(byName["Shank"]).kind === "metal");
check("prongs read as metal", material(byName["Prong"]).kind === "metal");

const named = (name, layerPath = null) => ({
  id: name,
  name,
  layerPath,
  definitionName: null,
  objectNames: [],
});

const cases = [
  ["Ruby Center", "stone", "ruby"],
  ["Blue Sapphire", "stone", "sapphire"],
  ["Emerald", "stone", "emerald"],
  ["Emerald Cut Diamond", "stone", "diamond"],
  ["Diamonds", "stone", "diamond"],
  ["Gemstones", "stone", "diamond"],
  ["Pave Melee", "stone", "diamond"],
  ["Shank", "metal", null],
  ["Prongs", "metal", null],
  ["Bezel", "metal", null],
  ["Head", "metal", null],
  ["Gallery Rail", "metal", null],
  ["Untitled Layer", "metal", null],
];
for (const [name, kind, color] of cases) {
  const guess = material(named(name));
  const detail = JSON.stringify(guess);
  check(`"${name}" → ${kind}${color ? `/${color}` : ""}`,
    guess.kind === kind && (kind === "metal" || guess.color === color), detail);
}

check(
  "the leaf layer wins over its parents",
  // "Head" would pull toward metal; the leaf says stone.
  material(named("Center", "Ring::Head::Center Stone")).kind === "stone",
);

// --- 3. matching ------------------------------------------------------------
console.log("\npart matching");
const parts = structured.parts;

const resolvedTo = (query) => {
  const match = matchParts(parts, query);
  return match.kind === "resolved" ? match.parts.map((part) => part.name) : match.kind;
};

check("exact name", resolvedTo("Shank").join(",") === "Shank");
check("case-insensitive", resolvedTo("shank").join(",") === "Shank");
check("centre/center spelling", resolvedTo("centre stone").join(",") === "Center Stone");
check("token order", resolvedTo("stone center").join(",") === "Center Stone");
check("matches an object name", resolvedTo("Shank Body").join(",") === "Shank");
check("matches a definition name", resolvedTo("prong").join(",") === "Prong");
check("matches a layer path segment", resolvedTo("halo").join(",") === "Halo Stones");
check("no match reports none", resolvedTo("engraving") === "none");
check(
  "a term hitting differently-named parts is ambiguous",
  matchParts(parts, "stone").kind === "ambiguous",
  matchParts(parts, "stone").kind,
);
check(
  "the ambiguity lists the candidates",
  /Center Stone|Halo Stones/.test(listPartNames(matchParts(parts, "stone").candidates)),
  listPartNames(matchParts(parts, "stone").candidates ?? []),
);
check("normalizeTerm folds punctuation and spelling",
  normalizeTerm("Centre-Stone!") === "center stone", normalizeTerm("Centre-Stone!"));

// --- 4. operation resolution ------------------------------------------------
console.log("\noperation resolution");
{
  const result = resolveOperations(parts, [
    { op: "hide_parts", match: "halo" },
    { op: "set_part_material", match: "center stone", material: "sapphire" },
    { op: "scale_part", match: "shank", factor: 1.1 },
    { op: "set_ring_size", from: 7, to: 8 },
  ]);

  check("nothing ambiguous in the sample turn", result.disambiguation === null);
  check("all four operations resolve", result.resolved.length === 4);
  check("nothing unmatched", result.unmatched.length === 0);

  const [hide, material_, scale, resize] = result.resolved;
  check("hide targets the halo part", hide.partNames.join(",") === "Halo Stones");
  check(
    "material targets the centre stone as a sapphire",
    material_.partNames.join(",") === "Center Stone" &&
      material_.material.kind === "stone" &&
      material_.material.color === "sapphire",
  );
  check("scale targets the shank at 1.1", scale.partNames.join(",") === "Shank" && scale.factor === 1.1);
  check(
    "ring size 7→8 becomes the diameter ratio",
    Math.abs(resize.factor - ringSizeScaleFactor(7, 8)) < 1e-9 &&
      Math.abs(resize.factor - 18.163 / 17.35) < 1e-3,
    String(resize.factor),
  );
}

check(
  "one ambiguous match blocks the whole turn",
  (() => {
    const result = resolveOperations(parts, [
      { op: "hide_parts", match: "shank" },
      { op: "set_part_material", match: "stone", material: "ruby" },
    ]);
    return result.resolved.length === 0 && /which did you mean/i.test(result.disambiguation);
  })(),
);

check(
  "a structureless file resolves any reference to its single part",
  (() => {
    const single = [{ id: "model", name: "Whole model", layerPath: null, definitionName: null, objectNames: [] }];
    const result = resolveOperations(single, [{ op: "set_part_material", match: "model", material: "rose_gold" }]);
    return result.resolved.length === 1 && result.resolved[0].partIds[0] === "model";
  })(),
);

check(
  "an unmatched reference is reported, not applied",
  (() => {
    const result = resolveOperations(parts, [{ op: "hide_parts", match: "filigree" }]);
    return result.resolved.length === 0 && result.unmatched.join(",") === "filigree";
  })(),
);

check(
  "runaway scale factors are clamped",
  resolveOperations(parts, [{ op: "scale_part", match: "shank", factor: 50 }])
    .resolved[0].factor === 4,
);
check(
  "material values map to the right kind",
  materialFromValue("rose_gold").kind === "metal" &&
    materialFromValue("ruby").kind === "stone",
);

// --- 5. prompts -------------------------------------------------------------
console.log("\narchive prompts");
{
  const structuredPrompt = structuredArchivePrompt(parts, 7);
  check("structured prompt lists every part", parts.every((part) =>
    structuredPrompt.includes(`"${part.name}"`)));
  check("structured prompt includes layer paths",
    structuredPrompt.includes("Ring::Head::Center Stone"));
  check("structured prompt documents all five operations",
    ["hide_parts", "show_parts", "set_part_material", "scale_part", "set_ring_size"]
      .every((op) => structuredPrompt.includes(op)));
  check("structured prompt states the assumed size", /US size 7/.test(structuredPrompt));
  check(
    "structured prompt sends geometry changes to the designer",
    /rebuild/i.test(structuredPrompt) && /bezel/i.test(structuredPrompt) &&
      /prong style|prong count/i.test(structuredPrompt),
  );

  const flatPrompt = flatArchivePrompt(7);
  check(
    "flat prompt offers the .3dm upgrade in the exact words",
    flatPrompt.includes("upload the .3dm for part-level control"),
  );
  check("flat prompt frames it as an offer, not an apology",
    /as an offer, not an apology/i.test(flatPrompt));
  check("flat prompt withholds hide/show", !flatPrompt.includes("hide_parts"));
  check("flat prompt still allows whole-model ops",
    flatPrompt.includes("set_part_material") && flatPrompt.includes("set_ring_size"));
  check("flat prompt also covers rebuilds", /rebuild/i.test(flatPrompt));
}

console.log(
  failures === 0 ? "\nAll archive-part checks passed." : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
