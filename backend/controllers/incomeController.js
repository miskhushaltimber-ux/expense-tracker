import fs from "fs";
import path from "path";
import Income from "../models/Income.js";
import { PAYMENT_STATUSES } from "../constants/categories.js";
import { UPLOADS_DIR } from "../middleware/uploadMiddleware.js";
import { isValidCategory, resolveGst } from "../utils/categoryValidation.js";

const resolvePaymentStatus = (paymentStatus) =>
  PAYMENT_STATUSES.includes(paymentStatus) ? paymentStatus : "Paid";

const resolveCategory = async (userId, category, customCategory) => {
  if (!category || !(await isValidCategory(userId, "income", category))) {
    return { error: "A valid category is required" };
  }
  if (category === "Other" && !customCategory?.trim()) {
    return { error: "Please specify the category when choosing 'Other'" };
  }
  return { category, customCategory: category === "Other" ? customCategory.trim() : undefined };
};

const billFilePath = (req) => (req.file ? `/uploads/${req.file.filename}` : undefined);

// Add Income
export const addIncome = async (req, res) => {
  const {
    source,
    amount,
    category,
    customCategory,
    party,
    paymentMode,
    paymentStatus,
    dueDate,
    gstApplicable,
    gstRate,
    notes,
    date,
  } = req.body;

  if (!source || !amount) {
    return res.status(400).json({ message: "Source and amount are required" });
  }

  const resolved = await resolveCategory(req.user.id, category, customCategory);
  if (resolved.error) {
    return res.status(400).json({ message: resolved.error });
  }

  const status = resolvePaymentStatus(paymentStatus);
  const gst = resolveGst(gstApplicable, gstRate, amount);

  try {
    const income = await Income.create({
      user: req.user.id,
      source,
      amount,
      category: resolved.category,
      customCategory: resolved.customCategory,
      party,
      paymentMode,
      paymentStatus: status,
      dueDate: status === "Pending" && dueDate ? dueDate : null,
      ...gst,
      notes,
      billFile: billFilePath(req),
      date: date || new Date(),
    });
    res.status(201).json(income);
  } catch (error) {
    console.error("Error adding income:", error);
    res.status(500).json({ message: "Error adding income", error: error.message });
  }
};

// Get Incomes (for the logged-in user)
export const getIncomes = async (req, res) => {
  try {
    const incomes = await Income.find({ user: req.user.id }).sort({ date: -1 });
    res.json(incomes);
  } catch (error) {
    console.error("Error fetching incomes:", error);
    res.status(500).json({ message: "Error fetching incomes", error: error.message });
  }
};

// Category-wise totals, for the reports/dashboard view
export const getIncomeSummary = async (req, res) => {
  try {
    const incomes = await Income.find({ user: req.user.id });
    const totals = {};
    for (const i of incomes) {
      const label = i.category === "Other" ? i.customCategory || "Other" : i.category;
      totals[label] = (totals[label] || 0) + i.amount;
    }
    res.json(totals);
  } catch (error) {
    console.error("Error building income summary:", error);
    res.status(500).json({ message: "Error building income summary", error: error.message });
  }
};

// Update Income
export const updateIncome = async (req, res) => {
  const { id } = req.params;
  const {
    source,
    amount,
    category,
    customCategory,
    party,
    paymentMode,
    paymentStatus,
    dueDate,
    gstApplicable,
    gstRate,
    notes,
    date,
  } = req.body;

  try {
    const income = await Income.findById(id);
    if (!income) return res.status(404).json({ message: "Income not found" });

    if (income.user.toString() !== req.user.id)
      return res.status(403).json({ message: "Not authorized to update this income entry" });

    if (category) {
      const resolved = await resolveCategory(req.user.id, category, customCategory);
      if (resolved.error) {
        return res.status(400).json({ message: resolved.error });
      }
      income.category = resolved.category;
      income.customCategory = resolved.customCategory;
    }

    income.source = source || income.source;
    income.amount = amount || income.amount;
    income.party = party !== undefined ? party : income.party;
    income.paymentMode = paymentMode || income.paymentMode;
    income.notes = notes !== undefined ? notes : income.notes;
    income.date = date || income.date;

    if (paymentStatus !== undefined) {
      income.paymentStatus = resolvePaymentStatus(paymentStatus);
      income.dueDate = income.paymentStatus === "Pending" && dueDate ? dueDate : null;
      if (income.paymentStatus !== "Pending") income.lastReminderSentAt = null;
    }

    if (gstApplicable !== undefined || gstRate !== undefined) {
      const gst = resolveGst(
        gstApplicable !== undefined ? gstApplicable : income.gstApplicable,
        gstRate !== undefined ? gstRate : income.gstRate,
        income.amount
      );
      income.gstApplicable = gst.gstApplicable;
      income.gstRate = gst.gstRate;
      income.gstAmount = gst.gstAmount;
    }

    if (req.file) {
      if (income.billFile) {
        const oldPath = path.join(UPLOADS_DIR, path.basename(income.billFile));
        fs.unlink(oldPath, () => {});
      }
      income.billFile = billFilePath(req);
    }

    const updatedIncome = await income.save();
    res.json(updatedIncome);
  } catch (error) {
    console.error("Error updating income:", error);
    res.status(500).json({ message: "Error updating income", error: error.message });
  }
};

// Delete Income
export const deleteIncome = async (req, res) => {
  const { id } = req.params;

  try {
    const income = await Income.findById(id);
    if (!income) return res.status(404).json({ message: "Income not found" });

    if (income.user.toString() !== req.user.id)
      return res.status(403).json({ message: "Not authorized to delete this income entry" });

    if (income.billFile) {
      const filePath = path.join(UPLOADS_DIR, path.basename(income.billFile));
      fs.unlink(filePath, () => {});
    }

    await income.deleteOne();
    res.json({ message: "Income deleted successfully" });
  } catch (error) {
    console.error("Error deleting income:", error);
    res.status(500).json({ message: "Error deleting income", error: error.message });
  }
};
