import express from "express";
import {
  getMills, addMill, updateMill, deleteMill,
  getContractors, addContractor, updateContractor, deleteContractor,
  getLabors, addLabor, updateLabor, deleteLabor,
  getWageEntries, addWageEntry, updateWageEntry, deleteWageEntry, bulkAddWageEntries, bulkDeleteWageEntriesHandler,
  getPayments, addPayment, updatePayment, deletePayment, bulkAddPayments, bulkDeletePaymentsHandler,
  getLocations, addLocation, updateLocation, deleteLocationHandler,
} from "../controllers/labourController.js";
import protect, { requireOwner } from "../middleware/authMiddleware.js";
import { uploadLabourDocs } from "../middleware/uploadMiddleware.js";

const router = express.Router();
router.use(protect);

// Locations/Mills/Contractors/Labor are reference data (same reasoning as
// vehicles/masters) — everyone can read them, only the owner adds/edits/
// removes one.
router.get("/locations", getLocations);
router.post("/locations", requireOwner, addLocation);
router.put("/locations/:id", requireOwner, updateLocation);
router.delete("/locations/:id", requireOwner, deleteLocationHandler);

router.get("/mills", getMills);
router.post("/mills", requireOwner, addMill);
router.put("/mills/:id", requireOwner, updateMill);
router.delete("/mills/:id", requireOwner, deleteMill);

router.get("/contractors", getContractors);
router.post("/contractors", requireOwner, uploadLabourDocs, addContractor);
router.put("/contractors/:id", requireOwner, uploadLabourDocs, updateContractor);
router.delete("/contractors/:id", requireOwner, deleteContractor);

router.get("/labors", getLabors);
router.post("/labors", requireOwner, uploadLabourDocs, addLabor);
router.put("/labors/:id", requireOwner, uploadLabourDocs, updateLabor);
router.delete("/labors/:id", requireOwner, deleteLabor);

// Wage entries/payments are day-to-day data entry — staff can add/edit/
// delete a single row (that's the job), but bulk-delete is owner-only, same
// reasoning as the Expense Sheet's bulk-delete.
router.get("/wage-entries", getWageEntries);
router.post("/wage-entries", addWageEntry);
router.post("/wage-entries/bulk", bulkAddWageEntries);
router.post("/wage-entries/bulk-delete", requireOwner, bulkDeleteWageEntriesHandler);
router.put("/wage-entries/:id", updateWageEntry);
router.delete("/wage-entries/:id", deleteWageEntry);

router.get("/payments", getPayments);
router.post("/payments", addPayment);
router.post("/payments/bulk", bulkAddPayments);
router.post("/payments/bulk-delete", requireOwner, bulkDeletePaymentsHandler);
router.put("/payments/:id", updatePayment);
router.delete("/payments/:id", deletePayment);

export default router;
