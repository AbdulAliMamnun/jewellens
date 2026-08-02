/**
 * Verifies the /api/design-step response contract without calling Claude:
 * fence stripping, zod validation, clamping, and the changed-field diff.
 *
 *   node scripts/check-design-step.mjs
 */
import {
  designStepResponseSchema,
  extractJsonObject,
} from "../lib/design-step.ts";
import {
  DEFAULT_RING_PARAMS,
  clampRingParams,
  diffRingParams,
} from "../lib/ring-params.ts";
import {
  describeChangedFields,
  listClampAdjustments,
  reconcileNote,
} from "../lib/design-note.ts";

let failures = 0;
const check = (name, condition, detail = "") => {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const params = (overrides = {}) => ({ ...DEFAULT_RING_PARAMS, ...overrides });
const reply = (overrides = {}, extra = {}) =>
  JSON.stringify({
    updatedParams: params(overrides),
    changed: Object.keys(overrides),
    assistantNote: "Done.",
    unhandled: [],
    ...extra,
  });

// --- fence stripping / preamble tolerance --------------------------------
console.log("\nextractJsonObject");
const bare = reply({ metal: "rose_gold" });
check("bare JSON passes through", extractJsonObject(bare) === bare);
check(
  "```json fence stripped",
  extractJsonObject("```json\n" + bare + "\n```") === bare,
);
check("bare ``` fence stripped", extractJsonObject("```\n" + bare + "\n```") === bare);
check(
  "prose preamble dropped",
  extractJsonObject("Here you go:\n" + bare) === bare,
);
check(
  "trailing prose dropped",
  extractJsonObject(bare + "\n\nLet me know!") === bare,
);

// --- schema validation ----------------------------------------------------
console.log("\ndesignStepResponseSchema");
check(
  "valid reply accepted",
  designStepResponseSchema.safeParse(JSON.parse(bare)).success,
);

const withoutArrays = designStepResponseSchema.safeParse({
  updatedParams: params(),
  assistantNote: "Done.",
});
check(
  "missing changed/unhandled default to []",
  withoutArrays.success &&
    withoutArrays.data.changed.length === 0 &&
    withoutArrays.data.unhandled.length === 0,
);

const rejects = [
  ["unknown metal", { updatedParams: params({ metal: "brass" }), assistantNote: "x" }],
  ["prongCount 3", { updatedParams: params({ prongCount: 3 }), assistantNote: "x" }],
  ["missing assistantNote", { updatedParams: params() }],
  ["empty assistantNote", { updatedParams: params(), assistantNote: "" }],
  ["missing a param field", { updatedParams: { metal: "rose_gold" }, assistantNote: "x" }],
  ["carat as string", { updatedParams: params({ stoneCarat: "two" }), assistantNote: "x" }],
  ["NaN carat", { updatedParams: params({ stoneCarat: Number.NaN }), assistantNote: "x" }],
];
for (const [name, payload] of rejects) {
  check(`rejects ${name}`, !designStepResponseSchema.safeParse(payload).success);
}

// --- clamping (never trust the model's arithmetic) ------------------------
console.log("\nclampRingParams");
const wild = clampRingParams(
  params({ stoneCarat: 12, ringSize: 20, bandWidthMm: 40, bandThicknessMm: -3 }),
);
check("carat 12 → 5", wild.stoneCarat === 5, String(wild.stoneCarat));
check("ring size 20 → 13", wild.ringSize === 13, String(wild.ringSize));
check("band width 40 → 8", wild.bandWidthMm === 8, String(wild.bandWidthMm));
check("band thickness -3 → 1", wild.bandThicknessMm === 1, String(wild.bandThicknessMm));

const belowMin = clampRingParams(params({ stoneCarat: 0.01, ringSize: 1 }));
check("carat 0.01 → 0.25", belowMin.stoneCarat === 0.25);
check("ring size 1 → 3", belowMin.ringSize === 3);

// --- changed-field diff ---------------------------------------------------
console.log("\ndiffRingParams");
const after = params({ metal: "rose_gold", stoneShape: "oval", haloStyle: "standard" });
const changed = diffRingParams(DEFAULT_RING_PARAMS, after);
check(
  "reports exactly the changed fields",
  changed.length === 3 &&
    ["metal", "stoneShape", "haloStyle"].every((key) => changed.includes(key)),
  changed.join(","),
);
check(
  "no change → empty",
  diffRingParams(DEFAULT_RING_PARAMS, params()).length === 0,
);
check(
  "clamped-away change is not reported",
  // Model asks for 12ct while already at 5ct: after clamping nothing moved.
  diffRingParams(
    params({ stoneCarat: 5 }),
    clampRingParams(params({ stoneCarat: 12 })),
  ).length === 0,
);

// --- the reported bug: note said 1.5ct, store held 1.05ct ------------------
console.log("\nfull route pipeline (parse → validate → clamp → diff)");

/** Mirrors the ordering in app/api/design-step/route.ts. */
function runPipeline(currentParams, rawModelReply) {
  const candidate = JSON.parse(extractJsonObject(rawModelReply));
  const validated = designStepResponseSchema.safeParse(candidate);
  if (!validated.success) return { ok: false };
  const requested = validated.data.updatedParams;
  const applied = clampRingParams(requested);
  const changed = diffRingParams(currentParams, applied);
  const audit = reconcileNote(validated.data.assistantNote, applied, changed);
  return {
    ok: true,
    applied,
    changed,
    adjusted: listClampAdjustments(requested, applied),
    note: audit.note,
    rewritten: audit.rewritten,
    conflicts: audit.conflicts,
  };
}

// "1.5 carat oval solitaire in rose gold, thin rounded band, six prongs"
const requestedShape = {
  stoneCarat: 1.5,
  stoneShape: "oval",
  metal: "rose_gold",
  bandWidthMm: 1.6,
  bandThicknessMm: 1.1,
  bandProfile: "rounded",
  prongCount: 6,
  halo: false,
  paveBand: false,
};

const honest = runPipeline(
  DEFAULT_RING_PARAMS,
  reply(requestedShape, {
    assistantNote: "Set a 1.5ct oval solitaire in rose gold with six prongs.",
  }),
);
check("in-range carat survives validation + clamping", honest.applied.stoneCarat === 1.5,
  String(honest.applied.stoneCarat));
check("no clamp adjustments reported", honest.adjusted.length === 0);
check("consistent note is kept verbatim", honest.rewritten === false);
check(
  "changed lists every edited field",
  ["stoneCarat", "stoneShape", "metal", "bandWidthMm", "bandThicknessMm", "prongCount"].every(
    (key) => honest.changed.includes(key),
  ),
  honest.changed.join(","),
);

// The divergence as reported: params say 1.05, prose says 1.5.
const diverged = runPipeline(
  DEFAULT_RING_PARAMS,
  reply(
    { ...requestedShape, stoneCarat: 1.05 },
    { assistantNote: "Set a 1.5ct oval solitaire in rose gold with six prongs." },
  ),
);
check("applied carat is the one from updatedParams", diverged.applied.stoneCarat === 1.05);
check("contradicting note is rewritten", diverged.rewritten === true);
check("conflict is described", diverged.conflicts.some((c) => c.includes("carat")),
  diverged.conflicts.join("; "));
check(
  "replacement note states the applied carat",
  diverged.note.includes("1.05ct") && !diverged.note.includes("1.5ct"),
  diverged.note,
);

// Clamping is the other way applied state can diverge from the request.
const clamped = runPipeline(
  DEFAULT_RING_PARAMS,
  reply({ stoneCarat: 9 }, { assistantNote: "Set a 9ct centre stone." }),
);
check("out-of-range carat clamped to 5", clamped.applied.stoneCarat === 5);
check(
  "clamp adjustment surfaced",
  clamped.adjusted.length === 1 &&
    clamped.adjusted[0].field === "stoneCarat" &&
    clamped.adjusted[0].requested === "9" &&
    clamped.adjusted[0].applied === "5",
  JSON.stringify(clamped.adjusted),
);
check("note that quoted the pre-clamp figure is rewritten", clamped.rewritten === true);
check("rewritten note quotes 5.00ct", clamped.note.includes("5.00ct"), clamped.note);

// --- note reconciliation edge cases ---------------------------------------
console.log("\nreconcileNote");
const applied = { ...DEFAULT_RING_PARAMS, stoneCarat: 1.05, prongCount: 6, ringSize: 7 };

const keeps = [
  ["matching carat", "Set a 1.05ct oval in rose gold."],
  ["matching prongs", "Moved to six prongs for a more secure setting."],
  ["numeric prongs", "Moved to 6-prong."],
  ["matching size", "Kept it at size 7."],
  ["stone spread in mm", "That is roughly 6.4mm across."],
  ["no numbers at all", "Switched the metal to rose gold."],
  ["rounded ring size", "Sized to size 7 for you."],
];
for (const [name, note] of keeps) {
  check(`keeps note — ${name}`, reconcileNote(note, applied, []).rewritten === false, note);
}

const rewrites = [
  ["wrong carat", "Set a 1.5ct oval."],
  ["wrong carat word form", "Set a 2 carat oval."],
  ["wrong prong count", "Moved to four prongs."],
  ["wrong ring size", "Sized to size 9."],
];
for (const [name, note] of rewrites) {
  check(`rewrites note — ${name}`, reconcileNote(note, applied, ["stoneCarat"]).rewritten === true, note);
}

check(
  "no-op turn produces an honest note",
  describeChangedFields(applied, []).includes("Nothing changed"),
);

console.log(
  failures === 0 ? "\nAll design-step checks passed." : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
