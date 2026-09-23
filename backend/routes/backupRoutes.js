import express from "express";
import protect, { requireOwner } from "../middleware/authMiddleware.js";
import { downloadBackup, runScheduledBackup } from "../controllers/backupController.js";

const router = express.Router();
router.get("/download", protect, requireOwner, downloadBackup);
router.post("/scheduled", runScheduledBackup); // secret-header protected, see controller
export default router;
