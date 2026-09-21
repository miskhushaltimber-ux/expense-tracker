// Custom columns (21 Sep, per Rishi: "wht if in future they need anything
// added in the sheet like any detailed column as important as master
// column") — lets anyone with a login add their own extra column to the
// Expense Sheet, the Vehicle Expense Sheet (same underlying data as the
// Expense Sheet — see the "expenses" sheetKey note below), and Labor Wages'
// Work Log / Payments tabs, without a code change or a deploy.
//
// A "column definition" just describes the column (its label, a stable
// machine key, a type, and — for a dropdown — its options); the actual
// value for a given row lives on that row's own entity as a small JSON blob
// (see the "customFields" header added to expenseStore.js/labourStore.js),
// not here. This file only manages the column's shape, scoped by company +
// which sheet it belongs to:
//   - "expenses"   -> the Expense Sheet AND the Vehicle Expense Sheet. These
//                     are the exact same Expenses rows (a vehicle expense is
//                     just an Expense with a vehicleId), so a column added
//                     from either sheet appears — and holds the same value —
//                     on both. There is deliberately no separate "vehicle"
//                     sheetKey.
//   - "wageEntries"-> Labor Wages' Work Log tab.
//   - "payments"   -> Labor Wages' Payments tab.
// Work Log and Payments get independent column sets since they're genuinely
// different ledgers (CFT/rate vs. date/label/amount) — a column meaningful
// on one usually isn't on the other.
//
// Scoped via AskUserQuestion, 21 Sep: Rishi chose "anyone with a login" for
// who can add/rename/delete a column (not owner-only, unlike Masters/Mills/
// Contractors/Vehicles/Budgets) — see routes/columnDefRoutes.js, which is
// gated by `protect` only, no `requireOwner`. He also chose to support
// text/number/date/dropdown from the start rather than text-only.
import crypto from "crypto";
import { ensureSheetTab, getAllRows, appendRow, updateRowAt, deleteRowAt } from "../utils/firestoreDb.js";

const SHEET_NAME = "ColumnDefs";
const HEADERS = ["id", "companyId", "sheetKey", "key", "label", "type", "options", "order", "createdAt", "updatedAt"];

export const SHEET_KEYS = ["expenses", "wageEntries", "payments"];
export const COLUMN_TYPES = ["text", "number", "date", "select"];

export const ensureColumnDefsSheet = () => ensureSheetTab(SHEET_NAME, HEADERS);

const toColumnDef = (row) => ({
  _id: row.id,
  id: row.id,
  sheetKey: row.sheetKey,
  key: row.key,
  label: row.label,
  type: row.type,
  options: row.options ? JSON.parse(row.options) : [],
  order: Number(row.order) || 0,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

// A stable, URL/JSON-safe field key derived from the label the user typed —
// this is what actually gets used as the property name inside a row's
// customFields blob, so it needs to survive the label being renamed later
// without orphaning already-saved values. Falls back to a short random
// suffix if the label has no lettersnumbers at all (e.g. someone names a
// column "!!!").
const slugify = (label) => {
  const base = (label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || `col_${crypto.randomBytes(3).toString("hex")}`;
};

export const listColumnDefsByCompany = async (companyId, sheetKey) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  return rows
    .filter((r) => r.companyId === companyId && r.sheetKey === sheetKey)
    .map(toColumnDef)
    .sort((a, b) => a.order - b.order || (a.label || "").localeCompare(b.label || ""));
};

export const createColumnDef = async ({ companyId, sheetKey, label, type, options }) => {
  const clean = (label || "").trim();
  if (!clean) return { error: "empty_label" };
  if (!SHEET_KEYS.includes(sheetKey)) return { error: "bad_sheet" };
  if (!COLUMN_TYPES.includes(type)) return { error: "bad_type" };

  const existing = await getAllRows(SHEET_NAME, HEADERS);
  const mine = existing.filter((r) => r.companyId === companyId && r.sheetKey === sheetKey);

  let baseKey = slugify(clean);
  let uniqueKey = baseKey;
  let n = 2;
  while (mine.some((r) => r.key === uniqueKey)) {
    uniqueKey = `${baseKey}_${n}`;
    n += 1;
  }
  if (mine.some((r) => r.label.trim().toLowerCase() === clean.toLowerCase())) {
    return { error: "duplicate" };
  }

  const cleanOptions = type === "select" ? (Array.isArray(options) ? options.map((o) => String(o).trim()).filter(Boolean) : []) : [];
  const maxOrder = mine.reduce((max, r) => Math.max(max, Number(r.order) || 0), 0);

  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    companyId,
    sheetKey,
    key: uniqueKey,
    label: clean,
    type,
    options: JSON.stringify(cleanOptions),
    order: maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  };
  await appendRow(SHEET_NAME, HEADERS, row);
  return { columnDef: toColumnDef(row) };
};

const findOwnedRow = async (id, companyId) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const row = rows.find((r) => r.id === id);
  if (!row) return { error: "not_found" };
  if (row.companyId !== companyId) return { error: "forbidden" };
  return { row };
};

// Renaming a column's label and/or editing a dropdown's options — NOT its
// type or its machine `key`, which every already-saved row's customFields
// blob is keyed by. Changing the type after rows already hold values in a
// different shape (a number typed into what's about to become a date field)
// has no safe migration, so it's kept out of scope rather than guessed at.
export const updateColumnDef = async (id, companyId, { label, options }) => {
  const { row, error } = await findOwnedRow(id, companyId);
  if (error) return { error };

  const updates = { ...row };
  if (label !== undefined) {
    const clean = (label || "").trim();
    if (!clean) return { error: "empty_label" };
    updates.label = clean;
  }
  if (options !== undefined && row.type === "select") {
    updates.options = JSON.stringify(Array.isArray(options) ? options.map((o) => String(o).trim()).filter(Boolean) : []);
  }
  updates.updatedAt = new Date().toISOString();
  await updateRowAt(SHEET_NAME, HEADERS, row._row, updates);
  return { columnDef: toColumnDef(updates) };
};

// Deleting a column definition only removes the definition — it does not
// scrub that column's values out of every row that ever had one (a bulk
// rewrite of every Expense/WageEntry/Payment just to blank one field is a
// lot of risk for a cosmetic cleanup). The value sits harmlessly unused in
// each row's customFields blob; recreating a column with the exact same
// label later would get a fresh machine key, not reconnect to the old data.
export const deleteColumnDef = async (id, companyId) => {
  const { row, error } = await findOwnedRow(id, companyId);
  if (error) return { error };
  await deleteRowAt(SHEET_NAME, row._row);
  return { columnDef: toColumnDef(row) };
};
