import express from "express";
import {
  getLabourSheetsStatus,
  exportLabourToSheet,
  emailLabourSheet,
  previewLabourFromSheet,
} from "../controllers/labourSheetsController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/status", getLabourSheetsStatus);
router.post("/export", exportLabourToSheet);
router.post("/email", emailLabourSheet);
router.post("/import-preview", previewLabourFromSheet);

export default router;
