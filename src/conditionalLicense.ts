// CLS money is stored as integer centavos. Percentages and balances are derived,
// never stored independently, so editing either amount cannot leave stale totals.
export const CLS_TYPE = "Conditional License to Sell (CLS)";
export const MAX_CENTAVOS = 999_999_999_999_999;
export type EscrowRecord = { issuance_type: string; date_issued: string; expiry_date: string; escrow_total_centavos?: number; escrow_paid_centavos?: number };

export function parsePesos(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [pesos, fraction = ""] = value.trim().split(".");
  const cents = Number(pesos) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= MAX_CENTAVOS ? cents : null;
}

export function pesosInput(cents: number | undefined): string {
  return validCentavos(cents) ? `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}` : "";
}

export const formatPesos = (cents: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);
export const formatPercent = (value: number) => `${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(value)}%`;
const validCentavos = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_CENTAVOS;

export function escrowSummary(total: number | undefined, paid: number | undefined) {
  if (!validCentavos(total) || total <= 0 || !validCentavos(paid) || paid > total) return null;
  return { total, paid, minimum: Math.ceil(total / 4), balance: total - paid, paidPercent: paid / total * 100, balancePercent: (total - paid) / total * 100 };
}

export function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Philippine calendar dates keep expiry consistent even for users abroad.
export function manilaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function clsOverdue(record: EscrowRecord, today = manilaToday()) {
  const summary = escrowSummary(record.escrow_total_centavos, record.escrow_paid_centavos);
  // A license remains valid through its expiry date. Fully paid CLS records
  // never trigger the combined expired-and-unpaid warning.
  return record.issuance_type === CLS_TYPE && validCalendarDate(record.expiry_date)
    && record.expiry_date < today && summary !== null && summary.balance > 0;
}

export function validateConditionalLicense(record: EscrowRecord): string | null {
  if (record.issuance_type !== CLS_TYPE) return null;
  if (!validCalendarDate(record.date_issued) || !validCalendarDate(record.expiry_date)) return "Enter valid CLS issuance and expiry dates.";
  if (record.expiry_date < record.date_issued) return "CLS expiry date cannot be before the issuance date.";
  if (!validCentavos(record.escrow_total_centavos) || record.escrow_total_centavos <= 0) return "Enter a positive total escrow amount in pesos, with no more than two decimal places.";
  if (!validCentavos(record.escrow_paid_centavos)) return "Enter the total amount paid in pesos, with no more than two decimal places.";
  const minimum = Math.ceil(record.escrow_total_centavos / 4);
  if (record.escrow_paid_centavos < minimum) return `Total amount paid must be at least 25% of escrow (${formatPesos(minimum)}).`;
  if (record.escrow_paid_centavos > record.escrow_total_centavos) return "Total amount paid cannot exceed the total escrow amount.";
  return null;
}
