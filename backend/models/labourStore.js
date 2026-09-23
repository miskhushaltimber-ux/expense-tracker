// Labor Wages — the whole tree: Location (its own store now, see
// locationStore.js) -> Mills (addable/editable per location) -> Contractors
// (under a mill) -> Labor (under a contractor). Plus, per contractor, the
// wage ledger sir's paper sheet uses: a CFT work log and a payments/advances
// log.
//
// Sir's notebook (18 Sep, second round): "Adoption with period here for
// adding more mills" -> Mills are their own addable list, same as
// Contractors/Labor. Locations used to be a fixed frontend constant here —
// 18 Sep (third round), per Rishi: "we gonna add more [locations] in near
// future", so they moved into their own per-user store (locationStore.js).
// A Mill's `location` field stays a plain NAME string (not a locationId) to
// keep every already-saved mill working without a migration this sandbox
// can't run against Rishi's live sheet — see renameLocationOnMills below for
// how a rename still reaches mills that reference the old name.
//
// All five entities in THIS file share the same generic CRUD shape (see
// makeStore), which just needs each sheet's headers and a row->entity mapper.
import crypto from "crypto";
import { ensureSheetTab, getAllRows, appendRow, appendRows, updateRowAt, updateRowsAt, deleteRowAt, deleteRowsAt } from "../utils/firestoreDb.js";
import { parseCustomFields } from "../utils/customFields.js";

const SHEETS = {
  mills: "Mills",
  contractors: "Contractors",
  labors: "Labors",
  wageEntries: "WageEntries",
  payments: "Payments",
};

const DOC_HEADERS = ["aadharFile", "panFile", "greenCardFile"];
const HEADERS = {
  mills: ["id", "userId", "location", "name", "createdAt", "updatedAt"],
  // contractorType (21 Sep, per Rishi: "add master ... MILL THEKEDAR, REPSO
  // THEKEDAR, BUNDLE THEKEDAR etc") — a free-typed category tag, shown in the
  // UI as "Master". Not related to the Masters catalog (expense categories).
  //
  // millIds (22 Sep, per Rishi: a contractor like Jamir runs Mill-11/12/13
  // under one KTPL-1 responsibility, but used to need a separate Contractor
  // record PER mill — which split his Work Log/Payments/Report into three
  // disconnected entries for the same real person. millIds is a JSON-array
  // string (same "arrives as text over multipart form-data, stored as-is,
  // parsed defensively on read" pattern as customFields — see
  // utils/customFields.js) holding every mill this one contractor covers.
  // millId (singular) stays in the row for any old data/code that hasn't
  // been touched yet, but toContractor() below always DERIVES it from
  // millIds[0] on read rather than trusting a stale stored value.
  contractors: ["id", "userId", "millId", "millIds", "name", "mobile", ...DOC_HEADERS, "openingBalance", "contractorType", "createdAt", "updatedAt"],
  labors: ["id", "userId", "contractorId", "name", "mobile", ...DOC_HEADERS, "createdAt", "updatedAt"],
  // dateLabel is free text ("22-06 TO 27-06") rather than a real date, same
  // as sir's paper sheet — a CFT batch usually spans several days, not one.
  // customFields (21 Sep, custom-columns feature) holds this row's values
  // for whatever extra columns have been added to this ledger — see
  // utils/customFields.js.
  //
  // millId (23 Sep, per Rishi: a multi-mill contractor like Jamir — Mill-11/
  // 12/13 — produces a SEPARATE CFT output per mill on the same job, e.g.
  // 1500/1700/1400 CFT. Before this field existed there was nowhere to
  // record which mill one entry's CFT came from, so the only option was to
  // add up all three mills into one lumped entry — losing exactly which mill
  // produced what. Optional and blank for any contractor with only one mill
  // (or none assigned yet), so nothing about single-mill contractors or
  // already-saved rows changes.
  wageEntries: ["id", "userId", "contractorId", "millId", "dateLabel", "cft", "rate", "createdAt", "updatedAt", "customFields"],
  // label is free text too ("CASH/ADV", "S&E", "RTGS", ...) rather than a
  // fixed set — the paper sheet uses several abbreviations sir didn't
  // define, and locking them to an enum risks guessing his terms wrong.
  payments: ["id", "userId", "contractorId", "date", "label", "amount", "createdAt", "updatedAt", "customFields"],
};

export const ensureMillsSheet = () => ensureSheetTab(SHEETS.mills, HEADERS.mills);
export const ensureContractorsSheet = () => ensureSheetTab(SHEETS.contractors, HEADERS.contractors);
export const ensureLaborsSheet = () => ensureSheetTab(SHEETS.labors, HEADERS.labors);
export const ensureWageEntriesSheet = () => ensureSheetTab(SHEETS.wageEntries, HEADERS.wageEntries);
export const ensurePaymentsSheet = () => ensureSheetTab(SHEETS.payments, HEADERS.payments);

const num = (v) => (v === "" || v === null || v === undefined ? 0 : Number(v) || 0);

// Parses a "which mills does this contractor cover" value defensively —
// it's normally a JSON-array string (how it arrives from the frontend's
// multipart form-data and how it's stored), but tolerates already being a
// real array (e.g. mid-request, before it's round-tripped through storage)
// and silently drops anything malformed rather than throwing.
export const parseIdArray = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((v) => typeof v === "string" && v.trim());
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string" && v.trim()) : [];
    } catch {
      return [];
    }
  }
  return [];
};

// A contractor's mills, falling back to the old single millId for any row
// saved before millIds existed — so nothing needs a manual migration step.
const contractorMillIds = (row) => {
  const parsed = parseIdArray(row.millIds);
  return parsed.length ? parsed : row.millId ? [row.millId] : [];
};

const toMill = (row) => ({ _id: row.id, id: row.id, location: row.location, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt });

const toContractor = (row) => {
  const millIds = contractorMillIds(row);
  return {
    _id: row.id,
    id: row.id,
    millId: millIds[0] || row.millId || "", // legacy/primary mill — derived, never trusted from storage directly
    millIds,
    name: row.name,
    mobile: row.mobile || "",
    aadharFile: row.aadharFile || null,
    panFile: row.panFile || null,
    greenCardFile: row.greenCardFile || null,
    openingBalance: num(row.openingBalance),
    contractorType: row.contractorType || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

const toLabor = (row) => ({
  _id: row.id,
  id: row.id,
  contractorId: row.contractorId,
  name: row.name,
  mobile: row.mobile || "",
  aadharFile: row.aadharFile || null,
  panFile: row.panFile || null,
  greenCardFile: row.greenCardFile || null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toWageEntry = (row) => {
  const cft = num(row.cft);
  const rate = num(row.rate);
  return {
    _id: row.id,
    id: row.id,
    contractorId: row.contractorId,
    millId: row.millId || "",
    dateLabel: row.dateLabel || "",
    cft,
    rate,
    amount: cft * rate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    customFields: parseCustomFields(row.customFields),
  };
};

const toPayment = (row) => ({
  _id: row.id,
  id: row.id,
  contractorId: row.contractorId,
  date: row.date || "",
  label: row.label || "",
  amount: num(row.amount),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  customFields: parseCustomFields(row.customFields),
});

// Fully generic: given a sheet's headers and its row->entity mapper, every
// entity here (mill, contractor, labor, wage entry, payment) gets the same
// list/create/update/delete behaviour, scoped and ownership-checked by
// userId. Callers pass whatever extra fields their entity needs (millId,
// cft, label, ...) — nothing here is hardcoded to any one shape.
const makeStore = (sheetKey, toEntity) => {
  const SHEET = SHEETS[sheetKey];
  const cols = HEADERS[sheetKey];
  const dataFields = cols.filter((h) => !["id", "userId", "createdAt", "updatedAt"].includes(h));

  const listByUser = async (userId) => {
    const rows = await getAllRows(SHEET, cols);
    return rows.filter((r) => r.userId === userId).map(toEntity);
  };

  const create = async (fields) => {
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      userId: fields.userId,
      createdAt: now,
      updatedAt: now,
      ...Object.fromEntries(dataFields.map((f) => [f, fields[f] ?? ""])),
    };
    await appendRow(SHEET, cols, row);
    return toEntity(row);
  };

  // Same idea as expenseStore's bulkCreateExpenses — used by the Labor Wages
  // Work Log / Payments import (one appendRows call instead of N appendRow
  // calls). Same generic shape as create() above, just batched.
  const bulkCreate = async (userId, rowsFields) => {
    const now = new Date().toISOString();
    const prepared = rowsFields.map((fields) => ({
      id: crypto.randomUUID(),
      userId,
      createdAt: now,
      updatedAt: now,
      ...Object.fromEntries(dataFields.map((f) => [f, fields[f] ?? ""])),
    }));
    await appendRows(SHEET, cols, prepared);
    return prepared.map(toEntity);
  };

  const findOwnedRow = async (id, userId) => {
    const rows = await getAllRows(SHEET, cols);
    const row = rows.find((r) => r.id === id);
    if (!row) return { error: "not_found" };
    if (row.userId !== userId) return { error: "forbidden" };
    return { row };
  };

  const updateById = async (id, userId, updates) => {
    const { row, error } = await findOwnedRow(id, userId);
    if (error) return { error };
    const merged = { ...row, ...updates, updatedAt: new Date().toISOString() };
    await updateRowAt(SHEET, cols, row._row, merged);
    return { entity: toEntity(merged) };
  };

  const deleteById = async (id, userId) => {
    const { row, error } = await findOwnedRow(id, userId);
    if (error) return { error };
    await deleteRowAt(SHEET, row._row);
    return { entity: toEntity(row) };
  };

  // Deletes many rows at once — same idea and same reasoning as
  // expenseStore's deleteExpensesByIds: one sheet read, one batched delete,
  // however many rows are selected, with anything not owned by this user (or
  // already gone) reported back instead of failing the whole request.
  const bulkDeleteByIds = async (ids, userId) => {
    const rows = await getAllRows(SHEET, cols);
    const byId = new Map(rows.map((r) => [r.id, r]));

    const mine = [];
    const notFound = [];
    const forbidden = [];
    for (const id of new Set(ids)) {
      const row = byId.get(id);
      if (!row) notFound.push(id);
      else if (row.userId !== userId) forbidden.push(id);
      else mine.push(row);
    }

    if (mine.length) {
      await deleteRowsAt(SHEET, mine.map((r) => r._row));
    }

    return { deleted: mine.map(toEntity), notFound, forbidden };
  };

  return { listByUser, create, bulkCreate, updateById, deleteById, bulkDeleteByIds };
};

// Contractors/labor also sort alphabetically by name for display — the
// generic store above doesn't, since mills/wage-entries/payments read
// better in entry order instead.
const alpha = (list) => [...list].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

const millStore = makeStore("mills", toMill);
const contractorStore = makeStore("contractors", toContractor);
const laborStore = makeStore("labors", toLabor);
const wageEntryStore = makeStore("wageEntries", toWageEntry);
const paymentStore = makeStore("payments", toPayment);

export const listMillsByUser = (userId) => millStore.listByUser(userId).then(alpha);
export const createMill = millStore.create;
export const updateMillById = millStore.updateById;
export const deleteMillById = millStore.deleteById;

// Mills reference a location by NAME (see the file header comment), so
// renaming a location has to reach every mill using the old name too —
// otherwise a rename would silently orphan them, same bug class the master
// rename cascade (renameMasterOnExpenses) already guards against. Deleting a
// location that's still in use is blocked at the controller level instead,
// using countMillsUsingLocation below.
export const renameLocationOnMills = async (userId, oldName, newName) => {
  const rows = await getAllRows(SHEETS.mills, HEADERS.mills);
  const wanted = (oldName || "").trim().toLowerCase();
  const now = new Date().toISOString();
  const updates = rows
    .filter((r) => r.userId === userId && (r.location || "").trim().toLowerCase() === wanted)
    .map((r) => ({ rowNumber: r._row, rowObject: { ...r, location: newName, updatedAt: now } }));

  if (updates.length) await updateRowsAt(SHEETS.mills, HEADERS.mills, updates);
  return updates.length;
};

export const countMillsUsingLocation = async (userId, name) => {
  const rows = await getAllRows(SHEETS.mills, HEADERS.mills);
  const wanted = (name || "").trim().toLowerCase();
  return rows.filter((r) => r.userId === userId && (r.location || "").trim().toLowerCase() === wanted).length;
};

export const listContractorsByUser = (userId) => contractorStore.listByUser(userId).then(alpha);
export const createContractor = contractorStore.create;
export const updateContractorById = contractorStore.updateById;
export const deleteContractorById = contractorStore.deleteById;

// Merging duplicate per-mill Contractor records into one (22 Sep, per
// Rishi: Jamir being entered as three separate Contractors — one per mill —
// split his Work Log/Payments/Report into three disconnected entries for
// the same real person, once each mill's work got logged separately).
// NEVER auto-run — this only fires when Rishi explicitly picks a primary +
// duplicates on Manage Data and confirms. Every WageEntry/Payment row that
// belonged to a duplicate is re-pointed at the primary contractor (nothing
// about those rows' amounts/dates/CFT changes, only which contractor they're
// filed under), the duplicates' mills are unioned onto the primary, opening
// balances are summed (each duplicate's own opening balance was real money
// owed, so merging silently dropping it would understate what's pending),
// and the now-redundant duplicate Contractor rows are deleted. Every result
// is returned so the caller can tell Rishi exactly what moved.
export const mergeContractors = async (userId, primaryId, duplicateIds) => {
  const rows = await getAllRows(SHEETS.contractors, HEADERS.contractors);
  const mine = rows.filter((r) => r.userId === userId);
  const primaryRow = mine.find((r) => r.id === primaryId);
  if (!primaryRow) return { error: "primary_not_found" };
  const dupRows = duplicateIds.map((id) => mine.find((r) => r.id === id)).filter(Boolean);
  if (!dupRows.length) return { error: "no_duplicates_found" };

  const millIdSet = new Set(contractorMillIds(primaryRow));
  let openingBalanceSum = num(primaryRow.openingBalance);
  for (const d of dupRows) {
    contractorMillIds(d).forEach((id) => millIdSet.add(id));
    openingBalanceSum += num(d.openingBalance);
  }
  const mergedMillIds = [...millIdSet];

  const now = new Date().toISOString();
  const updatedPrimaryRow = {
    ...primaryRow,
    millIds: JSON.stringify(mergedMillIds),
    millId: mergedMillIds[0] || primaryRow.millId || "",
    openingBalance: openingBalanceSum,
    updatedAt: now,
  };
  await updateRowAt(SHEETS.contractors, HEADERS.contractors, primaryRow._row, updatedPrimaryRow);

  const dupIdSet = new Set(dupRows.map((r) => r.id));
  const moveContractorId = async (sheetKey) => {
    const sheetRows = await getAllRows(SHEETS[sheetKey], HEADERS[sheetKey]);
    const updates = sheetRows
      .filter((r) => r.userId === userId && dupIdSet.has(r.contractorId))
      .map((r) => ({ rowNumber: r._row, rowObject: { ...r, contractorId: primaryId, updatedAt: now } }));
    if (updates.length) await updateRowsAt(SHEETS[sheetKey], HEADERS[sheetKey], updates);
    return updates.length;
  };
  const movedWageEntries = await moveContractorId("wageEntries");
  const movedPayments = await moveContractorId("payments");

  await deleteRowsAt(SHEETS.contractors, dupRows.map((r) => r._row));

  return {
    contractor: toContractor(updatedPrimaryRow),
    movedWageEntries,
    movedPayments,
    removedDuplicates: dupRows.length,
  };
};

export const listLaborsByUser = (userId) => laborStore.listByUser(userId).then(alpha);
export const createLabor = laborStore.create;
export const updateLaborById = laborStore.updateById;
export const deleteLaborById = laborStore.deleteById;

export const listWageEntriesByUser = wageEntryStore.listByUser;
export const createWageEntry = wageEntryStore.create;
export const bulkCreateWageEntries = wageEntryStore.bulkCreate;
export const updateWageEntryById = wageEntryStore.updateById;
export const deleteWageEntryById = wageEntryStore.deleteById;
export const bulkDeleteWageEntries = wageEntryStore.bulkDeleteByIds;

export const listPaymentsByUser = paymentStore.listByUser;
export const createPayment = paymentStore.create;
export const bulkCreatePayments = paymentStore.bulkCreate;
export const updatePaymentById = paymentStore.updateById;
export const deletePaymentById = paymentStore.deleteById;
export const bulkDeletePayments = paymentStore.bulkDeleteByIds;
