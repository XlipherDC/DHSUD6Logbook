import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Exercise the actual pure TypeScript helpers in memory using the existing
// compiler dependency. No Firebase account or extra test framework is needed.
const source = await readFile(new URL("../src/conditionalLicense.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const helpers = {};
new Function("exports", compiled.outputText)(helpers);
const { CLS_TYPE, MAX_CENTAVOS, parsePesos, pesosInput, escrowSummary, validCalendarDate, manilaToday, clsOverdue, validateConditionalLicense } = helpers;
let checks = 0;
const test = (name, check) => { check(); checks++; console.log(`PASS ${name}`); };
const record = { issuance_type: CLS_TYPE, date_issued: "2026-01-01", expiry_date: "2026-10-11", escrow_total_centavos: 100_000_000, escrow_paid_centavos: 25_000_000 };

test("PHP amounts convert to exact centavos", () => {
  assert.equal(parsePesos("1000000.00"), 100_000_000);
  assert.equal(parsePesos("0.29"), 29);
  assert.equal(parsePesos(" 25.5 "), 2550);
  assert.equal(pesosInput(29), "0.29");
  assert.equal(parsePesos(pesosInput(MAX_CENTAVOS)), MAX_CENTAVOS);
});
test("invalid money is rejected, not silently rounded", () => {
  for (const value of ["", " ", "-1", "NaN", "Infinity", "1e6", "1.001", "1,000", "10000000000000.00"]) assert.equal(parsePesos(value), null, value);
});
test("25% minimum, paid percentage and remaining balance", () => {
  assert.deepEqual(escrowSummary(100_000_000, 25_000_000), { total: 100_000_000, paid: 25_000_000, minimum: 25_000_000, balance: 75_000_000, paidPercent: 25, balancePercent: 75 });
  assert.equal(validateConditionalLicense(record), null);
  const halfPaid = escrowSummary(100_000_000, 50_000_000);
  assert.equal(halfPaid.paidPercent, 50);
  assert.equal(halfPaid.balance, 50_000_000);
});
test("fractional-cent minimum rounds upward", () => {
  const small = { ...record, escrow_total_centavos: 101, escrow_paid_centavos: 25 };
  assert.match(validateConditionalLicense(small), /at least 25%/);
  assert.equal(validateConditionalLicense({ ...small, escrow_paid_centavos: 26 }), null);
  assert.equal(escrowSummary(101, 26).minimum, 26);
  assert.equal(escrowSummary(1, 1).balance, 0);
});
test("underpayments, overpayments and invalid stored amounts are blocked", () => {
  assert.match(validateConditionalLicense({ ...record, escrow_paid_centavos: 24_999_999 }), /at least 25%/);
  assert.match(validateConditionalLicense({ ...record, escrow_paid_centavos: 100_000_001 }), /cannot exceed/);
  for (const value of [undefined, -1, 0.5, NaN, Infinity, MAX_CENTAVOS + 1]) assert.ok(validateConditionalLicense({ ...record, escrow_paid_centavos: value }));
  for (const value of [undefined, 0, -1, 0.5, NaN, Infinity, MAX_CENTAVOS + 1]) assert.ok(validateConditionalLicense({ ...record, escrow_total_centavos: value }));
});
test("calendar validation and manual expiry ordering", () => {
  assert.equal(validCalendarDate("2026-02-30"), false);
  assert.equal(validCalendarDate("2028-02-29"), true);
  assert.ok(validateConditionalLicense({ ...record, expiry_date: "" }));
  assert.ok(validateConditionalLicense({ ...record, expiry_date: "2026-02-30" }));
  assert.ok(validateConditionalLicense({ ...record, date_issued: "2026-11-01" }));
  assert.equal(validateConditionalLicense({ ...record, expiry_date: record.date_issued }), null);
});
test("warning requires BOTH past expiry and unpaid balance", () => {
  assert.equal(clsOverdue(record, "2026-10-12"), true);
  assert.equal(clsOverdue(record, "2026-10-11"), false);
  assert.equal(clsOverdue(record, "2026-10-10"), false);
  assert.equal(clsOverdue({ ...record, escrow_paid_centavos: record.escrow_total_centavos }, "2026-10-12"), false);
  assert.equal(clsOverdue({ ...record, expiry_date: "" }, "2026-10-12"), false);
  assert.equal(clsOverdue({ ...record, escrow_total_centavos: undefined }, "2026-10-12"), false);
});
test("Philippine midnight defines expiry consistently", () => {
  assert.equal(manilaToday(new Date("2026-10-11T15:59:59Z")), "2026-10-11");
  assert.equal(manilaToday(new Date("2026-10-11T16:00:00Z")), "2026-10-12");
});
test("other issuance types are unaffected", () => {
  const tls = { ...record, issuance_type: "Temporary License to Sell", escrow_paid_centavos: undefined };
  assert.equal(validateConditionalLicense(tls), null);
  assert.equal(clsOverdue(tls, "2026-10-12"), false);
});
console.log(`Validated ${checks} CLS escrow and expiry scenarios.`);
