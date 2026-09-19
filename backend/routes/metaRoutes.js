import express from "express";
import { EXPENSE_MASTERS } from "../constants/categories.js";

const router = express.Router();

// Public so the sheet page's Master suggestions work the moment the app
// loads, before login finishes.
router.get("/masters", (req, res) => {
  res.json({ masters: EXPENSE_MASTERS });
});

export default router;
