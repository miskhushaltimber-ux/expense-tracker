// Generic "undo" dispatch table for the audit log (30 Sep, per Rishi: a bad
// Labor Wages import trashed his contractor data and there was no way to fix
// it except hunting through Work Log/Payments by hand). Every AuditLog row
// now carries enough — entityStore + entityIds (+ a snapshot for updates and
// deletes) — to reverse itself; this file is the ONE place that knows how to
// actually call each store's create/update/delete for a given entityStore
// key, so utils/auditLog.js's undoAuditEntry() doesn't need a giant
// if/else across ten different store modules.
//
// Deliberately left OUT of this registry (kept not-undoable — see each
// controller's logFor call, which simply omits entityStore for these):
//  - Master/Location RENAMES — a rename cascades onto every expense/budget
//    (masters) or mill (locations) that referenced the old name; reversing
//    the rename itself wouldn't reverse that cascade, so it'd leave things
//    half-consistent. Creating/deleting a master or location IS undoable —
//    neither of those ever cascades.
//  - Budgets — saved as a whole-array upsert with no per-row identity to
//    restore individually.
//  - Contractor merges — moves rows AND deletes duplicates in one go; no
//    single reversible operation covers that.
//  - File fields (bill/RC/insurance/permit/Aadhar/PAN/green-card) on any
//    "updated" snapshot — by the time an update runs, the OLD file has
//    already been deleted from Cloudinary (see fileStorage.js's
//    deleteStoredFile calls in each controller's update handler), so
//    restoring an old file URL would just point at a dead link. Controllers
//    exclude these fields from the snapshot they log, not this file.
import { createExpense, updateExpenseById, deleteExpenseById } from "../models/expenseStore.js";
import { createVehicle, updateVehicleById, deleteVehicleById } from "../models/vehicleStore.js";
import { createMaster, deleteMaster } from "../models/masterStore.js";
import { createLocation, deleteLocation } from "../models/locationStore.js";
import {
  createMill, updateMillById, deleteMillById,
  createContractor, updateContractorById, deleteContractorById,
  createLabor, updateLaborById, deleteLaborById,
  createWageEntry, updateWageEntryById, deleteWageEntryById,
  createPayment, updatePaymentById, deletePaymentById,
} from "../models/labourStore.js";

// Every entry:
//   create(companyId, snapshot) -> entity (always scoped to companyId,
//     regardless of whatever userId/companyId the snapshot itself carries)
//   updateById(id, companyId, updates) -> { entity/<name>, error } | null
//     (null means "this store's updates aren't undoable")
//   deleteById(id, companyId) -> { entity/<name>, error }
export const UNDO_REGISTRY = {
  expenses: {
    create: (companyId, snapshot) => createExpense({ ...snapshot, userId: companyId }),
    updateById: (id, companyId, updates) => updateExpenseById(id, companyId, updates),
    deleteById: (id, companyId) => deleteExpenseById(id, companyId),
  },
  vehicles: {
    create: (companyId, snapshot) => createVehicle({ ...snapshot, userId: companyId }),
    updateById: (id, companyId, updates) => updateVehicleById(id, companyId, updates),
    deleteById: (id, companyId) => deleteVehicleById(id, companyId),
  },
  masters: {
    create: async (companyId, snapshot) => {
      const { master, error } = await createMaster(companyId, snapshot.name);
      return error ? { error } : master;
    },
    updateById: null, // renames cascade — see the file-level comment above
    deleteById: (id, companyId) => deleteMaster(id, companyId),
  },
  locations: {
    create: async (companyId, snapshot) => {
      const { location, error } = await createLocation(companyId, snapshot.name);
      return error ? { error } : location;
    },
    updateById: null,
    deleteById: (id, companyId) => deleteLocation(id, companyId),
  },
  mills: {
    create: (companyId, snapshot) => createMill({ ...snapshot, userId: companyId }),
    updateById: (id, companyId, updates) => updateMillById(id, companyId, updates),
    deleteById: (id, companyId) => deleteMillById(id, companyId),
  },
  contractors: {
    create: (companyId, snapshot) => createContractor({ ...snapshot, userId: companyId }),
    updateById: (id, companyId, updates) => updateContractorById(id, companyId, updates),
    deleteById: (id, companyId) => deleteContractorById(id, companyId),
  },
  labors: {
    create: (companyId, snapshot) => createLabor({ ...snapshot, userId: companyId }),
    updateById: (id, companyId, updates) => updateLaborById(id, companyId, updates),
    deleteById: (id, companyId) => deleteLaborById(id, companyId),
  },
  wageEntries: {
    create: (companyId, snapshot) => createWageEntry({ ...snapshot, userId: companyId }),
    updateById: (id, companyId, updates) => updateWageEntryById(id, companyId, updates),
    deleteById: (id, companyId) => deleteWageEntryById(id, companyId),
  },
  payments: {
    create: (companyId, snapshot) => createPayment({ ...snapshot, userId: companyId }),
    updateById: (id, companyId, updates) => updatePaymentById(id, companyId, updates),
    deleteById: (id, companyId) => deletePaymentById(id, companyId),
  },
};
