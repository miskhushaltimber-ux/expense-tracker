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

// --- Contractor Bill (29 Sep, per Rishi: "the report is looking bad now i
// think you should follow the report format just like repso cause sir is
// used to see such bill like reports so create such report pages of all
// the contractors and in same format") -------------------------------
//
// One worksheet PER CONTRACTOR (so each one prints as its own page, like a
// paper bill) — work history on the left, payment history on the right,
// same "left side payment right side work log" split Rishi already asked
// for on the linked Google Sheet (see utils/googleSheets.js's
// LABOUR_COMBINED_TAB), plus an Opening Balance line up top and a Closing
// Balance total at the bottom so it reads like sir's own ledger. Scoped via
// AskUserQuestion to the "Simpler version": a plain chronological list of
// work/payment rows, NOT the exact weekly-grid rollup-column paper layout.

// Same dateLabel parsing as labourSheetsController.js's parseWorkLogDate —
// wageEntries carry "DD-MM-YYYY" or "DD-MM-YYYY TO DD-MM-YYYY" rather than a
// real date field. Duplicated here (not imported) since this is a small,
// self-contained sort key and spreadsheetFile.js otherwise has no
// dependency on the controller layer.
const parseWorkLogDateForSort = (w) => {
  const first = String(w.dateLabel || "").split(" TO ")[0].trim();
  const [d, m, y] = first.split("-");
  if (!d || !m || !y) return Infinity;
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  return isNaN(dt.getTime()) ? Infinity : dt.getTime();
};

const isAdvancePaymentRow = (p) => p.isAdvance === true || /\badv/i.test(p.label || "");

// Excel sheet names: max 31 chars, no \ / * ? : [ ] , and must be unique
// within the workbook — two contractors named identically (or a name that
// collides after truncation) would otherwise crash the whole export.
const sheetNameFor = (name, used) => {
  const base = String(name || "Contractor").replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 28) || "Contractor";
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} (${n})`.slice(0, 31);
    n += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
};

const addBillSheet = (workbook, { sheetName, contractor, ownWageEntries, ownPayments }) => {
  const sheet = workbook.addWorksheet(sheetName, { views: [{ showGridLines: false }] });
  const colWidths = [13, 9, 10, 14, 3, 13, 12, 18, 14];
  sheet.columns = colWidths.map((width) => ({ width }));
  const colCount = colWidths.length;

  const totalEarned = ownWageEntries.reduce((sum, w) => sum + (Number(w.amount) || 0), 0);
  const totalPaid = ownPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const totalAdvance = ownPayments.filter(isAdvancePaymentRow).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const openingBalance = Number(contractor.openingBalance || 0);
  const closingBalance = openingBalance + totalEarned - totalPaid;

  sheet.mergeCells(1, 1, 1, colCount);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `${APP_NAME} — Contractor Bill`;
  titleCell.font = { bold: true, size: 14, color: { argb: COLORS.titleFont } };
  sheet.getRow(1).height = 26;

  sheet.mergeCells(2, 1, 2, colCount);
  const subtitleCell = sheet.getCell(2, 1);
  subtitleCell.value = [contractor.name, contractor.contractorType ? `Master: ${contractor.contractorType}` : null, `Generated ${new Date().toLocaleDateString("en-IN")}`]
    .filter(Boolean)
    .join("   ·   ");
  subtitleCell.font = { bold: true, size: 12, color: { argb: COLORS.titleFont } };
  sheet.getRow(2).height = 18;

  sheet.mergeCells(3, 1, 3, colCount);
  const openingCell = sheet.getCell(3, 1);
  openingCell.value = `Opening Balance: ${inr(openingBalance)}`;
  openingCell.font = { italic: true, size: 10, color: { argb: COLORS.subtitleFont } };
  sheet.getRow(3).height = 16;

  const sectionRowNum = 5;
  sheet.mergeCells(sectionRowNum, 1, sectionRowNum, 4);
  sheet.mergeCells(sectionRowNum, 6, sectionRowNum, 9);
  const sectionRow = sheet.getRow(sectionRowNum);
  const workHeaderCell = sectionRow.getCell(1);
  workHeaderCell.value = "WORK HISTORY";
  const paymentHeaderCell = sectionRow.getCell(6);
  paymentHeaderCell.value = "PAYMENT HISTORY";
  [workHeaderCell, paymentHeaderCell].forEach((cell) => {
    cell.font = { bold: true, color: { argb: COLORS.headerFont } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerFill } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  sectionRow.height = 18;

  const headerRowNum = 6;
  const headerRow = sheet.getRow(headerRowNum);
  const headerLabels = ["Date", "CFT", "Rate", "Amount", "", "Date", "Type", "Label", "Amount"];
  const rightAligned = new Set([2, 3, 4, 9]);
  headerLabels.forEach((label, i) => {
    if (!label) return; // column 5 is a blank spacer between the two blocks
    const cell = headerRow.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.zebraFill } };
    cell.border = cellBorder;
    cell.alignment = { vertical: "middle", horizontal: rightAligned.has(i + 1) ? "right" : "left" };
  });
  headerRow.height = 16;

  const workRows = [...ownWageEntries].sort((a, b) => parseWorkLogDateForSort(a) - parseWorkLogDateForSort(b));
  const paymentRows = [...ownPayments].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  const dataRowCount = Math.max(workRows.length, paymentRows.length);
  const dataCols = [1, 2, 3, 4, 6, 7, 8, 9];

  for (let idx = 0; idx < dataRowCount; idx += 1) {
    const excelRow = sheet.getRow(headerRowNum + 1 + idx);
    const w = workRows[idx];
    const p = paymentRows[idx];
    if (w) {
      excelRow.getCell(1).value = w.dateLabel || "";
      excelRow.getCell(2).value = Number(w.cft) || 0;
      excelRow.getCell(3).value = Number(w.rate) || 0;
      excelRow.getCell(3).numFmt = CURRENCY_FMT;
      excelRow.getCell(4).value = Number(w.amount) || 0;
      excelRow.getCell(4).numFmt = CURRENCY_FMT;
    }
    if (p) {
      excelRow.getCell(6).value = formatDate(p.date);
      excelRow.getCell(7).value = isAdvancePaymentRow(p) ? "Advance" : "Payment";
      excelRow.getCell(8).value = p.label || "";
      excelRow.getCell(9).value = Number(p.amount) || 0;
      excelRow.getCell(9).numFmt = CURRENCY_FMT;
    }
    const zebra = idx % 2 === 1;
    dataCols.forEach((c) => {
      const cell = excelRow.getCell(c);
      cell.border = cellBorder;
      cell.alignment = { vertical: "middle", horizontal: rightAligned.has(c) ? "right" : "left" };
      if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.zebraFill } };
    });
  }

  if (dataRowCount === 0) {
    const emptyRowNum = headerRowNum + 1;
    sheet.mergeCells(emptyRowNum, 1, emptyRowNum, 4);
    sheet.getCell(emptyRowNum, 1).value = "No work logged yet";
    sheet.mergeCells(emptyRowNum, 6, emptyRowNum, 9);
    sheet.getCell(emptyRowNum, 6).value = "No payments yet";
    [1, 6].forEach((c) => {
      sheet.getCell(emptyRowNum, c).font = { italic: true, color: { argb: COLORS.subtitleFont } };
    });
  }

  const summaryStart = headerRowNum + 2 + dataRowCount;
  const summaryLines = [
    ["Total Earned", totalEarned],
    ["Total Paid", totalPaid],
    ["Total Advance (included in Paid)", totalAdvance],
    ["Opening Balance", openingBalance],
    [closingBalance < 0 ? "Closing Balance — owed back to company" : "Closing Balance — pending to pay", Math.abs(closingBalance)],
  ];
  summaryLines.forEach(([label, value], i) => {
    const rowNum = summaryStart + i;
    const isLast = i === summaryLines.length - 1;
    sheet.mergeCells(rowNum, 1, rowNum, 6);
    const labelCell = sheet.getCell(rowNum, 1);
    labelCell.value = label;
    sheet.mergeCells(rowNum, 7, rowNum, 9);
    const valueCell = sheet.getCell(rowNum, 7);
    valueCell.value = value;
    valueCell.numFmt = CURRENCY_FMT;
    valueCell.alignment = { horizontal: "right" };
    [labelCell, valueCell].forEach((cell) => {
      cell.font = { bold: true, size: isLast ? 12 : 10 };
      if (isLast) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.totalFill } };
    });
  });

  sheet.views = [{ state: "frozen", ySplit: headerRowNum, showGridLines: false }];
  return sheet;
};

// contractors: the full list (not narrowed to whoever has activity) — a
// contractor with only an opening balance and nothing logged yet still gets
// a page, since that balance is real money either way. Contractors with
// truly nothing (no opening balance, no work, no payments) are skipped so
// the workbook doesn't fill up with empty pages.
export const buildContractorBillWorkbook = async (contractors, wageEntries, payments) => {
  const workbook = new ExcelJS.Workbook();

  const wageByContractor = new Map();
  for (const w of wageEntries) {
    if (!wageByContractor.has(w.contractorId)) wageByContractor.set(w.contractorId, []);
    wageByContractor.get(w.contractorId).push(w);
  }
  const paymentsByContractor = new Map();
  for (const p of payments) {
    if (!paymentsByContractor.has(p.contractorId)) paymentsByContractor.set(p.contractorId, []);
    paymentsByContractor.get(p.contractorId).push(p);
  }

  const used = new Set();
  const sortedContractors = [...contractors].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  for (const contractor of sortedContractors) {
    const ownWageEntries = wageByContractor.get(contractor._id) || [];
    const ownPayments = paymentsByContractor.get(contractor._id) || [];
    if (ownWageEntries.length === 0 && ownPayments.length === 0 && Number(contractor.openingBalance || 0) === 0) continue;
    addBillSheet(workbook, { sheetName: sheetNameFor(contractor.name, used), contractor, ownWageEntries, ownPayments });
  }

  if (workbook.worksheets.length === 0) {
    addBillSheet(workbook, { sheetName: "No Activity", contractor: { name: "No contractors with activity yet" }, ownWageEntries: [], ownPayments: [] });
  }

  return workbookBuffer(workbook);
};

export const labourFileName = (type) =>
  `${FILE_PREFIX}-${
    type === "payments" ? "payments" : type === "combined" ? "work-log-and-payments" : type === "bill" ? "contractor-bills" : "work-log"
  }-${new Date().toISOString().split("T")[0]}.xlsx`;
