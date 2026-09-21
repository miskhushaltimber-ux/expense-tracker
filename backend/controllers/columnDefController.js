import {
  SHEET_KEYS,
  COLUMN_TYPES,
  listColumnDefsByCompany,
  createColumnDef,
  updateColumnDef,
  deleteColumnDef,
} from "../models/columnDefStore.js";
import { logAction } from "../utils/auditLog.js";

// Every route here is `?sheet=expenses|wageEntries|payments` (see
// routes/columnDefRoutes.js) — no owner check, per Rishi's choice that any
// login (owner or staff) can add/rename/delete a column. That's a deliberate
// difference from Masters/Mills/Contractors/Vehicles, which stay owner-only.
const logFor = (req, action, entityLabel) =>
  logAction({
    companyId: req.user.companyId,
    actorId: req.user.id,
    actorName: req.user.name,
    actorRole: req.user.role,
    action,
    entity: "column",
    entityLabel,
  });

const sheetFromQuery = (req) => {
  const sheet = req.query.sheet;
  return SHEET_KEYS.includes(sheet) ? sheet : null;
};

export const listColumns = async (req, res) => {
  const sheet = sheetFromQuery(req);
  if (!sheet) return res.status(400).json({ message: `sheet must be one of: ${SHEET_KEYS.join(", ")}` });
  try {
    res.json(await listColumnDefsByCompany(req.user.companyId, sheet));
  } catch (error) {
    res.status(500).json({ message: error.message || "Error fetching columns" });
  }
};

export const addColumn = async (req, res) => {
  const sheet = sheetFromQuery(req);
  if (!sheet) return res.status(400).json({ message: `sheet must be one of: ${SHEET_KEYS.join(", ")}` });
  const { label, type, options } = req.body;
  if (!label || !label.trim()) return res.status(400).json({ message: "Column name is required" });
  if (!COLUMN_TYPES.includes(type)) return res.status(400).json({ message: `type must be one of: ${COLUMN_TYPES.join(", ")}` });

  try {
    const { columnDef, error } = await createColumnDef({ companyId: req.user.companyId, sheetKey: sheet, label, type, options });
    if (error === "duplicate") return res.status(409).json({ message: `A column named "${label.trim()}" already exists here` });
    if (error) return res.status(400).json({ message: "Couldn't add that column" });
    logFor(req, "created", columnDef.label);
    res.status(201).json(columnDef);
  } catch (error) {
    res.status(500).json({ message: error.message || "Error adding column" });
  }
};

export const updateColumn = async (req, res) => {
  const { label, options } = req.body;
  try {
    const { columnDef, error } = await updateColumnDef(req.params.id, req.user.companyId, { label, options });
    if (error === "not_found") return res.status(404).json({ message: "Column not found" });
    if (error === "forbidden") return res.status(403).json({ message: "Not authorized to change this column" });
    if (error === "empty_label") return res.status(400).json({ message: "Column name is required" });
    logFor(req, "updated", columnDef.label);
    res.json(columnDef);
  } catch (error) {
    res.status(500).json({ message: error.message || "Error updating column" });
  }
};

export const removeColumn = async (req, res) => {
  try {
    const { columnDef, error } = await deleteColumnDef(req.params.id, req.user.companyId);
    if (error === "not_found") return res.status(404).json({ message: "Column not found" });
    if (error === "forbidden") return res.status(403).json({ message: "Not authorized to delete this column" });
    logFor(req, "deleted", columnDef.label);
    res.json({ message: "Column deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message || "Error deleting column" });
  }
};
