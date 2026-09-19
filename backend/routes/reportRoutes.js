import express from "express";
import {
  getMonthlyTrend,
  getPendingPayments,
  getGstSummary,
  getFinancialYearSummary,
} from "../controllers/reportController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/monthly-trend", getMonthlyTrend);
router.get("/pending-payments", getPendingPayments);
router.get("/gst-summary", getGstSummary);
router.get("/financial-year", getFinancialYearSummary);

export default router;
