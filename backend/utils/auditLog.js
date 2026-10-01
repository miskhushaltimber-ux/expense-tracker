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
//
// 30 Sep, per Rishi: a bad Labor Wages import ("i imported the sheet of
// expenses from 13 to 28 and it messed up the whole thing") left him with no
// way to fix it except hunting down the bad rows by hand — the log could
// only ever be READ, never acted on. Every entry now optionally carries
// entityStore + entityIds (+ a snapshot for updates/deletes), and
// undoAuditEntry() below can reverse it: delete what was created, re-create
// what was deleted, or restore the fields an update changed. See
// utils/undoRegistry.js for exactly which entities/actions this covers and
// which are deliberately excluded (renames that cascade, budgets, merges,
// file fields).
import crypto from "crypto";
import { ensureSheetTab, getAllRows, appendRow, updateRowAt } from "./firestoreDb.js";
import { UNDO_REGISTRY } from "./undoRegistry.js";

const SHEET_NAME = "AuditLog";
const HEADERS = [
  "id", "companyId", "actorId", "actorName", "actorRole", "action", "entity", "entityLabel",
  "entityStore", "entityIds", "snapshot", "undoneAt", "undoneBy", "createdAt",
];

export const ensureAuditLogSheet = () => ensureSheetTab(SHEET_NAME, HEADERS);

const safeParse = (json, fallback) => {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
};

const toEntry = (row) => {
  const entityIds = safeParse(row.entityIds, []);
  return {
    id: row.id,
    actorId: row.actorId,
    actorName: row.actorName,
    actorRole: row.actorRole,
    action: row.action, // "created" | "updated" | "deleted"
    entity: row.entity, // "expense" | "vehicle" | "master" | "mill" | ...
    entityLabel: row.entityLabel, // a short human-readable description of the row affected
    createdAt: row.createdAt,
    undoneAt: row.undoneAt || null,
    undoneBy: row.undoneBy || "",
    // The frontend only needs to know WHETHER an Undo button makes sense —
    // the actual snapshot data stays server-side, it's never sent down here.
    undoable: Boolean(row.entityStore && UNDO_REGISTRY[row.entityStore] && entityIds.length && !row.undoneAt),
  };
};

// Never throws — a failed audit write is logged to the console and otherwise
// swallowed, so it can never turn a successful save/delete into a 500 for
// the person who just did it.
//
// entityStore: which store the undo registry should use ("expenses",
// "wageEntries", "payments", ...) — omit it (as most call sites for
// non-reversible actions do) and this entry simply isn't undoable.
// entityIds: the row id(s) this action touched — for "created", the new
// row(s); for "updated"/"deleted", the existing row's id (an array of one,
// or several for a bulk delete).
// snapshot: only meaningful for "updated" (the fields' PREVIOUS values —
// not the whole row) and "deleted" (the full deleted row, or an array of
// rows for a bulk delete, in the same order as entityIds). Not used for
// "created" — undoing a create is just "delete these ids".
export const logAction = async ({
  companyId, actorId, actorName, actorRole, action, entity, entityLabel,
  entityStore, entityIds, snapshot,
}) => {
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
      entityStore: entityStore || "",
      entityIds: entityIds && entityIds.length ? JSON.stringify(entityIds) : "",
      snapshot: snapshot !== undefined && snapshot !== null ? JSON.stringify(snapshot) : "",
      undoneAt: "",
      undoneBy: "",
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

// Reverses one audit log entry. Owner-only at the route level (see
// teamRoutes.js) — this can permanently delete rows (undoing a "created"),
// so it gets the same trust level as bulk-delete elsewhere in the app.
//
// "created" -> delete every id in entityIds.
// "deleted" -> re-create every row in snapshot (a fresh id each time — the
//   original id is gone for good, same as any other re-add would be).
// "updated" -> restore the fields captured in snapshot onto entityIds[0].
// Marks the entry undoneAt/undoneBy on success so it can't be undone twice
// and the UI can show it as settled either way.
export const undoAuditEntry = async (id, companyId, { actorId, actorName } = {}) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const row = rows.find((r) => r.id === id && r.companyId === companyId);
  if (!row) return { error: "not_found" };
  if (row.undoneAt) return { error: "already_undone" };

  const registry = row.entityStore && UNDO_REGISTRY[row.entityStore];
  const entityIds = safeParse(row.entityIds, []);
  if (!registry || !entityIds.length) return { error: "not_undoable" };

  const snapshot = safeParse(row.snapshot, null);
  const errors = [];
  let removed = 0;
  let restored = 0;

  if (row.action === "created") {
    if (!registry.deleteById) return { error: "not_undoable" };
    for (const entId of entityIds) {
      const result = await registry.deleteById(entId, companyId);
      if (result?.error) errors.push(`${entId}: ${result.error}`);
      else removed += 1;
    }
  } else if (row.action === "deleted") {
    if (!registry.create) return { error: "not_undoable" };
    const snaps = Array.isArray(snapshot) ? snapshot : [snapshot];
    for (const snap of snaps) {
      if (!snap) continue;
      const result = await registry.create(companyId, snap);
      if (result?.error) errors.push(result.error);
      else restored += 1;
    }
  } else if (row.action === "updated") {
    if (!registry.updateById || entityIds.length !== 1 || !snapshot || typeof snapshot !== "object") {
      return { error: "not_undoable" };
    }
    const result = await registry.updateById(entityIds[0], companyId, snapshot);
    if (result?.error) errors.push(result.error);
    else restored += 1;
  } else {
    return { error: "not_undoable" };
  }

  const merged = { ...row, undoneAt: new Date().toISOString(), undoneBy: actorName || actorId || "" };
  await updateRowAt(SHEET_NAME, HEADERS, row._row, merged);

  return { ok: true, removed, restored, errors };
};
