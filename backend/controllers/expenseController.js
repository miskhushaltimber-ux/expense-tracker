import {
  listExpensesByUser,
  createExpense,
  updateExpenseById,
  deleteExpenseById,
  deleteExpensesByIds,
  bulkCreateExpenses,
} from "../models/expenseStore.js";
import { storeFile, deleteStoredFile } from "../utils/fileStorage.js";
import { logAction } from "../utils/auditLog.js";
import { parseCustomFields } from "../utils/customFields.js";

// 19 Sep, multi-user accounts: every list/create/update/delete below is now
// scoped by req.user.companyId (the shared account), not req.user.id (the
// individual login) — so two logins on the same team see and edit the same
// data. req.user.id is still used, separately, to say WHO did it in the
// audit log. See status.md's Fifteenth update.
const actorFields = (req) => ({ actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role });

// Add Expense (one row of the sheet)
export const addExpense = async (req, res) => {
  const { date, expense, amount, master, vehicleId, litres, odometer } = req.body;

  if (!expense || !amount || !master) {
    return res.status(400).json({ message: "Expense, amount and master are required" });
  }

  try {
    const doc = await createExpense({
      userId: req.user.companyId,
      date: date || new Date(),
      expense,
      amount,
      master,
      billFile: await storeFile(req.file),
      vehicleId,
      litres,
      odometer,
      // 21 Sep, custom-columns feature. Arrives as a JSON string here since
      // this request is multipart/form-data (see toFormData in the
      // frontend's api/expenses.js) — parseCustomFields tolerates that.
      customFields: parseCustomFields(req.body.customFields),
    });
    logAction({
      companyId: req.user.companyId,
      ...actorFields(req),
      action: "created",
      entity: "expense",
      entityLabel: `${doc.expense} — ₹${doc.amount}`,
    });
    res.status(201).json(doc);
  } catch (error) {
    console.error("Error adding expense:", error);
    res.status(500).json({ message: error.message || "Error adding expense" });
  }
};

// Get All Expenses (for the whole company), most recent first
export const getExpenses = async (req, res) => {
  try {
    const expenses = await listExpensesByUser(req.user.companyId);
    res.json(expenses);
  } catch (error) {
    console.error("Error fetching expenses:", error);
    res.status(500).json({ message: error.message || "Error fetching expenses" });
  }
};

// Master-wise totals, for the dashboard's breakdown chart
export const getExpenseSummary = async (req, res) => {
  try {
    const expenses = await listExpensesByUser(req.user.companyId);
    const totals = {};
    for (const e of expenses) {
      totals[e.master] = (totals[e.master] || 0) + e.amount;
    }
    res.json(totals);
  } catch (error) {
    console.error("Error building expense summary:", error);
    res.status(500).json({ message: error.message || "Error building expense summary" });
  }
};

// Last N months of totals, for the dashboard's trend chart
export const getMonthlyTrend = async (req, res) => {
  const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 6));
  try {
    const expenses = await listExpensesByUser(req.user.companyId);
    const now = new Date();
    const buckets = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }), total: 0 });
    }
    const bucketByKey = new Map(buckets.map((b) => [b.key, b]));
    for (const e of expenses) {
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const bucket = bucketByKey.get(key);
      if (bucket) bucket.total += e.amount;
    }
    res.json(buckets.map(({ label, total }) => ({ label, total })));
  } catch (error) {
    console.error("Error building monthly trend:", error);
    res.status(500).json({ message: error.message || "Error building monthly trend" });
  }
};

// Update Expense (editing a cell/row in the sheet)
export const updateExpense = async (req, res) => {
  const { date, expense, amount, master, vehicleId, removeBill, litres, odometer } = req.body;

  try {
    const updates = {};
    if (date !== undefined) updates.date = date;
    if (expense !== undefined) updates.expense = expense;
    if (amount !== undefined) updates.amount = Number(amount);
    if (master !== undefined) updates.master = master;
    if (vehicleId !== undefined) updates.vehicleId = vehicleId;
    if (litres !== undefined) updates.litres = litres;
    if (odometer !== undefined) updates.odometer = odometer;
    if (req.body.customFields !== undefined) updates.customFields = parseCustomFields(req.body.customFields);

    // Two different things can happen to a bill: a new file replaces it, or
    // the user detaches it outright (the × in the Bill column). Both need the
    // old file cleaned up, so look the row up once and handle either case.
    // FormData sends booleans as strings, hence the "true" comparison.
    const isRemovingBill = removeBill === "true" || removeBill === true;
    if (req.file || isRemovingBill) {
      const existing = (await listExpensesByUser(req.user.companyId)).find((e) => e._id === req.params.id);
      if (existing?.billFile) await deleteStoredFile(existing.billFile);
      updates.billFile = req.file ? await storeFile(req.file) : "";
    }

    const { expense: updated, error } = await updateExpenseById(req.params.id, req.user.companyId, updates);
    if (error === "not_found") return res.status(404).json({ message: "Expense not found" });
    if (error === "forbidden") return res.status(403).json({ message: "Not authorized to update this expense" });
    logAction({
      companyId: req.user.companyId,
      ...actorFields(req),
      action: "updated",
      entity: "expense",
      entityLabel: `${updated.expense} — ₹${updated.amount}`,
    });
    res.json(updated);
  } catch (error) {
    console.error("Error updating expense:", error);
    res.status(500).json({ message: error.message || "Error updating expense" });
  }
};

// Delete Expense
export const deleteExpense = async (req, res) => {
  try {
    const { expense: deleted, error } = await deleteExpenseById(req.params.id, req.user.companyId);
    if (error === "not_found") return res.status(404).json({ message: "Expense not found" });
    if (error === "forbidden") return res.status(403).json({ message: "Not authorized to delete this expense" });

    if (deleted?.billFile) await deleteStoredFile(deleted.billFile);

    logAction({
      companyId: req.user.companyId,
      ...actorFields(req),
      action: "deleted",
      entity: "expense",
      entityLabel: `${deleted.expense} — ₹${deleted.amount}`,
    });
    res.json({ message: "Expense deleted successfully" });
  } catch (error) {
    console.error("Error deleting expense:", error);
    res.status(500).json({ message: error.message || "Error deleting expense" });
  }
};


// Bulk delete — one request for a whole selection, rather than one request per
// row. See deleteRowsAt in utils/firestoreDb.js for why this is not just a
// convenience: row-at-a-time deletion used to exhaust the old Google Sheets
// write quota. Owner-only — see routes/expenseRoutes.js.
export const bulkDeleteExpenses = async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "Expected a non-empty `ids` array." });
  }
  if (ids.length > 500) {
    return res.status(400).json({ message: "Too many rows in one request (limit 500). Delete them in batches." });
  }
  if (!ids.every((id) => typeof id === "string" && id.trim())) {
    return res.status(400).json({ message: "Every id must be a non-empty string." });
  }

  try {
    const { deleted, notFound, forbidden } = await deleteExpensesByIds(ids, req.user.companyId);

    // Bills are cleaned up afterwards, and never allowed to fail the delete:
    // the rows are already gone from the sheet by this point, so throwing here
    // would report failure for work that actually succeeded. A file left
    // behind in Cloudinary is a much smaller problem than a misleading error.
    const bills = deleted.filter((d) => d.billFile).map((d) => deleteStoredFile(d.billFile));
    const fileResults = await Promise.allSettled(bills);
    const filesFailed = fileResults.filter((r) => r.status === "rejected").length;
    if (filesFailed) {
      console.warn(`Deleted ${deleted.length} expenses but ${filesFailed} bill file(s) could not be removed.`);
    }

    if (deleted.length) {
      logAction({
        companyId: req.user.companyId,
        ...actorFields(req),
        action: "deleted",
        entity: "expense",
        entityLabel: `${deleted.length} expense${deleted.length === 1 ? "" : "s"} (bulk delete)`,
      });
    }

    res.json({
      message: `${deleted.length} ${deleted.length === 1 ? "entry" : "entries"} deleted`,
      deletedIds: deleted.map((d) => d._id),
      skipped: { notFound, forbidden },
    });
  } catch (error) {
    console.error("Error bulk deleting expenses:", error);
    res.status(500).json({ message: error.message || "Error deleting those entries" });
  }
};

// Bulk add — used when committing an imported/reviewed batch of sheet rows
// (from a file upload or a Google Sheet) in one call instead of one HTTP
// request per row.
export const bulkAddExpenses = async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: "No rows to import" });
  }

  const toInsert = [];
  const skipped = [];
  rows.forEach((row, i) => {
    const amount = Number(row.amount);
    if (row.include === false) return;
    if (!row.expense || !row.master || !amount || isNaN(amount) || amount <= 0) {
      skipped.push({ row: i + 1, reason: "Missing or invalid expense/amount/master" });
      return;
    }
    toInsert.push({
      date: row.date,
      expense: row.expense,
      amount,
      master: row.master,
      vehicleId: row.vehicleId,
      litres: row.litres,
      odometer: row.odometer,
      billFile: row.billFile,
    });
  });

  try {
    const saved = toInsert.length ? await bulkCreateExpenses(req.user.companyId, toInsert) : [];
    if (saved.length) {
      logAction({
        companyId: req.user.companyId,
        ...actorFields(req),
        action: "created",
        entity: "expense",
        entityLabel: `${saved.length} expense${saved.length === 1 ? "" : "s"} (import)`,
      });
    }
    res.status(201).json({ imported: saved.length, skipped });
  } catch (error) {
    console.error("Error bulk-adding expenses:", error);
    res.status(500).json({ message: error.message || "Some rows failed to save" });
  }
};
