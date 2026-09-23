// Data backup (23 Sep, per Rishi: "add a backup system so that we dont lose
// any data in future"). Builds one JSON snapshot of EVERYTHING a company has
// in Firestore — every collection, every document, read raw (not through the
// store files' header lists) so no field is ever silently dropped, even one
// added in a future round. Uploaded files (bills, documents) live on
// Cloudinary, not Firestore; the snapshot keeps their URLs.
//
// Password hashes are deliberately left OUT — a backup gets emailed and
// downloaded, and a leaked copy shouldn't carry login secrets. After a
// restore, people just use "Forgot password" once.
import { getFirestoreClient } from "./firestoreClient.js";

// Collection name -> the field that says which company a document belongs
// to. Most stores kept the Sheets-era `userId` name (it holds the companyId
// since the multi-user change — see status.md, Fifteenth update).
export const BACKUP_COLLECTIONS = {
  Companies: "id",
  Users: "companyId",
  Expenses: "userId",
  Vehicles: "userId",
  Budgets: "userId",
  Masters: "userId",
  Locations: "userId",
  Mills: "userId",
  Contractors: "userId",
  Labors: "userId",
  WageEntries: "userId",
  Payments: "userId",
  ColumnDefs: "companyId",
  AuditLog: "companyId",
};

const OMIT_FIELDS = new Set(["passwordHash"]);

const requireDb = () => {
  const db = getFirestoreClient();
  if (!db) throw new Error("Firestore isn't configured on the server.");
  return db;
};

export const buildCompanyBackup = async (companyId) => {
  const db = requireDb();
  const collections = {};
  let totalDocs = 0;
  for (const [name, scopeField] of Object.entries(BACKUP_COLLECTIONS)) {
    const snap = await db.collection(name).where(scopeField, "==", companyId).get();
    collections[name] = snap.docs.map((doc) => {
      const data = { ...doc.data() };
      for (const f of OMIT_FIELDS) delete data[f];
      return { _docId: doc.id, ...data };
    });
    totalDocs += collections[name].length;
  }
  return {
    format: "expense-tracker-backup",
    version: 1,
    companyId,
    createdAt: new Date().toISOString(),
    totalDocs,
    collections,
  };
};

// Every company + its owner's email — used by the daily scheduled run.
export const listCompaniesWithOwners = async () => {
  const db = requireDb();
  const [companies, users] = await Promise.all([db.collection("Companies").get(), db.collection("Users").get()]);
  const usersById = new Map(users.docs.map((d) => [d.id, d.data()]));
  return companies.docs.map((d) => {
    const c = d.data();
    return { id: c.id || d.id, name: c.name || "", ownerEmail: usersById.get(c.ownerId)?.email || "" };
  });
};
