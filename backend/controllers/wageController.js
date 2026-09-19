import WageEntry from "../models/WageEntry.js";
import Expense from "../models/Expense.js";

const WAGE_CATEGORY = "Labor Wages";

export const getWageEntries = async (req, res) => {
  try {
    const entries = await WageEntry.find({ user: req.user.id }).sort({ date: -1 });
    res.json(entries);
  } catch (error) {
    console.error("Error fetching wage entries:", error);
    res.status(500).json({ message: "Error fetching wage entries", error: error.message });
  }
};

// Per-worker totals — paid so far, still pending, how many entries — for the
// summary view at the top of the Wages page.
export const getWageSummary = async (req, res) => {
  try {
    const entries = await WageEntry.find({ user: req.user.id });
    const totals = new Map();
    for (const e of entries) {
      const key = e.workerName.trim().toLowerCase();
      if (!totals.has(key)) {
        totals.set(key, { workerName: e.workerName.trim(), totalPaid: 0, totalPending: 0, entryCount: 0 });
      }
      const t = totals.get(key);
      if (e.paymentStatus === "Pending") t.totalPending += e.amount;
      else t.totalPaid += e.amount;
      t.entryCount += 1;
    }
    res.json(Array.from(totals.values()).sort((a, b) => b.totalPaid + b.totalPending - (a.totalPaid + a.totalPending)));
  } catch (error) {
    console.error("Error building wage summary:", error);
    res.status(500).json({ message: "Error building wage summary", error: error.message });
  }
};

// A wage entry always creates (and stays in sync with) a linked Expense
// under "Labor Wages", so it flows into the existing dashboard/reports/CSV
// export without any of that logic needing to know Wages exists.
export const addWageEntry = async (req, res) => {
  const { workerName, workDescription, amount, paymentMode, paymentStatus, dueDate, date, notes } = req.body;

  if (!workerName || !amount) {
    return res.status(400).json({ message: "Worker name and amount are required" });
  }
  const status = paymentStatus === "Pending" ? "Pending" : "Paid";

  try {
    const linkedExpense = await Expense.create({
      user: req.user.id,
      title: workDescription ? `Wage: ${workDescription}` : `Wage payment — ${workerName}`,
      amount,
      category: WAGE_CATEGORY,
      party: workerName,
      paymentMode,
      paymentStatus: status,
      dueDate: status === "Pending" && dueDate ? dueDate : null,
      notes,
      date: date || new Date(),
    });

    const wageEntry = await WageEntry.create({
      user: req.user.id,
      workerName,
      workDescription,
      amount,
      paymentMode,
      paymentStatus: status,
      dueDate: status === "Pending" && dueDate ? dueDate : null,
      date: date || new Date(),
      notes,
      linkedExpense: linkedExpense._id,
    });

    res.status(201).json(wageEntry);
  } catch (error) {
    console.error("Error adding wage entry:", error);
    res.status(500).json({ message: "Error adding wage entry", error: error.message });
  }
};

export const updateWageEntry = async (req, res) => {
  const { workerName, workDescription, amount, paymentMode, paymentStatus, dueDate, date, notes } = req.body;

  try {
    const wageEntry = await WageEntry.findById(req.params.id);
    if (!wageEntry) return res.status(404).json({ message: "Wage entry not found" });
    if (wageEntry.user.toString() !== req.user.id)
      return res.status(403).json({ message: "Not authorized to update this wage entry" });

    wageEntry.workerName = workerName || wageEntry.workerName;
    wageEntry.workDescription = workDescription !== undefined ? workDescription : wageEntry.workDescription;
    wageEntry.amount = amount || wageEntry.amount;
    wageEntry.paymentMode = paymentMode || wageEntry.paymentMode;
    wageEntry.notes = notes !== undefined ? notes : wageEntry.notes;
    wageEntry.date = date || wageEntry.date;
    if (paymentStatus !== undefined) {
      wageEntry.paymentStatus = paymentStatus === "Pending" ? "Pending" : "Paid";
      wageEntry.dueDate = wageEntry.paymentStatus === "Pending" && dueDate ? dueDate : null;
    }

    await wageEntry.save();

    if (wageEntry.linkedExpense) {
      await Expense.findByIdAndUpdate(wageEntry.linkedExpense, {
        title: wageEntry.workDescription ? `Wage: ${wageEntry.workDescription}` : `Wage payment — ${wageEntry.workerName}`,
        amount: wageEntry.amount,
        party: wageEntry.workerName,
        paymentMode: wageEntry.paymentMode,
        paymentStatus: wageEntry.paymentStatus,
        dueDate: wageEntry.dueDate,
        notes: wageEntry.notes,
        date: wageEntry.date,
      });
    }

    res.json(wageEntry);
  } catch (error) {
    console.error("Error updating wage entry:", error);
    res.status(500).json({ message: "Error updating wage entry", error: error.message });
  }
};

export const deleteWageEntry = async (req, res) => {
  try {
    const wageEntry = await WageEntry.findById(req.params.id);
    if (!wageEntry) return res.status(404).json({ message: "Wage entry not found" });
    if (wageEntry.user.toString() !== req.user.id)
      return res.status(403).json({ message: "Not authorized to delete this wage entry" });

    if (wageEntry.linkedExpense) {
      await Expense.findByIdAndDelete(wageEntry.linkedExpense);
    }
    await wageEntry.deleteOne();
    res.json({ message: "Wage entry deleted successfully" });
  } catch (error) {
    console.error("Error deleting wage entry:", error);
    res.status(500).json({ message: "Error deleting wage entry", error: error.message });
  }
};
