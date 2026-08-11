import { readFile, writeFile } from "node:fs/promises";
import { sanitizeRecord } from "./public-data-utils.mjs";

const sourcePath = process.argv[2] || "private-data/issuances.json";
const targetPath = process.argv[3] || "src/seed/issuances.public.json";
const records = JSON.parse(await readFile(sourcePath, "utf8"));
const sanitized = records.map(sanitizeRecord);

await writeFile(targetPath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
console.log(`Wrote ${sanitized.length} public records to ${targetPath}.`);
