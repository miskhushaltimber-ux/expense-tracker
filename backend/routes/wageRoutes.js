import express from "express";
import {
  getWageEntries,
  getWageSummary,
  addWageEntry,
  updateWageEntry,
  deleteWageEntry,
} from "../controllers/wageController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/", getWageEntries);
router.get("/summary", getWageSummary);
router.post("/", addWageEntry);
router.put("/:id", updateWageEntry);
router.delete("/:id", deleteWageEntry);

export default router;
