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
const after = params({ metal: "rose_gold", stoneShape: "oval", halo: true });
const changed = diffRingParams(DEFAULT_RING_PARAMS, after);
check(
  "reports exactly the changed fields",
  changed.length === 3 &&
    ["metal", "stoneShape", "halo"].every((key) => changed.includes(key)),
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

console.log(
  failures === 0 ? "\nAll design-step checks passed." : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
