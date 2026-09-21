import express from "express";
import {
  addExpense,
  getExpenses,
  getExpenseSummary,
  getMonthlyTrend,
  updateExpense,
  deleteExpense,
  bulkDeleteExpenses,
  bulkAddExpenses,
} from "../controllers/expenseController.js";
import protect, { requireOwner } from "../middleware/authMiddleware.js";
import { uploadBill } from "../middleware/uploadMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/", getExpenses);
router.get("/summary", getExpenseSummary);
router.get("/monthly-trend", getMonthlyTrend);
router.post("/", uploadBill, addExpense);
router.post("/bulk", bulkAddExpenses);
// POST, not DELETE: a DELETE with a request body is poorly supported by
// proxies and some HTTP clients drop it outright.
// Owner-only — deleting many rows at once is the highest-blast-radius action
// on the sheet, so it's kept separate from ordinary single-row add/edit/
// delete, which stays open to staff for day-to-day data entry.
router.post("/bulk-delete", requireOwner, bulkDeleteExpenses);
router.put("/:id", uploadBill, updateExpense);
router.delete("/:id", deleteExpense);

export default router;
