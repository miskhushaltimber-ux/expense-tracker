import express from "express";
import { getBudgets, saveBudgets } from "../controllers/budgetController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/", getBudgets);
// One PUT saves every changed budget at once — see the controller for why.
router.put("/", saveBudgets);

export default router;
