import express from "express";
import { downloadMonthlyReport, emailMonthlyReport } from "../controllers/reportsController.js";
import protect, { requireOwner } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect, requireOwner);

router.get("/monthly", downloadMonthlyReport);
router.post("/monthly/email", emailMonthlyReport);

export default router;
