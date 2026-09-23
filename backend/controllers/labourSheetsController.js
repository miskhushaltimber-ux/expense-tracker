// Google Sheet / email share flow for the Labor Wages ledgers (Work Log,
// Payments) — same idea as sheetsController.js's expense version, just
// parameterized by `type` ("worklog" | "payments") instead of having one
// hardcoded shape, since there are two ledgers here instead of one.
import { listWageEntriesByUser, listPaymentsByUser, listContractorsByUser } from "../models/labourStore.js";
import { isGoogleSheetsConfigured, exportWorkLogToSheet, exportPaymentsToSheet, readSheetValues } from "../utils/googleSheets.js";
import { parseWorkLogValuesToPreview, parsePaymentValuesToPreview } from "../utils/labourImportParser.js";
import { buildWorkLogWorkbook, buildPaymentsWorkbook, buildCombinedLabourWorkbook, labourFileName } from "../utils/spreadsheetFile.js";
import { isEmailConfigured, sendLabourSheetEmail } from "../utils/mailer.js";

export const getLabourSheetsStatus = (req, res) => {
  res.json({ configured: isGoogleSheetsConfigured(), emailConfigured: isEmailConfigured() });
};

const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

const resolveType = (value) => (value === "payments" ? "payments" : value === "combined" ? "combined" : "worklog");

export const exportLabourToSheet = async (req, res) => {
  const { sheetUrl, type: rawType } = req.body;
  const type = resolveType(rawType);
  if (!sheetUrl || !sheetUrl.trim()) {
    return res.status(400).json({ message: "Paste the Google Sheet's link or ID first" });
  }

  try {
    const contractors = await listContractorsByUser(req.user.companyId);
    const contractorsById = new Map(contractors.map((c) => [c._id, c]));

    if (type === "payments") {
      const payments = (await listPaymentsByUser(req.user.companyId)).sort((a, b) => new Date(a.date) - new Date(b.date));
      await exportPaymentsToSheet(sheetUrl, payments, contractorsById);
      return res.json({ message: `Exported ${payments.length} payment${payments.length === 1 ? "" : "s"} to the Google Sheet`, count: payments.length });
    }

    const wageEntries = await listWageEntriesByUser(req.user.companyId);
    await exportWorkLogToSheet(sheetUrl, wageEntries, contractorsById);
    res.json({ message: `Exported ${wageEntries.length} entr${wageEntries.length === 1 ? "y" : "ies"} to the Google Sheet`, count: wageEntries.length });
  } catch (error) {
    console.error("Error exporting labour sheet to Google Sheet:", error.message);
    res.status(400).json({ message: error.message });
  }
};

export const emailLabourSheet = async (req, res) => {
  const { email, note, type: rawType } = req.body;
  const type = resolveType(rawType);
  if (!looksLikeEmail(email)) {
    return res.status(400).json({ message: "Enter a valid email address" });
  }

  try {
    const contractors = await listContractorsByUser(req.user.companyId);
    const contractorsById = new Map(contractors.map((c) => [c._id, c]));

    let buffer, count, total;
    if (type === "payments") {
      const payments = [...(await listPaymentsByUser(req.user.companyId))].sort((a, b) => new Date(a.date) - new Date(b.date));
      if (payments.length === 0) return res.status(400).json({ message: "There are no payments to send yet" });
      buffer = await buildPaymentsWorkbook(payments, contractorsById);
      count = payments.length;
      total = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    } else {
      const wageEntries = await listWageEntriesByUser(req.user.companyId);
      if (wageEntries.length === 0) return res.status(400).json({ message: "There are no work log entries to send yet" });
      buffer = await buildWorkLogWorkbook(wageEntries, contractorsById);
      count = wageEntries.length;
      total = wageEntries.reduce((sum, w) => sum + (Number(w.amount) || 0), 0);
    }

    await sendLabourSheetEmail({
      toEmail: email.trim(),
      fileName: labourFileName(type),
      buffer,
      count,
      total,
      note,
      type,
    });

    res.json({ message: `Sent ${count} ${count === 1 ? "entry" : "entries"} to ${email.trim()}`, count });
  } catch (error) {
    console.error("Error emailing the labour sheet:", error.message);
    res.status(400).json({ message: error.message || "Couldn't send that email" });
  }
};

// Direct file download of the same styled workbook emailLabourSheet builds —
// 23 Sep, per Rishi (see sheetsController.js's downloadExpenseSheet for the
// full reasoning). type: "worklog" | "payments" | "combined" (both ledgers
// as two tabs in one file — the Excel equivalent of "Download Combined CSV").
export const downloadLabourSheet = async (req, res) => {
  const type = resolveType(req.query.type);

  try {
    const contractors = await listContractorsByUser(req.user.companyId);
    const contractorsById = new Map(contractors.map((c) => [c._id, c]));

    let buffer;
    if (type === "combined") {
      const [wageEntries, payments] = await Promise.all([
        listWageEntriesByUser(req.user.companyId),
        listPaymentsByUser(req.user.companyId),
      ]);
      buffer = await buildCombinedLabourWorkbook(wageEntries, payments, contractorsById);
    } else if (type === "payments") {
      const payments = [...(await listPaymentsByUser(req.user.companyId))].sort((a, b) => new Date(a.date) - new Date(b.date));
      buffer = await buildPaymentsWorkbook(payments, contractorsById);
    } else {
      const wageEntries = await listWageEntriesByUser(req.user.companyId);
      buffer = await buildWorkLogWorkbook(wageEntries, contractorsById);
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${labourFileName(type)}"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Error building the labour sheet download:", error.message);
    res.status(400).json({ message: error.message || "Couldn't build that file" });
  }
};

// Reads a Google Sheet and returns preview rows shaped for the Work Log /
// Payments importer — mirrors sheetsController.js's previewFromSheet.
export const previewLabourFromSheet = async (req, res) => {
  const { sheetUrl, type: rawType } = req.body;
  const type = resolveType(rawType);
  if (!sheetUrl || !sheetUrl.trim()) {
    return res.status(400).json({ message: "Paste the Google Sheet's link or ID first" });
  }

  try {
    const values = await readSheetValues(sheetUrl);
    const parse = type === "payments" ? parsePaymentValuesToPreview : parseWorkLogValuesToPreview;
    const { rows, warnings, columnMapping } = parse(values);
    res.json({ rows, warnings, columnMapping, totalRows: rows.length });
  } catch (error) {
    console.error("Error importing labour sheet from Google Sheet:", error.message);
    res.status(400).json({ message: error.message });
  }
};
