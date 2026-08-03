/**
 * Writes a tiny, deliberately messy catalog for exercising ingestion before the
 * studio's real spreadsheet exists.
 *
 *   node scripts/make-test-3dm.mjs && node scripts/make-test-catalog.mjs
 *
 * Output: public/test-catalog.xlsx (gitignored; regenerate on demand)
 *
 * The mess is the point — every awkward shape here is one the schema profiler
 * and the confirmation screen have to survive:
 *   - Metal spelled four ways across six rows (RG, rose gold, Rose Gold, 14k rose)
 *   - one typo ("Cushon") that must NOT silently fold into "Cushion"
 *   - a blank Setting cell
 *   - carats written as a number, a string with a unit, a fraction, and a
 *     leading-dot decimal
 *   - a File Link column whose paths resolve against /public
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "public", "test-catalog.xlsx");

/** Files the links point at. The .3dm fixtures are generated, not committed. */
const LINKS = {
  stl: "/models/placeholder-ring.stl",
  structured: "/models/test-3dm/structured-ring-mm.3dm",
  band: "/models/test-3dm/band-mm.3dm",
  inches: "/models/test-3dm/band-inches.3dm",
  // Deliberately points at a file that will not resolve, so the dashboard has
  // to cope with a broken link rather than assuming every row loads.
  missing: "/models/does-not-exist.3dm",
};

const ROWS = [
  {
    "Design ID": "JL-1001",
    Style: "Solitaire",
    Metal: "RG",
    "Stone Shape": "Oval",
    Carat: 1.5,
    Setting: "4 prong",
    Notes: "Best seller",
    "File Link": LINKS.structured,
  },
  {
    "Design ID": "JL-1002",
    Style: "Halo",
    Metal: "rose gold",
    "Stone Shape": "Round",
    Carat: "1.00 ct",
    Setting: "6 prong",
    Notes: "",
    "File Link": LINKS.stl,
  },
  {
    "Design ID": "JL-1003",
    Style: "Solitaire",
    Metal: "Rose Gold",
    // The typo. Grouping it with "Cushion" is a judgement call for the
    // confirmation screen, not something ingestion should decide silently.
    "Stone Shape": "Cushon",
    Carat: "1 1/2",
    // Blank cell.
    Setting: "",
    Notes: "Client reorder",
    "File Link": LINKS.band,
  },
  {
    "Design ID": "JL-1004",
    Style: "Three stone",
    Metal: "14k rose",
    "Stone Shape": "Emerald",
    Carat: ".75",
    Setting: "Bezel",
    Notes: "Vintage inspired",
    "File Link": LINKS.inches,
  },
  {
    "Design ID": "JL-1005",
    Style: "Eternity",
    Metal: "YG",
    "Stone Shape": "",
    Carat: 0,
    Setting: "Channel",
    Notes: "No centre stone",
    "File Link": LINKS.stl,
  },
  {
    "Design ID": "JL-1006",
    Style: "Halo",
    Metal: "Platinum",
    "Stone Shape": "Pear",
    Carat: "2.05ct",
    Setting: "V-prong",
    Notes: "",
    "File Link": LINKS.missing,
  },
];

const HEADERS = [
  "Design ID",
  "Style",
  "Metal",
  "Stone Shape",
  "Carat",
  "Setting",
  "Notes",
  "File Link",
];

const sheet = XLSX.utils.json_to_sheet(ROWS, { header: HEADERS });
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, sheet, "Designs");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, XLSX.write(book, { type: "buffer", bookType: "xlsx" }));

const missingTargets = Object.values(LINKS).filter(
  (link) => link !== LINKS.missing && !existsSync(join(root, "public", link)),
);

console.log(`wrote ${OUT} — ${ROWS.length} rows, ${HEADERS.length} columns`);
if (missingTargets.length > 0) {
  console.log(
    `note: ${missingTargets.length} linked file(s) not on disk yet — run: node scripts/make-test-3dm.mjs`,
  );
  for (const link of missingTargets) console.log(`      ${link}`);
}
