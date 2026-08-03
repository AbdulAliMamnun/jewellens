/**
 * Catalog ingestion, checked against the synthetic fixture.
 *
 *   node scripts/make-test-catalog.mjs && node scripts/check-catalog.mjs
 *
 * COVERED offline: spreadsheet parsing (messy carats, blank cells), the sample
 * cap that keeps the catalog in the browser, canonical-value grouping, role
 * reconciliation for every role, and file-link resolution against the archive
 * folder + session uploads including the deliberate broken link.
 *
 * COVERED live (only with ANTHROPIC_API_KEY): role inference — whether Claude
 * actually labels the ID, file-link, categorical, numeric and text columns of a
 * real messy sheet correctly, and groups RG/rose gold/Rose Gold/14k rose.
 *
 * NOT COVERED: anything visual — the confirmation screen's merge/split controls
 * and the preview table.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseCatalogFile,
  sampleForProfiling,
  SAMPLE_ROWS,
} from "../lib/catalog-parse.ts";
import {
  canonicalFor,
  parseNumeric,
  normalizeValue,
  reconcileProfile,
  schemaProfileSchema,
  profileRequestSchema,
} from "../lib/catalog-schema.ts";
import { resolveLink, fileNameFromLink, resolutionBadge } from "../lib/file-resolution.ts";
import { PROFILE_SCHEMA_SYSTEM_PROMPT } from "../lib/profile-prompt.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "public", "test-catalog.xlsx");

let failures = 0;
const check = (name, condition, detail = "") => {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

if (!existsSync(FIXTURE)) {
  console.error(
    `Fixture missing: ${FIXTURE}\nRun: node scripts/make-test-catalog.mjs`,
  );
  process.exit(1);
}

// --- parsing --------------------------------------------------------------
console.log("\nparseCatalogFile");
const bytes = readFileSync(FIXTURE);
const catalog = parseCatalogFile(
  "test-catalog.xlsx",
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);

check("6 rows read", catalog.rows.length === 6, `got ${catalog.rows.length}`);
check(
  "8 headers read",
  catalog.headers.length === 8,
  catalog.headers.join(", "),
);
check(
  "headers keep their studio spelling",
  catalog.headers.includes("Stone Shape") && catalog.headers.includes("File Link"),
);
check(
  "values arrive as trimmed strings",
  catalog.rows.every((row) =>
    Object.values(row).every((value) => typeof value === "string"),
  ),
);
check(
  "blank cell stays blank rather than becoming a value",
  catalog.rows.some((row) => row["Setting"] === "") &&
    catalog.rows.some((row) => row["Stone Shape"] === ""),
);

// --- the privacy property -------------------------------------------------
console.log("\nsampleForProfiling");
const sample = sampleForProfiling(catalog);
check("sample never exceeds the cap", sample.length <= SAMPLE_ROWS);
check("small sheet samples whole", sample.length === catalog.rows.length);
check(
  "request shape validates",
  profileRequestSchema.safeParse({ headers: catalog.headers, sampleRows: sample })
    .success,
);
{
  // The cap is the promise: a 3,000-row catalog still sends 30 rows.
  const big = {
    ...catalog,
    rows: Array.from({ length: 3000 }, (_, index) => ({ "Design ID": `JL-${index}` })),
  };
  const capped = sampleForProfiling(big);
  check("3,000-row sheet still sends 30", capped.length === SAMPLE_ROWS);
  check(
    "sample spreads across the sheet, not just the top",
    capped.some((row) => Number(row["Design ID"].slice(3)) > 1500),
  );
  check(
    "over-cap request is rejected by the schema",
    !profileRequestSchema.safeParse({
      headers: catalog.headers,
      sampleRows: Array.from({ length: 31 }, () => ({ a: "b" })),
    }).success,
  );
}

// --- variant grouping -----------------------------------------------------
console.log("\ncanonical value grouping");
const metalColumn = {
  name: "Metal",
  role: "categorical_filter",
  canonical_label: "metal",
  values: [
    { canonical: "rose gold", variants: ["RG", "Rose Gold", "14k rose"] },
    { canonical: "yellow gold", variants: ["YG"] },
    { canonical: "platinum", variants: [] },
  ],
  range: null,
};

for (const [raw, expected] of [
  ["RG", "rose gold"],
  ["rose gold", "rose gold"],
  ["Rose Gold", "rose gold"],
  ["14k rose", "rose gold"],
  ["  rose  gold ", "rose gold"],
  ["YG", "yellow gold"],
  ["Platinum", "platinum"],
]) {
  check(`"${raw}" → ${expected}`, canonicalFor(metalColumn, raw) === expected);
}
check("blank maps to nothing", canonicalFor(metalColumn, "") === "");
check(
  "unlisted value survives as itself rather than vanishing",
  canonicalFor(metalColumn, "Palladium") === "Palladium",
);
check(
  "normalizeValue is case- and punctuation-insensitive",
  normalizeValue("18K White-Gold") === normalizeValue("18k white gold"),
);

const shapeColumn = {
  name: "Stone Shape",
  role: "categorical_filter",
  canonical_label: "stone_shape",
  values: [
    { canonical: "cushion", variants: [] },
    { canonical: "Cushon", variants: [] },
    { canonical: "oval", variants: [] },
  ],
  range: null,
};
check(
  "a likely typo stays its own value until the studio says otherwise",
  canonicalFor(shapeColumn, "Cushon") === "Cushon" &&
    canonicalFor(shapeColumn, "Cushion") === "cushion",
);

// Merging is what the confirmation screen does; the result must then collapse.
const merged = {
  ...shapeColumn,
  values: [
    { canonical: "cushion", variants: ["Cushon"] },
    { canonical: "oval", variants: [] },
  ],
};
check(
  "after a merge the typo folds into the real value",
  canonicalFor(merged, "Cushon") === "cushion",
);

// --- numbers as spreadsheets carry them -----------------------------------
console.log("\nparseNumeric");
for (const [raw, expected] of [
  ["1.5", 1.5],
  ["1.00 ct", 1],
  ["2.05ct", 2.05],
  [".75", 0.75],
  ["1 1/2", 1.5],
  ["3/4", 0.75],
  ["0", 0],
]) {
  const got = parseNumeric(raw);
  check(`"${raw}" → ${expected}`, Math.abs(got - expected) < 1e-9, `got ${got}`);
}
check("empty cell has no number", parseNumeric("") === null);
check("prose has no number", parseNumeric("call for pricing") === null);
check(
  "every fixture carat reads as a number",
  catalog.rows.every((row) => parseNumeric(row["Carat"]) !== null),
);

// --- role reconciliation --------------------------------------------------
console.log("\nreconcileProfile");
{
  const profile = schemaProfileSchema.parse({
    columns: [
      { name: "Design ID", role: "identifier", canonical_label: "design_id" },
      { name: "Ghost Column", role: "categorical_filter", canonical_label: "ghost" },
      { name: "File Link", role: "file_link", canonical_label: "file_link" },
      { name: "Notes", role: "file_link", canonical_label: "notes" },
    ],
    file_link_column: "File Link",
    notes: "",
  });
  const reconciled = reconcileProfile(profile, catalog.headers);

  check(
    "profile covers exactly the uploaded headers, in order",
    reconciled.columns.map((column) => column.name).join("|") ===
      catalog.headers.join("|"),
  );
  check(
    "a hallucinated column is dropped",
    !reconciled.columns.some((column) => column.name === "Ghost Column"),
  );
  check(
    "an unmentioned column arrives as text",
    reconciled.columns.find((column) => column.name === "Metal")?.role === "text",
  );
  check(
    "only one file_link survives",
    reconciled.columns.filter((column) => column.role === "file_link").length === 1,
  );
  check(
    "the second file_link falls back to text",
    reconciled.columns.find((column) => column.name === "Notes")?.role === "text",
  );

  const orphan = reconcileProfile(
    schemaProfileSchema.parse({
      columns: [{ name: "Design ID", role: "identifier", canonical_label: "id" }],
      file_link_column: "Nowhere",
      notes: "",
    }),
    catalog.headers,
  );
  check("a file_link naming nothing is cleared", orphan.file_link_column === null);
}

// --- file-link resolution -------------------------------------------------
console.log("\nresolveLink");
const pool = [
  {
    kind: "archive",
    name: "structured-ring-mm.3dm",
    url: "/models/archive/structured-ring-mm.3dm",
  },
  { kind: "archive", name: "band-mm.3dm", url: "/models/archive/band-mm.3dm" },
  {
    kind: "archive",
    name: "band-inches.3dm",
    url: "/models/archive/band-inches.3dm",
  },
  {
    kind: "archive",
    name: "placeholder-ring.stl",
    url: "/models/archive/placeholder-ring.stl",
  },
];

check(
  "filename pulled from a posix path",
  fileNameFromLink("/models/test-3dm/band-mm.3dm") === "band-mm.3dm",
);
check(
  "filename pulled from a Windows path",
  fileNameFromLink("C:\\Studio\\Designs\\Band-MM.3dm") === "band-mm.3dm",
);
check(
  "query strings are ignored",
  fileNameFromLink("https://cdn.example.com/a/band-mm.3dm?v=3") === "band-mm.3dm",
);

const resolutions = catalog.rows.map((row) => resolveLink(row["File Link"], pool));
check(
  "5 of the 6 fixture rows resolve",
  resolutions.filter((resolution) => resolution.status === "resolved").length === 5,
  resolutions.map((resolution) => resolution.status).join(","),
);
const broken = resolutions.find((resolution) => resolution.status === "missing");
check("the deliberate broken link is reported missing", Boolean(broken));
check(
  "a missing link gets the badge, not an exception",
  resolutionBadge(broken) === "file not found",
);
check(
  "a resolved link gets no badge",
  resolutionBadge(resolutions.find((r) => r.status === "resolved")) === null,
);
check(
  "resolution never throws on junk",
  ["", "   ", "n/a", "\\\\server\\share\\", "notes.docx"].every(
    (raw) => resolveLink(raw, pool).status !== "resolved",
  ),
);
check(
  "an unsupported extension says so rather than 'not found'",
  resolveLink("brochure.pdf", pool).status === "unsupported",
);
check("a blank link reads as empty", resolveLink("", pool).status === "empty");

// A file dropped mid-meeting resolves its row, and wins over the archive copy.
const withSession = resolveLink("/models/test-3dm/band-mm.3dm", [
  ...pool,
  { kind: "session", name: "band-mm.3dm", entryId: "entry-7" },
]);
check(
  "a session upload resolves the row",
  withSession.status === "resolved" && withSession.source.kind === "session",
);
check(
  "the broken row resolves once the file is dropped in",
  resolveLink(broken.raw, [
    ...pool,
    { kind: "session", name: broken.fileName, entryId: "entry-8" },
  ]).status === "resolved",
);

// --- the prompt's promises ------------------------------------------------
console.log("\nPROFILE_SCHEMA_SYSTEM_PROMPT");
check(
  "every role is defined for the model",
  ["identifier", "file_link", "categorical_filter", "numeric_range", "text"].every(
    (role) => PROFILE_SCHEMA_SYSTEM_PROMPT.includes(role),
  ),
);
check(
  "variant grouping is taught by example",
  /RG.*rose gold/s.test(PROFILE_SCHEMA_SYSTEM_PROMPT),
);
check(
  "auto-merging typos is forbidden",
  /DO NOT group a likely typo/.test(PROFILE_SCHEMA_SYSTEM_PROMPT),
);
check(
  "blank cells are excluded",
  /Blank cells are not a value/.test(PROFILE_SCHEMA_SYSTEM_PROMPT),
);
check(
  "loose number formats are called out",
  PROFILE_SCHEMA_SYSTEM_PROMPT.includes('"1 1/2"'),
);

// --- live role inference (needs a key) ------------------------------------
const envPath = join(ROOT, ".env.local");
if (existsSync(envPath) && !process.env.ANTHROPIC_API_KEY) {
  const match = readFileSync(envPath, "utf8").match(/^ANTHROPIC_API_KEY=(.*)$/m);
  if (match) process.env.ANTHROPIC_API_KEY = match[1].trim().replace(/^["']|["']$/g, "");
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("\nlive profiling — SKIPPED (no ANTHROPIC_API_KEY)");
} else {
  console.log("\nlive profiling (/api/profile-schema contract)");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { extractJsonObject } = await import("../lib/design-step.ts");

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    temperature: 0,
    system: PROFILE_SCHEMA_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Columns: ${JSON.stringify(catalog.headers)}

Sample rows (${sample.length} of the catalog; the rest stays on the studio's machine):
${JSON.stringify(sample, null, 1)}

Return the JSON object only.`,
      },
    ],
  });

  const raw = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  const validated = schemaProfileSchema.safeParse(JSON.parse(extractJsonObject(raw)));
  check("reply validates against the schema", validated.success, validated.error?.message);

  if (validated.success) {
    const profile = reconcileProfile(validated.data, catalog.headers);
    const roleOf = (name) =>
      profile.columns.find((column) => column.name === name)?.role;

    check("Design ID → identifier", roleOf("Design ID") === "identifier", roleOf("Design ID"));
    check("File Link → file_link", roleOf("File Link") === "file_link", roleOf("File Link"));
    check("Metal → categorical_filter", roleOf("Metal") === "categorical_filter", roleOf("Metal"));
    check(
      "Stone Shape → categorical_filter",
      roleOf("Stone Shape") === "categorical_filter",
      roleOf("Stone Shape"),
    );
    check("Carat → numeric_range", roleOf("Carat") === "numeric_range", roleOf("Carat"));
    check("Notes → text", roleOf("Notes") === "text", roleOf("Notes"));

    const metal = profile.columns.find((column) => column.name === "Metal");
    const rose = metal?.values.find((value) => /rose/i.test(value.canonical));
    check(
      "RG / rose gold / Rose Gold / 14k rose become one value",
      Boolean(rose) &&
        ["RG", "rose gold", "Rose Gold", "14k rose"].every(
          (variant) => canonicalFor(metal, variant) === rose.canonical,
        ),
      JSON.stringify(metal?.values),
    );
    check(
      "the typo is not silently merged",
      profile.columns
        .find((column) => column.name === "Stone Shape")
        ?.values.some((value) => /cushon/i.test(value.canonical)) ?? false,
      JSON.stringify(profile.columns.find((c) => c.name === "Stone Shape")?.values),
    );
    check("the typo is raised in notes", /cush/i.test(profile.notes), profile.notes);

    const carat = profile.columns.find((column) => column.name === "Carat");
    check(
      "carat range covers 0 – 2.05 read from loose formats",
      carat?.range !== null &&
        carat.range.min <= 0.75 &&
        carat.range.max >= 2 &&
        carat.range.max <= 2.05,
      JSON.stringify(carat?.range),
    );
    check(
      "the blank Setting cell did not become a value",
      !profile.columns
        .find((column) => column.name === "Setting")
        ?.values.some((value) => !value.canonical.trim()),
    );
  }
}

console.log(
  failures === 0 ? "\nAll catalog checks passed.\n" : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
