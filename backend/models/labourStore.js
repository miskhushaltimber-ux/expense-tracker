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
  contractors: ["id", "userId", "millId", "name", "mobile", ...DOC_HEADERS, "openingBalance", "createdAt", "updatedAt"],
  labors: ["id", "userId", "contractorId", "name", "mobile", ...DOC_HEADERS, "createdAt", "updatedAt"],
  // dateLabel is free text ("22-06 TO 27-06") rather than a real date, same
  // as sir's paper sheet — a CFT batch usually spans several days, not one.
  wageEntries: ["id", "userId", "contractorId", "dateLabel", "cft", "rate", "createdAt", "updatedAt"],
  // label is free text too ("CASH/ADV", "S&E", "RTGS", ...) rather than a
  // fixed set — the paper sheet uses several abbreviations sir didn't
  // define, and locking them to an enum risks guessing his terms wrong.
  payments: ["id", "userId", "contractorId", "date", "label", "amount", "createdAt", "updatedAt"],
};

export const ensureMillsSheet = () => ensureSheetTab(SHEETS.mills, HEADERS.mills);
export const ensureContractorsSheet = () => ensureSheetTab(SHEETS.contractors, HEADERS.contractors);
export const ensureLaborsSheet = () => ensureSheetTab(SHEETS.labors, HEADERS.labors);
export const ensureWageEntriesSheet = () => ensureSheetTab(SHEETS.wageEntries, HEADERS.wageEntries);
export const ensurePaymentsSheet = () => ensureSheetTab(SHEETS.payments, HEADERS.payments);

const num = (v) => (v === "" || v === null || v === undefined ? 0 : Number(v) || 0);

const toMill = (row) => ({ _id: row.id, id: row.id, location: row.location, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt });

const toContractor = (row) => ({
  _id: row.id,
  id: row.id,
  millId: row.millId,
  name: row.name,
  mobile: row.mobile || "",
  aadharFile: row.aadharFile || null,
  panFile: row.panFile || null,
  greenCardFile: row.greenCardFile || null,
  openingBalance: num(row.openingBalance),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

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
    dateLabel: row.dateLabel || "",
    cft,
    rate,
    amount: cft * rate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
