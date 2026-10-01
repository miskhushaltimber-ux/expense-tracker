import {
  listMillsByUser, createMill, updateMillById, deleteMillById,
  listContractorsByUser, createContractor, updateContractorById, deleteContractorById, mergeContractors, parseIdArray,
  listLaborsByUser, createLabor, updateLaborById, deleteLaborById,
  listWageEntriesByUser, createWageEntry, bulkCreateWageEntries, updateWageEntryById, deleteWageEntryById, bulkDeleteWageEntries,
  listPaymentsByUser, createPayment, bulkCreatePayments, updatePaymentById, deletePaymentById, bulkDeletePayments,
  renameLocationOnMills, countMillsUsingLocation,
} from "../models/labourStore.js";
import { listLocationsByUser, createLocation, renameLocation, deleteLocation } from "../models/locationStore.js";
import { storeFieldFile, deleteStoredFile } from "../utils/fileStorage.js";
import { logAction } from "../utils/auditLog.js";
import { parseCustomFields, serializeCustomFields } from "../utils/customFields.js";

const DOC_FIELDS = ["aadharFile", "panFile", "greenCardFile"];
const removeFlagFor = (field) => `remove${field.charAt(0).toUpperCase()}${field.slice(1)}`;

const actorFields = (req) => ({ actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role });

// extra: { entityStore, entityIds, snapshot } — see utils/auditLog.js.
// Omitting entityStore (the default) makes an entry simply not undoable,
// which is what every call site that doesn't pass it wants (renames,
// merges — see utils/undoRegistry.js for why those are excluded).
const logFor = (req, action, entity, entityLabel, extra = {}) =>
  logAction({ companyId: req.user.companyId, ...actorFields(req), action, entity, entityLabel, ...extra });

// millIds (22 Sep, multi-mill contractors): arrives as a JSON-array string or
// a real array (same tolerance as parseIdArray in labourStore.js) — this
// re-serializes it to a clean JSON-array string before it's written, same
// "sanitize on the way in" step serializeCustomFields does for customFields,
// so a stray comma-separated string or a single non-array value never gets
// stored verbatim.
const normalizePersonField = (f, v) => (f === "millIds" ? JSON.stringify(parseIdArray(v)) : v);

// Contractors and labor: identical shape (name, mobile, three documents)
// plus whatever's in `parentField` (millId / contractorId) and any other
// plain fields listed in `fields`. Owner-only for add/update/delete (see
// routes/labourRoutes.js) — these are reference data, not day-to-day entries.
const makePersonHandlers = ({ listByUser, create, updateById, deleteById, parentField, fields = [], label, validateExtra, entityStore }) => ({
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
    // Contractors (22 Sep, multi-mill support): no single required parentField
    // any more — validateExtra checks "at least one mill" against millIds
    // instead. Labor still goes through the parentField branch above.
    if (validateExtra) {
      const err = validateExtra(req);
      if (err) return res.status(400).json({ message: err });
    }
    try {
      const docs = {};
      for (const field of DOC_FIELDS) docs[field] = await storeFieldFile(req, field);
      const extra = Object.fromEntries(fields.map((f) => [f, normalizePersonField(f, req.body[f])]));
      if (parentField) extra[parentField] = req.body[parentField];
      const entity = await create({ userId: req.user.companyId, name: name.trim(), mobile, ...extra, ...docs });
      logFor(req, "created", label.toLowerCase(), entity.name, { entityStore, entityIds: [entity._id] });
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
      for (const f of fields) if (req.body[f] !== undefined) updates[f] = normalizePersonField(f, req.body[f]);
      if (parentField && req.body[parentField] !== undefined) updates[parentField] = req.body[parentField];

      const existing = (await listByUser(req.user.companyId)).find((e) => e._id === req.params.id);
      // Undo snapshot — the PRE-update value of every plain field about to
      // change, captured before storeFieldFile/deleteStoredFile below touch
      // anything. Deliberately excludes DOC_FIELDS (aadhar/PAN/green card):
      // by the time an update runs, the OLD file is already deleted from
      // Cloudinary (see the loop below), so "undo" restoring that URL would
      // just point at a dead link — see utils/undoRegistry.js's comment.
      const before = {};
      for (const key of Object.keys(updates)) before[key] = existing?.[key];

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
      logFor(
        req,
        "updated",
        label.toLowerCase(),
        entity.name,
        Object.keys(before).length ? { entityStore, entityIds: [req.params.id], snapshot: before } : {}
      );
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
      // Snapshot carries the deleted row's DOC_FIELDS URLs too, even though
      // those files are now gone from Cloudinary — restoring the row itself
      // (name/mobile/mill/opening balance/etc.) is still useful even if the
      // attached documents need re-uploading afterward.
      logFor(req, "deleted", label.toLowerCase(), deleted.name, { entityStore, entityIds: [deleted._id], snapshot: deleted });
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
const makeSimpleHandlers = ({ listByUser, create, updateById, deleteById, fields, required = [], label, labelFor, entityStore }) => {
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
        // customFields (21 Sep, custom-columns feature) — arrives as a JSON
        // string here too (this request is also multipart/form-data, see
        // toFormData in the frontend's api/labour.js); parseCustomFields
        // tolerates that, serializeCustomFields then sanitizes it for
        // storage, same split expenseController.js uses.
        if (fields.includes("customFields")) values.customFields = serializeCustomFields(parseCustomFields(req.body.customFields));
        const entity = await create({ userId: req.user.companyId, ...values });
        logFor(req, "created", label.toLowerCase(), describe(entity), { entityStore, entityIds: [entity._id] });
        res.status(201).json(entity);
      } catch (error) {
        res.status(500).json({ message: error.message || `Error adding ${label}` });
      }
    },
    update: async (req, res) => {
      try {
        const updates = {};
        for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];
        // A customFields patch is merged onto this row's EXISTING custom
        // values (one extra read), not a wholesale replace — a cell edit
        // only ever sends the one column that changed, same reasoning as
        // expenseStore.js's updateExpenseById.
        const existingList = await listByUser(req.user.companyId);
        const existing = existingList.find((e) => (e._id || e.id) === req.params.id);
        if (fields.includes("customFields") && req.body.customFields !== undefined) {
          updates.customFields = serializeCustomFields({ ...(existing?.customFields || {}), ...parseCustomFields(req.body.customFields) });
        }
        // Undo snapshot — the PRE-update value of every field about to
        // change (customFields excluded: its merge semantics above mean
        // "restore the old blob" could clobber a customFields change made
        // by someone else in between — safer to leave that one field alone
        // on undo than risk silently dropping unrelated data).
        const before = {};
        for (const key of Object.keys(updates)) {
          if (key === "customFields") continue;
          before[key] = existing?.[key];
        }
        const { entity, error } = await updateById(req.params.id, req.user.companyId, updates);
        if (error === "not_found") return res.status(404).json({ message: `${label} not found` });
        if (error === "forbidden") return res.status(403).json({ message: `Not authorized to update this ${label.toLowerCase()}` });
        logFor(
          req,
          "updated",
          label.toLowerCase(),
          describe(entity),
          Object.keys(before).length ? { entityStore, entityIds: [req.params.id], snapshot: before } : {}
        );
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
        logFor(
          req,
          "deleted",
          label.toLowerCase(),
          entity ? describe(entity) : req.params.id,
          entity ? { entityStore, entityIds: [entity._id], snapshot: entity } : {}
        );
        res.json({ message: `${label} deleted successfully` });
      } catch (error) {
        res.status(500).json({ message: error.message || `Error deleting ${label}` });
      }
    },
  };
};

const millHandlers = makeSimpleHandlers({
  listByUser: listMillsByUser, create: createMill, updateById: updateMillById, deleteById: deleteMillById,
  fields: ["location", "name"], required: ["location", "name"], label: "Mill", entityStore: "mills",
});
// Contractors (22 Sep, multi-mill support): parentField dropped — a
// contractor can now cover several mills (millIds) instead of exactly one
// (millId), so "at least one mill" is enforced by validateExtra instead of
// the generic single-required-parent check.
const contractorHandlers = makePersonHandlers({
  listByUser: listContractorsByUser, create: createContractor, updateById: updateContractorById, deleteById: deleteContractorById,
  parentField: null, fields: ["openingBalance", "contractorType", "millIds"], label: "Contractor", entityStore: "contractors",
  validateExtra: (req) => (parseIdArray(req.body.millIds).length ? null : "Pick at least one mill"),
});
const laborHandlers = makePersonHandlers({
  listByUser: listLaborsByUser, create: createLabor, updateById: updateLaborById, deleteById: deleteLaborById,
  parentField: "contractorId", label: "Labor", entityStore: "labors",
});
// Wage entries/payments have no "name" — deliberately allowed to keep
// entering data (see routes/labourRoutes.js: only their bulk-delete is
// owner-only, not add/update/delete).
const wageEntryHandlers = makeSimpleHandlers({
  listByUser: listWageEntriesByUser, create: createWageEntry, updateById: updateWageEntryById, deleteById: deleteWageEntryById,
  // millId (23 Sep) — optional, which mill this specific CFT batch belongs
  // to, for a contractor covering more than one.
  fields: ["contractorId", "millId", "dateLabel", "cft", "rate", "customFields"], required: ["contractorId", "dateLabel"], label: "Wage entry",
  labelFor: (e) => `${e.dateLabel || ""} — ${e.cft || 0} CFT`.trim(),
  entityStore: "wageEntries",
});
const paymentHandlers = makeSimpleHandlers({
  listByUser: listPaymentsByUser, create: createPayment, updateById: updatePaymentById, deleteById: deletePaymentById,
  // millId (24 Sep) — optional, which mill this payment was for, same as
  // wageEntryHandlers' millId below. isAdvance (25 Sep) — real Advance
  // checkbox, see labourStore.js HEADERS.payments comment.
  fields: ["contractorId", "millId", "date", "label", "amount", "isAdvance", "customFields"], required: ["contractorId", "date"], label: "Payment",
  labelFor: (p) => `${p.label || "Payment"} — ₹${p.amount || 0}`,
  entityStore: "payments",
});

export const getMills = millHandlers.list;
export const addMill = millHandlers.add;
export const updateMill = millHandlers.update;
export const deleteMill = millHandlers.remove;

export const getContractors = contractorHandlers.list;
export const addContractor = contractorHandlers.add;
export const updateContractor = contractorHandlers.update;
export const deleteContractor = contractorHandlers.remove;

// Merge duplicate per-mill Contractor records into one (22 Sep, per Rishi's
// notebook: Jamir covering Mill-11/12/13 needed a separate Contractor per
// mill before, splitting his Work Log/Payments/Report into disconnected
// entries for the same real person). Manual and explicit only — Rishi picks
// a primary + one or more duplicates on Manage Data and confirms; nothing
// here runs automatically. Owner-only (see routes/labourRoutes.js).
export const mergeContractorsHandler = async (req, res) => {
  const { primaryId, duplicateIds } = req.body;
  if (!primaryId || typeof primaryId !== "string") {
    return res.status(400).json({ message: "primaryId is required" });
  }
  const dupIds = Array.isArray(duplicateIds) ? duplicateIds.filter((id) => typeof id === "string" && id.trim()) : [];
  if (!dupIds.length) {
    return res.status(400).json({ message: "Pick at least one duplicate contractor to merge" });
  }
  if (dupIds.includes(primaryId)) {
    return res.status(400).json({ message: "The primary contractor can't also be listed as a duplicate" });
  }
  try {
    const result = await mergeContractors(req.user.companyId, primaryId, dupIds);
    if (result.error === "primary_not_found") return res.status(404).json({ message: "Primary contractor not found" });
    if (result.error === "no_duplicates_found") return res.status(404).json({ message: "None of the selected duplicates were found" });
    logFor(
      req,
      "updated",
      "contractor",
      `${result.contractor.name} — merged ${result.removedDuplicates} duplicate(s), moved ${result.movedWageEntries} wage entries + ${result.movedPayments} payments`
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message || "Error merging contractors" });
  }
};

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
    logFor(req, "created", "location", location.name, { entityStore: "locations", entityIds: [location._id] });
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
    logFor(req, "deleted", "location", location.name, { entityStore: "locations", entityIds: [location._id], snapshot: location });
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
const makeBulkDeleteHandler = (bulkDeleteFn, singular, plural, entity, entityStore) => async (req, res) => {
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
      // Undoable as one entry covering the whole batch — see
      // utils/auditLog.js's undoAuditEntry "deleted" branch, which
      // re-creates every row in the snapshot array.
      logFor(req, "deleted", entity, `${deleted.length} ${deleted.length === 1 ? singular : plural} (bulk delete)`, {
        entityStore,
        entityIds: deleted.map((d) => d._id),
        snapshot: deleted,
      });
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

export const bulkDeleteWageEntriesHandler = makeBulkDeleteHandler(bulkDeleteWageEntries, "entry", "entries", "wage entry", "wageEntries");
export const bulkDeletePaymentsHandler = makeBulkDeleteHandler(bulkDeletePayments, "payment", "payments", "payment", "payments");

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
    // 30 Sep, per Rishi: "i imported the sheet of expenses from 13 to 28 and
    // it messed up the whole thing" — this is exactly what the new Undo
    // button on Team & Activity reverses: one click deletes every id this
    // import created, instead of hunting the bad rows down by hand.
    if (entities.length) {
      logFor(req, "created", "wage entry", `${entities.length} wage entries (import)`, {
        entityStore: "wageEntries",
        entityIds: entities.map((e) => e._id),
      });
    }
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
    if (entities.length) {
      logFor(req, "created", "payment", `${entities.length} payments (import)`, {
        entityStore: "payments",
        entityIds: entities.map((e) => e._id),
      });
    }
    res.status(201).json({ added: entities.length, payments: entities });
  } catch (error) {
    res.status(500).json({ message: error.message || "Error adding payments" });
  }
};
