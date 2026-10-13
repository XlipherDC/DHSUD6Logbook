import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeApp, deleteApp } from "firebase/app";
import * as firestore from "firebase/firestore";
import { loadAppModule } from "./load-app-module.mjs";

// Run against an isolated emulator only. This script clears its test project.
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("Set FIRESTORE_EMULATOR_HOST to a loopback Firestore emulator, e.g. 127.0.0.1:8088.");
const project = "demo-issuance-history";
const endpoint = `http://${host}`;
const adminRequest = async (path, method, body) => {
  const response = await fetch(endpoint + path, { method, headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
};
await adminRequest(`/emulator/v1/projects/${project}/databases/(default)/documents`, "DELETE");
const ruleResult = await adminRequest(`/emulator/v1/projects/${project}:securityRules`, "PUT", { rules: { files: [{ name: "firestore.rules", content: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }] } });
assert.ok(!(ruleResult.issues || []).some((issue) => issue.severity === "ERROR"), JSON.stringify(ruleResult));
const { doc, collection, getDoc, getDocs, updateDoc, deleteDoc, writeBatch, serverTimestamp, getFirestore, connectFirestoreEmulator } = firestore;
firestore.setLogLevel("silent"); // Expected denials are asserted below.
const clients = [];
const createClient = (uid, role, active = true) => {
  const app = initializeApp({ projectId: project, apiKey: "test", appId: "test" }, uid);
  clients.push(app);
  const db = getFirestore(app);
  const [hostname, port] = host.split(":");
  connectFirestoreEmulator(db, hostname, Number(port), { mockUserToken: { sub: uid, user_id: uid } });
  const profile = { id: uid, name: uid, email: `${uid}@example.test`, active, role, processor_code: "" };
  return { db, profile, api: loadAppModule("data", { "firebase/firestore": firestore, "./firebase": { demoMode: false, publicDataMode: false, db } }) };
};
const encode = (value) => value === null ? { nullValue: null } : typeof value === "string" ? { stringValue: value } : typeof value === "boolean" ? { booleanValue: value } : typeof value === "number" ? { integerValue: String(value) } : { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
const seed = (path, value) => adminRequest(`/v1/projects/${project}/databases/(default)/documents/${path}`, "PATCH", { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) });
const denied = async (promise) => assert.rejects(promise, (error) => error.code === "permission-denied");
try {
  const admin = createClient("admin", "admin");
  const processor = createClient("processor", "processor");
  const viewer = createClient("viewer", "viewer");
  const inactive = createClient("inactive", "admin", false);
  const outsider = createClient("outsider", "viewer");
  for (const client of [admin, processor, viewer, inactive]) await seed(`users/${client.profile.id}`, client.profile);
  const payload = { reference_number: "HISTORY-001", issuance_type: "Development Permit", source_sheet: "Manual", source_row: null,
    date_filed: "2026-10-01", date_issued: "2026-10-13", expiry_date: "", project_name: "Original", location: "Test City",
    applicant: "", developer: "", owner: "", processor: "", or_number: "", remarks: "", assigned_to: "", details: {} };
  const id = await admin.api.createIssuance(payload, admin.profile);
  const reference = doc(admin.db, "issuances", id);
  const read = async () => ({ ...(await getDoc(reference)).data(), id });
  let current = await read();
  assert.equal(current.version, 1);
  await processor.api.updateIssuance(id, { ...payload, project_name: "Edited" }, processor.profile, 1, "Correction");
  await assert.rejects(admin.api.updateIssuance(id, payload, admin.profile, 1, "Stale"), /Another staff member/);
  current = await read();
  const history = await getDocs(collection(viewer.db, "issuances", id, "history"));
  assert.equal(history.size, 2);
  const edit = history.docs.find((entry) => entry.data().version === 2).data();
  assert.equal(edit.before.project_name, "Original"); assert.equal(edit.after.project_name, "Edited");
  assert.deepEqual(edit.after, (await getDoc(reference)).data());
  await denied(updateDoc(reference, { project_name: "Unlogged" }));
  await denied(deleteDoc(reference));
  await denied(updateDoc(doc(admin.db, "issuances", id, "history", current.history_id), { reason: "Tampered" }));
  await denied(deleteDoc(doc(admin.db, "issuances", id, "history", current.history_id)));
  await denied(getDocs(collection(inactive.db, "issuances", id, "history")));
  await denied(getDocs(collection(outsider.db, "issuances", id, "history")));
  // Attempt forged, otherwise internally consistent atomic writes directly
  // through the SDK, bypassing the application's permission checks.
  const forge = async (client, patch, action = "update", mutate = () => {}) => {
    const parent = doc(client.db, "issuances", id);
    const before = (await getDoc(parent)).data();
    const audit = doc(collection(parent, "history"));
    const after = { ...before, ...patch, history_id: audit.id, version: before.version + 1, updated_at: serverTimestamp(), updated_by: client.profile.name };
    const entry = { action, reason: "Test action", actor_id: client.profile.id, actor_name: client.profile.name, at: serverTimestamp(), version: after.version, before, after };
    mutate(entry, after);
    const batch = writeBatch(client.db); batch.set(parent, after); batch.set(audit, entry);
    if (patch.reference_key) batch.set(doc(client.db, "issuance_reference_numbers", patch.reference_key), { issuance_id: id, reference_number: after.reference_number, updated_at: serverTimestamp() });
    return batch.commit();
  };
  await denied(forge(processor, { archived: true }, "archive"));
  await denied(forge(processor, { project_name: "Recover" }, "revert"));
  await denied(forge(viewer, { project_name: "Viewer write" }));
  await denied(forge(admin, { project_name: "Forged actor" }, "update", (entry) => { entry.actor_id = "processor"; }));
  await denied(forge(admin, { project_name: "Forged before" }, "update", (entry) => { entry.before = {}; }));
  await denied(forge(admin, { archived: true, project_name: "Hidden archive edit" }, "archive"));
  await denied(forge(admin, { archived: true, reference_key: "replacement-key" }, "archive"));
  await denied(forge(admin, { project_name: "Missing reason" }, "update", (entry) => { entry.reason = ""; }));
  await denied(forge(admin, { project_name: "Whitespace reason" }, "update", (entry) => { entry.reason = " \n\t "; }));
  await admin.api.archiveIssuance(current, admin.profile, "Duplicate entry");
  current = await read(); assert.equal(current.archived, true);
  assert.ok((await getDoc(doc(admin.db, "issuance_reference_numbers", current.reference_key))).exists());
  await assert.rejects(admin.api.createIssuance(payload, admin.profile), /already exists/);
  await denied(deleteDoc(doc(admin.db, "issuance_reference_numbers", current.reference_key)));
  await admin.api.restoreIssuance(current, admin.profile, "Confirmed correct");
  current = await read(); assert.equal(current.archived, false);
  await admin.api.updateIssuance(id, payload, admin.profile, current.version, "Recover original values", "revert");
  current = await read(); assert.equal(current.project_name, "Original");
  const race = await Promise.allSettled([
    admin.api.updateIssuance(id, { ...payload, project_name: "Admin race" }, admin.profile, current.version, "Concurrent admin edit"),
    processor.api.updateIssuance(id, { ...payload, project_name: "Processor race" }, processor.profile, current.version, "Concurrent processor edit"),
  ]);
  assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
  assert.match(race.find((result) => result.status === "rejected").reason.message, /Another staff member/);
  current = await read();
  const secondId = await admin.api.createIssuance({ ...payload, reference_number: "HISTORY-002" }, admin.profile);
  await assert.rejects(admin.api.updateIssuance(secondId, payload, admin.profile, 1, "Recover occupied reference", "revert"), /already exists/);
  const changedPayload = { ...payload, reference_number: "HISTORY-003" };
  await admin.api.updateIssuance(id, changedPayload, admin.profile, current.version, "Correct official number");
  assert.equal((await getDoc(doc(admin.db, "issuance_reference_numbers", "HISTORY-001"))).exists(), false);
  assert.equal((await getDoc(doc(admin.db, "issuance_reference_numbers", "HISTORY-003"))).data().issuance_id, id);
  // First change of an untracked legacy record records its exact baseline.
  await seed("issuances/legacy", { ...payload, reference_number: "LEGACY-001", created_at: "2025-01-01", updated_at: "2025-01-01", updated_by: "Migration" });
  await admin.api.archiveIssuance({ id: "legacy", version: 0 }, admin.profile, "Archive legacy record");
  const legacy = (await getDoc(doc(admin.db, "issuances", "legacy"))).data();
  const baseline = (await getDoc(doc(admin.db, "issuances", "legacy", "history", legacy.history_id))).data();
  assert.equal(baseline.before.updated_by, "Migration"); assert.equal(baseline.version, 1);
  assert.ok((await getDoc(doc(admin.db, "issuance_reference_numbers", "LEGACY-001"))).exists());
  for (const suffix of ["a", "b"]) {
    await seed(`issuances/duplicate-${suffix}`, { ...payload, reference_number: "2026/06-15", created_at: "2025-01-01", updated_at: "2025-01-01", updated_by: "Migration" });
    await admin.api.archiveIssuance({ id: `duplicate-${suffix}`, version: 0 }, admin.profile, "Archive inherited duplicate");
    await admin.api.restoreIssuance({ id: `duplicate-${suffix}`, version: 1 }, admin.profile, "Restore inherited duplicate");
    await processor.api.updateIssuance(`duplicate-${suffix}`, { ...payload, reference_number: "2026/06-15" }, processor.profile, 2, "Correct project information");
  }
  // Bypass app guards to prove the protected inherited number cannot be reused
  // even if a malicious client supplies a different reservation key.
  const forbiddenReference = doc(admin.db, "issuances", "new-duplicate");
  const forbiddenHistory = doc(collection(forbiddenReference, "history"));
  const forbiddenAfter = { ...payload, reference_number: "2026/06-15", reference_key: "fake-key", archived: false, version: 1,
    history_id: forbiddenHistory.id, created_at: serverTimestamp(), updated_at: serverTimestamp(), updated_by: "admin" };
  const forbiddenBatch = writeBatch(admin.db);
  forbiddenBatch.set(forbiddenReference, forbiddenAfter);
  forbiddenBatch.set(forbiddenHistory, { action: "create", reason: "Attempt duplicate", actor_id: "admin", actor_name: "admin", at: serverTimestamp(), version: 1, before: null, after: forbiddenAfter });
  forbiddenBatch.set(doc(admin.db, "issuance_reference_numbers", "fake-key"), { issuance_id: "new-duplicate", reference_number: "2026/06-15", updated_at: serverTimestamp() });
  await denied(forbiddenBatch.commit());
  console.log("PASS actual Firestore rules: atomic history, immutable entries, role enforcement, forged writes, stale edits, archive/restore, recovery, legacy baselines and shared references.");
} finally {
  await Promise.all(clients.map(deleteApp));
}
