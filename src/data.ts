import {
  collection, doc, onSnapshot, runTransaction, serverTimestamp,
} from "firebase/firestore";
import { db, demoMode, publicDataMode } from "./firebase";
import publicSeed from "./seed/issuances.public.json";

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
};

export type IssuanceInput = Omit<Issuance, "id" | "created_at" | "updated_at" | "updated_by">;

export const canonicalReferenceNumber = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
const referenceKey = (value: string) => encodeURIComponent(canonicalReferenceNumber(value)).replace(/\./g, "%2E");
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
  return typeof value === "string" ? value : now();
};
const textValue = (value: unknown) => typeof value === "string" ? value : "";
const mapIssuance = (id: string, value: Record<string, unknown>): Issuance => ({
  id,
  reference_number: textValue(value.reference_number),
  issuance_type: textValue(value.issuance_type),
  source_sheet: textValue(value.source_sheet),
  source_row: value.source_row === null || value.source_row === undefined ? null : Number(value.source_row),
  date_filed: textValue(value.date_filed),
  date_issued: textValue(value.date_issued),
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
});

const demoSeed: Issuance[] = [
  {
    id: "demo-development-permit", reference_number: "DP-DEMO-001",
    issuance_type: "Development Permit", source_sheet: "Demo", source_row: null,
    date_filed: "2026-01-12", date_issued: "2026-02-04", project_name: "Sample Heights",
    location: "Example City", applicant: "Demo Applicant", developer: "Demo Development Corp.",
    owner: "Demo Property Owner", processor: "DM", or_number: "DEMO-1001",
    remarks: "Synthetic record for local preview only.", assigned_to: "demo-user",
    details: { "Land Area (Sqm)": "12500", "Residential Units": "96" },
    created_at: "2026-02-04T08:00:00.000Z", updated_at: "2026-02-04T08:00:00.000Z", updated_by: "Demo Administrator",
  },
  {
    id: "demo-license-to-sell", reference_number: "LS-DEMO-002",
    issuance_type: "License to Sell — Subdivision", source_sheet: "Demo", source_row: null,
    date_filed: "2026-03-08", date_issued: "2026-03-27", project_name: "Demo Residences",
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

export async function createIssuance(payload: IssuanceInput, actor: Profile) {
  if (demoMode) {
    if (demoRecords.some((item) => canonicalReferenceNumber(item.reference_number) === canonicalReferenceNumber(payload.reference_number))) {
      throw duplicateReferenceError(payload.reference_number);
    }
    const created: Issuance = { ...payload, id: `demo-${Date.now()}`, created_at: now(), updated_at: now(), updated_by: actor.name };
    demoRecords = [created, ...demoRecords];
    emitDemo();
    return created.id;
  }
  const database = store();
  const issuanceReference = doc(collection(database, "issuances"));
  const key = referenceKey(payload.reference_number);
  const reservationReference = doc(database, "issuance_reference_numbers", key);
  await runTransaction(database, async (transaction) => {
    const reservation = await transaction.get(reservationReference);
    if (reservation.exists()) throw duplicateReferenceError(payload.reference_number);
    transaction.set(issuanceReference, {
      ...payload,
      reference_key: key,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      updated_by: actor.name,
    });
    transaction.set(reservationReference, {
      issuance_id: issuanceReference.id,
      reference_number: payload.reference_number,
      updated_at: serverTimestamp(),
    });
  });
  return issuanceReference.id;
}

export async function updateIssuance(id: string, payload: IssuanceInput, actor: Profile) {
  if (demoMode) {
    if (demoRecords.some((item) => item.id !== id && canonicalReferenceNumber(item.reference_number) === canonicalReferenceNumber(payload.reference_number))) {
      throw duplicateReferenceError(payload.reference_number);
    }
    demoRecords = demoRecords.map((item) => item.id === id ? { ...item, ...payload, updated_at: now(), updated_by: actor.name } : item);
    emitDemo();
    return;
  }
  const database = store();
  const issuanceReference = doc(database, "issuances", id);
  await runTransaction(database, async (transaction) => {
    const existing = await transaction.get(issuanceReference);
    if (!existing.exists()) throw new Error("This issuance no longer exists.");

    const previousNumber = textValue(existing.data().reference_number);
    const previousKey = textValue(existing.data().reference_key);
    if (!previousKey && previousNumber === payload.reference_number) {
      transaction.update(issuanceReference, { ...payload, updated_at: serverTimestamp(), updated_by: actor.name });
      return;
    }

    const nextKey = referenceKey(payload.reference_number);
    const nextReservationReference = doc(database, "issuance_reference_numbers", nextKey);
    const nextReservation = await transaction.get(nextReservationReference);
    if (nextReservation.exists() && textValue(nextReservation.data().issuance_id) !== id) {
      throw duplicateReferenceError(payload.reference_number);
    }

    transaction.update(issuanceReference, {
      ...payload,
      reference_key: nextKey,
      updated_at: serverTimestamp(),
      updated_by: actor.name,
    });
    transaction.set(nextReservationReference, {
      issuance_id: id,
      reference_number: payload.reference_number,
      updated_at: serverTimestamp(),
    });
    if (previousKey && previousKey !== nextKey) {
      transaction.delete(doc(database, "issuance_reference_numbers", previousKey));
    }
  });
}

export async function deleteIssuance(id: string) {
  if (demoMode) {
    demoRecords = demoRecords.filter((item) => item.id !== id);
    emitDemo();
    return;
  }
  const database = store();
  const issuanceReference = doc(database, "issuances", id);
  await runTransaction(database, async (transaction) => {
    const existing = await transaction.get(issuanceReference);
    if (!existing.exists()) return;
    const key = textValue(existing.data().reference_key);
    const reservationReference = key ? doc(database, "issuance_reference_numbers", key) : null;
    const reservation = reservationReference ? await transaction.get(reservationReference) : null;
    transaction.delete(issuanceReference);
    if (reservationReference && reservation?.exists() && textValue(reservation.data().issuance_id) === id) {
      transaction.delete(reservationReference);
    }
  });
}
