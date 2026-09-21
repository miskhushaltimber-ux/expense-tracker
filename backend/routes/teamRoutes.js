import express from "express";
import { listTeam, createStaffAccount, removeStaff, getAuditLog } from "../controllers/teamController.js";
import protect, { requireOwner } from "../middleware/authMiddleware.js";

const router = express.Router();

// Every route here is owner-only — staff have no reason to see who else is
// on the team or the activity feed, and definitely can't create/remove logins.
router.use(protect, requireOwner);

router.get("/", listTeam);
router.post("/staff", createStaffAccount);
router.delete("/staff/:id", removeStaff);
router.get("/audit-log", getAuditLog);

export default router;
