import { listExpensesByUser } from "../models/expenseStore.js";
import { isGoogleSheetsConfigured, exportExpensesToSheet, readSheetValues } from "../utils/googleSheets.js";
import { parseSheetValuesToPreview } from "../utils/importParser.js";
import { resolveImportDestinations } from "../utils/importDestinations.js";
import { listVehiclesByUser } from "../models/vehicleStore.js";
import { buildExpensesWorkbook, expensesFileName } from "../utils/spreadsheetFile.js";
import { isEmailConfigured, sendExpenseSheetEmail } from "../utils/mailer.js";
import { rowsToCsv } from "../utils/csv.js";

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
// existing behaviour unchanged. format: "csv" sends a plain .csv instead of
// the default formatted .xlsx (24 Sep, per Rishi: "give one dropdown where
// we can choose in which format we are sharing the sheets").
export const emailSheet = async (req, res) => {
  const { email, note, scope, format } = req.body;
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
    const total = ordered.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    let buffer, fileName, contentType;
    if (format === "csv") {
      const header = scope === "vehicles" ? ["Date", "Vehicle", "Expense", "Amount (INR)", "Master"] : ["Date", "Expense", "Amount (INR)", "Master"];
      const rows = ordered.map((e) => {
        const row = [new Date(e.date).toLocaleDateString("en-IN")];
        if (scope === "vehicles") row.push(vehiclesById.get(e.vehicleId)?.name || "");
        row.push(e.expense, e.amount, e.master);
        return row;
      });
      buffer = Buffer.from(rowsToCsv(header, rows), "utf8");
      fileName = expensesFileName().replace(/\.xlsx$/, ".csv");
      contentType = "text/csv";
    } else {
      buffer = await buildExpensesWorkbook(ordered, vehiclesById);
      fileName = expensesFileName();
    }

    await sendExpenseSheetEmail({
      toEmail: email.trim(),
      fileName,
      buffer,
      count: ordered.length,
      total,
      note,
      scopeLabel: scope === "vehicles" ? "vehicle expense sheet" : "expense sheet",
      contentType,
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

// Streams the same styled workbook emailSheet builds, as a direct file
// download instead of an email attachment — 23 Sep, per Rishi: "downloaded"
// used to mean a plain .csv with no formatting at all; this gives the
// "Download Excel" button on the Expense Sheet / Vehicle Expense Sheet the
// same professional-looking file the email option already sends.
export const downloadExpenseSheet = async (req, res) => {
  const { scope } = req.query;

  try {
    const [allExpenses, vehicles] = await Promise.all([
      listExpensesByUser(req.user.companyId),
      listVehiclesByUser(req.user.companyId).catch(() => []),
    ]);
    const expenses = scope === "vehicles" ? allExpenses.filter((e) => e.vehicleId) : allExpenses;
    const ordered = [...expenses].sort((a, b) => new Date(a.date) - new Date(b.date));
    const vehiclesById = new Map(vehicles.map((v) => [v._id, v]));
    const buffer = await buildExpensesWorkbook(ordered, vehiclesById);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${expensesFileName()}"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Error building the expense sheet download:", error.message);
    res.status(400).json({ message: error.message || "Couldn't build that file" });
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
