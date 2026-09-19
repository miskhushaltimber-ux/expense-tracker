import express from "express";
import { runDailyTasks } from "../utils/dailyTasks.js";

const router = express.Router();

// Deliberately NOT using the JWT `protect` middleware — this is meant to be
// called by an external scheduler (e.g. a free cron-job.org ping), which has
// no user login. Guarded instead by a shared secret header, since Render's
// free tier can go to sleep and lose its own internal node-cron schedule.
router.post("/run-daily", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({ message: "CRON_SECRET is not configured on the server" });
  }
  if (req.headers["x-cron-secret"] !== secret) {
    return res.status(401).json({ message: "Invalid or missing x-cron-secret header" });
  }

  try {
    const summary = await runDailyTasks();
    res.json({ message: "Daily tasks run complete", ...summary });
  } catch (error) {
    console.error("Error running daily tasks via cron endpoint:", error);
    res.status(500).json({ message: "Error running daily tasks", error: error.message });
  }
});

export default router;
