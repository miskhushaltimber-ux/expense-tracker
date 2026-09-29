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

// wageEntries carry dateLabel ("DD-MM-YYYY" or "DD-MM-YYYY TO DD-MM-YYYY",
// see LaborWages.jsx's combineDateRange) rather than a real date field —
// this pulls a sortable timestamp out of the first date in that string.
// Unparseable/missing dates sort to the very end rather than the very
// start, so one bad row can't shove itself above everything else.
const parseWorkLogDate = (w) => {
  const first = String(w.dateLabel || "").split(" TO ")[0].trim();
  const [d, m, y] = first.split("-");
  if (!d || !m || !y) return Infinity;
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  return isNaN(dt.getTime()) ? Infinity : dt.getTime();
};

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
    // 25 Sep, per Rishi: "it adds up in the sheets down below but it is not
    // organised" — this tab used to get written in whatever order the store
    // returned rows (creation order), same gap the Expenses tab above
    // already avoided. Sorted by each entry's own date now, oldest first,
    // so this week's rows land together instead of wherever they happened
    // to be typed in.
    const sorted = [...wageEntries].sort((a, b) => parseWorkLogDate(a) - parseWorkLogDate(b));
    await exportWorkLogToSheet(sheetUrl, sorted, new Map(contractors.map((c) => [c._id, c])), "Work Log");
  } else if (kind === "payments") {
    const [payments, contractors] = await Promise.all([listPaymentsByUser(companyId), listContractorsByUser(companyId)]);
    const sorted = [...payments].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    await exportPaymentsToSheet(sheetUrl, sorted, new Map(contractors.map((c) => [c._id, c])), "Payments");
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
