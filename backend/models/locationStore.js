// Locations (KTPL I, KTPL II, Reeling, Automatic, ...) as rows in the
// "Locations" tab of the app's Google Sheet database.
//
// Until now this was a hardcoded frontend constant (see the removed
// LOCATIONS array in ManageData.jsx) — labourStore.js's own header comment
// used to say as much, on the theory that sir's notes never asked for more
// than the original four. 18 Sep, per Rishi: "we gonna add more in near
// future" (plus a typo fix — it was "Rolling", it should be "Reeling") — so
// this is now per-user data, same pattern masterStore.js already uses for
// expense masters: on a user's first visit the preset four are copied into
// their own rows, and from then on they're theirs to rename, add to and
// remove.
import crypto from "crypto";
import { ensureSheetTab, getAllRows, appendRow, appendRows, updateRowAt, deleteRowAt } from "../utils/firestoreDb.js";

const SHEET_NAME = "Locations";
const HEADERS = ["id", "userId", "name", "createdAt", "updatedAt"];

// The fixed four sir's paper sheet started with — "Reeling", not "Rolling"
// (that was a typo carried over from the original hardcoded list).
const DEFAULT_LOCATIONS = ["KTPL I", "KTPL II", "Reeling", "Automatic"];

export const ensureLocationsSheet = () => ensureSheetTab(SHEET_NAME, HEADERS);

const toLocation = (row) => ({
  _id: row.id,
  id: row.id,
  name: row.name,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const key = (name) => (name || "").trim().toLowerCase();

// Reads this user's locations, seeding them from the defaults the first
// time — same seed-on-first-read approach as listMastersByUser.
export const listLocationsByUser = async (userId) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const mine = rows.filter((r) => r.userId === userId && r.name);

  if (mine.length === 0) {
    const now = new Date().toISOString();
    const seeded = DEFAULT_LOCATIONS.map((name) => ({
      id: crypto.randomUUID(),
      userId,
      name,
      createdAt: now,
      updatedAt: now,
    }));
    await appendRows(SHEET_NAME, HEADERS, seeded);
    return seeded.map(toLocation);
  }

  // Defensive de-duplication, same reasoning as listMastersByUser: two tabs
  // open at once could both decide the user needs seeding.
  const seen = new Set();
  const out = [];
  for (const row of mine) {
    const k = key(row.name);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(toLocation(row));
  }
  return out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
};

export const createLocation = async (userId, name) => {
  const clean = (name || "").trim();
  if (!clean) return { error: "empty" };

  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const clash = rows.find((r) => r.userId === userId && key(r.name) === key(clean));
  if (clash) return { error: "duplicate", location: toLocation(clash) };

  const now = new Date().toISOString();
  const row = { id: crypto.randomUUID(), userId, name: clean, createdAt: now, updatedAt: now };
  await appendRow(SHEET_NAME, HEADERS, row);
  return { location: toLocation(row) };
};

const findOwnedRow = async (id, userId) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const row = rows.find((r) => r.id === id);
  if (!row) return { error: "not_found" };
  if (row.userId !== userId) return { error: "forbidden" };
  return { row, rows };
};

// Renames the location row only. Carrying the new name across to the mills
// that reference it (by name, not id — see labourStore.js's comment on
// Mill.location) is the controller's job, same split masterController.js
// uses for renaming a master onto expenses/budgets.
export const renameLocation = async (id, userId, name) => {
  const clean = (name || "").trim();
  if (!clean) return { error: "empty" };

  const { row, rows, error } = await findOwnedRow(id, userId);
  if (error) return { error };

  const clash = rows.find((r) => r.userId === userId && r.id !== id && key(r.name) === key(clean));
  if (clash) return { error: "duplicate" };

  const previousName = row.name;
  const merged = { ...row, name: clean, updatedAt: new Date().toISOString() };
  await updateRowAt(SHEET_NAME, HEADERS, row._row, merged);
  return { location: toLocation(merged), previousName };
};

export const deleteLocation = async (id, userId) => {
  const { row, error } = await findOwnedRow(id, userId);
  if (error) return { error };
  await deleteRowAt(SHEET_NAME, row._row);
  return { location: toLocation(row) };
};
