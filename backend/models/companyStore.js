// Companies — the multi-user account boundary. Everything that used to be
// scoped by a single user's own id (Expenses, Vehicles, Masters, Mills,
// Contractors, Labor, Locations, Budgets, WageEntries, Payments) is now
// scoped by companyId instead, so several logins can share one dataset.
//
// A company is created once, automatically: at signup (the new user becomes
// its owner), or lazily for an account that existed before this feature
// (see ensureUserHasCompany in userStore.js) — nobody ever has to "set up a
// company" by hand. From there the owner adds staff logins via /api/team,
// and every staff account carries the same companyId.
import crypto from "crypto";
import { ensureSheetTab, getAllRows, appendRow, findRowById, updateRowAt } from "../utils/firestoreDb.js";

const SHEET_NAME = "Companies";
// linkedSheetUrl (25 Sep, per Rishi: "link a sheet where every new entry
// updates itself in that sheet automatically") — one Google Sheet link per
// company, set once from the Settings menu. Blank means auto-sync is off;
// see utils/sheetSync.js for what happens when it's set.
const HEADERS = ["id", "name", "ownerId", "linkedSheetUrl", "createdAt"];

export const ensureCompaniesSheet = () => ensureSheetTab(SHEET_NAME, HEADERS);

const toCompany = (row) => ({
  id: row.id,
  name: row.name,
  ownerId: row.ownerId,
  linkedSheetUrl: row.linkedSheetUrl || "",
  createdAt: row.createdAt,
});

export const createCompany = async ({ name, ownerId }) => {
  const row = {
    id: crypto.randomUUID(),
    name: (name || "Company").trim(),
    ownerId,
    createdAt: new Date().toISOString(),
  };
  await appendRow(SHEET_NAME, HEADERS, row);
  return toCompany(row);
};

export const findCompanyById = async (id) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const row = rows.find((r) => r.id === id);
  return row ? toCompany(row) : null;
};

// 25 Sep — the only mutable field on a Company so far. sheetUrl === "" (or
// null) unlinks; anything else replaces the current link outright, same
// "paste a new one to replace it" behaviour as every other Sheet-link field
// in this app.
export const setLinkedSheet = async (companyId, sheetUrl) => {
  const row = await findRowById(SHEET_NAME, HEADERS, companyId);
  if (!row) return { error: "not_found" };
  const merged = { ...row, linkedSheetUrl: (sheetUrl || "").trim() };
  await updateRowAt(SHEET_NAME, HEADERS, row._row, merged);
  return { company: toCompany(merged) };
};
