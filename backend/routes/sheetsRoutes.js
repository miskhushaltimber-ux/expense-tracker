import express from "express";
import { getSheetsStatus, exportToSheet, previewFromSheet, emailSheet, downloadExpenseSheet, exportAllToSheet } from "../controllers/sheetsController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/status", getSheetsStatus);
router.get("/download", downloadExpenseSheet);
router.post("/export", exportToSheet);
// 25 Sep — pushes Expenses/Vehicles/Work Log/Payments to one Sheet, each as
// its own tab. See sheetsController.js's exportAllToSheet for the reasoning.
router.post("/export-all", exportAllToSheet);
router.post("/email", emailSheet);
router.post("/import-preview", previewFromSheet);

export default router;
