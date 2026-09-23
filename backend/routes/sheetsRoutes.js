import express from "express";
import { getSheetsStatus, exportToSheet, previewFromSheet, emailSheet, downloadExpenseSheet } from "../controllers/sheetsController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/status", getSheetsStatus);
router.get("/download", downloadExpenseSheet);
router.post("/export", exportToSheet);
router.post("/email", emailSheet);
router.post("/import-preview", previewFromSheet);

export default router;
