import ExcelJS from "exceljs";
import { APP_NAME, FILE_PREFIX } from "../constants/brand.js";

// Builds a real, FORMATTED .xlsx workbook in memory — for emailing as an
// attachment, and for a direct download. 23 Sep, per Rishi: the sheet you
// get by sharing or downloading "still looks bad... make it look
// professional and assured company proof." Previously this used the `xlsx`
// package's plain array-of-arrays writer, which the free/community build of
// that library can't style at all (no colors, no borders, no bold) — every
// exported sheet was just raw text in cells. Switched to `exceljs`, which
// supports real cell styling, to build something that actually looks like a
// company report: a title band, a shaded bold header row, borders on every
// cell, zebra-striped rows, right-aligned currency formatting, and a bold
// total row set off with a double border. `xlsx` stays as a dependency —
// it's still used to READ uploaded files for import (see importParser.js /
// labourImportParser.js), just not to build these output files anymore.

const COLORS = {
  headerFill: "FF1F3864", // deep navy — reads as "official report", not the app's own red UI accent
  headerFont: "FFFFFFFF",
  titleFont: "FF1F2937",
  subtitleFont: "FF6B7280",
  zebraFill: "FFF3F4F6",
  totalFill: "FFE2E8F0",
  border: "FFD1D5DB",
};

const thin = { style: "thin", color: { argb: COLORS.border } };
const cellBorder = { top: thin, left: thin, bottom: thin, right: thin };
const CURRENCY_FMT = '"₹"#,##0';

const formatDate = (d) => {
  if (!d) return "";
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString("en-IN");
};

const inr = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN")}`;

// Lays out one styled worksheet: title band, subtitle line, a shaded header
// row, zebra-striped data rows with borders, and a bold total row — then
// freezes the header and turns on autofilter so it behaves like a real
// report the moment it's opened, not just a table of values.
//
// columns: [{ header, width, key, currency?: bool }]
// rows: plain objects keyed by column.key
// totals: { [columnKey]: number } — which columns get a summed total
const addStyledSheet = (workbook, { sheetName, title, subtitleParts, columns, rows, totals = {} }) => {
  const sheet = workbook.addWorksheet(sheetName, { views: [{ showGridLines: false }] });
  const colCount = columns.length;
  sheet.columns = columns.map((c) => ({ width: c.width }));

  sheet.mergeCells(1, 1, 1, colCount);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14, color: { argb: COLORS.titleFont } };
  sheet.getRow(1).height = 26;

  sheet.mergeCells(2, 1, 2, colCount);
  const subtitleCell = sheet.getCell(2, 1);
  subtitleCell.value = subtitleParts.filter(Boolean).join("   ·   ");
  subtitleCell.font = { size: 10, italic: true, color: { argb: COLORS.subtitleFont } };
  sheet.getRow(2).height = 16;

  const headerRowNum = 4;
  const headerRow = sheet.getRow(headerRowNum);
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: COLORS.headerFont } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerFill } };
    cell.alignment = { vertical: "middle", horizontal: c.currency ? "right" : "left" };
    cell.border = cellBorder;
  });
  headerRow.height = 20;

  rows.forEach((row, idx) => {
    const excelRow = sheet.getRow(headerRowNum + 1 + idx);
    columns.forEach((c, i) => {
      const cell = excelRow.getCell(i + 1);
      cell.value = row[c.key] ?? "";
      cell.border = cellBorder;
      cell.alignment = { vertical: "middle", horizontal: c.currency ? "right" : "left" };
      if (c.currency) cell.numFmt = CURRENCY_FMT;
      if (idx % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.zebraFill } };
    });
  });

  const totalRowNum = headerRowNum + 1 + rows.length;
  const totalRow = sheet.getRow(totalRowNum);
  columns.forEach((c, i) => {
    const cell = totalRow.getCell(i + 1);
    cell.border = { ...cellBorder, top: { style: "double", color: { argb: COLORS.border } } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.totalFill } };
    cell.font = { bold: true };
    if (i === 0) {
      cell.value = "TOTAL";
    } else if (totals[c.key] !== undefined) {
      cell.value = totals[c.key];
      cell.numFmt = CURRENCY_FMT;
      cell.alignment = { horizontal: "right" };
    }
  });
  totalRow.height = 18;

  sheet.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: colCount } };
  sheet.views = [{ state: "frozen", ySplit: headerRowNum, showGridLines: false }];

  return sheet;
};

const workbookBuffer = async (workbook) => {
  workbook.creator = APP_NAME;
  workbook.created = new Date();
  return workbook.xlsx.writeBuffer();
};

const EXPENSE_COLUMNS = [
  { header: "Date", key: "date", width: 13 },
  { header: "Expense", key: "expense", width: 34 },
  { header: "Amount (INR)", key: "amount", width: 15, currency: true },
  { header: "Master", key: "master", width: 26 },
  { header: "Vehicle", key: "vehicle", width: 16 },
  { header: "Litres", key: "litres", width: 9 },
  { header: "Bill", key: "bill", width: 42 },
];

// vehiclesById maps a vehicle id to its record, so the sheet shows the truck's
// name rather than a UUID nobody can read.
export const buildExpensesWorkbook = async (expenses, vehiclesById = new Map()) => {
  const rows = expenses.map((e) => ({
    date: formatDate(e.date),
    expense: e.expense || "",
    amount: Number(e.amount) || 0,
    master: e.master || "",
    vehicle: e.vehicleId ? vehiclesById.get(e.vehicleId)?.name || "" : "",
    litres: e.litres ? Number(e.litres) : "",
    bill: e.billFile || "",
  }));
  const total = rows.reduce((sum, r) => sum + r.amount, 0);

  const workbook = new ExcelJS.Workbook();
  addStyledSheet(workbook, {
    sheetName: "Expenses",
    title: `${APP_NAME} — Expense Sheet`,
    subtitleParts: [`Generated ${new Date().toLocaleDateString("en-IN")}`, `${rows.length} ${rows.length === 1 ? "entry" : "entries"}`, `Total ${inr(total)}`],
    columns: EXPENSE_COLUMNS,
    rows,
    totals: { amount: total },
  });
  return workbookBuffer(workbook);
};

export const expensesFileName = () =>
  `${FILE_PREFIX}-${new Date().toISOString().split("T")[0]}.xlsx`;

const WORK_LOG_COLUMNS = [
  { header: "Contractor", key: "contractor", width: 22 },
  { header: "Date", key: "date", width: 20 },
  { header: "CFT", key: "cft", width: 10 },
  { header: "Rate", key: "rate", width: 10, currency: true },
  { header: "Amount (INR)", key: "amount", width: 15, currency: true },
];

const PAYMENT_COLUMNS = [
  { header: "Contractor", key: "contractor", width: 22 },
  { header: "Date", key: "date", width: 14 },
  { header: "Label", key: "label", width: 20 },
  { header: "Amount (INR)", key: "amount", width: 15, currency: true },
];

// contractorsById maps a contractorId to its record, so the sheet shows the
// contractor's name rather than a UUID.
export const buildWorkLogWorkbook = async (wageEntries, contractorsById = new Map()) => {
  const rows = wageEntries.map((w) => ({
    contractor: contractorsById.get(w.contractorId)?.name || "",
    date: w.dateLabel || "",
    cft: Number(w.cft) || 0,
    rate: Number(w.rate) || 0,
    amount: Number(w.amount) || 0,
  }));
  const total = rows.reduce((sum, r) => sum + r.amount, 0);

  const workbook = new ExcelJS.Workbook();
  addStyledSheet(workbook, {
    sheetName: "Work Log",
    title: `${APP_NAME} — Labor Wages Work Log`,
    subtitleParts: [`Generated ${new Date().toLocaleDateString("en-IN")}`, `${rows.length} ${rows.length === 1 ? "entry" : "entries"}`, `Total ${inr(total)}`],
    columns: WORK_LOG_COLUMNS,
    rows,
    totals: { amount: total },
  });
  return workbookBuffer(workbook);
};

export const buildPaymentsWorkbook = async (payments, contractorsById = new Map()) => {
  const rows = payments.map((p) => ({
    contractor: contractorsById.get(p.contractorId)?.name || "",
    date: p.date || "",
    label: p.label || "",
    amount: Number(p.amount) || 0,
  }));
  const total = rows.reduce((sum, r) => sum + r.amount, 0);

  const workbook = new ExcelJS.Workbook();
  addStyledSheet(workbook, {
    sheetName: "Payments",
    title: `${APP_NAME} — Labor Wages Payments`,
    subtitleParts: [`Generated ${new Date().toLocaleDateString("en-IN")}`, `${rows.length} ${rows.length === 1 ? "entry" : "entries"}`, `Total ${inr(total)}`],
    columns: PAYMENT_COLUMNS,
    rows,
    totals: { amount: total },
  });
  return workbookBuffer(workbook);
};

// One workbook, two tabs — the Excel equivalent of the app's existing
// "Download Combined CSV" (Work Log + Payments in one file), but as real
// separate sheets rather than interleaved rows, since Excel doesn't need to
// flatten them the way a single CSV does.
export const buildCombinedLabourWorkbook = async (wageEntries, payments, contractorsById = new Map()) => {
  const workLogRows = wageEntries.map((w) => ({
    contractor: contractorsById.get(w.contractorId)?.name || "",
    date: w.dateLabel || "",
    cft: Number(w.cft) || 0,
    rate: Number(w.rate) || 0,
    amount: Number(w.amount) || 0,
  }));
  const paymentRows = payments.map((p) => ({
    contractor: contractorsById.get(p.contractorId)?.name || "",
    date: p.date || "",
    label: p.label || "",
    amount: Number(p.amount) || 0,
  }));
  const workLogTotal = workLogRows.reduce((sum, r) => sum + r.amount, 0);
  const paymentTotal = paymentRows.reduce((sum, r) => sum + r.amount, 0);
  const generated = `Generated ${new Date().toLocaleDateString("en-IN")}`;

  const workbook = new ExcelJS.Workbook();
  addStyledSheet(workbook, {
    sheetName: "Work Log",
    title: `${APP_NAME} — Labor Wages Work Log`,
    subtitleParts: [generated, `${workLogRows.length} ${workLogRows.length === 1 ? "entry" : "entries"}`, `Total ${inr(workLogTotal)}`],
    columns: WORK_LOG_COLUMNS,
    rows: workLogRows,
    totals: { amount: workLogTotal },
  });
  addStyledSheet(workbook, {
    sheetName: "Payments",
    title: `${APP_NAME} — Labor Wages Payments`,
    subtitleParts: [generated, `${paymentRows.length} ${paymentRows.length === 1 ? "entry" : "entries"}`, `Total ${inr(paymentTotal)}`],
    columns: PAYMENT_COLUMNS,
    rows: paymentRows,
    totals: { amount: paymentTotal },
  });
  return workbookBuffer(workbook);
};

export const labourFileName = (type) =>
  `${FILE_PREFIX}-${type === "payments" ? "payments" : type === "combined" ? "work-log-and-payments" : "work-log"}-${new Date().toISOString().split("T")[0]}.xlsx`;
