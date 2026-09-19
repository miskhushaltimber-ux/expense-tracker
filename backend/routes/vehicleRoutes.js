import express from "express";
import { getVehicles, addVehicle, updateVehicle, deleteVehicle } from "../controllers/vehicleController.js";
import protect from "../middleware/authMiddleware.js";
import { uploadVehicleDocs } from "../middleware/uploadMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/", getVehicles);
router.post("/", uploadVehicleDocs, addVehicle);
router.put("/:id", uploadVehicleDocs, updateVehicle);
router.delete("/:id", deleteVehicle);

export default router;
