// Google Sheet / email share flow for the Labor Wages ledgers (Work Log,
// Payments) — same idea as sheetsController.js's expense version, just
// parameterized by `type` ("worklog" | "payments") instead of having one
// hardcoded shape, since there are two ledgers here instead of one.
import { listWageEntriesByUser, listPaymentsByUser, listContractorsByUser } from "../models/labourStore.js";
import {
  isGoogleSheetsConfigured,
  exportWorkLogToSheet,
  exportPaymentsToSheet,
  exportCombinedLabourToSheet,
  readSheetValues,
  writeRowsToSheet,
  WORK_LOG_HEADER,
  PAYMENTS_HEADER,
  COMBINED_LABOUR_HEADER,
} from "../utils/googleSheets.js";
import { parseWorkLogValuesToPreview, parsePaymentValuesToPreview } from "../utils/labourImportParser.js";
import { buildWorkLogWorkbook, buildPaymentsWorkbook, buildCombinedLabourWorkbook, labourFileName } from "../utils/spreadsheetFile.js";
import { isEmailConfigured, sendLabourSheetEmail, sendReportEmail } from "../utils/mailer.js";
import { rowsToCsv } from "../utils/csv.js";

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

    // 23 Sep — this "combined" branch used to not exist at all, so picking
    // it silently fell through to whichever tab's hardcoded type ("worklog"
    // or "payments") the Share Sheet modal was opened from — exactly the
    // bug Rishi reported ("it just prints the worklog page or payment page
    // and dont print both combined").
    if (type === "combined") {
      const [wageEntries, payments] = await Promise.all([
        listWageEntriesByUser(req.user.companyId),
        listPaymentsByUser(req.user.companyId),
      ]);
      await exportCombinedLabourToSheet(sheetUrl, wageEntries, payments, contractorsById);
      const total = wageEntries.length + payments.length;
      return res.json({ message: `Exported ${wageEntries.length} work log entries + ${payments.length} payments (${total} rows) to the Google Sheet`, count: total });
    }

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

// format: "csv" sends a plain .csv instead of the default formatted .xlsx
// (24 Sep, per Rishi: "give one dropdown where we can choose in which
// format we are sharing the sheets").
export const emailLabourSheet = async (req, res) => {
  const { email, note, type: rawType, format } = req.body;
  const type = resolveType(rawType);
  if (!looksLikeEmail(email)) {
    return res.status(400).json({ message: "Enter a valid email address" });
  }

  try {
    const contractors = await listContractorsByUser(req.user.companyId);
    const contractorsById = new Map(contractors.map((c) => [c._id, c]));

    let wageEntries = [];
    let payments = [];
    // 23 Sep — same missing branch as exportLabourToSheet above: "combined"
    // used to fall through to the `else` (worklog-only) case here, so
    // emailing "combined" silently sent just the work log, never payments.
    if (type === "combined") {
      [wageEntries, payments] = await Promise.all([
        listWageEntriesByUser(req.user.companyId),
        listPaymentsByUser(req.user.companyId),
      ]);
      if (wageEntries.length === 0 && payments.length === 0) {
        return res.status(400).json({ message: "There are no work log entries or payments to send yet" });
      }
    } else if (type === "payments") {
      payments = [...(await listPaymentsByUser(req.user.companyId))].sort((a, b) => new Date(a.date) - new Date(b.date));
      if (payments.length === 0) return res.status(400).json({ message: "There are no payments to send yet" });
    } else {
      wageEntries = await listWageEntriesByUser(req.user.companyId);
      if (wageEntries.length === 0) return res.status(400).json({ message: "There are no work log entries to send yet" });
    }

    const count = type === "combined" ? wageEntries.length + payments.length : type === "payments" ? payments.length : wageEntries.length;
    const total =
      wageEntries.reduce((sum, w) => sum + (Number(w.amount) || 0), 0) +
      payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    let buffer, fileName, contentType;
    if (format === "csv") {
      let header, rows;
      if (type === "combined") {
        header = COMBINED_LABOUR_HEADER;
        rows = [
          ...wageEntries.map((w) => [
            "Work Log",
            contractorsById.get(w.contractorId)?.name || "",
            w.dateLabel || "",
            `${Number(w.cft) || 0} CFT × ₹${Number(w.rate) || 0}`,
            Number(w.amount) || 0,
          ]),
          ...payments.map((p) => ["Payment", contractorsById.get(p.contractorId)?.name || "", p.date || "", p.label || "", Number(p.amount) || 0]),
        ];
      } else if (type === "payments") {
        header = PAYMENTS_HEADER;
        rows = payments.map((p) => [contractorsById.get(p.contractorId)?.name || "", p.date || "", p.label || "", Number(p.amount) || 0]);
      } else {
        header = WORK_LOG_HEADER;
        rows = wageEntries.map((w) => [
          contractorsById.get(w.contractorId)?.name || "",
          w.dateLabel || "",
          Number(w.cft) || 0,
          Number(w.rate) || 0,
          Number(w.amount) || 0,
        ]);
      }
      buffer = Buffer.from(rowsToCsv(header, rows), "utf8");
      fileName = labourFileName(type).replace(/\.xlsx$/, ".csv");
      contentType = "text/csv";
    } else if (type === "combined") {
      buffer = await buildCombinedLabourWorkbook(wageEntries, payments, contractorsById);
      fileName = labourFileName(type);
    } else if (type === "payments") {
      buffer = await buildPaymentsWorkbook(payments, contractorsById);
      fileName = labourFileName(type);
    } else {
      buffer = await buildWorkLogWorkbook(wageEntries, contractorsById);
      fileName = labourFileName(type);
    }

    await sendLabourSheetEmail({
      toEmail: email.trim(),
      fileName,
      buffer,
      count,
      total,
      note,
      type,
      contentType,
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

// --- Report tab download/share (24 Sep, per Rishi: "add the report to
// download or share option") -------------------------------------------
//
// Unlike Work Log/Payments above, the Report tab's numbers (Earned/Paid/
// Advance/Balance/Status per contractor) are computed entirely in the
// FRONTEND (SummaryReport in LaborWages.jsx) from data already fetched
// there — there's no separate server-side "report" to recompute, and
// duplicating that math here would just be a second, driftable copy of it.
// So these two handlers take the already-computed header + rows straight
// from the frontend and hand them to the existing generic CSV writer /
// Google Sheet writer, the same trust boundary Import already uses (a
// reviewed row set, not re-derived business logic).

export const exportReportToSheet = async (req, res) => {
  const { sheetUrl, header, rows } = req.body;
  if (!sheetUrl || !sheetUrl.trim()) {
    return res.status(400).json({ message: "Paste the Google Sheet's link or ID first" });
  }
  if (!Array.isArray(header) || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: "There's nothing in the report to export yet" });
  }

  try {
    await writeRowsToSheet(sheetUrl, header, rows);
    res.json({ message: `Exported ${rows.length} row${rows.length === 1 ? "" : "s"} to the Google Sheet`, count: rows.length });
  } catch (error) {
    console.error("Error exporting the report to Google Sheet:", error.message);
    res.status(400).json({ message: error.message });
  }
};

export const emailReport = async (req, res) => {
  const { email, note, header, rows, fileName, title } = req.body;
  if (!looksLikeEmail(email)) {
    return res.status(400).json({ message: "Enter a valid email address" });
  }
  if (!Array.isArray(header) || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: "There's nothing in the report to send yet" });
  }

  try {
    const buffer = Buffer.from(rowsToCsv(header, rows), "utf8");
    await sendReportEmail({
      toEmail: email.trim(),
      fileName: fileName || `report-${new Date().toISOString().split("T")[0]}.csv`,
      buffer,
      count: rows.length,
      note,
      title,
    });
    res.json({ message: `Sent the report (${rows.length} rows) to ${email.trim()}`, count: rows.length });
  } catch (error) {
    console.error("Error emailing the report:", error.message);
    res.status(400).json({ message: error.message || "Couldn't send that email" });
  }
};
