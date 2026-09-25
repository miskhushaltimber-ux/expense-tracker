// Auto-sync to a company's linked Google Sheet (25 Sep, per Rishi: "can we
// link a sheet where every new entry updates itself in that sheet
// automatically?"). This is the background cousin of the manual "Push to
// Google Sheet" / "Export Everything" buttons in sheetsController.js /
// labourSheetsController.js — same underlying writeRowsToSheet/tab-per-kind
// machinery (see utils/googleSheets.js), just triggered automatically after
// a save instead of by a button click.
//
// Called from the store layer (expenseStore.js, labourStore.js) right after
// every create/update/delete, so it fires no matter which controller/route
// the change came through — a single choke point instead of remembering to
// wire it into every handler.
//
// Deliberately fire-and-forget: callers do NOT `await` this. A Sheets API
// hiccup (rate limit, revoked share, bad/unlinked link, network blip) must
// never delay or fail the actual save the user is waiting on — it only ever
// logs and swallows its own errors. The trade-off: if a sync silently fails,
// that one tab is stale until the next change to that ledger (or a manual
// "Push to Google Sheet") re-syncs it — there's no retry queue.
import { findCompanyById } from "../models/companyStore.js";
import { listExpensesByUser } from "../models/expenseStore.js";
import { listWageEntriesByUser, listPaymentsByUser, listContractorsByUser } from "../models/labourStore.js";
import { exportExpensesToSheet, exportWorkLogToSheet, exportPaymentsToSheet } from "./googleSheets.js";

// The real work, split out from syncLinkedSheet below so
// settingsController.js's "link this Sheet" action can await it directly and
// let a bad/unshared link surface as a real error immediately, instead of
// going through the swallow-everything wrapper meant for background calls.
// kind: "expenses" (also refreshes the Vehicles tab — same underlying data,
// just narrowed to vehicle-tagged rows) | "worklog" | "payments". Returns
// false (does nothing) when nothing is linked; true once it's actually
// written.
export const pushToLinkedSheet = async (companyId, kind) => {
  const company = await findCompanyById(companyId);
  const sheetUrl = company?.linkedSheetUrl;
  if (!sheetUrl) return false; // nothing linked — the common case

  if (kind === "expenses") {
    const all = [...(await listExpensesByUser(companyId))].sort((a, b) => new Date(a.date) - new Date(b.date));
    await exportExpensesToSheet(sheetUrl, all, "Expenses");
    await exportExpensesToSheet(sheetUrl, all.filter((e) => e.vehicleId), "Vehicles");
  } else if (kind === "worklog") {
    const [wageEntries, contractors] = await Promise.all([listWageEntriesByUser(companyId), listContractorsByUser(companyId)]);
    await exportWorkLogToSheet(sheetUrl, wageEntries, new Map(contractors.map((c) => [c._id, c])), "Work Log");
  } else if (kind === "payments") {
    const [payments, contractors] = await Promise.all([listPaymentsByUser(companyId), listContractorsByUser(companyId)]);
    await exportPaymentsToSheet(sheetUrl, payments, new Map(contractors.map((c) => [c._id, c])), "Payments");
  }
  return true;
};

// The fire-and-forget wrapper every store-layer call site above uses —
// same work, but never throws, so a Sheets hiccup can never delay or fail
// the save the user is actually waiting on.
export const syncLinkedSheet = async (companyId, kind) => {
  try {
    await pushToLinkedSheet(companyId, kind);
  } catch (error) {
    console.warn(`Linked Sheet auto-sync failed (companyId=${companyId}, kind=${kind}):`, error.message);
  }
};
