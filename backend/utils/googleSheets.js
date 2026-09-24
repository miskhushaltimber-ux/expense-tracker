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

// Applied best-effort, after the raw values are already safely written —
// a formatting hiccup (e.g. an odd sheet state) should never lose the export
// itself, so this only ever logs and swallows its own errors.
const formatSheetProfessionally = async (client, spreadsheetId, { numCols, numDataRows, currencyCols = [] }) => {
  try {
    const sheetId = await getFirstSheetId(client, spreadsheetId);
    const border = { style: "SOLID", color: BORDER_GRAY };
    const lastRow = numDataRows + 1; // +1 for the header row, exclusive end index

    const requests = [
      // Bold, white-on-navy header row (row 1)
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: numCols },
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
          range: { sheetId, startRowIndex: 0, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: numCols },
          top: border,
          bottom: border,
          left: border,
          right: border,
          innerHorizontal: border,
          innerVertical: border,
        },
      },
      // Freeze the header row so it stays visible while scrolling
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      // Filter dropdown on the header, same as the app's own sheet views
      {
        setBasicFilter: {
          filter: { range: { sheetId, startRowIndex: 0, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: numCols } },
        },
      },
      // Zebra-striped data rows (excludes the header row entirely, so it
      // never fights with the header styling above)
      ...(numDataRows > 0
        ? [
            {
              addBanding: {
                bandedRange: {
                  range: { sheetId, startRowIndex: 1, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: numCols },
                  rowProperties: { firstBandColor: WHITE, secondBandColor: ZEBRA },
                },
              },
            },
          ]
        : []),
      // Auto-resize columns to fit their content, like a real report rather
      // than the default uniform-width grid
      {
        autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: numCols } },
      },
      // Right-aligned currency formatting on amount/rate columns
      ...currencyCols.map((colIndex) => ({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, endRowIndex: lastRow, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 },
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
// Wages exporters below — overwrites the target sheet's first tab with the
// given header + rows, then applies the styling above. A straightforward
// full re-export rather than an incremental sync, so the Google Sheet always
// mirrors exactly what's in the app.
export const writeRowsToSheet = async (sheetIdOrUrl, header, rows, currencyCols = []) => {
  const client = getSheetsClient();
  if (!client) {
    throw new Error("Google Sheets sync isn't configured on the server yet");
  }
  const spreadsheetId = extractSheetId(sheetIdOrUrl);

  try {
    await client.spreadsheets.values.clear({ spreadsheetId, range: "A1:Z100000" });
    await client.spreadsheets.values.update({
      spreadsheetId,
      range: "A1",
      valueInputOption: "RAW",
      requestBody: { values: [header, ...rows] },
    });
  } catch (error) {
    const reason = error?.response?.data?.error?.message || error.message;
    throw new Error(
      `Couldn't write to that Google Sheet (${reason}). Make sure the Sheet is shared with the service account's email as an Editor.`
    );
  }

  await formatSheetProfessionally(client, spreadsheetId, { numCols: header.length, numDataRows: rows.length, currencyCols });
};

export const exportExpensesToSheet = async (sheetIdOrUrl, expenses) => {
  const rows = expenses.map((e) => [
    new Date(e.date).toLocaleDateString("en-IN"),
    e.expense,
    e.amount,
    e.master,
    e.billFile || "",
  ]);
  return writeRowsToSheet(sheetIdOrUrl, SHEET_HEADER, rows, [2]);
};

// contractorsById maps a contractorId to its record, so the sheet shows the
// contractor's name rather than a UUID.
export const exportWorkLogToSheet = async (sheetIdOrUrl, wageEntries, contractorsById = new Map()) => {
  const rows = wageEntries.map((w) => [
    contractorsById.get(w.contractorId)?.name || "",
    w.dateLabel || "",
    Number(w.cft) || 0,
    Number(w.rate) || 0,
    Number(w.amount) || 0,
  ]);
  return writeRowsToSheet(sheetIdOrUrl, WORK_LOG_HEADER, rows, [3, 4]);
};

export const exportPaymentsToSheet = async (sheetIdOrUrl, payments, contractorsById = new Map()) => {
  const rows = payments.map((p) => [
    contractorsById.get(p.contractorId)?.name || "",
    p.date || "",
    p.label || "",
    Number(p.amount) || 0,
  ]);
  return writeRowsToSheet(sheetIdOrUrl, PAYMENTS_HEADER, rows, [3]);
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
