import express from "express";
import {
  addIncome,
  getIncomes,
  getIncomeSummary,
  updateIncome,
  deleteIncome,
} from "../controllers/incomeController.js";
import protect from "../middleware/authMiddleware.js";
import { uploadBill } from "../middleware/uploadMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/", getIncomes);
router.get("/summary", getIncomeSummary);
router.post("/", uploadBill, addIncome);
router.put("/:id", uploadBill, updateIncome);
router.delete("/:id", deleteIncome);

export default router;
