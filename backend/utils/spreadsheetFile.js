import * as XLSX from "xlsx";
import { FILE_PREFIX } from "../constants/brand.js";

// Builds a real .xlsx workbook in memory from expense rows, for emailing as
// an attachment.
//
// This exists because the app CANNOT create a Google Sheet on the user's
// behalf: service accounts on free (non-Workspace) Google accounts get zero
// Drive storage quota, so spreadsheets.create fails with a 403. Emailing a
// spreadsheet file sidesteps that entirely — and it's better for the
// recipient anyway, since Gmail offers "Open with Google Sheets" in one
// click and it works for people who don't use Google at all.

const COLUMNS = [
  { header: "Date", width: 12 },
  { header: "Expense", width: 34 },
  { header: "Amount (INR)", width: 14 },
  { header: "Master", width: 26 },
  { header: "Vehicle", width: 16 },
  { header: "Litres", width: 9 },
  { header: "Bill", width: 42 },
];

const formatDate = (d) => {
  if (!d) return "";
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString("en-IN");
};

// vehiclesById maps a vehicle id to its record, so the sheet shows the truck's
// name rather than a UUID nobody can read.
export const buildExpensesWorkbook = (expenses, vehiclesById = new Map()) => {
  const rows = expenses.map((e) => [
    formatDate(e.date),
    e.expense || "",
    Number(e.amount) || 0,
    e.master || "",
    e.vehicleId ? vehiclesById.get(e.vehicleId)?.name || "" : "",
    e.litres ? Number(e.litres) : "",
    e.billFile || "",
  ]);

  const total = rows.reduce((sum, r) => sum + (Number(r[2]) || 0), 0);

  const sheet = XLSX.utils.aoa_to_sheet([
    COLUMNS.map((c) => c.header),
    ...rows,
    [],
    ["", "TOTAL", total, "", "", "", ""],
  ]);
  sheet["!cols"] = COLUMNS.map((c) => ({ wch: c.width }));
  // Freeze the header row so it stays put when scrolling a long sheet.
  sheet["!freeze"] = { xSplit: "0", ySplit: "1" };

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Expenses");

  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
};

export const expensesFileName = () =>
  `${FILE_PREFIX}-${new Date().toISOString().split("T")[0]}.xlsx`;

// Same idea as buildExpensesWorkbook, for the Labor Wages ledgers (Work Log /
// Payments) — each is its own small workbook rather than trying to force
// them into the expense sheet's columns.
const WORK_LOG_COLUMNS = [
  { header: "Contractor", width: 22 },
  { header: "Date", width: 20 },
  { header: "CFT", width: 10 },
  { header: "Rate", width: 10 },
  { header: "Amount (INR)", width: 14 },
];

const PAYMENT_COLUMNS = [
  { header: "Contractor", width: 22 },
  { header: "Date", width: 14 },
  { header: "Label", width: 18 },
  { header: "Amount (INR)", width: 14 },
];

// contractorsById maps a contractorId to its record, so the sheet shows the
// contractor's name rather than a UUID.
export const buildWorkLogWorkbook = (wageEntries, contractorsById = new Map()) => {
  const rows = wageEntries.map((w) => [
    contractorsById.get(w.contractorId)?.name || "",
    w.dateLabel || "",
    Number(w.cft) || 0,
    Number(w.rate) || 0,
    Number(w.amount) || 0,
  ]);
  const total = rows.reduce((sum, r) => sum + (Number(r[4]) || 0), 0);

  const sheet = XLSX.utils.aoa_to_sheet([
    WORK_LOG_COLUMNS.map((c) => c.header),
    ...rows,
    [],
    ["", "", "", "TOTAL", total],
  ]);
  sheet["!cols"] = WORK_LOG_COLUMNS.map((c) => ({ wch: c.width }));
  sheet["!freeze"] = { xSplit: "0", ySplit: "1" };

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Work Log");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
};

export const buildPaymentsWorkbook = (payments, contractorsById = new Map()) => {
  const rows = payments.map((p) => [
    contractorsById.get(p.contractorId)?.name || "",
    p.date || "",
    p.label || "",
    Number(p.amount) || 0,
  ]);
  const total = rows.reduce((sum, r) => sum + (Number(r[3]) || 0), 0);

  const sheet = XLSX.utils.aoa_to_sheet([
    PAYMENT_COLUMNS.map((c) => c.header),
    ...rows,
    [],
    ["", "", "TOTAL", total],
  ]);
  sheet["!cols"] = PAYMENT_COLUMNS.map((c) => ({ wch: c.width }));
  sheet["!freeze"] = { xSplit: "0", ySplit: "1" };

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Payments");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
};

export const labourFileName = (type) =>
  `${FILE_PREFIX}-${type === "payments" ? "payments" : "work-log"}-${new Date().toISOString().split("T")[0]}.xlsx`;
