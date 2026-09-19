// One-off migration: copies every row out of the old Google Sheets database
// into the new Firestore database, table by table, preserving each row's
// own `id` as the Firestore document ID. Uses the OLD Sheets reader
// (utils/sheetsDb.js) as the source and the Firestore client directly as the
// destination — this file is the only thing left that still reads from
// Sheets as a database once firestoreDb.js is live everywhere else.
//
// SAFE TO RUN MORE THAN ONCE: each table is skipped if its Firestore
// collection already has at least one document, so re-running this (e.g. by
// accidentally leaving RUN_MIGRATION=true set) never duplicates data.
//
// How it's triggered: server.js checks for RUN_MIGRATION=true at startup
// and calls runMigration() before the app starts serving requests. See
// backend/.env.example and claude/firestore-migration-scope.md for the full
// step-by-step.
import { getAllRows as getAllRowsFromSheets, isSheetsDbConfigured as isSheetsSourceConfigured } from "../utils/sheetsDb.js";
import { getFirestoreClient } from "../utils/firestoreClient.js";

const TABLES = [
  { name: "Users", headers: ["id", "name", "email", "passwordHash", "createdAt"] },
  {
    name: "Expenses",
    headers: [
      "id",
      "userId",
      "date",
      "expense",
      "amount",
      "master",
      "billFile",
      "createdAt",
      "updatedAt",
      "vehicleId",
      "litres",
      "odometer",
    ],
  },
  {
    name: "Vehicles",
    headers: [
      "id",
      "userId",
      "name",
      "numberPlate",
      "rcExpiry",
      "insuranceExpiry",
      "permitExpiry",
      "rcFile",
      "insuranceFile",
      "permitFile",
      "plateFile",
      "createdAt",
      "updatedAt",
    ],
  },
  { name: "Budgets", headers: ["id", "userId", "master", "monthlyBudget", "yearlyBudget", "createdAt", "updatedAt"] },
  { name: "Masters", headers: ["id", "userId", "name", "createdAt", "updatedAt"] },
  { name: "Locations", headers: ["id", "userId", "name", "createdAt", "updatedAt"] },
  { name: "Mills", headers: ["id", "userId", "location", "name", "createdAt", "updatedAt"] },
  {
    name: "Contractors",
    headers: [
      "id",
      "userId",
      "millId",
      "name",
      "mobile",
      "aadharFile",
      "panFile",
      "greenCardFile",
      "openingBalance",
      "createdAt",
      "updatedAt",
    ],
  },
  {
    name: "Labors",
    headers: ["id", "userId", "contractorId", "name", "mobile", "aadharFile", "panFile", "greenCardFile", "createdAt", "updatedAt"],
  },
  { name: "WageEntries", headers: ["id", "userId", "contractorId", "dateLabel", "cft", "rate", "createdAt", "updatedAt"] },
  { name: "Payments", headers: ["id", "userId", "contractorId", "date", "label", "amount", "createdAt", "updatedAt"] },
];

const CHUNK = 450;

const migrateTable = async (db, { name, headers }) => {
  const collectionRef = db.collection(name);

  const existing = await collectionRef.limit(1).get();
  if (!existing.empty) {
    console.log(`  ⏭  ${name}: Firestore already has data here — skipping (safe re-run)`);
    return;
  }

  const rows = await getAllRowsFromSheets(name, headers);
  if (!rows.length) {
    console.log(`  •  ${name}: no rows in the old Sheet — nothing to migrate`);
    return;
  }

  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = db.batch();
    for (const row of rows.slice(i, i + CHUNK)) {
      const data = {};
      headers.forEach((h) => {
        data[h] = row[h] ?? "";
      });
      // Every row already has its own `id` (crypto.randomUUID(), set when it
      // was first created) — reuse it as the Firestore document ID so ids
      // never change across the migration.
      batch.set(collectionRef.doc(String(row.id)), data);
    }
    await batch.commit();
  }
  console.log(`  ✅ ${name}: migrated ${rows.length} row(s)`);
};

export const runMigration = async () => {
  if (!isSheetsSourceConfigured()) {
    console.log("⏭  Skipping Sheets → Firestore migration — GOOGLE_SHEET_ID isn't set, so there's no old Sheet to read from.");
    return;
  }
  const db = getFirestoreClient();
  if (!db) {
    console.error("❌ Can't run the Sheets → Firestore migration — Firestore isn't configured (check GOOGLE_SERVICE_ACCOUNT_KEY / FIRESTORE_DATABASE_ID).");
    return;
  }

  console.log("🔄 Starting Sheets → Firestore migration...");
  for (const table of TABLES) {
    try {
      await migrateTable(db, table);
    } catch (error) {
      console.error(`  ❌ ${table.name}: ${error.message}`);
    }
  }
  console.log("🔄 Sheets → Firestore migration finished. Remove RUN_MIGRATION from your env vars now — it doesn't need to run again.");
};
