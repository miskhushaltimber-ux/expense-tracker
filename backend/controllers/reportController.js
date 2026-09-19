import Expense from "../models/Expense.js";
import Income from "../models/Income.js";
import { getFYRange, getCurrentFYStartYear, fyLabel, parseFYParam } from "../utils/financialYear.js";

const monthKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const monthLabel = (key) => {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

// Income vs expense, month by month, for the trend chart on the dashboard.
// Includes both Paid and Pending transactions (same as the rest of the
// dashboard's totals) — this is about when the transaction was recorded,
// not whether the cash has actually moved yet.
export const getMonthlyTrend = async (req, res) => {
  const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);

  try {
    const [expenses, incomes] = await Promise.all([
      Expense.find({ user: req.user.id }, "amount date"),
      Income.find({ user: req.user.id }, "amount date"),
    ]);

    const totals = new Map(); // monthKey -> { income, expense }
    const bump = (date, field, amount) => {
      const key = monthKey(date);
      if (!totals.has(key)) totals.set(key, { income: 0, expense: 0 });
      totals.get(key)[field] += amount;
    };
    expenses.forEach((e) => bump(e.date, "expense", e.amount));
    incomes.forEach((i) => bump(i.date, "income", i.amount));

    // Build a continuous last-N-months timeline (including empty months) so
    // the trend line doesn't jump around missing gaps.
    const now = new Date();
    const series = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const bucket = totals.get(key) || { income: 0, expense: 0 };
      series.push({
        month: key,
        label: monthLabel(key),
        income: bucket.income,
        expense: bucket.expense,
        profit: bucket.income - bucket.expense,
      });
    }

    res.json(series);
  } catch (error) {
    console.error("Error building monthly trend:", error);
    res.status(500).json({ message: "Error building monthly trend", error: error.message });
  }
};

// All transactions still marked Pending, combined and sorted by due date so
// the dashboard can surface what needs collecting/paying soonest — and flag
// anything already overdue.
export const getPendingPayments = async (req, res) => {
  try {
    const [expenses, incomes] = await Promise.all([
      Expense.find({ user: req.user.id, paymentStatus: "Pending" }).sort({ dueDate: 1 }),
      Income.find({ user: req.user.id, paymentStatus: "Pending" }).sort({ dueDate: 1 }),
    ]);

    const now = new Date();
    const toItem = (doc, type) => ({
      _id: doc._id,
      type,
      title: type === "expense" ? doc.title : doc.source,
      party: doc.party || "",
      amount: doc.amount,
      dueDate: doc.dueDate,
      date: doc.date,
      overdue: !!(doc.dueDate && new Date(doc.dueDate) < now),
    });

    const items = [
      ...expenses.map((e) => toItem(e, "expense")),
      ...incomes.map((i) => toItem(i, "income")),
    ].sort((a, b) => {
      // Items with a due date first (soonest due first), undated ones last.
      if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return new Date(b.date) - new Date(a.date);
    });

    const totalPendingPayable = expenses.reduce((sum, e) => sum + e.amount, 0);
    const totalPendingReceivable = incomes.reduce((sum, i) => sum + i.amount, 0);
    const overdueCount = items.filter((it) => it.overdue).length;

    res.json({ items, totalPendingPayable, totalPendingReceivable, overdueCount });
  } catch (error) {
    console.error("Error fetching pending payments:", error);
    res.status(500).json({ message: "Error fetching pending payments", error: error.message });
  }
};

// GST collected (from sales) vs. paid (from purchases) for a period —
// ?fy=2025-2026, or ?month=YYYY-MM, or defaults to the current calendar
// month. Only counts entries explicitly marked gstApplicable.
export const getGstSummary = async (req, res) => {
  try {
    let start, end, label;
    const fyStart = parseFYParam(req.query.fy);

    if (fyStart !== null) {
      ({ start, end } = getFYRange(fyStart));
      label = fyLabel(fyStart);
    } else if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) {
      const [y, m] = req.query.month.split("-").map(Number);
      start = new Date(y, m - 1, 1);
      end = new Date(y, m, 0, 23, 59, 59, 999);
      label = monthLabel(req.query.month);
    } else {
      const now = new Date();
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      label = monthLabel(monthKey(now));
    }

    const [expenses, incomes] = await Promise.all([
      Expense.find(
        { user: req.user.id, gstApplicable: true, date: { $gte: start, $lte: end } },
        "amount gstAmount gstRate"
      ),
      Income.find(
        { user: req.user.id, gstApplicable: true, date: { $gte: start, $lte: end } },
        "amount gstAmount gstRate"
      ),
    ]);

    const gstPaid = expenses.reduce((sum, e) => sum + (e.gstAmount || 0), 0);
    const gstCollected = incomes.reduce((sum, i) => sum + (i.gstAmount || 0), 0);

    res.json({
      label,
      period: { start, end },
      gstCollected,
      gstPaid,
      netPayable: gstCollected - gstPaid,
      expenseCount: expenses.length,
      incomeCount: incomes.length,
    });
  } catch (error) {
    console.error("Error building GST summary:", error);
    res.status(500).json({ message: "Error building GST summary", error: error.message });
  }
};

// A full Indian financial year (Apr-Mar) broken down month by month, plus
// totals — ?fy=2025-2026, defaults to the FY containing today.
export const getFinancialYearSummary = async (req, res) => {
  try {
    const fyStart = parseFYParam(req.query.fy) ?? getCurrentFYStartYear();
    const { start, end } = getFYRange(fyStart);

    const [expenses, incomes] = await Promise.all([
      Expense.find({ user: req.user.id, date: { $gte: start, $lte: end } }, "amount date"),
      Income.find({ user: req.user.id, date: { $gte: start, $lte: end } }, "amount date"),
    ]);

    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(fyStart, 3 + i, 1); // rolls over into the next calendar year automatically
      return { month: monthKey(d), label: monthLabel(monthKey(d)), income: 0, expense: 0 };
    });

    const indexForDate = (date) => {
      const d = new Date(date);
      return (d.getFullYear() - fyStart) * 12 + (d.getMonth() - 3);
    };

    expenses.forEach((e) => {
      const idx = indexForDate(e.date);
      if (idx >= 0 && idx < 12) months[idx].expense += e.amount;
    });
    incomes.forEach((i) => {
      const idx = indexForDate(i.date);
      if (idx >= 0 && idx < 12) months[idx].income += i.amount;
    });
    months.forEach((m) => (m.profit = m.income - m.expense));

    const totals = months.reduce(
      (acc, m) => ({ income: acc.income + m.income, expense: acc.expense + m.expense }),
      { income: 0, expense: 0 }
    );

    res.json({ fy: fyLabel(fyStart), months, totals: { ...totals, profit: totals.income - totals.expense } });
  } catch (error) {
    console.error("Error building financial year summary:", error);
    res.status(500).json({ message: "Error building financial year summary", error: error.message });
  }
};
