// Vehicles live as rows in the "Vehicles" tab of the app's Google Sheet
// database (see utils/sheetsDb.js) — same pattern as userStore/expenseStore.
// Each vehicle can hold up to 3 documents (RC, insurance, permit) with an
// expiry date each, so the Vehicles page can flag what's expiring soon or
// already expired. Expenses logged against a vehicle are just normal rows
// in the Expenses sheet with `vehicleId` set — this sheet only holds the
// vehicle's own details, not its expense history.
import crypto from "crypto";
import { ensureSheetTab, getAllRows, appendRow, updateRowAt, deleteRowAt } from "../utils/sheetsDb.js";

const SHEET_NAME = "Vehicles";
const HEADERS = [
  "id",
  "userId",
  "name",
  "numberPlate",
  "rcExpiry",
  "insuranceExpiry",
  "permitExpiry",
  "rcFile",
  "insuranceFile",
  "permitFile",
  // A photo of the number plate itself. Unlike the documents it has no
  // expiry date — it is just proof of which vehicle this row is.
  "plateFile",
  "createdAt",
  "updatedAt",
];

export const ensureVehiclesSheet = () => ensureSheetTab(SHEET_NAME, HEADERS);

const toVehicle = (row) => ({
  _id: row.id,
  id: row.id,
  name: row.name,
  numberPlate: row.numberPlate,
  rcExpiry: row.rcExpiry || null,
  insuranceExpiry: row.insuranceExpiry || null,
  permitExpiry: row.permitExpiry || null,
  rcFile: row.rcFile || null,
  insuranceFile: row.insuranceFile || null,
  permitFile: row.permitFile || null,
  plateFile: row.plateFile || null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const listVehiclesByUser = async (userId) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  return rows
    .filter((r) => r.userId === userId)
    .map(toVehicle)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
};

export const createVehicle = async ({
  userId,
  name,
  numberPlate,
  rcExpiry,
  insuranceExpiry,
  permitExpiry,
  rcFile,
  insuranceFile,
  permitFile,
  plateFile,
}) => {
  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    userId,
    name,
    numberPlate: numberPlate || "",
    rcExpiry: rcExpiry || "",
    insuranceExpiry: insuranceExpiry || "",
    permitExpiry: permitExpiry || "",
    rcFile: rcFile || "",
    insuranceFile: insuranceFile || "",
    permitFile: permitFile || "",
    plateFile: plateFile || "",
    createdAt: now,
    updatedAt: now,
  };
  await appendRow(SHEET_NAME, HEADERS, row);
  return toVehicle(row);
};

const findOwnedRow = async (id, userId) => {
  const rows = await getAllRows(SHEET_NAME, HEADERS);
  const row = rows.find((r) => r.id === id);
  if (!row) return { error: "not_found" };
  if (row.userId !== userId) return { error: "forbidden" };
  return { row };
};

export const updateVehicleById = async (id, userId, updates) => {
  const { row, error } = await findOwnedRow(id, userId);
  if (error) return { error };
  const merged = { ...row, ...updates, updatedAt: new Date().toISOString() };
  await updateRowAt(SHEET_NAME, HEADERS, row._row, merged);
  return { vehicle: toVehicle(merged) };
};

export const deleteVehicleById = async (id, userId) => {
  const { row, error } = await findOwnedRow(id, userId);
  if (error) return { error };
  await deleteRowAt(SHEET_NAME, row._row);
  return { vehicle: toVehicle(row) };
};
