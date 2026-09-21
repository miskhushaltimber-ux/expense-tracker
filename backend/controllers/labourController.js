import {
  listMillsByUser, createMill, updateMillById, deleteMillById,
  listContractorsByUser, createContractor, updateContractorById, deleteContractorById,
  listLaborsByUser, createLabor, updateLaborById, deleteLaborById,
  listWageEntriesByUser, createWageEntry, bulkCreateWageEntries, updateWageEntryById, deleteWageEntryById, bulkDeleteWageEntries,
  listPaymentsByUser, createPayment, bulkCreatePayments, updatePaymentById, deletePaymentById, bulkDeletePayments,
  renameLocationOnMills, countMillsUsingLocation,
} from "../models/labourStore.js";
import { listLocationsByUser, createLocation, renameLocation, deleteLocation } from "../models/locationStore.js";
import { storeFieldFile, deleteStoredFile } from "../utils/fileStorage.js";
import { logAction } from "../utils/auditLog.js";

const DOC_FIELDS = ["aadharFile", "panFile", "greenCardFile"];
const removeFlagFor = (field) => `remove${field.charAt(0).toUpperCase()}${field.slice(1)}`;

const actorFields = (req) => ({ actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role });

const logFor = (req, action, entity, entityLabel) =>
  logAction({ companyId: req.user.companyId, ...actorFields(req), action, entity, entityLabel });

// Contractors and labor: identical shape (name, mobile, three documents)
// plus whatever's in `parentField` (millId / contractorId) and any other
// plain fields listed in `fields`. Owner-only for add/update/delete (see
// routes/labourRoutes.js) — these are reference data, not day-to-day entries.
const makePersonHandlers = ({ listByUser, create, updateById, deleteById, parentField, fields = [], label }) => ({
  list: async (req, res) => {
    try {
      res.json(await listByUser(req.user.companyId));
    } catch (error) {
      res.status(500).json({ message: error.message || `Error fetching ${label}s` });
    }
  },
  add: async (req, res) => {
    const { name, mobile } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: `${label} name is required` });
    if (parentField && !req.body[parentField]) {
      return res.status(400).json({ message: `${parentField} is required to add a ${label.toLowerCase()}` });
    }
    try {
      const docs = {};
      for (const field of DOC_FIELDS) docs[field] = await storeFieldFile(req, field);
      const extra = Object.fromEntries(fields.map((f) => [f, req.body[f]]));
      if (parentField) extra[parentField] = req.body[parentField];
      const entity = await create({ userId: req.user.companyId, name: name.trim(), mobile, ...extra, ...docs });
      logFor(req, "created", label.toLowerCase(), entity.name);
      res.status(201).json(entity);
    } catch (error) {
      res.status(500).json({ message: error.message || `Error adding ${label}` });
    }
  },
  update: async (req, res) => {
    const { name, mobile } = req.body;
    try {
      const updates = {};
      if (name !== undefined) updates.name = name;
      if (mobile !== undefined) updates.mobile = mobile;
      for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];
      if (parentField && req.body[parentField] !== undefined) updates[parentField] = req.body[parentField];

      const existing = (await listByUser(req.user.companyId)).find((e) => e._id === req.params.id);
      for (const field of DOC_FIELDS) {
        const removing = req.body[removeFlagFor(field)] === "true";
        const stored = removing ? undefined : await storeFieldFile(req, field);
        if (removing || stored) {
          if (existing?.[field]) await deleteStoredFile(existing[field]);
          updates[field] = stored || "";
        }
      }

      const { entity, error } = await updateById(req.params.id, req.user.companyId, updates);
      if (error === "not_found") return res.status(404).json({ message: `${label} not found` });
      if (error === "forbidden") return res.status(403).json({ message: `Not authorized to update this ${label.toLowerCase()}` });
      logFor(req, "updated", label.toLowerCase(), entity.name);
      res.json(entity);
    } catch (error) {
      res.status(500).json({ message: error.message || `Error updating ${label}` });
    }
  },
  remove: async (req, res) => {
    try {
      const { entity: deleted, error } = await deleteById(req.params.id, req.user.companyId);
      if (error === "not_found") return res.status(404).json({ message: `${label} not found` });
      if (error === "forbidden") return res.status(403).json({ message: `Not authorized to delete this ${label.toLowerCase()}` });
      for (const field of DOC_FIELDS) await deleteStoredFile(deleted?.[field]);
      logFor(req, "deleted", label.toLowerCase(), deleted.name);
      res.json({ message: `${label} deleted successfully` });
    } catch (error) {
      res.status(500).json({ message: error.message || `Error deleting ${label}` });
    }
  },
});

// Mills, wage entries, payments: plain JSON fields, no files. `required`
// lists the fields that must be non-empty to create one. `labelFor` builds
// the audit-log description from the saved entity (mills log their name;
// wage entries/payments, which have no name, log something more useful).
const makeSimpleHandlers = ({ listByUser, create, updateById, deleteById, fields, required = [], label, labelFor }) => {
  const describe = labelFor || ((entity) => entity.name || entity.id);
  return {
    list: async (req, res) => {
      try {
        res.json(await listByUser(req.user.companyId));
      } catch (error) {
        res.status(500).json({ message: error.message || `Error fetching ${label}s` });
      }
    },
    add: async (req, res) => {
      for (const f of required) {
        if (req.body[f] === undefined || req.body[f] === null || String(req.body[f]).trim() === "") {
          return res.status(400).json({ message: `${f} is required` });
        }
      }
      try {
        const values = Object.fromEntries(fields.map((f) => [f, req.body[f]]));
        const entity = await create({ userId: req.user.companyId, ...values });
        logFor(req, "created", label.toLowerCase(), describe(entity));
        res.status(201).json(entity);
      } catch (error) {
        res.status(500).json({ message: error.message || `Error adding ${label}` });
      }
    },
    update: async (req, res) => {
      try {
        const updates = {};
        for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];
        const { entity, error } = await updateById(req.params.id, req.user.companyId, updates);
        if (error === "not_found") return res.status(404).json({ message: `${label} not found` });
        if (error === "forbidden") return res.status(403).json({ message: `Not authorized to update this ${label.toLowerCase()}` });
        logFor(req, "updated", label.toLowerCase(), describe(entity));
        res.json(entity);
      } catch (error) {
        res.status(500).json({ message: error.message || `Error updating ${label}` });
      }
    },
    remove: async (req, res) => {
      try {
        const { entity, error } = await deleteById(req.params.id, req.user.companyId);
        if (error === "not_found") return res.status(404).json({ message: `${label} not found` });
        if (error === "forbidden") return res.status(403).json({ message: `Not authorized to delete this ${label.toLowerCase()}` });
        logFor(req, "deleted", label.toLowerCase(), entity ? describe(entity) : req.params.id);
        res.json({ message: `${label} deleted successfully` });
      } catch (error) {
        res.status(500).json({ message: error.message || `Error deleting ${label}` });
      }
    },
  };
};

const millHandlers = makeSimpleHandlers({
  listByUser: listMillsByUser, create: createMill, updateById: updateMillById, deleteById: deleteMillById,
  fields: ["location", "name"], required: ["location", "name"], label: "Mill",
});
const contractorHandlers = makePersonHandlers({
  listByUser: listContractorsByUser, create: createContractor, updateById: updateContractorById, deleteById: deleteContractorById,
  parentField: "millId", fields: ["openingBalance"], label: "Contractor",
});
const laborHandlers = makePersonHandlers({
  listByUser: listLaborsByUser, create: createLabor, updateById: updateLaborById, deleteById: deleteLaborById,
  parentField: "contractorId", label: "Labor",
});
// Wage entries/payments have no "name" — deliberately allowed to keep
// entering data (see routes/labourRoutes.js: only their bulk-delete is
// owner-only, not add/update/delete).
const wageEntryHandlers = makeSimpleHandlers({
  listByUser: listWageEntriesByUser, create: createWageEntry, updateById: updateWageEntryById, deleteById: deleteWageEntryById,
  fields: ["contractorId", "dateLabel", "cft", "rate"], required: ["contractorId", "dateLabel"], label: "Wage entry",
  labelFor: (e) => `${e.dateLabel || ""} — ${e.cft || 0} CFT`.trim(),
});
const paymentHandlers = makeSimpleHandlers({
  listByUser: listPaymentsByUser, create: createPayment, updateById: updatePaymentById, deleteById: deletePaymentById,
  fields: ["contractorId", "date", "label", "amount"], required: ["contractorId", "date"], label: "Payment",
  labelFor: (p) => `${p.label || "Payment"} — ₹${p.amount || 0}`,
});

export const getMills = millHandlers.list;
export const addMill = millHandlers.add;
export const updateMill = millHandlers.update;
export const deleteMill = millHandlers.remove;

export const getContractors = contractorHandlers.list;
export const addContractor = contractorHandlers.add;
export const updateContractor = contractorHandlers.update;
export const deleteContractor = contractorHandlers.remove;

export const getLabors = laborHandlers.list;
export const addLabor = laborHandlers.add;
export const updateLabor = laborHandlers.update;
export const deleteLabor = laborHandlers.remove;

export const getWageEntries = wageEntryHandlers.list;
export const addWageEntry = wageEntryHandlers.add;
export const updateWageEntry = wageEntryHandlers.update;
export const deleteWageEntry = wageEntryHandlers.remove;

export const getPayments = paymentHandlers.list;
export const addPayment = paymentHandlers.add;
export const updatePayment = paymentHandlers.update;
export const deletePayment = paymentHandlers.remove;

// Locations — its own tiny CRUD set rather than makeSimpleHandlers, since
// renaming has to cascade to Mills (same reasoning as masterController's
// editMaster cascading a rename onto expenses/budgets) and deleting has to
// check Mills are not still using it first. Owner-only (see
// routes/labourRoutes.js).
export const getLocations = async (req, res) => {
  try {
    res.json(await listLocationsByUser(req.user.companyId));
  } catch (error) {
    console.error("Error fetching locations:", error);
    res.status(500).json({ message: error.message || "Error fetching locations" });
  }
};

export const addLocation = async (req, res) => {
  const { name } = req.body;
  try {
    const { location, error } = await createLocation(req.user.companyId, name);
    if (error === "empty") return res.status(400).json({ message: "A location needs a name." });
    if (error === "duplicate") return res.status(409).json({ message: `"${(name || "").trim()}" is already in the list.` });
    logFor(req, "created", "location", location.name);
    res.status(201).json(location);
  } catch (error) {
    console.error("Error adding location:", error);
    res.status(500).json({ message: error.message || "Error adding location" });
  }
};

export const updateLocation = async (req, res) => {
  const { name } = req.body;
  try {
    const { location, previousName, error } = await renameLocation(req.params.id, req.user.companyId, name);
    if (error === "empty") return res.status(400).json({ message: "A location needs a name." });
    if (error === "not_found") return res.status(404).json({ message: "That location no longer exists." });
    if (error === "forbidden") return res.status(403).json({ message: "Not authorized to edit this location." });
    if (error === "duplicate") return res.status(409).json({ message: `"${(name || "").trim()}" is already in the list.` });

    let movedMills = 0;
    if (previousName && previousName !== location.name) {
      movedMills = await renameLocationOnMills(req.user.companyId, previousName, location.name);
    }

    logFor(req, "updated", "location", previousName && previousName !== location.name ? `${previousName} → ${location.name}` : location.name);
    res.json({ location, movedMills });
  } catch (error) {
    console.error("Error renaming location:", error);
    res.status(500).json({ message: error.message || "Error renaming location" });
  }
};

// Deleting is refused while any mill still uses the location — same
// "in use" refusal masterController.js uses for masters, so a mill can never
// be left pointing at a location that no longer exists.
export const deleteLocationHandler = async (req, res) => {
  try {
    const locations = await listLocationsByUser(req.user.companyId);
    const target = locations.find((l) => l.id === req.params.id);
    if (!target) return res.status(404).json({ message: "That location no longer exists." });

    const used = await countMillsUsingLocation(req.user.companyId, target.name);
    if (used > 0) {
      return res.status(409).json({
        message: `"${target.name}" is used by ${used} ${used === 1 ? "mill" : "mills"} — reassign or edit those first.`,
        inUse: used,
      });
    }

    const { location, error } = await deleteLocation(req.params.id, req.user.companyId);
    if (error === "not_found") return res.status(404).json({ message: "That location no longer exists." });
    if (error === "forbidden") return res.status(403).json({ message: "Not authorized to delete this location." });
    logFor(req, "deleted", "location", location.name);
    res.json({ message: `"${location.name}" removed`, location });
  } catch (error) {
    console.error("Error deleting location:", error);
    res.status(500).json({ message: error.message || "Error deleting location" });
  }
};

// Bulk delete for the Work Log / Payments ledgers — owner-only (see
// routes/labourRoutes.js), same reasoning as expenseController's
// bulkDeleteExpenses: deleting many rows at once is the highest-blast-radius
// action on a ledger, so it's kept separate from ordinary single-row add/
// edit/delete, which stays open to staff.
const makeBulkDeleteHandler = (bulkDeleteFn, singular, plural, entity) => async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "Expected a non-empty `ids` array." });
  }
  if (ids.length > 500) {
    return res.status(400).json({ message: "Too many rows in one request (limit 500). Delete them in batches." });
  }
  if (!ids.every((id) => typeof id === "string" && id.trim())) {
    return res.status(400).json({ message: "Every id must be a non-empty string." });
  }

  try {
    const { deleted, notFound, forbidden } = await bulkDeleteFn(ids, req.user.companyId);
    if (deleted.length) {
      logFor(req, "deleted", entity, `${deleted.length} ${deleted.length === 1 ? singular : plural} (bulk delete)`);
    }
    res.json({
      message: `${deleted.length} ${deleted.length === 1 ? singular : plural} deleted`,
      deletedIds: deleted.map((d) => d._id),
      skipped: { notFound, forbidden },
    });
  } catch (error) {
    console.error(`Error bulk deleting ${plural}:`, error);
    res.status(500).json({ message: error.message || `Error deleting those ${plural}` });
  }
};

export const bulkDeleteWageEntriesHandler = makeBulkDeleteHandler(bulkDeleteWageEntries, "entry", "entries", "wage entry");
export const bulkDeletePaymentsHandler = makeBulkDeleteHandler(bulkDeletePayments, "payment", "payments", "payment");

// Bulk add — used by the Work Log / Payments importer once the user has
// reviewed the preview rows (same idea as expenses' POST /api/expenses/bulk).
// Each row must already carry a resolved contractorId (the frontend matches
// contractor names to ids before calling this, using the list it already has
// loaded) — rows a user couldn't match are expected to be dropped or fixed
// client-side before this is called.
export const bulkAddWageEntries = async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const valid = rows.filter((r) => r.contractorId && r.cft !== undefined && r.rate !== undefined);
  if (!valid.length) return res.status(400).json({ message: "No valid wage entries to add" });
  try {
    const entities = await bulkCreateWageEntries(
      req.user.companyId,
      valid.map((r) => ({ contractorId: r.contractorId, dateLabel: r.dateLabel || "", cft: r.cft, rate: r.rate }))
    );
    if (entities.length) logFor(req, "created", "wage entry", `${entities.length} wage entries (import)`);
    res.status(201).json({ added: entities.length, entries: entities });
  } catch (error) {
    res.status(500).json({ message: error.message || "Error adding wage entries" });
  }
};

export const bulkAddPayments = async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const valid = rows.filter((r) => r.contractorId && r.amount !== undefined);
  if (!valid.length) return res.status(400).json({ message: "No valid payments to add" });
  try {
    const entities = await bulkCreatePayments(
      req.user.companyId,
      valid.map((r) => ({ contractorId: r.contractorId, date: r.date || "", label: r.label || "", amount: r.amount }))
    );
    if (entities.length) logFor(req, "created", "payment", `${entities.length} payments (import)`);
    res.status(201).json({ added: entities.length, payments: entities });
  } catch (error) {
    res.status(500).json({ message: error.message || "Error adding payments" });
  }
};
