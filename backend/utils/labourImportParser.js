import XLSX from "xlsx";
import { parseCsvToRows } from "./importParser.js";

// Column detection for the two Labor Wages ledgers (Work Log / Payments).
// These are NOT expense-shaped (contractor+CFT+rate, or contractor+label+
// amount) so they need their own header matchers rather than reusing
// importParser.js's expense-specific ones (date/expense/amount/master).
// The contractor column is matched by NAME TEXT only — resolving that text
// to an actual contractorId happens on the frontend (it already has the
// contractor list loaded), same as this file leaves "vehicle" resolution to
// the frontend for the Vehicle Expense Sheet's own import (which reuses the
// plain expense parser unchanged).
const normalizeHeader = (h) => String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const findColumn = (headers, candidates) => {
  const normalized = headers.map(normalizeHeader);
  const idx = normalized.findIndex((h) => candidates.some((c) => h === c || h.includes(c)));
  return idx !== -1 ? headers[idx] : null;
};

const parseNumber = (raw) => {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[,₹$\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
};

const readRawRows = (buffer, filename) => {
  const isCsv = /\.csv$/i.test(filename || "");
  if (isCsv) {
    const rows = parseCsvToRows(buffer.toString("utf8"));
    return { rawRows: rows, headers: rows.length ? Object.keys(rows[0]) : [] };
  }
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return { rawRows: [], headers: [] };
  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return { rawRows, headers: rawRows.length ? Object.keys(rawRows[0]) : [] };
};

const valuesToRows = (values) => {
  if (!Array.isArray(values) || values.length < 2) return { rawRows: [], headers: [] };
  const headers = values[0].map((h) => String(h || "").trim());
  const rawRows = values.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? "";
    });
    return obj;
  });
  return { rawRows, headers };
};

const mapWorkLogRows = (rawRows, headers) => {
  if (!rawRows.length) {
    return { rows: [], warnings: ["No data rows found — is the first row a header row?"], columnMapping: {} };
  }
  const mapping = {
    contractor: findColumn(headers, ["contractor", "name", "worker", "party"]),
    date: findColumn(headers, ["date", "period", "week", "dates"]),
    cft: findColumn(headers, ["cft", "quantity", "qty"]),
    rate: findColumn(headers, ["rate", "price", "perft", "percft"]),
  };
  const warnings = [];
  if (!mapping.contractor) warnings.push("Couldn't find a contractor column — you'll need to pick one manually for each row.");
  if (!mapping.cft) warnings.push("Couldn't find a CFT column.");
  if (!mapping.rate) warnings.push("Couldn't find a Rate column.");

  const rows = rawRows.map((raw, index) => {
    const contractorText = mapping.contractor ? String(raw[mapping.contractor] || "").trim() : "";
    const dateLabel = mapping.date ? String(raw[mapping.date] || "").trim() : "";
    const cft = mapping.cft ? parseNumber(raw[mapping.cft]) : null;
    const rate = mapping.rate ? parseNumber(raw[mapping.rate]) : null;
    return {
      _rowNumber: index + 2,
      contractorText,
      contractorId: "",
      dateLabel,
      cft: cft ?? "",
      rate: rate ?? "",
      amount: cft !== null && rate !== null ? cft * rate : null,
      include: cft !== null && rate !== null,
    };
  });

  return { rows, warnings, columnMapping: mapping };
};

const mapPaymentRows = (rawRows, headers) => {
  if (!rawRows.length) {
    return { rows: [], warnings: ["No data rows found — is the first row a header row?"], columnMapping: {} };
  }
  const mapping = {
    contractor: findColumn(headers, ["contractor", "name", "worker", "party"]),
    date: findColumn(headers, ["date", "period", "week", "dates"]),
    label: findColumn(headers, ["label", "type", "mode", "note", "remark", "description"]),
    amount: findColumn(headers, ["amount", "amt", "paid", "value"]),
  };
  const warnings = [];
  if (!mapping.contractor) warnings.push("Couldn't find a contractor column — you'll need to pick one manually for each row.");
  if (!mapping.amount) warnings.push("Couldn't find an amount column.");

  const rows = rawRows.map((raw, index) => {
    const contractorText = mapping.contractor ? String(raw[mapping.contractor] || "").trim() : "";
    const date = mapping.date ? String(raw[mapping.date] || "").trim() : "";
    const label = mapping.label ? String(raw[mapping.label] || "").trim() : "";
    const amount = mapping.amount ? parseNumber(raw[mapping.amount]) : null;
    return {
      _rowNumber: index + 2,
      contractorText,
      contractorId: "",
      date,
      label,
      amount: amount ?? "",
      include: amount !== null,
    };
  });

  return { rows, warnings, columnMapping: mapping };
};

export const parseWorkLogSheetToPreview = (buffer, filename) => {
  const { rawRows, headers } = readRawRows(buffer, filename);
  return mapWorkLogRows(rawRows, headers);
};

export const parseWorkLogValuesToPreview = (values) => {
  const { rawRows, headers } = valuesToRows(values);
  return mapWorkLogRows(rawRows, headers);
};

export const parsePaymentSheetToPreview = (buffer, filename) => {
  const { rawRows, headers } = readRawRows(buffer, filename);
  return mapPaymentRows(rawRows, headers);
};

export const parsePaymentValuesToPreview = (values) => {
  const { rawRows, headers } = valuesToRows(values);
  return mapPaymentRows(rawRows, headers);
};
