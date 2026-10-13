import { readFile } from "node:fs/promises";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { collection, doc, getDoc, getFirestore, runTransaction, serverTimestamp } from "firebase/firestore";

const value = (name) => process.env[name] || process.env[`VITE_${name}`] || "";
const config = {
  apiKey: value("FIREBASE_API_KEY"),
  authDomain: value("FIREBASE_AUTH_DOMAIN"),
  projectId: value("FIREBASE_PROJECT_ID"),
  storageBucket: value("FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: value("FIREBASE_MESSAGING_SENDER_ID"),
  appId: value("FIREBASE_APP_ID"),
};
const email = process.env.FIREBASE_IMPORT_EMAIL || "";
const password = process.env.FIREBASE_IMPORT_PASSWORD || "";
// --dry-run validates the ignored private snapshot without authenticating or
// writing to Firebase, which is useful before a production migration.
const dryRun = process.argv.includes("--dry-run");

const records = JSON.parse(await readFile(new URL("../private-data/issuances.json", import.meta.url), "utf8"));
if (!Array.isArray(records) || !records.length) throw new Error("No seed issuance records were found.");
console.log(`${dryRun ? "Validated" : "Importing"} ${records.length} issuance records…`);

if (!dryRun) {
  if (!Object.values(config).every(Boolean)) {
    throw new Error("Missing Firebase configuration. Set the FIREBASE_* or VITE_FIREBASE_* environment variables.");
  }
  if (!email || !password) {
    throw new Error("Set FIREBASE_IMPORT_EMAIL and FIREBASE_IMPORT_PASSWORD to an authorized administrator account.");
  }
  const app = initializeApp(config);
  const auth = getAuth(app);
  const database = getFirestore(app);
  await signInWithEmailAndPassword(auth, email, password);

  const profile = await getDoc(doc(database, "users", auth.currentUser.uid));
  if (!profile.exists() || !profile.data().active || profile.data().role !== "admin") throw new Error("An active administrator profile is required.");
  let imported = 0;
  let skipped = 0;
  for (const record of records) {
    const { id, ...payload } = record;
    const reference = doc(database, "issuances", id);
    const historyReference = doc(collection(reference, "history"));
    const key = encodeURIComponent(payload.reference_number.trim().replace(/\s+/g, " ").toUpperCase()).replace(/\./g, "%2E");
    const reservationReference = doc(database, "issuance_reference_numbers", key);
    const created = await runTransaction(database, async (transaction) => {
      const existing = await transaction.get(reference);
      // Re-imports never overwrite staff changes or bypass immutable history.
      if (existing.exists()) return false;
      const reservation = await transaction.get(reservationReference);
      if (reservation.exists()) throw new Error("Duplicate reference in import: " + payload.reference_number + ". Reconcile it before importing.");
      const after = { ...payload, reference_key: key, archived: false, version: 1,
        history_id: historyReference.id, created_at: serverTimestamp(), updated_at: serverTimestamp(), updated_by: profile.data().name };
      transaction.set(reference, after);
      transaction.set(historyReference, { action: "create", reason: "Spreadsheet migration", actor_id: auth.currentUser.uid,
        actor_name: profile.data().name, at: serverTimestamp(), version: 1, before: null, after });
      transaction.set(reservationReference, { issuance_id: id, reference_number: payload.reference_number, updated_at: serverTimestamp() });
      return true;
    });
    if (created) imported++; else skipped++;
  }
  console.log(`Imported ${imported}; skipped ${skipped} existing records.`);
  await signOut(auth);
}

console.log("Migration complete. Existing document IDs are skipped; staff edits and history are preserved.");
