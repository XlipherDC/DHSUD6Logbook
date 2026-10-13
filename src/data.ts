import {
  collection, doc, getDocFromServer, onSnapshot, runTransaction, serverTimestamp,
} from "firebase/firestore";
import { db, demoMode, publicDataMode } from "./firebase";
import publicSeed from "./seed/issuances.public.json";
import { validateConditionalLicense } from "./conditionalLicense";
import { assertCurrentVersion, editableSnapshot, validateRecoveryInput } from "./recordHistory";

export type Role = "admin" | "processor" | "viewer";
export type Identity = { uid: string; email: string; displayName: string };
export type Profile = {
  id: string;
  name: string;
  email: string;
  role: Role;
  processor_code: string;
  active: boolean;
};
export type Issuance = {
  id: string;
  reference_number: string;
  issuance_type: string;
  source_sheet: string;
  source_row: number | null;
  date_filed: string;
  date_issued: string;
  expiry_date: string;
  escrow_total_centavos?: number;
  escrow_paid_centavos?: number;
  project_name: string;
  location: string;
  applicant: string;
  developer: string;
  owner: string;
  processor: string;
  or_number: string;
  remarks: string;
  assigned_to: string;
  details: Record<string, string>;
  created_at: string;
  updated_at: string;
  updated_by: string;
  version?: number;
  archived?: boolean;
};

export type IssuanceInput = Omit<Issuance, "id" | "created_at" | "updated_at" | "updated_by" | "version" | "archived">;
export type HistoryAction = "create" | "update" | "archive" | "restore" | "revert";
export type HistoryEntry = {
  id: string; action: HistoryAction; actor_id: string; actor_name: string;
  at: string; reason: string; version: number;
  before: Record<string, unknown> | null; after: Record<string, unknown>;
};

// Reference numbers are compared case-insensitively with collapsed whitespace.
// The encoded value is safe to use as a Firestore reservation document ID.
export const canonicalReferenceNumber = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
const referenceKey = (value: string) => encodeURIComponent(canonicalReferenceNumber(value)).replace(/\./g, "%2E");
const protectedLegacyReferences = new Set(["REMC-2025-152", "REMC-2025-158", "2026/06-15"]);
const duplicateReferenceError = (value: string) => new Error(`Reference Number "${value}" already exists. Use a unique Reference Number.`);
const newestFirst = (items: Issuance[]) => [...items].sort((left, right) =>
  right.date_issued.localeCompare(left.date_issued)
  || right.date_filed.localeCompare(left.date_filed)
  || left.reference_number.localeCompare(right.reference_number, undefined, { numeric: true }),
);
const now = () => new Date().toISOString();
const dateValue = (value: unknown) => {
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === "string" ? value : "";
};
const textValue = (value: unknown) => typeof value === "string" ? value : "";

// Convert loose Firestore/static JSON values into the stable shape consumed by
// the UI. This keeps rendering code free from timestamp and null checks.
const mapIssuance = (id: string, value: Record<string, unknown>): Issuance => ({
  id,
  reference_number: textValue(value.reference_number),
  issuance_type: textValue(value.issuance_type),
  source_sheet: textValue(value.source_sheet),
  source_row: value.source_row === null || value.source_row === undefined ? null : Number(value.source_row),
  date_filed: textValue(value.date_filed),
  date_issued: textValue(value.date_issued),
  expiry_date: textValue(value.expiry_date),
  escrow_total_centavos: typeof value.escrow_total_centavos === "number" ? value.escrow_total_centavos : undefined,
  escrow_paid_centavos: typeof value.escrow_paid_centavos === "number" ? value.escrow_paid_centavos : undefined,
  project_name: textValue(value.project_name),
  location: textValue(value.location),
  applicant: textValue(value.applicant),
  developer: textValue(value.developer),
  owner: textValue(value.owner),
  processor: textValue(value.processor),
  or_number: textValue(value.or_number),
  remarks: textValue(value.remarks),
  assigned_to: textValue(value.assigned_to),
  details: value.details && typeof value.details === "object" ? value.details as Record<string, string> : {},
  created_at: dateValue(value.created_at),
  updated_at: dateValue(value.updated_at),
  updated_by: textValue(value.updated_by),
  version: typeof value.version === "number" ? value.version : 0,
  archived: value.archived === true,
});

const demoSeed: Issuance[] = [
  {
    id: "demo-development-permit", reference_number: "DP-DEMO-001",
    issuance_type: "Development Permit", source_sheet: "Demo", source_row: null,
    date_filed: "2026-01-12", date_issued: "2026-02-04", expiry_date: "", project_name: "Sample Heights",
    location: "Example City", applicant: "Demo Applicant", developer: "Demo Development Corp.",
    owner: "Demo Property Owner", processor: "DM", or_number: "DEMO-1001",
    remarks: "Synthetic record for local preview only.", assigned_to: "demo-user",
    details: { "Land Area (Sqm)": "12500", "Residential Units": "96" },
    created_at: "2026-02-04T08:00:00.000Z", updated_at: "2026-02-04T08:00:00.000Z", updated_by: "Demo Administrator",
  },
  {
    id: "demo-license-to-sell", reference_number: "LS-DEMO-002",
    issuance_type: "License to Sell — Subdivision", source_sheet: "Demo", source_row: null,
    date_filed: "2026-03-08", date_issued: "2026-03-27", expiry_date: "", project_name: "Demo Residences",
    location: "Sample Municipality", applicant: "Example Representative", developer: "Sample Homes Inc.",
    owner: "Sample Landowner", processor: "DM", or_number: "DEMO-1002",
    remarks: "Synthetic record for local preview only.", assigned_to: "demo-user",
    details: { "Legal Basis": "Demo", "Number of Lots": "48" },
    created_at: "2026-03-27T08:00:00.000Z", updated_at: "2026-03-27T08:00:00.000Z", updated_by: "Demo Administrator",
  },
];
let demoRecords: Issuance[] = newestFirst(demoSeed);
const demoListeners = new Set<(items: Issuance[]) => void>();
const emitDemo = () => demoListeners.forEach((listener) => listener(newestFirst(demoRecords)));

function store() {
  if (!db) throw new Error("Firebase has not been configured.");
  return db;
}

export function subscribeIssuances(next: (items: Issuance[]) => void, fail: (error: Error) => void) {
  // Public builds read the sanitized snapshot; demo builds use in-memory data;
  // only the authenticated staff build opens a real-time Firestore listener.
  if (publicDataMode) {
    next(newestFirst((publicSeed as Array<Record<string, unknown>>).map((item) => mapIssuance(String(item.id), item))));
    return () => undefined;
  }
  if (demoMode) {
    demoListeners.add(next);
    next(newestFirst(demoRecords));
    return () => { demoListeners.delete(next); };
  }
  return onSnapshot(
    collection(store(), "issuances"),
    (snapshot) => next(newestFirst(snapshot.docs.map((item) => mapIssuance(item.id, item.data())))),
    fail,
  );
}

export function subscribeProfile(identity: Identity, next: (profile: Profile | null) => void, fail: (error: Error) => void) {
  // The users/{uid} record is the source of authorization roles and processor
  // assignments. Authentication alone does not grant registry access.
  if (publicDataMode) {
    next({ id: identity.uid, name: "Public Viewer", email: "", role: "viewer", processor_code: "", active: true });
    return () => undefined;
  }
  if (demoMode) {
    next({ id: identity.uid, name: "Demo Administrator", email: identity.email, role: "admin", processor_code: "DM", active: true });
    return () => undefined;
  }
  return onSnapshot(
    doc(store(), "users", identity.uid),
    (snapshot) => next(snapshot.exists() ? {
      id: snapshot.id,
      name: textValue(snapshot.data().name) || identity.displayName || identity.email,
      email: textValue(snapshot.data().email) || identity.email,
      role: (snapshot.data().role || "viewer") as Role,
      processor_code: textValue(snapshot.data().processor_code),
      active: snapshot.data().active === true,
    } : null),
    fail,
  );
}

export function subscribeUsers(next: (profiles: Profile[]) => void, fail: (error: Error) => void) {
  if (publicDataMode) {
    next([]);
    return () => undefined;
  }
  if (demoMode) {
    next([{ id: "demo-user", name: "Demo Administrator", email: "demo@dhsud.gov.ph", role: "admin", processor_code: "DM", active: true }]);
    return () => undefined;
  }
  return onSnapshot(collection(store(), "users"), (snapshot) => next(snapshot.docs.map((item) => ({
    id: item.id,
    name: textValue(item.data().name) || textValue(item.data().email),
    email: textValue(item.data().email),
    role: (item.data().role || "viewer") as Role,
    processor_code: textValue(item.data().processor_code),
    active: item.data().active === true,
  })).filter((item) => item.active).sort((a, b) => a.name.localeCompare(b.name))), fail);
}


const demoHistory = new Map<string, HistoryEntry[]>();
const historyListeners = new Map<string, Set<(entries: HistoryEntry[]) => void>>();
export function subscribeHistory(id: string, next: (entries: HistoryEntry[]) => void, fail: (error: Error) => void) {
  if (publicDataMode) { next([]); return () => undefined; }
  if (demoMode) {
    const listeners = historyListeners.get(id) || new Set();
    historyListeners.set(id, listeners); listeners.add(next); next(demoHistory.get(id) || []);
    return () => { listeners.delete(next); };
  }
  return onSnapshot(collection(store(), "issuances", id, "history"), (snapshot) => {
    next(snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id, at: dateValue(entry.data().at) } as HistoryEntry))
      .sort((a, b) => b.version - a.version));
  }, fail);
}

type Mutation = { action: HistoryAction; reason: string; expectedVersion: number; payload?: IssuanceInput };
const ensureStaffWrite = (actor: Profile, action: HistoryAction, reason: string) => {
  if (publicDataMode || !actor.active || !["admin", "processor"].includes(actor.role)) throw new Error("Editing access is required.");
  if (["archive", "restore", "revert"].includes(action) && actor.role !== "admin") throw new Error("Administrator access is required.");
  if (action !== "create" && !reason.trim()) throw new Error("Enter a reason for this change.");
  if (reason.length > 1000) throw new Error("Use a reason of 1,000 characters or fewer.");
};

async function saveRecord(id: string | null, operation: Mutation, actor: Profile) {
  const { action, reason, expectedVersion } = operation;
  ensureStaffWrite(actor, action, reason);
  const payload = operation.payload ? editableSnapshot(operation.payload as unknown as Record<string, unknown>) : undefined;
  if (payload) {
    const error = action === "revert" ? validateRecoveryInput(payload) : validateConditionalLicense(payload);
    if (error) throw new Error(error);
  }
  // Never send undefined optional escrow values to Firestore.
  const cleanPayload = payload ? JSON.parse(JSON.stringify(payload)) as IssuanceInput : undefined;
  const prepare = (before: Record<string, unknown> | null, at: unknown, historyId: string) => {
    if (action !== "create" && !before) throw new Error("This issuance no longer exists.");
    assertCurrentVersion(Number(before?.version || 0), expectedVersion);
    if (before?.archived === true && action !== "restore") throw new Error("Restore this archived record before editing it.");
    if (action === "restore" && before?.archived !== true) throw new Error("This record is already active.");
    if (cleanPayload && protectedLegacyReferences.has(canonicalReferenceNumber(cleanPayload.reference_number)) && (!before || before.reference_number !== cleanPayload.reference_number)) throw duplicateReferenceError(cleanPayload.reference_number);
    const after = { ...before, ...cleanPayload, archived: action === "archive", version: expectedVersion + 1,
      history_id: historyId, updated_at: at, updated_by: actor.name,
      ...(before ? {} : { created_at: at }) } as Record<string, unknown> & IssuanceInput & { history_id: string; version: number };
    const entry = { action, reason: reason.trim(), actor_id: actor.id, actor_name: actor.name,
      at, version: expectedVersion + 1, before, after };
    return { after, entry };
  };
  if (demoMode) {
    const recordId = id || crypto.randomUUID();
    const current = demoRecords.find((item) => item.id === recordId);
    const before = current ? JSON.parse(JSON.stringify(current)) : null;
    if (before) delete before.id;
    const { after, entry } = prepare(before, now(), crypto.randomUUID());
    if (demoRecords.some((item) => item.id !== recordId && canonicalReferenceNumber(item.reference_number) === canonicalReferenceNumber(after.reference_number)
      && (!current || current.reference_number !== after.reference_number))) throw duplicateReferenceError(after.reference_number);
    demoRecords = [...demoRecords.filter((item) => item.id !== recordId), mapIssuance(recordId, after)];
    const entries = [{ ...entry, id: after.history_id } as HistoryEntry, ...(demoHistory.get(recordId) || [])];
    demoHistory.set(recordId, entries); emitDemo(); historyListeners.get(recordId)?.forEach((listener) => listener(entries));
    return recordId;
  }
  const database = store();
  const reference = id ? doc(database, "issuances", id) : doc(collection(database, "issuances"));
  const auditReference = doc(collection(reference, "history"));
  try { await runTransaction(database, async (transaction) => {
    const existing = await transaction.get(reference);
    if (!id && existing.exists()) throw new Error("Record already exists.");
    const before = existing.exists() ? existing.data() : null;
    const { after, entry } = prepare(before, serverTimestamp(), auditReference.id);
    const previousKey = textValue(before?.reference_key);
    const previousNumber = textValue(before?.reference_number);
    // The three inherited duplicate groups keep the legacy exception and are
    // blocked globally for new references. Other legacy numbers acquire a
    // reservation on first change; archiving never releases it.
    const inheritedDuplicate = before && !previousKey && previousNumber === after.reference_number && protectedLegacyReferences.has(canonicalReferenceNumber(previousNumber));
    const needsReservation = !inheritedDuplicate;
    const nextKey = needsReservation ? referenceKey(after.reference_number) : "";
    const reservationReference = nextKey ? doc(database, "issuance_reference_numbers", nextKey) : null;
    const reservation = reservationReference ? await transaction.get(reservationReference) : null;
    if (reservation?.exists() && textValue(reservation.data().issuance_id) !== reference.id) throw duplicateReferenceError(after.reference_number);
    if (nextKey) { Object.assign(after, { reference_key: nextKey }); }
    transaction.set(reference, after);
    transaction.set(auditReference, entry);
    if (reservationReference) transaction.set(reservationReference, { issuance_id: reference.id, reference_number: after.reference_number, updated_at: serverTimestamp() });
    if (previousKey && previousKey !== nextKey) transaction.delete(doc(database, "issuance_reference_numbers", previousKey));
  }); } catch (failure) {
    // Rules can reject a racing write before the SDK retries its transaction.
    // Translate that specific case into the same actionable conflict message.
    if (id && failure && typeof failure === "object" && "code" in failure && failure.code === "permission-denied") {
      let latest;
      try { latest = await getDocFromServer(reference); } catch { throw failure; }
      if (latest.exists()) assertCurrentVersion(Number(latest.data().version || 0), expectedVersion);
    }
    throw failure;
  }
  return reference.id;
}

export const createIssuance = (payload: IssuanceInput, actor: Profile) =>
  saveRecord(null, { action: "create", reason: "Record created", expectedVersion: 0, payload }, actor);
export const updateIssuance = (id: string, payload: IssuanceInput, actor: Profile, expectedVersion: number, reason: string, action: "update" | "revert" = "update") =>
  saveRecord(id, { action, reason, expectedVersion, payload }, actor);
export const archiveIssuance = (item: Issuance, actor: Profile, reason: string) =>
  saveRecord(item.id, { action: "archive", reason, expectedVersion: item.version || 0 }, actor);
export const restoreIssuance = (item: Issuance, actor: Profile, reason: string) =>
  saveRecord(item.id, { action: "restore", reason, expectedVersion: item.version || 0 }, actor);
