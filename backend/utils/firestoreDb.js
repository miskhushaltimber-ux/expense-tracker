import { getFirestoreClient, isFirestoreConfigured } from "./firestoreClient.js";

// Firestore-backed database layer — replaces utils/sheetsDb.js as the app's
// real "database" module. Every store file (backend/models/*Store.js) calls
// these exact same function names with the exact same arguments; only their
// import path changed (from ../utils/sheetsDb.js to this file), so none of
// the store files' own logic needed to change at all.
//
// How the old Sheets model maps onto Firestore:
//   sheetName            -> a Firestore collection name (e.g. "Expenses")
//   one sheet row         -> one Firestore document
//   rowNumber / `_row`    -> the Firestore document's ID. Every row this app
//                            writes already carries its own `id` field
//                            (crypto.randomUUID(), set by the store file), so
//                            that value IS the document ID — there's no
//                            separate row-position bookkeeping to maintain.
//                            A nice side effect: "find by id" is now a
//                            direct document read instead of scanning every
//                            row (see findRowById below).
//   headers               -> kept only so every document is written with
//                            every expected field present (missing -> ""),
//                            matching the old sheet's fixed-column behaviour.
//                            Nothing here still literally has "headers".
//
// sheetsDb.js itself is untouched and kept around — it's still what powers
// the one-off migration script (scripts/migrateSheetsToFirestore.js) and the
// unrelated "export/import to a Google Sheet" feature (utils/googleSheets.js).

export const isSheetsDbConfigured = isFirestoreConfigured; // name kept so server.js's usage still reads naturally

const requireDb = () => {
  const db = getFirestoreClient();
  if (!db) {
    throw new Error(
      "Firestore isn't configured on the server yet — set GOOGLE_SERVICE_ACCOUNT_KEY (and FIRESTORE_DATABASE_ID, if your database isn't named \"(default)\") in backend/.env."
    );
  }
  return db;
};

const friendly = async (fn, action) => {
  try {
    return await fn();
  } catch (error) {
    throw new Error(`Firestore error while ${action}: ${error.message}`);
  }
};

// Every field in `headers` is guaranteed present on the returned object
// (missing -> ""), the same guarantee getAllRows always made against a
// sheet's fixed columns.
const fill = (headers, data) => {
  const obj = {};
  headers.forEach((h) => {
    obj[h] = data[h] ?? "";
  });
  return obj;
};

// Firestore collections are created implicitly on first write — there's
// nothing to prepare ahead of time the way a Sheets tab needed a header row.
// Kept as a real (async, no-op) export so server.js's startup calls, and
// every store file's ensure*Sheet() export, keep working unchanged.
export const ensureSheetTab = async () => {};

export const getAllRows = async (sheetName, headers) => {
  const db = requireDb();
  const snap = await friendly(() => db.collection(sheetName).get(), `reading "${sheetName}"`);
  return snap.docs.map((doc) => ({ _row: doc.id, ...fill(headers, doc.data()) }));
};

export const appendRow = async (sheetName, headers, rowObject) => appendRows(sheetName, headers, [rowObject]);

// Firestore batched writes top out at 500 operations each — chunked at 450
// to leave headroom, same spirit as the old code's 60-writes-per-minute care.
const CHUNK = 450;

export const appendRows = async (sheetName, headers, rowObjects) => {
  if (!rowObjects.length) return;
  const db = requireDb();
  const collectionRef = db.collection(sheetName);
  for (let i = 0; i < rowObjects.length; i += CHUNK) {
    const chunk = rowObjects.slice(i, i + CHUNK);
    await friendly(async () => {
      const batch = db.batch();
      chunk.forEach((obj) => {
        batch.set(collectionRef.doc(String(obj.id)), fill(headers, obj));
      });
      await batch.commit();
    }, `adding to "${sheetName}"`);
  }
};

// `rowNumber` here is really a document ID (see the mapping note above) —
// the parameter name is kept only so callers (findOwnedRow -> row._row in
// every store file) didn't need to change.
export const updateRowAt = async (sheetName, headers, rowNumber, rowObject) => {
  const db = requireDb();
  await friendly(
    () => db.collection(sheetName).doc(String(rowNumber)).set(fill(headers, rowObject)),
    `updating a row in "${sheetName}"`
  );
};

export const updateRowsAt = async (sheetName, headers, updates) => {
  if (!updates.length) return;
  const db = requireDb();
  const collectionRef = db.collection(sheetName);
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    await friendly(async () => {
      const batch = db.batch();
      chunk.forEach(({ rowNumber, rowObject }) => {
        batch.set(collectionRef.doc(String(rowNumber)), fill(headers, rowObject));
      });
      await batch.commit();
    }, `updating ${updates.length} rows in "${sheetName}"`);
  }
};

export const deleteRowAt = async (sheetName, rowNumber) => {
  const db = requireDb();
  await friendly(() => db.collection(sheetName).doc(String(rowNumber)).delete(), `deleting a row from "${sheetName}"`);
};

export const deleteRowsAt = async (sheetName, rowNumbers) => {
  if (!rowNumbers.length) return;
  const db = requireDb();
  const collectionRef = db.collection(sheetName);
  const unique = [...new Set(rowNumbers)];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    await friendly(async () => {
      const batch = db.batch();
      chunk.forEach((id) => batch.delete(collectionRef.doc(String(id))));
      await batch.commit();
    }, `deleting ${unique.length} rows from "${sheetName}"`);
  }
};

// A direct document read by ID — Firestore's actual advantage over the old
// full-tab scan every findRowById used to do against a Sheet.
export const findRowById = async (sheetName, headers, id) => {
  const db = requireDb();
  const doc = await friendly(
    () => db.collection(sheetName).doc(String(id)).get(),
    `looking up a row in "${sheetName}"`
  );
  if (!doc.exists) return null;
  return { _row: doc.id, ...fill(headers, doc.data()) };
};
