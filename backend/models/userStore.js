// Replaces the old Mongoose User model — users now live as rows in the
// "Users" collection of the app's Firestore database (see utils/firestoreDb.js).
//
// 19 Sep — multi-user accounts: every user now belongs to a company
// (companyId) and holds a role ("owner" | "staff"). The company, not the
// individual login, is what all the app's data (Expenses, Vehicles, Masters,
// etc.) is actually scoped by — see companyStore.js and status.md's
// Fifteenth update. An "owner" is whoever's signup created the company;
// "staff" accounts are created by the owner from the Team page (/api/team),
// never via public signup.
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { ensureSheetTab, getAllRows, appendRow, findRowById, updateRowAt, deleteRowAt } from "../utils/firestoreDb.js";
import { createCompany } from "./companyStore.js";

const SHEET_NAME = "Users";
const HEADERS = ["id", "name", "email", "passwordHash", "companyId", "role", "createdAt"];

export const ensureUsersSheet = () => ensureSheetTab(SHEET_NAME, HEADERS);

export const findUserByEmail = async (email) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  return rows.find((r) => (r.email || "").toLowerCase() === String(email || "").toLowerCase()) || null;
};

export const findUserById = async (id) => findRowById(SHEET_NAME, HEADERS, id);

export const listUsersByCompany = async (companyId) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  return rows
    .filter((r) => r.companyId === companyId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
};

// Passwords are always bcrypt-hashed before they ever reach the sheet — the
// sheet never stores a plain-text password, only the hash.
//
// companyId/role are optional here on purpose: a brand-new signup doesn't
// have a company yet when this is called (createUser makes the row, then
// registerUser creates the company and comes back to set it — see
// userController.js), and createStaffAccount always supplies both up front.
export const createUser = async ({ name, email, password, companyId = "", role = "" }) => {
  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    email: String(email).toLowerCase().trim(),
    passwordHash,
    companyId,
    role,
    createdAt: new Date().toISOString(),
  };
  await appendRow(SHEET_NAME, HEADERS, user);
  return user;
};

export const verifyPassword = (plainPassword, passwordHash) => bcrypt.compare(plainPassword, passwordHash || "");

// Used by the password-reset flow, once the reset token/JWT has already
// been verified — re-hashes and overwrites just this one user's row.
export const updateUserPassword = async (id, newPlainPassword) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error("User not found");
  const passwordHash = await bcrypt.hash(newPlainPassword, 10);
  await updateRowAt(SHEET_NAME, HEADERS, row._row, { ...row, passwordHash });
};

// Attaches companyId/role to this user's row directly — used right after
// registerUser creates a brand-new company for a brand-new signup.
export const setUserCompany = async (id, { companyId, role }) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error("User not found");
  const merged = { ...row, companyId, role };
  await updateRowAt(SHEET_NAME, HEADERS, row._row, merged);
  return merged;
};

// Backfills companyId/role for a user whose row predates multi-user
// accounts (or whose still-valid JWT was issued before this feature and so
// carries neither field — see authMiddleware.js's fallback path). Idempotent
// and safe to call on every such request: once the row has a companyId this
// just returns it unchanged, no new company is ever created twice for the
// same user.
export const ensureUserHasCompany = async (id) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  if (row.companyId) return row;

  const company = await createCompany({ name: `${row.name || "My"}'s Company`, ownerId: row.id });
  const merged = { ...row, companyId: company.id, role: "owner" };
  await updateRowAt(SHEET_NAME, HEADERS, row._row, merged);
  return merged;
};

// Removing a staff account. The caller (teamController) is responsible for
// checking the target belongs to the same company and isn't the owner —
// this just does the delete once that's already been confirmed.
export const deleteUserById = async (id) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const row = rows.find((r) => r.id === id);
  if (!row) return { error: "not_found" };
  await deleteRowAt(SHEET_NAME, row._row);
  return { user: row };
};
