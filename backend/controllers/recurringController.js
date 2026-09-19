import RecurringTransaction from "../models/RecurringTransaction.js";
import { computeNextRunDate } from "../utils/recurring.js";
import { isValidCategory } from "../utils/categoryValidation.js";
import { runDailyTasks } from "../utils/dailyTasks.js";

export const listRecurring = async (req, res) => {
  try {
    const items = await RecurringTransaction.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(items);
  } catch (error) {
    console.error("Error listing recurring transactions:", error);
    res.status(500).json({ message: "Error listing recurring transactions", error: error.message });
  }
};

export const addRecurring = async (req, res) => {
  const { type, title, amount, category, customCategory, party, paymentMode, dayOfMonth, endDate, notes } =
    req.body;

  if (!type || !["expense", "income"].includes(type)) {
    return res.status(400).json({ message: "type must be 'expense' or 'income'" });
  }
  if (!title || !amount) {
    return res.status(400).json({ message: "Title and amount are required" });
  }
  const day = Math.min(28, Math.max(1, parseInt(dayOfMonth, 10) || 0));
  if (!day) {
    return res.status(400).json({ message: "A day of month (1-28) is required" });
  }
  if (!(await isValidCategory(req.user.id, type, category))) {
    return res.status(400).json({ message: "A valid category is required" });
  }
  if (category === "Other" && !customCategory?.trim()) {
    return res.status(400).json({ message: "Please specify the category when choosing 'Other'" });
  }

  try {
    const recurring = await RecurringTransaction.create({
      user: req.user.id,
      type,
      title,
      amount,
      category,
      customCategory: category === "Other" ? customCategory.trim() : undefined,
      party,
      paymentMode,
      dayOfMonth: day,
      endDate: endDate || null,
      notes,
      nextRunDate: computeNextRunDate(day),
    });
    res.status(201).json(recurring);
  } catch (error) {
    console.error("Error adding recurring transaction:", error);
    res.status(500).json({ message: "Error adding recurring transaction", error: error.message });
  }
};

export const updateRecurring = async (req, res) => {
  const { title, amount, category, customCategory, party, paymentMode, dayOfMonth, active, endDate, notes } =
    req.body;

  try {
    const recurring = await RecurringTransaction.findById(req.params.id);
    if (!recurring) return res.status(404).json({ message: "Recurring transaction not found" });
    if (recurring.user.toString() !== req.user.id)
      return res.status(403).json({ message: "Not authorized to update this recurring transaction" });

    if (category) {
      if (!(await isValidCategory(req.user.id, recurring.type, category))) {
        return res.status(400).json({ message: "A valid category is required" });
      }
      recurring.category = category;
      recurring.customCategory = category === "Other" ? customCategory?.trim() : undefined;
    }

    if (title !== undefined) recurring.title = title;
    if (amount !== undefined) recurring.amount = amount;
    if (party !== undefined) recurring.party = party;
    if (paymentMode !== undefined) recurring.paymentMode = paymentMode;
    if (notes !== undefined) recurring.notes = notes;
    if (endDate !== undefined) recurring.endDate = endDate || null;
    if (active !== undefined) recurring.active = !!active;

    if (dayOfMonth !== undefined) {
      const day = Math.min(28, Math.max(1, parseInt(dayOfMonth, 10) || recurring.dayOfMonth));
      recurring.dayOfMonth = day;
      recurring.nextRunDate = computeNextRunDate(day);
    }

    const updated = await recurring.save();
    res.json(updated);
  } catch (error) {
    console.error("Error updating recurring transaction:", error);
    res.status(500).json({ message: "Error updating recurring transaction", error: error.message });
  }
};

export const deleteRecurring = async (req, res) => {
  try {
    const recurring = await RecurringTransaction.findById(req.params.id);
    if (!recurring) return res.status(404).json({ message: "Recurring transaction not found" });
    if (recurring.user.toString() !== req.user.id)
      return res.status(403).json({ message: "Not authorized to delete this recurring transaction" });

    await recurring.deleteOne();
    res.json({ message: "Recurring transaction deleted successfully" });
  } catch (error) {
    console.error("Error deleting recurring transaction:", error);
    res.status(500).json({ message: "Error deleting recurring transaction", error: error.message });
  }
};

// Lets a user trigger today's due recurring transactions/reminders on demand
// (mainly useful for testing right after setting one up, instead of waiting
// for the schedule) rather than only for this one user's templates, since
// the underlying job doesn't filter by user.
export const runNow = async (req, res) => {
  try {
    const summary = await runDailyTasks();
    res.json({ message: "Daily tasks run complete", ...summary });
  } catch (error) {
    console.error("Error running daily tasks on demand:", error);
    res.status(500).json({ message: "Error running daily tasks", error: error.message });
  }
};
