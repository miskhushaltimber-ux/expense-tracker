import express from "express";
import { getMasters, addMaster, editMaster, removeMaster, guardMasterInUse } from "../controllers/masterController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/", getMasters);
router.post("/", addMaster);
router.put("/:id", editMaster);
// guardMasterInUse refuses with a 409 before removeMaster runs, so a master
// that entries still reference can never be deleted out from under them.
router.delete("/:id", guardMasterInUse, removeMaster);

export default router;
