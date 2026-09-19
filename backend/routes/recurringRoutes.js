import express from "express";
import {
  listRecurring,
  addRecurring,
  updateRecurring,
  deleteRecurring,
  runNow,
} from "../controllers/recurringController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/", listRecurring);
router.post("/", addRecurring);
router.post("/run-now", runNow);
router.put("/:id", updateRecurring);
router.delete("/:id", deleteRecurring);

export default router;
