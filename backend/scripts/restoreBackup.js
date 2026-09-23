// Restore from a backup JSON (23 Sep, backup system).
//
//   node scripts/restoreBackup.js path/to/backup.json            <- dry run, changes nothing
//   node scripts/restoreBackup.js path/to/backup.json --apply    <- actually restores
//
// SAFE BY DEFAULT: only re-creates documents that are MISSING now. Anything
// that still exists is left untouched, so a restore can never overwrite
// newer edits. Run it from the backend folder with the same .env the server
// uses (GOOGLE_SERVICE_ACCOUNT_KEY, FIRESTORE_DATABASE_ID).
import "dotenv/config";
import fs from "fs";
import { getFirestoreClient } from "../utils/firestoreClient.js";

const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node scripts/restoreBackup.js <backup.json> [--apply]");
  process.exit(1);
}
const apply = flag === "--apply";
const backup = JSON.parse(fs.readFileSync(file, "utf8"));
if (backup.format !== "expense-tracker-backup") {
  console.error("That file isn't an expense-tracker backup.");
  process.exit(1);
}
const db = getFirestoreClient();
if (!db) {
  console.error("Firestore isn't configured — check backend/.env.");
  process.exit(1);
}

let toRestore = 0;
for (const [name, docs] of Object.entries(backup.collections)) {
  const existing = new Set((await db.collection(name).get()).docs.map((d) => d.id));
  const missing = docs.filter((d) => !existing.has(d._docId));
  toRestore += missing.length;
  console.log(`${name}: ${docs.length} in backup, ${missing.length} missing now`);
  if (!apply) continue;
  for (let i = 0; i < missing.length; i += 450) {
    const batch = db.batch();
    missing.slice(i, i + 450).forEach(({ _docId, ...data }) => batch.set(db.collection(name).doc(_docId), data));
    await batch.commit();
  }
}
console.log(apply ? `Restored ${toRestore} documents.` : `Dry run — ${toRestore} would be restored. Add --apply to do it.`);
console.log("Note: restored logins have no password — use 'Forgot password' to set one.");
process.exit(0);
