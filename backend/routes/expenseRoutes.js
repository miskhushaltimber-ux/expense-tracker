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
import protect from "../middleware/authMiddleware.js";
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
router.post("/bulk-delete", bulkDeleteExpenses);
router.put("/:id", uploadBill, updateExpense);
router.delete("/:id", deleteExpense);

export default router;
