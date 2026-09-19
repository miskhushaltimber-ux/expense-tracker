// Masters (ledger heads) as rows in the "Masters" tab of the app's Google
// Sheet database.
//
// Until now the master list was a hardcoded constant, which is why nobody
// could edit or remove one. It is now per-user data: on a user's first visit
// the preset list is copied into their own rows, and from then on it's theirs
// to rename, delete and add to. The constant in constants/categories.js
// survives only as the seed for that first copy.
import crypto from "crypto";
import { ensureSheetTab, getAllRows, appendRow, appendRows, updateRowAt, deleteRowAt } from "../utils/sheetsDb.js";
import { EXPENSE_MASTERS } from "../constants/categories.js";

const SHEET_NAME = "Masters";
const HEADERS = ["id", "userId", "name", "createdAt", "updatedAt"];

export const ensureMastersSheet = () => ensureSheetTab(SHEET_NAME, HEADERS);

const toMaster = (row) => ({
  _id: row.id,
  id: row.id,
  name: row.name,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const key = (name) => (name || "").trim().toLowerCase();

// Reads this user's masters, seeding them from the presets the first time.
// Order is preserved rather than sorted — the preset list is arranged the way
// the business thinks about its spending, and alphabetising it would scatter
// the vehicle heads away from each other.
export const listMastersByUser = async (userId) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const mine = rows.filter((r) => r.userId === userId && r.name);

  if (mine.length === 0) {
    const now = new Date().toISOString();
    const seeded = EXPENSE_MASTERS.map((name) => ({
      id: crypto.randomUUID(),
      userId,
      name,
      createdAt: now,
      updatedAt: now,
    }));
    await appendRows(SHEET_NAME, HEADERS, seeded);
    return seeded.map(toMaster);
  }

  // Defensive de-duplication: two tabs open at once could both decide the user
  // needs seeding. Duplicates are harmless in the sheet but confusing in a
  // dropdown, so only the first of each name is served.
  const seen = new Set();
  const out = [];
  for (const row of mine) {
    const k = key(row.name);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(toMaster(row));
  }
  return out;
};

export const createMaster = async (userId, name) => {
  const clean = (name || "").trim();
  if (!clean) return { error: "empty" };

  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const clash = rows.find((r) => r.userId === userId && key(r.name) === key(clean));
  if (clash) return { error: "duplicate", master: toMaster(clash) };

  const now = new Date().toISOString();
  const row = { id: crypto.randomUUID(), userId, name: clean, createdAt: now, updatedAt: now };
  await appendRow(SHEET_NAME, HEADERS, row);
  return { master: toMaster(row) };
};

const findOwnedRow = async (id, userId) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const row = rows.find((r) => r.id === id);
  if (!row) return { error: "not_found" };
  if (row.userId !== userId) return { error: "forbidden" };
  return { row, rows };
};

// Renames the master row only. Carrying the new name across to the expenses
// and budgets that use it is the controller's job — see masterController.
export const renameMaster = async (id, userId, name) => {
  const clean = (name || "").trim();
  if (!clean) return { error: "empty" };

  const { row, rows, error } = await findOwnedRow(id, userId);
  if (error) return { error };

  const clash = rows.find((r) => r.userId === userId && r.id !== id && key(r.name) === key(clean));
  if (clash) return { error: "duplicate" };

  const previousName = row.name;
  const merged = { ...row, name: clean, updatedAt: new Date().toISOString() };
  await updateRowAt(SHEET_NAME, HEADERS, row._row, merged);
  return { master: toMaster(merged), previousName };
};

export const deleteMaster = async (id, userId) => {
  const { row, error } = await findOwnedRow(id, userId);
  if (error) return { error };
  await deleteRowAt(SHEET_NAME, row._row);
  return { master: toMaster(row) };
};
