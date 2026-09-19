import express from "express";
import {
  getInventoryTransactions,
  getStockSummary,
  addInventoryTransaction,
  deleteInventoryTransaction,
} from "../controllers/inventoryController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/", getInventoryTransactions);
router.get("/summary", getStockSummary);
router.post("/", addInventoryTransaction);
router.delete("/:id", deleteInventoryTransaction);

export default router;
