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

const SHEET_HEADER = ["Date", "Expense", "Amount", "Master", "Bill"];
const WORK_LOG_HEADER = ["Contractor", "Date", "CFT", "Rate", "Amount"];
const PAYMENTS_HEADER = ["Contractor", "Date", "Label", "Amount"];

// Generic full-sheet writer, shared by exportExpensesToSheet and the Labor
// Wages exporters below — overwrites the target sheet's first tab with the
// given header + rows. A straightforward full re-export rather than an
// incremental sync, so the Google Sheet always mirrors exactly what's in
// the app.
export const writeRowsToSheet = async (sheetIdOrUrl, header, rows) => {
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
};

export const exportExpensesToSheet = async (sheetIdOrUrl, expenses) => {
  const rows = expenses.map((e) => [
    new Date(e.date).toLocaleDateString("en-IN"),
    e.expense,
    e.amount,
    e.master,
    e.billFile || "",
  ]);
  return writeRowsToSheet(sheetIdOrUrl, SHEET_HEADER, rows);
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
  return writeRowsToSheet(sheetIdOrUrl, WORK_LOG_HEADER, rows);
};

export const exportPaymentsToSheet = async (sheetIdOrUrl, payments, contractorsById = new Map()) => {
  const rows = payments.map((p) => [
    contractorsById.get(p.contractorId)?.name || "",
    p.date || "",
    p.label || "",
    Number(p.amount) || 0,
  ]);
  return writeRowsToSheet(sheetIdOrUrl, PAYMENTS_HEADER, rows);
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
