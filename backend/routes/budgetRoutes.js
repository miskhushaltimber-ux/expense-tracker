import express from "express";
import { getBudgets, saveBudgets } from "../controllers/budgetController.js";
import protect, { requireOwner } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

// Everyone can read budgets (the Expense Sheet's over-budget alerts need
// them); only the owner sets/changes them.
router.get("/", getBudgets);
// One PUT saves every changed budget at once — see the controller for why.
router.put("/", requireOwner, saveBudgets);

export default router;
