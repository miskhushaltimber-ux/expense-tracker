import express from "express";
import { getMasters, addMaster, editMaster, removeMaster, guardMasterInUse } from "../controllers/masterController.js";
import protect, { requireOwner } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

// Masters are shared reference data — everyone on the team needs to READ
// them (to log an expense), but only the owner adds/renames/removes one,
// since a rename/delete cascades onto every expense and budget using it.
router.get("/", getMasters);
router.post("/", requireOwner, addMaster);
router.put("/:id", requireOwner, editMaster);
// guardMasterInUse refuses with a 409 before removeMaster runs, so a master
// that entries still reference can never be deleted out from under them.
router.delete("/:id", requireOwner, guardMasterInUse, removeMaster);

export default router;
