// The "who entered what" trail (19 Sep, multi-user accounts) — a plain,
// append-only Firestore collection every mutating controller writes one row
// to. Deliberately separate from the entities themselves (Expenses, Vehicles,
// Masters, ...) rather than adding createdBy/updatedBy columns to each of
// them: this way NONE of the existing stores needed to change shape, and the
// owner gets one chronological feed of everything instead of having to open
// each page and each row to piece it together.
//
// Logging a mistake must never break the action it's logging — every call
// site does `logAction(...).catch(...)` (or this module swallows the error
// itself, see below) so a Firestore hiccup on the audit write can, at worst,
// lose one log line, never the user's actual save/delete.
import crypto from "crypto";
import { ensureSheetTab, getAllRows, appendRow } from "./firestoreDb.js";

const SHEET_NAME = "AuditLog";
const HEADERS = ["id", "companyId", "actorId", "actorName", "actorRole", "action", "entity", "entityLabel", "createdAt"];

export const ensureAuditLogSheet = () => ensureSheetTab(SHEET_NAME, HEADERS);

const toEntry = (row) => ({
  id: row.id,
  actorId: row.actorId,
  actorName: row.actorName,
  actorRole: row.actorRole,
  action: row.action, // "created" | "updated" | "deleted"
  entity: row.entity, // "expense" | "vehicle" | "master" | "mill" | ...
  entityLabel: row.entityLabel, // a short human-readable description of the row affected
  createdAt: row.createdAt,
});

// Never throws — a failed audit write is logged to the console and otherwise
// swallowed, so it can never turn a successful save/delete into a 500 for
// the person who just did it.
export const logAction = async ({ companyId, actorId, actorName, actorRole, action, entity, entityLabel }) => {
  if (!companyId) return; // legacy/mid-migration request — nothing to attribute yet
  try {
    const row = {
      id: crypto.randomUUID(),
      companyId,
      actorId: actorId || "",
      actorName: actorName || "",
      actorRole: actorRole || "",
      action,
      entity,
      entityLabel: entityLabel || "",
      createdAt: new Date().toISOString(),
    };
    await appendRow(SHEET_NAME, HEADERS, row);
  } catch (error) {
    console.warn("Audit log write failed (the underlying action still succeeded):", error.message);
  }
};

// Most recent first, capped — this is a feed for a human to skim on the Team
// page, not a report to page through, so a simple cap is enough for now.
export const listAuditLogByCompany = async (companyId, { limit = 300 } = {}) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  return rows
    .filter((r) => r.companyId === companyId)
    .map(toEntry)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
};
