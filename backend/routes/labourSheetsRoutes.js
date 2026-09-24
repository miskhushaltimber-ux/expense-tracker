import express from "express";
import {
  getLabourSheetsStatus,
  exportLabourToSheet,
  emailLabourSheet,
  previewLabourFromSheet,
  downloadLabourSheet,
  exportReportToSheet,
  emailReport,
} from "../controllers/labourSheetsController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/status", getLabourSheetsStatus);
router.get("/download", downloadLabourSheet);
router.post("/export", exportLabourToSheet);
router.post("/email", emailLabourSheet);
router.post("/import-preview", previewLabourFromSheet);
// Report tab (24 Sep) — see labourSheetsController.js's comment above
// exportReportToSheet/emailReport for why these take the already-computed
// data instead of a `type` like the routes above.
router.post("/report/export", exportReportToSheet);
router.post("/report/email", emailReport);

export default router;
