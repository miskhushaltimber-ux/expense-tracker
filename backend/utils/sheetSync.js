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
import {
  exportExpensesToSheet,
  exportWorkLogToSheet,
  exportPaymentsToSheet,
  LABOUR_COMBINED_TAB,
  PAYMENTS_START_COL,
  WORK_LOG_START_COL,
} from "./googleSheets.js";

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
    // 25 Sep, per Rishi: "dont keep it seperatly enter both the data in one
    // sheet only right side worklog and leftside payment" — Work Log now
    // lands in the right-hand block (from column F) of the shared
    // "Work Log & Payments" tab instead of its own "Work Log" tab.
    await exportWorkLogToSheet(sheetUrl, sorted, new Map(contractors.map((c) => [c._id, c])), LABOUR_COMBINED_TAB, {
      startCol: WORK_LOG_START_COL,
      applyFilter: false,
    });
  } else if (kind === "payments") {
    const [payments, contractors] = await Promise.all([listPaymentsByUser(companyId), listContractorsByUser(companyId)]);
    const sorted = [...payments].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    // Left-hand block (column A) of the same shared tab — see comment above.
    await exportPaymentsToSheet(sheetUrl, sorted, new Map(contractors.map((c) => [c._id, c])), LABOUR_COMBINED_TAB, {
      startCol: PAYMENTS_START_COL,
      applyFilter: false,
    });
  }
  return true;
};

// 25 Sep, per Rishi: "all the sheets are unformated and typography is bad
// too" — found it. Every create/update/delete fires its own syncLinkedSheet
// call, and each one independently does clear-the-tab -> rewrite every row
// -> reformat (bold header, borders, currency, zebra stripes). A burst of
// several saves close together (a bulk import, or just a few quick entries)
// fires several of THESE full cycles against the same tab at once. Two
// overlapping cycles can interleave — one's `clear()` landing in the middle
// of another's write, or the LAST cycle to actually finish having read the
// row list a beat before a slightly-later one added more rows — so whichever
// cycle's reformat step ends up covering fewer rows than are actually on the
// sheet leaves the extra rows with raw, unformatted numbers. That's exactly
// the pattern on Rishi's linked sheet: the older/Aug rows have the ₹
// formatting, everything from the 14–20 Sep batch onward doesn't. Fix: only
// one sync per (companyId, kind) actually runs at a time now. A sync
// requested while one's already in flight doesn't fire in parallel — it
// waits, then the queue runs ONE more full cycle afterward (not one per
// request piled up), so whatever's latest always ends up fully written and
// reformatted, no matter how many saves happened while it was busy.
const syncQueues = new Map(); // `${companyId}:${kind}` -> { running: Promise|null, rerunQueued: boolean }

const runSerialized = (key, fn) => {
  let entry = syncQueues.get(key);
  if (!entry) {
    entry = { running: null, rerunQueued: false };
    syncQueues.set(key, entry);
  }
  if (entry.running) {
    entry.rerunQueued = true;
    return entry.running;
  }
  const run = () =>
    fn().finally(() => {
      if (entry.rerunQueued) {
        entry.rerunQueued = false;
        entry.running = run();
      } else {
        entry.running = null;
      }
    });
  entry.running = run();
  return entry.running;
};

// The fire-and-forget wrapper every store-layer call site above uses —
// same work, but never throws, so a Sheets hiccup can never delay or fail
// the save the user is actually waiting on. Serialized per (companyId, kind)
// via runSerialized above so overlapping saves can't race each other's
// clear/write/format cycle on the same tab (see the comment there).
export const syncLinkedSheet = async (companyId, kind) => {
  try {
    await runSerialized(`${companyId}:${kind}`, () => pushToLinkedSheet(companyId, kind));
  } catch (error) {
    console.warn(`Linked Sheet auto-sync failed (companyId=${companyId}, kind=${kind}):`, error.message);
  }
};
