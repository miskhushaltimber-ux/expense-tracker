import express from "express";
import { listColumns, addColumn, updateColumn, removeColumn } from "../controllers/columnDefController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();
router.use(protect);

// Unlike Masters/Mills/Contractors/Vehicles (owner-only structural data),
// custom columns are deliberately NOT gated by requireOwner — 21 Sep, per
// Rishi: "anyone with a login" should be able to add/rename/remove one.
// Every route takes ?sheet=expenses|wageEntries|payments (see
// columnDefController.js's sheetFromQuery).
router.get("/", listColumns);
router.post("/", addColumn);
router.put("/:id", updateColumn);
router.delete("/:id", removeColumn);

export default router;
