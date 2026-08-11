import { readFile } from "node:fs/promises";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getFirestore, serverTimestamp, writeBatch } from "firebase/firestore";

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

  for (let offset = 0; offset < records.length; offset += 400) {
    const batch = writeBatch(database);
    for (const record of records.slice(offset, offset + 400)) {
      const { id, ...payload } = record;
      batch.set(doc(database, "issuances", id), {
        ...payload,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        updated_by: "Spreadsheet migration",
      }, { merge: true });
    }
    await batch.commit();
    console.log(`Imported ${Math.min(offset + 400, records.length)} / ${records.length}`);
  }
  await signOut(auth);
}

console.log("Migration complete. Re-running it is safe because source rows use deterministic document IDs.");
