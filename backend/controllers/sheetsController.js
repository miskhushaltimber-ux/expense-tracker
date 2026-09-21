import { listExpensesByUser } from "../models/expenseStore.js";
import { isGoogleSheetsConfigured, exportExpensesToSheet, readSheetValues } from "../utils/googleSheets.js";
import { parseSheetValuesToPreview } from "../utils/importParser.js";
import { resolveImportDestinations } from "../utils/importDestinations.js";
import { listVehiclesByUser } from "../models/vehicleStore.js";
import { buildExpensesWorkbook, expensesFileName } from "../utils/spreadsheetFile.js";
import { isEmailConfigured, sendExpenseSheetEmail } from "../utils/mailer.js";

export const getSheetsStatus = (req, res) => {
  res.json({ configured: isGoogleSheetsConfigured(), emailConfigured: isEmailConfigured() });
};

// A very basic sanity check — the mail server does the real validation, this
// just stops obvious typos before we build a whole workbook.
const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

// Emails the expense sheet as an .xlsx attachment. Deliberately NOT "create a
// Google Sheet and share it": service accounts on free Google accounts have
// zero Drive storage quota, so the app cannot create a Sheet at all. An
// emailed file needs no sharing setup and works for any address.
// scope: "vehicles" narrows to only vehicle-tagged expenses (Vehicles.jsx's
// Vehicle Expense Sheet); anything else (undefined, "all") keeps Expenses.jsx's
// existing behaviour unchanged.
export const emailSheet = async (req, res) => {
  const { email, note, scope } = req.body;
  if (!looksLikeEmail(email)) {
    return res.status(400).json({ message: "Enter a valid email address" });
  }

  try {
    const [allExpenses, vehicles] = await Promise.all([
      listExpensesByUser(req.user.companyId),
      listVehiclesByUser(req.user.companyId).catch(() => []),
    ]);
    const expenses = scope === "vehicles" ? allExpenses.filter((e) => e.vehicleId) : allExpenses;
    if (expenses.length === 0) {
      return res.status(400).json({ message: scope === "vehicles" ? "There are no vehicle expenses to send yet" : "There are no expenses to send yet" });
    }

    const ordered = [...expenses].sort((a, b) => new Date(a.date) - new Date(b.date));
    const vehiclesById = new Map(vehicles.map((v) => [v._id, v]));
    const buffer = buildExpensesWorkbook(ordered, vehiclesById);
    const total = ordered.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    await sendExpenseSheetEmail({
      toEmail: email.trim(),
      fileName: expensesFileName(),
      buffer,
      count: ordered.length,
      total,
      note,
      scopeLabel: scope === "vehicles" ? "vehicle expense sheet" : "expense sheet",
    });

    res.json({
      message: `Sent ${ordered.length} ${ordered.length === 1 ? "entry" : "entries"} to ${email.trim()}`,
      count: ordered.length,
    });
  } catch (error) {
    console.error("Error emailing the expense sheet:", error.message);
    res.status(400).json({ message: error.message || "Couldn't send that email" });
  }
};

// Pushes every one of the user's expenses into a Google Sheet the user
// owns/shares with the service account. Full overwrite, not incremental —
// the Sheet always ends up mirroring exactly what's in the app. This is
// separate from the app's own database sheet (GOOGLE_SHEET_ID) — this is a
// "share/back up a copy to any Sheet you like" feature.
export const exportToSheet = async (req, res) => {
  const { sheetUrl, scope } = req.body;
  if (!sheetUrl || !sheetUrl.trim()) {
    return res.status(400).json({ message: "Paste the Google Sheet's link or ID first" });
  }

  try {
    const allExpenses = await listExpensesByUser(req.user.companyId);
    const expenses = (scope === "vehicles" ? allExpenses.filter((e) => e.vehicleId) : allExpenses).sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );
    await exportExpensesToSheet(sheetUrl, expenses);
    res.json({ message: `Exported ${expenses.length} expense${expenses.length === 1 ? "" : "s"} to the Google Sheet`, count: expenses.length });
  } catch (error) {
    console.error("Error exporting to Google Sheet:", error.message);
    res.status(400).json({ message: error.message });
  }
};

// Reads a Google Sheet and returns preview rows — same shape the file-based
// import preview returns — so the frontend can reuse one review/commit UI
// regardless of whether the data came from a file or a live Sheet.
export const previewFromSheet = async (req, res) => {
  const { sheetUrl } = req.body;
  if (!sheetUrl || !sheetUrl.trim()) {
    return res.status(400).json({ message: "Paste the Google Sheet's link or ID first" });
  }

  try {
    const values = await readSheetValues(sheetUrl);
    const { rows, warnings, columnMapping } = parseSheetValuesToPreview(values);
    const { rows: resolvedRows, warnings: destWarnings, vehicleOptions, contractorOptions } = await resolveImportDestinations(
      rows,
      req.user.companyId
    );
    res.json({
      rows: resolvedRows,
      warnings: [...warnings, ...destWarnings],
      columnMapping,
      totalRows: resolvedRows.length,
      vehicleOptions,
      contractorOptions,
    });
  } catch (error) {
    console.error("Error importing from Google Sheet:", error.message);
    res.status(400).json({ message: error.message });
  }
};
