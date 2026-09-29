import { getSheetsClient, isGoogleAuthConfigured } from "./googleAuth.js";

// This file is for pushing to / pulling from ANY Google Sheet the user
// pastes a link for ("Export to Sheet" / "Import from Sheet" buttons) — a
// share/backup/import feature. It's separate from utils/sheetsDb.js, which
// is the app's own database (GOOGLE_SHEET_ID). Both share the same
// service-account auth client from googleAuth.js.

export const isGoogleSheetsConfigured = () => isGoogleAuthConfigured();

// Accepts either a full Google Sheets URL or a bare spreadsheet ID.
export const extractSheetId = (urlOrId) => {
  const trimmed = (urlOrId || "").trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmed;
};

// Exported (24 Sep) so the "email it as CSV" format option in
// sheetsController.js/labourSheetsController.js can build a CSV with the
// exact same columns this file already pushes to a live Google Sheet with,
// instead of a third, slightly-different column list.
export const SHEET_HEADER = ["Date", "Expense", "Amount", "Master", "Bill"];
export const WORK_LOG_HEADER = ["Contractor", "Date", "CFT", "Rate", "Amount"];
export const PAYMENTS_HEADER = ["Contractor", "Date", "Label", "Amount"];
export const COMBINED_LABOUR_HEADER = ["Type", "Contractor", "Date", "Details", "Amount"];

// 25 Sep, per Rishi: "for the worklog and payments sheet dont keep it
// seperatly enter both the data in one sheet only right side worklog and
// leftside payment" — the LINKED sheet's auto-sync (see sheetSync.js) now
// pushes both ledgers into this one tab side by side instead of two separate
// tabs: Payments in columns A-D, a blank spacer column E, Work Log starting
// at column F. They're independent tables (not row-matched to each other),
// each block cleared/written/formatted using only its own columns so a
// Payments save can never wipe the Work Log block and vice versa (see
// startCol below). The manual "Push to Google Sheet" buttons and "Export
// Everything" still write Work Log/Payments to their own separate tabs —
// this combined layout is specifically for the auto-synced linked sheet.
export const LABOUR_COMBINED_TAB = "Work Log & Payments";
export const PAYMENTS_START_COL = 0; // A
export const WORK_LOG_START_COL = 5; // F — D is Payments' last col (index 3), E (4) is the spacer

// A-Z only — every sheet this app writes has well under 26 columns per block.
const colLetter = (index) => String.fromCharCode(65 + index);

// Header/body styling for a pushed Google Sheet (24 Sep, per Rishi: "add
// google sheet which looks professional just like you did for excel") —
// mirrors utils/spreadsheetFile.js's own COLORS/CURRENCY_FMT so a Sheet
// looks like the same company report the .xlsx download already does: a
// bold white-on-navy header, thin borders, zebra-striped rows, right-aligned
// currency, a frozen + filterable header. Deliberately does NOT add the
// .xlsx version's merged title/subtitle band above the header — readSheetValues
// (see utils/importParser.js / labourImportParser.js) always treats row 1 as
// the header when reading a Sheet back in for import, so anything above row 1
// here would silently break re-import of a Sheet this app itself exported to.
const NAVY = { red: 0x1f / 255, green: 0x38 / 255, blue: 0x64 / 255 };
const WHITE = { red: 1, green: 1, blue: 1 };
const ZEBRA = { red: 0xf3 / 255, green: 0xf4 / 255, blue: 0xf6 / 255 };
const BORDER_GRAY = { red: 0xd1 / 255, green: 0xd5 / 255, blue: 0xdb / 255 };
const CURRENCY_NUM_FMT = { type: "CURRENCY", pattern: '"₹"#,##0' };

const getFirstSheetId = async (client, spreadsheetId) => {
  const res = await client.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  return res.data.sheets?.[0]?.properties?.sheetId ?? 0;
};

// 25 Sep, per Rishi ("one google sheet where things are separated like
// expense has split sheet, vehicle has separate split sheet, labor wages
// split sheet") — every export above wrote to the SAME first tab of
// whatever Sheet URL was pasted, so two exports into one Sheet just
// overwrote each other; "combined" labour existed only as a workaround
// (both ledgers jammed into that one tab with a Type column). This finds
// (or creates) a NAMED tab in the target spreadsheet so several exports can
// live side by side in one file — "Expenses", "Vehicles", "Work Log",
// "Payments" as their own tabs, not four different Sheets to keep track of.
const ensureTabId = async (client, spreadsheetId, tabName) => {
  const res = await client.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const existing = res.data.sheets?.find((s) => s.properties?.title === tabName);
  if (existing) return existing.properties.sheetId;

  try {
    const createRes = await client.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    });
    return createRes.data.replies?.[0]?.addSheet?.properties?.sheetId;
  } catch (error) {
    // 25 Sep — Work Log and Payments now share one tab (see LABOUR_COMBINED_TAB),
    // so on a freshly-linked sheet their two auto-syncs can both land here at
    // once, both find no existing tab, and both try to create it — the loser
    // gets Sheets API's "a sheet with this name already exists" error. Not a
    // real failure: the tab just got created by the other sync a moment ago,
    // so look it up instead of bubbling the error up and losing this write.
    const reason = error?.response?.data?.error?.message || error.message;
    if (!/already exists/i.test(reason)) throw error;
    const retry = await client.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
    const nowExisting = retry.data.sheets?.find((s) => s.properties?.title === tabName);
    if (nowExisting) return nowExisting.properties.sheetId;
    throw error; // genuinely not there — surface the original error
  }
};

// Applied best-effort, after the raw values are already safely written —
// a formatting hiccup (e.g. an odd sheet state) should never lose the export
// itself, so this only ever logs and swallows its own errors.
//
// startColumnIndex (25 Sep, "one sheet only right side worklog and leftside
// payment") — every range below is now relative to this offset instead of
// always starting at column A, so Payments and Work Log can each format only
// their own block of one shared tab without touching each other's columns.
//
// Zebra striping used to be one `addBanding` request over the whole data
// range. That's NOT idempotent — calling it again on a range that (mostly)
// already has a banded range from the previous sync throws "overlaps an
// existing banded range", which fails the ENTIRE batchUpdate (all requests
// in one batchUpdate succeed or fail together) and silently drops the bold
// header / borders / currency formatting along with it. That's almost
// certainly why formatting looked like it "worked once, then stopped" —
// every sync after the first one was quietly failing at this step (25 Sep,
// per Rishi: "all the sheets are unformated"). Replaced with one repeatCell
// per data row instead — more requests, but each one just overwrites that
// row's background color, safe to run any number of times.
// applyFilter (25 Sep) — a tab can only have ONE basic filter total, so when
// two independent blocks share a tab (Payments + Work Log), only one of them
// should try to own it — sheetSync.js passes false for both there.
const formatSheetProfessionally = async (
  client,
  spreadsheetId,
  { sheetId, numCols, numDataRows, currencyCols = [], startColumnIndex = 0, applyFilter = true }
) => {
  try {
    const border = { style: "SOLID", color: BORDER_GRAY };
    const lastRow = numDataRows + 1; // +1 for the header row, exclusive end index
    const startCol = startColumnIndex;
    const endCol = startColumnIndex + numCols;

    const requests = [
      // Bold, white-on-navy header row (row 1)
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: startCol, endColumnIndex: endCol },
          cell: {
            userEnteredFormat: {
              backgroundColor: NAVY,
              textFormat: { bold: true, foregroundColor: WHITE },
              verticalAlignment: "MIDDLE",
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
        },
      },
      // Thin borders around every written cell
      {
        updateBorders: {
          range: { sheetId, startRowIndex: 0, endRowIndex: lastRow, startColumnIndex: startCol, endColumnIndex: endCol },
          top: border,
          bottom: border,
          left: border,
          right: border,
          innerHorizontal: border,
          innerVertical: border,
        },
      },
      // Freeze the header row so it stays visible while scrolling — a
      // sheet-wide setting, harmless/shared no matter which block last set it.
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      // Filter dropdown on the header, same as the app's own sheet views —
      // skipped when this block shares a tab with another (see applyFilter above).
      ...(applyFilter
        ? [
            {
              setBasicFilter: {
                filter: { range: { sheetId, startRowIndex: 0, endRowIndex: lastRow, startColumnIndex: startCol, endColumnIndex: endCol } },
              },
            },
          ]
        : []),
      // Zebra-striped data rows, one repeatCell per row (see comment above
      // for why this replaced a single addBanding request).
      ...Array.from({ length: numDataRows }, (_, i) => ({
        repeatCell: {
          range: { sheetId, startRowIndex: 1 + i, endRowIndex: 2 + i, startColumnIndex: startCol, endColumnIndex: endCol },
          cell: { userEnteredFormat: { backgroundColor: i % 2 === 0 ? WHITE : ZEBRA } },
          fields: "userEnteredFormat.backgroundColor",
        },
      })),
      // Auto-resize columns to fit their content, like a real report rather
      // than the default uniform-width grid
      {
        autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: startCol, endIndex: endCol } },
      },
      // Right-aligned currency formatting on amount/rate columns
      ...currencyCols.map((colIndex) => ({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, endRowIndex: lastRow, startColumnIndex: startCol + colIndex, endColumnIndex: startCol + colIndex + 1 },
          cell: { userEnteredFormat: { numberFormat: CURRENCY_NUM_FMT, horizontalAlignment: "RIGHT" } },
          fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
        },
      })),
    ];

    await client.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  } catch (error) {
    console.warn("Google Sheet export: styling step failed (data was still written):", error?.response?.data?.error?.message || error.message);
  }
};

// Generic full-sheet writer, shared by exportExpensesToSheet and the Labor
// Wages exporters below — overwrites the given tab (the sheet's first tab by
// default, for every caller from before 25 Sep) with the given header +
// rows, then applies the styling above. A straightforward full re-export
// rather than an incremental sync, so the Google Sheet always mirrors
// exactly what's in the app.
//
// tabName (25 Sep, "export everything as separate tabs in one Sheet") —
// when given, writes/clears/formats that NAMED tab instead of always the
// first one, creating it first if it doesn't exist yet (see ensureTabId
// above). Left undefined, behaviour is byte-for-byte what it always was.
//
// startCol/applyFilter (25 Sep, "one sheet only right side worklog and
// leftside payment") — when startCol > 0, this only clears/writes/formats
// ITS OWN block of columns (startCol through startCol+header.length), never
// touching whatever another block (e.g. Payments) has written earlier in the
// same tab. applyFilter=false skips the "only one filter per tab" fight
// between two blocks sharing a tab — see formatSheetProfessionally's comment.
export const writeRowsToSheet = async (sheetIdOrUrl, header, rows, currencyCols = [], tabName = null, { startCol = 0, applyFilter = true } = {}) => {
  const client = getSheetsClient();
  if (!client) {
    throw new Error("Google Sheets sync isn't configured on the server yet");
  }
  const spreadsheetId = extractSheetId(sheetIdOrUrl);

  const startLetter = colLetter(startCol);
  const endLetter = colLetter(startCol + Math.max(header.length, 1) - 1);
  const tabPrefix = tabName ? `'${tabName}'!` : "";

  let sheetId;
  try {
    sheetId = tabName ? await ensureTabId(client, spreadsheetId, tabName) : await getFirstSheetId(client, spreadsheetId);
    const range = `${tabPrefix}${startLetter}1:${endLetter}100000`;
    const writeRange = `${tabPrefix}${startLetter}1`;
    await client.spreadsheets.values.clear({ spreadsheetId, range });
    await client.spreadsheets.values.update({
      spreadsheetId,
      range: writeRange,
      valueInputOption: "RAW",
      requestBody: { values: [header, ...rows] },
    });
  } catch (error) {
    const reason = error?.response?.data?.error?.message || error.message;
    throw new Error(
      `Couldn't write to that Google Sheet (${reason}). Make sure the Sheet is shared with the service account's email as an Editor.`
    );
  }

  await formatSheetProfessionally(client, spreadsheetId, {
    sheetId,
    numCols: header.length,
    numDataRows: rows.length,
    currencyCols,
    startColumnIndex: startCol,
    applyFilter,
  });
};

export const exportExpensesToSheet = async (sheetIdOrUrl, expenses, tabName = null) => {
  const rows = expenses.map((e) => [
    new Date(e.date).toLocaleDateString("en-IN"),
    e.expense,
    e.amount,
    e.master,
    e.billFile || "",
  ]);
  return writeRowsToSheet(sheetIdOrUrl, SHEET_HEADER, rows, [2], tabName);
};

// contractorsById maps a contractorId to its record, so the sheet shows the
// contractor's name rather than a UUID.
// writeOpts (25 Sep) — forwarded straight to writeRowsToSheet's {startCol,
// applyFilter}; left at the default (its own full-width tab) for every
// caller except sheetSync.js's linked-sheet auto-sync, which passes
// startCol: WORK_LOG_START_COL to land in the right-hand block of the
// shared "Work Log & Payments" tab instead of a separate tab.
export const exportWorkLogToSheet = async (sheetIdOrUrl, wageEntries, contractorsById = new Map(), tabName = null, writeOpts = {}) => {
  const rows = wageEntries.map((w) => [
    contractorsById.get(w.contractorId)?.name || "",
    w.dateLabel || "",
    Number(w.cft) || 0,
    Number(w.rate) || 0,
    Number(w.amount) || 0,
  ]);
  return writeRowsToSheet(sheetIdOrUrl, WORK_LOG_HEADER, rows, [3, 4], tabName, writeOpts);
};

export const exportPaymentsToSheet = async (sheetIdOrUrl, payments, contractorsById = new Map(), tabName = null, writeOpts = {}) => {
  const rows = payments.map((p) => [
    contractorsById.get(p.contractorId)?.name || "",
    p.date || "",
    p.label || "",
    Number(p.amount) || 0,
  ]);
  return writeRowsToSheet(sheetIdOrUrl, PAYMENTS_HEADER, rows, [3], tabName, writeOpts);
};

// 25 Sep, per Rishi: "one google sheet where things are separated" — pushes
// Expenses, Vehicles (vehicle-tagged expenses), Work Log and Payments each
// into their OWN tab of the SAME spreadsheet, one action instead of pasting
// the same Sheet link into four separate "Push to Google Sheet" buttons
// (which used to clobber each other anyway, see writeRowsToSheet above).
// Sequential, not Promise.all — two tabs being created at once against the
// same spreadsheet is exactly the kind of race ensureTabId shouldn't have
// to handle.
export const exportAllToSheet = async (sheetIdOrUrl, { expenses, vehicleExpenses, wageEntries, payments, contractorsById }) => {
  await exportExpensesToSheet(sheetIdOrUrl, expenses, "Expenses");
  await exportExpensesToSheet(sheetIdOrUrl, vehicleExpenses, "Vehicles");
  await exportWorkLogToSheet(sheetIdOrUrl, wageEntries, contractorsById, "Work Log");
  await exportPaymentsToSheet(sheetIdOrUrl, payments, contractorsById, "Payments");
  return {
    expenses: expenses.length,
    vehicles: vehicleExpenses.length,
    workLog: wageEntries.length,
    payments: payments.length,
  };
};

// 23 Sep, per Rishi: "when i share... using combined switch it just prints
// the worklog page or payment page and dont print both combined" — this
// combined path genuinely didn't exist before (exportLabourToSheet only
// ever branched on "payments" vs "worklog"). A Google Sheet only has ONE
// tab this feature writes to (see writeRowsToSheet's header comment), so
// "combined" here means both ledgers in that one tab, tagged by a Type
// column — same shape as the existing "Download Combined CSV" button, just
// pushed to a live Sheet instead of downloaded.
export const exportCombinedLabourToSheet = async (sheetIdOrUrl, wageEntries, payments, contractorsById = new Map()) => {
  const rows = [
    ...wageEntries.map((w) => [
      "Work Log",
      contractorsById.get(w.contractorId)?.name || "",
      w.dateLabel || "",
      `${Number(w.cft) || 0} CFT × ₹${Number(w.rate) || 0}`,
      Number(w.amount) || 0,
    ]),
    ...payments.map((p) => [
      "Payment",
      contractorsById.get(p.contractorId)?.name || "",
      p.date || "",
      p.label || "",
      Number(p.amount) || 0,
    ]),
  ];
  return writeRowsToSheet(sheetIdOrUrl, COMBINED_LABOUR_HEADER, rows, [4]);
};

// Reads every value out of the target sheet's first tab as a raw 2D array
// (headers in row 1), for the import-preview flow to map into expense rows.
export const readSheetValues = async (sheetIdOrUrl) => {
  const client = getSheetsClient();
  if (!client) {
    throw new Error("Google Sheets sync isn't configured on the server yet");
  }
  const spreadsheetId = extractSheetId(sheetIdOrUrl);

  try {
    const res = await client.spreadsheets.values.get({ spreadsheetId, range: "A1:Z100000" });
    return res.data.values || [];
  } catch (error) {
    const reason = error?.response?.data?.error?.message || error.message;
    throw new Error(
      `Couldn't read that Google Sheet (${reason}). Make sure the Sheet is shared with the service account's email, and the link/ID is correct.`
    );
  }
};
