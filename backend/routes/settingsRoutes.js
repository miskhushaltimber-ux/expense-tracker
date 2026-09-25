import express from "express";
import { getSettings, updateLinkedSheet } from "../controllers/settingsController.js";
import protect, { requireOwner } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/", getSettings);
// Owner-only, same as everything else that changes shared account-wide
// config (Manage Data, Team & Activity) rather than day-to-day entries.
router.put("/sheet", requireOwner, updateLinkedSheet);

export default router;
