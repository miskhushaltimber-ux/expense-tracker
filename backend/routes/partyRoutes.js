import express from "express";
import { getParties, getPartyTransactions } from "../controllers/partyController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/", getParties);
router.get("/:name", getPartyTransactions);

export default router;
