import type { IssuanceInput } from "./data";
import { validateConditionalLicense, validCalendarDate } from "./conditionalLicense";

// Only business fields may be recovered. Audit, identity and archive metadata
// always come from the current record and the authenticated operation.
export const editableFields = [
  "reference_number", "issuance_type", "source_sheet", "source_row", "date_filed",
  "date_issued", "expiry_date", "escrow_total_centavos", "escrow_paid_centavos",
  "project_name", "location", "applicant", "developer", "owner", "processor",
  "or_number", "remarks", "assigned_to", "details",
] as const;

export function editableSnapshot(record: Record<string, unknown>): IssuanceInput {
  return Object.fromEntries(editableFields.filter((field) => record[field] !== undefined)
    .map((field) => [field, record[field]])) as IssuanceInput;
}

export function assertCurrentVersion(actual: number, expected: number) {
  if (actual !== expected) throw new Error("Another staff member changed this record. Close this form and review the latest record before trying again.");
}

export function validateRecoveryInput(input: IssuanceInput): string | null {
  if (!input.reference_number?.trim() || !input.issuance_type?.trim() || !input.project_name?.trim()) {
    return "Reference number, issuance type and project / subject are required.";
  }
  if (!validCalendarDate(input.date_issued)) return "Enter a valid issuance date.";
  if (input.date_filed && (!validCalendarDate(input.date_filed) || input.date_filed > input.date_issued)) {
    return "Date filed must be a valid date on or before issuance.";
  }
  if (input.issuance_type === "REMC" && !/^REMC-\d{4}-\d+[A-Z]?$/.test(input.reference_number)) {
    return "REMC Decision Number must use REMC-YYYY-NUMBER.";
  }
  if (input.issuance_type === "Temporary License to Sell") {
    const [year, month, day] = input.date_issued.split("-").map(Number);
    const expiry = `${year + 1}-${String(month).padStart(2, "0")}-${String(Math.min(day, new Date(Date.UTC(year + 1, month, 0)).getUTCDate())).padStart(2, "0")}`;
    if (input.expiry_date !== expiry) return "TLS expiry must be one calendar year after issuance.";
  }
  return validateConditionalLicense(input);
}

export function changedFields(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  return [...editableFields, "archived"].filter((field) =>
    JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after[field] ?? null));
}
