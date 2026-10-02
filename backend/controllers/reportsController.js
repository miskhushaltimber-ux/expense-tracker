// Monthly Report (2 Oct, per Rishi: "add an option where i send monthly
// report to my boss when a new month started and he can see every expense
// of the month in one report of the data we entered in the app"). Scoped
// via AskUserQuestion — a manual button Rishi clicks himself (not an
// automatic month-start send), building the FULL workbook (every row for
// the month, one tab per category) rather than a totals-only summary.
//
// Owner-only (see routes/reportsRoutes.js) — same bracket as Team & Activity/
// backup/Manage Data: account-wide reporting, not day-to-day entry.
import { listExpensesByUser } from "../models/expenseStore.js";
import { listVehiclesByUser } from "../models/vehicleStore.js";
import { listWageEntriesByUser, listPaymentsByUser, listContractorsByUser } from "../models/labourStore.js";
import { findCompanyById } from "../models/companyStore.js";
import { buildMonthlyReportWorkbook, monthlyReportFileName, parseWorkLogDateRange } from "../utils/spreadsheetFile.js";
import { sendMonthlyReportEmail, isEmailConfigured } from "../utils/mailer.js";
import { logAction } from "../utils/auditLog.js";

const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

// "YYYY-MM" (what an <input type="month"> gives the frontend) -> the
// [start, end) bounds used to filter every collection below, plus a human
// label for the title/subject line ("September 2026").
const monthBounds = (month) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1; // 0-based
  if (monthIdx < 0 || monthIdx > 11) return null;
  const start = new Date(year, monthIdx, 1);
  const end = new Date(year, monthIdx + 1, 1); // exclusive
  const label = start.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  return { start, end, label };
};

// Gathers + filters every collection for one month. Shared by both the
// email and the plain-download endpoints below so they can never drift.
const buildReportData = async (companyId, month) => {
  const bounds = monthBounds(month);
  if (!bounds) return { error: "bad_month" };

  const [allExpenses, vehicles, allWageEntries, allPayments, contractors, company] = await Promise.all([
    listExpensesByUser(companyId),
    listVehiclesByUser(companyId).catch(() => []),
    listWageEntriesByUser(companyId).catch(() => []),
    listPaymentsByUser(companyId).catch(() => []),
    listContractorsByUser(companyId).catch(() => []),
    findCompanyById(companyId).catch(() => null),
  ]);

  const inMonth = (dateStr) => {
    const d = new Date(dateStr);
    return !isNaN(d.getTime()) && d >= bounds.start && d < bounds.end;
  };
  const expenses = allExpenses.filter((e) => inMonth(e.date));
  const payments = allPayments.filter((p) => inMonth(p.date));
  // A Work Log batch is included if its date RANGE touches the month at
  // all, not only if it starts exactly inside it — see
  // utils/spreadsheetFile.js's parseWorkLogDateRange comment.
  const wageEntries = allWageEntries.filter((w) => {
    const range = parseWorkLogDateRange(w.dateLabel);
    return range && range.start < bounds.end && range.end >= bounds.start;
  });

  return {
    bounds,
    expenses,
    vehiclesById: new Map(vehicles.map((v) => [v._id, v])),
    wageEntries,
    payments,
    contractorsById: new Map(contractors.map((c) => [c._id, c])),
    companyName: company?.name || "",
  };
};

// GET /api/reports/monthly?month=YYYY-MM — straight download, same pattern
// as downloadExpenseSheet/downloadLabourSheet.
export const downloadMonthlyReport = async (req, res) => {
  try {
    const data = await buildReportData(req.user.companyId, req.query.month);
    if (data.error === "bad_month") return res.status(400).json({ message: "Pick a valid month" });

    const { buffer } = await buildMonthlyReportWorkbook({ monthLabel: data.bounds.label, companyName: data.companyName, ...data });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${monthlyReportFileName(req.query.month)}"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Error building monthly report:", error);
    res.status(500).json({ message: error.message || "Couldn't build the monthly report" });
  }
};

// POST /api/reports/monthly/email — body: { email, month, note }
export const emailMonthlyReport = async (req, res) => {
  const { email, month, note } = req.body;
  if (!looksLikeEmail(email)) return res.status(400).json({ message: "Enter a valid email address" });
  if (!isEmailConfigured()) return res.status(500).json({ message: "Email isn't set up on the server yet" });

  try {
    const data = await buildReportData(req.user.companyId, month);
    if (data.error === "bad_month") return res.status(400).json({ message: "Pick a valid month" });

    const { buffer, summary } = await buildMonthlyReportWorkbook({ monthLabel: data.bounds.label, companyName: data.companyName, ...data });
    await sendMonthlyReportEmail({
      toEmail: email.trim(),
      companyName: data.companyName,
      monthLabel: data.bounds.label,
      fileName: monthlyReportFileName(month),
      buffer: Buffer.from(buffer),
      summary,
      note,
    });

    logAction({
      companyId: req.user.companyId,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: "created",
      entity: "monthly-report",
      entityLabel: `Sent ${data.bounds.label} report to ${email.trim()}`,
    });

    res.json({ message: `${data.bounds.label} report sent to ${email.trim()}`, summary });
  } catch (error) {
    console.error("Error sending monthly report:", error);
    res.status(500).json({ message: error.message || "Couldn't send the monthly report" });
  }
};
