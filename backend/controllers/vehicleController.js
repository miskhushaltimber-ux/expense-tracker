import {
  listVehiclesByUser,
  createVehicle,
  updateVehicleById,
  deleteVehicleById,
} from "../models/vehicleStore.js";
import { storeFieldFile, deleteStoredFile } from "../utils/fileStorage.js";

// The three tracked vehicle documents, looped over wherever all of them get
// the same treatment (upload, replace, clean up).
const DOC_FIELDS = ["rcFile", "insuranceFile", "permitFile", "plateFile"];

// The body flag the frontend sends to detach a document outright:
// rcFile -> removeRcFile. Distinct from simply not uploading a new file,
// which leaves whatever is already attached alone.
const removeFlagFor = (field) => `remove${field.charAt(0).toUpperCase()}${field.slice(1)}`;

export const getVehicles = async (req, res) => {
  try {
    const vehicles = await listVehiclesByUser(req.user.id);
    res.json(vehicles);
  } catch (error) {
    console.error("Error fetching vehicles:", error);
    res.status(500).json({ message: error.message || "Error fetching vehicles" });
  }
};

export const addVehicle = async (req, res) => {
  const { name, numberPlate, rcExpiry, insuranceExpiry, permitExpiry } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ message: "Vehicle name is required" });
  }
  try {
    const vehicle = await createVehicle({
      userId: req.user.id,
      name: name.trim(),
      numberPlate,
      rcExpiry,
      insuranceExpiry,
      permitExpiry,
      rcFile: await storeFieldFile(req, "rcFile"),
      insuranceFile: await storeFieldFile(req, "insuranceFile"),
      permitFile: await storeFieldFile(req, "permitFile"),
    });
    res.status(201).json(vehicle);
  } catch (error) {
    console.error("Error adding vehicle:", error);
    res.status(500).json({ message: error.message || "Error adding vehicle" });
  }
};

export const updateVehicle = async (req, res) => {
  const { name, numberPlate, rcExpiry, insuranceExpiry, permitExpiry } = req.body;
  try {
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (numberPlate !== undefined) updates.numberPlate = numberPlate;
    if (rcExpiry !== undefined) updates.rcExpiry = rcExpiry;
    if (insuranceExpiry !== undefined) updates.insuranceExpiry = insuranceExpiry;
    if (permitExpiry !== undefined) updates.permitExpiry = permitExpiry;

    // Look up the current vehicle first so we can clean up any doc files
    // that are about to be replaced.
    const existing = (await listVehiclesByUser(req.user.id)).find((v) => v._id === req.params.id);

    for (const field of DOC_FIELDS) {
      const removing = req.body[removeFlagFor(field)] === "true";
      const stored = removing ? undefined : await storeFieldFile(req, field);

      if (removing || stored) {
        if (existing?.[field]) await deleteStoredFile(existing[field]);
        updates[field] = stored || "";
      }
    }

    const { vehicle, error } = await updateVehicleById(req.params.id, req.user.id, updates);
    if (error === "not_found") return res.status(404).json({ message: "Vehicle not found" });
    if (error === "forbidden") return res.status(403).json({ message: "Not authorized to update this vehicle" });
    res.json(vehicle);
  } catch (error) {
    console.error("Error updating vehicle:", error);
    res.status(500).json({ message: error.message || "Error updating vehicle" });
  }
};

export const deleteVehicle = async (req, res) => {
  try {
    const { vehicle: deleted, error } = await deleteVehicleById(req.params.id, req.user.id);
    if (error === "not_found") return res.status(404).json({ message: "Vehicle not found" });
    if (error === "forbidden") return res.status(403).json({ message: "Not authorized to delete this vehicle" });

    for (const field of DOC_FIELDS) await deleteStoredFile(deleted?.[field]);

    res.json({ message: "Vehicle deleted successfully" });
  } catch (error) {
    console.error("Error deleting vehicle:", error);
    res.status(500).json({ message: error.message || "Error deleting vehicle" });
  }
};
