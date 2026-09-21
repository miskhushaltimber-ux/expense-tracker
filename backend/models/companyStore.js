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
import { ensureSheetTab, getAllRows, appendRow } from "../utils/firestoreDb.js";

const SHEET_NAME = "Companies";
const HEADERS = ["id", "name", "ownerId", "createdAt"];

export const ensureCompaniesSheet = () => ensureSheetTab(SHEET_NAME, HEADERS);

const toCompany = (row) => ({
  id: row.id,
  name: row.name,
  ownerId: row.ownerId,
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
