import express from "express";
import { getVehicles, addVehicle, updateVehicle, deleteVehicle } from "../controllers/vehicleController.js";
import protect, { requireOwner } from "../middleware/authMiddleware.js";
import { uploadVehicleDocs } from "../middleware/uploadMiddleware.js";

const router = express.Router();

router.use(protect);

// Everyone can read the vehicle list (needed to log a vehicle expense);
// adding/editing/deleting a vehicle itself is owner-only reference data.
router.get("/", getVehicles);
router.post("/", requireOwner, uploadVehicleDocs, addVehicle);
router.put("/:id", requireOwner, uploadVehicleDocs, updateVehicle);
router.delete("/:id", requireOwner, deleteVehicle);

export default router;
