import { readFile } from "node:fs/promises";
import { containsHiddenPublicFields, isOrganization } from "./public-data-utils.mjs";

const records = JSON.parse(await readFile(new URL("../src/seed/issuances.public.json", import.meta.url), "utf8"));
const required = ["id", "reference_number", "issuance_type", "project_name", "source_sheet"];
const problems = [];
const ids = new Set();
const references = new Map();
const legacyDuplicateReferences = new Set(["REMC-2025-152", "REMC-2025-158", "2026/06-15"]);

for (const [index, record] of records.entries()) {
  for (const field of required) {
    if (!record[field]) problems.push(`Record ${index + 1} is missing ${field}`);
  }
  if (ids.has(record.id)) problems.push(`Duplicate ID: ${record.id}`);
  ids.add(record.id);
  const canonicalReference = String(record.reference_number).trim().replace(/\s+/g, " ").toUpperCase();
  references.set(canonicalReference, (references.get(canonicalReference) || 0) + 1);
  if (containsHiddenPublicFields(record)) problems.push(`${record.id} contains a hidden public field`);
  if (String(record.processor || "").toUpperCase() === "IQ") {
    problems.push(`${record.id} contains the deprecated IQ processor code`);
  }
  if (record.issuance_type === "REMC" && !/^REMC-\d{4}-\d+[A-Z]?$/.test(record.reference_number)) {
    problems.push(`${record.id} has an invalid REMC Decision Number: ${record.reference_number}`);
  }
  for (const [key, value] of Object.entries(record.details || {})) {
    if (key.replace(/[^a-z0-9]/gi, "").toLowerCase() === "processor" && String(value).toUpperCase() === "IQ") {
      problems.push(`${record.id} contains the deprecated IQ processor code in details`);
    }
  }
  for (const field of ["applicant", "owner", "developer"]) {
    const value = String(record[field] || "");
    if (value && !isOrganization(value) && /\s/.test(value)) {
      problems.push(`${record.id} has a non-surname ${field}: ${value}`);
    }
  }
  for (const field of ["date_filed", "date_issued"]) {
    if (record[field] && !/^\d{4}-\d{2}-\d{2}$/.test(record[field])) {
      problems.push(`${record.id} has an unnormalized ${field}: ${record[field]}`);
    }
  }
}

for (const [reference, count] of references) {
  if (count > 1 && (!legacyDuplicateReferences.has(reference) || count > 2)) {
    problems.push(`Duplicate Reference Number: ${reference} (${count} records)`);
  }
}

if (records.length !== 183) problems.push(`Expected 183 public rows, found ${records.length}`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${records.length} public records with ${ids.size} unique IDs, no new duplicate references, and required redactions.`);
}
