// Replaces the old Mongoose Expense model — expenses now live as rows in the
// "Expenses" tab of the app's Google Sheet database (see utils/sheetsDb.js).
// Same 5 user-facing fields as before (date, expense, amount, master, bill),
// plus id/userId/timestamps to make it work as a real table.
import crypto from "crypto";
import {
  ensureSheetTab,
  getAllRows,
  appendRow,
  appendRows,
  updateRowAt,
  updateRowsAt,
  deleteRowAt,
  deleteRowsAt,
} from "../utils/sheetsDb.js";

const SHEET_NAME = "Expenses";
const HEADERS = ["id", "userId", "date", "expense", "amount", "master", "billFile", "createdAt", "updatedAt", "vehicleId", "litres", "odometer"];

export const ensureExpensesSheet = () => ensureSheetTab(SHEET_NAME, HEADERS);

// Shapes a raw sheet row into the object the frontend already expects
// (it was built against Mongoose documents, so `_id` is kept as an alias).
// vehicleId is "" for a normal expense, or a Vehicle's id for one logged
// against a specific vehicle from the Vehicles page.
const toExpense = (row) => ({
  _id: row.id,
  id: row.id,
  user: row.userId,
  date: row.date,
  expense: row.expense,
  amount: Number(row.amount) || 0,
  master: row.master,
  billFile: row.billFile || null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  vehicleId: row.vehicleId || null,
  // Only set on fuel entries. Lets the Vehicles page work out rate per litre
  // (amount / litres) and spot a bill charged above the going rate.
  litres: row.litres === "" || row.litres === undefined ? null : Number(row.litres) || null,
  // Kilometre reading at the time of a fill. Paired with the previous fill's
  // reading it gives distance run, and distance / litres gives real mileage —
  // the only way to spot fuel going missing rather than just being overcharged.
  odometer: row.odometer === "" || row.odometer === undefined ? null : Number(row.odometer) || null,
});

const timeOf = (d) => {
  const t = new Date(d).getTime();
  return isNaN(t) ? 0 : t;
};

export const listExpensesByUser = async (userId) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  return rows
    .filter((r) => r.userId === userId)
    .map(toExpense)
    .sort((a, b) => timeOf(b.date) - timeOf(a.date) || timeOf(b.createdAt) - timeOf(a.createdAt));
};

export const createExpense = async ({ userId, date, expense, amount, master, billFile, vehicleId, litres, odometer }) => {
  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    userId,
    date: date ? new Date(date).toISOString() : now,
    expense,
    amount: Number(amount),
    master,
    billFile: billFile || "",
    createdAt: now,
    updatedAt: now,
    vehicleId: vehicleId || "",
    litres: litres === undefined || litres === null || litres === "" ? "" : Number(litres),
    odometer: odometer === undefined || odometer === null || odometer === "" ? "" : Number(odometer),
  };
  await appendRow(SHEET_NAME, HEADERS, row);
  return toExpense(row);
};

// Used by both file-upload import and Google Sheet import commit — appends
// many rows in a single API call instead of one call per row.
export const bulkCreateExpenses = async (userId, rows) => {
  const now = new Date().toISOString();
  const prepared = rows.map((r) => ({
    id: crypto.randomUUID(),
    userId,
    date: r.date && !isNaN(new Date(r.date).getTime()) ? new Date(r.date).toISOString() : now,
    expense: r.expense,
    amount: Number(r.amount),
    master: r.master,
    billFile: r.billFile || "",
    createdAt: now,
    updatedAt: now,
    // Optional, and only ever supplied by callers that have them (the seeder,
    // or a future import that maps these columns). A CSV import leaves them
    // blank, exactly as before.
    vehicleId: r.vehicleId || "",
    litres: r.litres === undefined || r.litres === null || r.litres === "" ? "" : Number(r.litres),
    odometer: r.odometer === undefined || r.odometer === null || r.odometer === "" ? "" : Number(r.odometer),
  }));
  await appendRows(SHEET_NAME, HEADERS, prepared);
  return prepared.map(toExpense);
};

const findOwnedRow = async (id, userId) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const row = rows.find((r) => r.id === id);
  if (!row) return { error: "not_found" };
  if (row.userId !== userId) return { error: "forbidden" };
  return { row };
};

export const updateExpenseById = async (id, userId, updates) => {
  const { row, error } = await findOwnedRow(id, userId);
  if (error) return { error };
  const merged = { ...row, ...updates, updatedAt: new Date().toISOString() };
  if (updates.date !== undefined) merged.date = new Date(updates.date).toISOString();
  if (updates.amount !== undefined) merged.amount = Number(updates.amount);
  if (updates.litres !== undefined) merged.litres = updates.litres === "" || updates.litres === null ? "" : Number(updates.litres);
  if (updates.odometer !== undefined)
    merged.odometer = updates.odometer === "" || updates.odometer === null ? "" : Number(updates.odometer);
  await updateRowAt(SHEET_NAME, HEADERS, row._row, merged);
  return { expense: toExpense(merged) };
};

export const deleteExpenseById = async (id, userId) => {
  const { row, error } = await findOwnedRow(id, userId);
  if (error) return { error };
  await deleteRowAt(SHEET_NAME, row._row);
  return { expense: toExpense(row) };
};

// --- master renaming / usage --------------------------------------------
// A master's NAME is the only link between an expense and its ledger head, so
// renaming one has to carry every entry with it. One read, then ONE batched
// write, however many rows are affected.
export const renameMasterOnExpenses = async (userId, oldName, newName) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const wanted = (oldName || "").trim().toLowerCase();
  const now = new Date().toISOString();
  const updates = rows
    .filter((r) => r.userId === userId && (r.master || "").trim().toLowerCase() === wanted)
    .map((r) => ({ rowNumber: r._row, rowObject: { ...r, master: newName, updatedAt: now } }));

  if (updates.length) await updateRowsAt(SHEET_NAME, HEADERS, updates);
  return updates.length;
};

// How many of this user's entries are filed under a master. Used to refuse
// deleting one that is still in use.
export const countExpensesUsingMaster = async (userId, name) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const wanted = (name || "").trim().toLowerCase();
  return rows.filter((r) => r.userId === userId && (r.master || "").trim().toLowerCase() === wanted).length;
};

// Deletes many expenses at once: ONE sheet read, then ONE batched delete,
// however many rows are selected. Rows belonging to someone else, or already
// gone, are reported back rather than failing the whole request — if one id in
// a selection of fifty is stale, the other forty-nine should still go.
export const deleteExpensesByIds = async (ids, userId) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const mine = [];
  const notFound = [];
  const forbidden = [];
  for (const id of new Set(ids)) {
    const row = byId.get(id);
    if (!row) notFound.push(id);
    else if (row.userId !== userId) forbidden.push(id);
    else mine.push(row);
  }

  if (mine.length) {
    await deleteRowsAt(
      SHEET_NAME,
      mine.map((r) => r._row)
    );
  }

  return { deleted: mine.map(toExpense), notFound, forbidden };
};
