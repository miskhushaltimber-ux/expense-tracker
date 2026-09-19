// Budgets live as rows in the "Budgets" tab of the app's Google Sheet
// database — same pattern as expenseStore/vehicleStore.
//
// One row per (user, master). Each row holds a monthly limit and a yearly
// limit; either can be left blank, which means "no budget set for this
// master" rather than "a budget of zero". That distinction matters: a master
// with no budget is simply not reported on, whereas a master budgeted at 0
// would be permanently over.
//
// Spending is NOT stored here. It is always computed from the Expenses tab at
// read time, so a budget can never drift out of sync with what was actually
// spent.
import crypto from "crypto";
import { ensureSheetTab, getAllRows, appendRows, updateRowsAt } from "../utils/firestoreDb.js";

const SHEET_NAME = "Budgets";
const HEADERS = ["id", "userId", "master", "monthlyBudget", "yearlyBudget", "createdAt", "updatedAt"];

export const ensureBudgetsSheet = () => ensureSheetTab(SHEET_NAME, HEADERS);

// "" / null / 0 / rubbish all become null — "no budget set".
const toAmount = (raw) => {
  if (raw === "" || raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
};

const toBudget = (row) => ({
  master: row.master,
  monthlyBudget: toAmount(row.monthlyBudget),
  yearlyBudget: toAmount(row.yearlyBudget),
  updatedAt: row.updatedAt || null,
});

export const listBudgetsByUser = async (userId) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  return rows
    .filter((r) => r.userId === userId && r.master)
    .map(toBudget)
    .sort((a, b) => a.master.localeCompare(b.master));
};

// Masters are matched case-insensitively so "diesel" and "Diesel" can't end up
// as two competing budget rows, but the master's name is stored exactly as the
// caller spelled it.
const key = (master) => (master || "").trim().toLowerCase();

// Saves any number of budgets at once: one sheet read, then at most one
// batched update and one batched append. Entries whose master already has a
// row are updated in place; the rest are appended.
export const saveBudgetsForUser = async (userId, entries) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const mine = new Map();
  for (const r of rows) {
    if (r.userId === userId && r.master) mine.set(key(r.master), r);
  }

  const now = new Date().toISOString();
  const updates = [];
  const additions = [];
  const seen = new Set();

  for (const entry of entries) {
    const master = (entry.master || "").trim();
    if (!master) continue;
    const k = key(master);
    if (seen.has(k)) continue; // ignore a duplicate master in one payload
    seen.add(k);

    const monthly = toAmount(entry.monthlyBudget);
    const yearly = toAmount(entry.yearlyBudget);
    const existing = mine.get(k);

    if (existing) {
      updates.push({
        rowNumber: existing._row,
        rowObject: {
          ...existing,
          // Keep the spelling already on file. Saving "fuel & diesel" must not
          // rename the row away from "Fuel & Diesel" — the master name is what
          // joins a budget to its expenses, and a silent rename would break
          // that join without any visible error. Renaming a master is a
          // separate, deliberate action, not a side effect of a budget edit.
          master: existing.master,
          monthlyBudget: monthly ?? "",
          yearlyBudget: yearly ?? "",
          updatedAt: now,
        },
      });
    } else if (monthly !== null || yearly !== null) {
      // Only create a row once there's an actual budget to remember — typing
      // in a box and clearing it again shouldn't leave a blank row behind.
      additions.push({
        id: crypto.randomUUID(),
        userId,
        master,
        monthlyBudget: monthly ?? "",
        yearlyBudget: yearly ?? "",
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  if (updates.length) await updateRowsAt(SHEET_NAME, HEADERS, updates);
  if (additions.length) await appendRows(SHEET_NAME, HEADERS, additions);

  return listBudgetsByUser(userId);
};

// Keeps a budget attached to its master through a rename. Without this the
// budget would still be filed under the old name and would silently stop
// matching any spending — the same orphaning bug that turned up when
// different capitalisation rewrote a master name.
export const renameMasterOnBudgets = async (userId, oldName, newName) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const wanted = (oldName || "").trim().toLowerCase();
  const now = new Date().toISOString();
  const updates = rows
    .filter((r) => r.userId === userId && (r.master || "").trim().toLowerCase() === wanted)
    .map((r) => ({ rowNumber: r._row, rowObject: { ...r, master: newName, updatedAt: now } }));

  if (updates.length) await updateRowsAt(SHEET_NAME, HEADERS, updates);
  return updates.length;
};

// Used by the "a master in use can't be deleted" rule later on, and by the
// masters list, so budgets and masters never disagree about what exists.
export const budgetedMasters = async (userId) => {
  const budgets = await listBudgetsByUser(userId);
  return budgets.filter((b) => b.monthlyBudget !== null || b.yearlyBudget !== null).map((b) => b.master);
};
