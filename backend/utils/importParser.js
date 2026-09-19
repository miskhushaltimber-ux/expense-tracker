import XLSX from "xlsx";
import { EXPENSE_MASTERS } from "../constants/categories.js";

// ---- Master guessing, from keywords in the row's expense/description text ----
// Order matters: first match wins, so put more specific keywords first.
const MASTER_KEYWORD_RULES = [
  { master: "Raw Timber Purchase", keywords: ["timber purchase", "wood purchase", "log purchase", "raw material", "timber", "log", "wood"] },
  { master: "Transport & Freight", keywords: ["transport", "freight", "truck", "lorry", "shipping", "delivery", "carriage"] },
  { master: "Labor Wages", keywords: ["wage", "labour", "labor", "salary", "worker", "staff pay"] },
  { master: "Sawmill & Machinery Maintenance", keywords: ["machine", "machinery", "saw blade", "sawmill", "repair", "maintenance", "spare part", "spares"] },
  { master: "Fuel & Diesel", keywords: ["diesel", "petrol", "fuel", "gas"] },
  { master: "Electricity Bill", keywords: ["electricity", "power bill", "current bill", "electric bill"] },
  { master: "Rent", keywords: ["rent"] },
  { master: "GST & Taxes", keywords: ["gst", "tax", "vat", "cess"] },
  { master: "Loading & Unloading", keywords: ["loading", "unloading", "coolie", "handling charge"] },
  { master: "Packing Material", keywords: ["packing", "packaging", "carton", "box"] },
  { master: "Office & Stationery", keywords: ["stationery", "office supply", "printer", "paper", "pen"] },
];

const guessMaster = (text) => {
  const t = (text || "").toLowerCase();
  for (const rule of MASTER_KEYWORD_RULES) {
    if (rule.keywords.some((kw) => t.includes(kw))) return rule.master;
  }
  return "Miscellaneous";
};

// ---- Header-name based column detection ----
const normalizeHeader = (h) => String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const HEADER_MATCHERS = {
  date: ["date", "transactiondate", "entrydate"],
  amount: ["amount", "amt", "value", "price", "total", "inr", "rupees"],
  expense: ["expense", "description", "desc", "particulars", "particular", "details", "detail", "title", "narration", "remark", "remarks", "item"],
  master: ["master", "category", "categories", "head", "expensehead"],
  // Optional columns, only present on a sheet that mixes vehicle expenses
  // and/or labor payments in with regular expenses. See resolveDestinations
  // in backend/utils/importDestinations.js for what happens with these —
  // this file only detects and extracts the raw text, it has no database
  // access to match names against actual saved vehicles/contractors.
  vehicle: ["vehicle", "vehiclename", "vehicleno", "vehiclenumber", "numberplate", "truckno", "truck"],
  contractor: ["contractor", "contractorname", "labourcontractor", "labourername", "labourer", "labouername"],
};

const detectColumnsByHeader = (headers) => {
  const mapping = {};
  const normalized = headers.map(normalizeHeader);
  for (const [field, candidates] of Object.entries(HEADER_MATCHERS)) {
    const idx = normalized.findIndex((h) => candidates.some((c) => h === c || h.includes(c)));
    if (idx !== -1) mapping[field] = headers[idx];
  }
  return mapping;
};

// ---- Content-based fallback (when headers don't give it away) ----
const looksLikeDate = (v) => {
  if (v instanceof Date) return true;
  if (typeof v === "number") return v > 20000 && v < 60000; // plausible Excel serial date range
  if (typeof v !== "string" || !v.trim()) return false;
  return !isNaN(Date.parse(v));
};

const looksLikeNumber = (v) => {
  if (typeof v === "number") return true;
  if (typeof v !== "string") return false;
  const cleaned = v.replace(/[,₹$\s]/g, "");
  return cleaned !== "" && !isNaN(Number(cleaned));
};

// A "1, 2, 3, ..." row-number/serial column (e.g. "S.No") is technically
// numeric but is never the amount — it just counts rows.
const isSequentialIndexColumn = (rows, header) => {
  if (!rows.length) return false;
  return rows.every((r, i) => {
    const raw = r[header];
    const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
    return !isNaN(n) && n === i + 1;
  });
};

const numericValueOf = (raw) => {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[,₹$\s]/g, ""));
  return isNaN(n) ? null : n;
};

const detectColumnsByContent = (rows, headers, alreadyMapped) => {
  const mapping = { ...alreadyMapped };
  const remaining = () => {
    const used = new Set(Object.values(mapping).filter(Boolean));
    return headers.filter((h) => !used.has(h));
  };

  const scoreColumn = (header, predicate) => {
    const sample = rows.slice(0, 20);
    if (!sample.length) return 0;
    const hits = sample.filter((r) => predicate(r[header])).length;
    return hits / sample.length;
  };

  if (!mapping.date) {
    const candidate = remaining().find((h) => scoreColumn(h, looksLikeDate) > 0.7);
    if (candidate) mapping.date = candidate;
  }

  if (!mapping.amount) {
    const numericCandidates = remaining().filter((h) => scoreColumn(h, looksLikeNumber) > 0.7);
    const nonSequential = numericCandidates.filter((h) => !isSequentialIndexColumn(rows, h));
    const pool = nonSequential.length ? nonSequential : numericCandidates;
    const avgMagnitude = (h) => {
      const vals = rows.map((r) => numericValueOf(r[h])).filter((n) => n !== null);
      if (!vals.length) return 0;
      return vals.reduce((sum, n) => sum + Math.abs(n), 0) / vals.length;
    };
    const best = pool.slice().sort((a, b) => avgMagnitude(b) - avgMagnitude(a))[0];
    if (best) mapping.amount = best;
  }

  if (!mapping.expense) {
    const candidates = remaining();
    const textCandidate = candidates.find((h) => scoreColumn(h, looksLikeNumber) <= 0.5) || candidates[0];
    if (textCandidate) mapping.expense = textCandidate;
  }

  return mapping;
};

const parseAmount = (raw) => {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[,₹$\s]/g, "");
  const n = Number(cleaned);
  return isNaN(n) ? null : Math.abs(n);
};

const parseDate = (raw) => {
  if (raw instanceof Date) return raw.toISOString().split("T")[0];
  if (typeof raw === "number") {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)).toISOString().split("T")[0];
  }
  if (typeof raw === "string" && raw.trim()) {
    const s = raw.trim();

    // DD-MM-YYYY or DD/MM/YYYY — the standard Indian day-first convention.
    const dayFirst = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dayFirst) {
      const [, d, m, y] = dayFirst.map(Number);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return new Date(Date.UTC(y, m - 1, d)).toISOString().split("T")[0];
      }
    }

    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) {
      const [, y, m, d] = iso.map(Number);
      return new Date(Date.UTC(y, m - 1, d)).toISOString().split("T")[0];
    }

    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  return null;
};

// A minimal CSV parser (handles quoted fields with embedded commas/newlines)
// used instead of XLSX's own CSV reader, which auto-guesses date formats
// (usually assuming US MM-DD-YYYY) and mis-reads Indian DD-MM-YYYY dates.
export const parseCsvToRows = (text) => {
  const table = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (!(row.length === 1 && row[0] === "")) table.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    table.push(row);
  }

  if (!table.length) return [];
  const headers = table[0].map((h) => h.trim());
  return table.slice(1).map((cols) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (cols[i] ?? "").trim();
    });
    return obj;
  });
};

/**
 * Core mapping step, shared by file-upload import and Google Sheets import:
 * given row objects (header -> value) and the header list, detects which
 * column is which and returns preview rows shaped for the expense sheet.
 */
export const mapRowsToPreview = (rawRows, headers) => {
  if (!rawRows.length) {
    return { rows: [], warnings: ["No data rows found — is the first row a header row?"], columnMapping: {} };
  }

  let mapping = detectColumnsByHeader(headers);
  mapping = detectColumnsByContent(rawRows, headers, mapping);

  const warnings = [];
  if (!mapping.amount) warnings.push("Couldn't find an amount column — you'll need to fill amounts in manually.");
  if (!mapping.expense) warnings.push("Couldn't find an expense/description column.");
  if (!mapping.date) warnings.push("Couldn't find a date column — today's date will be used where missing.");

  const rows = rawRows.map((raw, index) => {
    const expenseText = mapping.expense ? String(raw[mapping.expense] || "").trim() : "";
    const amount = mapping.amount ? parseAmount(raw[mapping.amount]) : null;
    const date = mapping.date ? parseDate(raw[mapping.date]) : null;
    const rawMaster = mapping.master ? String(raw[mapping.master] || "").trim() : "";
    const matchedMaster = EXPENSE_MASTERS.find((m) => m.toLowerCase() === rawMaster.toLowerCase());
    const master = matchedMaster || rawMaster || guessMaster(expenseText);

    // Raw, unresolved text only — matching these against the user's actual
    // saved vehicles/contractors needs database access this file doesn't
    // have. See resolveDestinations in importDestinations.js.
    const vehicleText = mapping.vehicle ? String(raw[mapping.vehicle] || "").trim() : "";
    const contractorText = mapping.contractor ? String(raw[mapping.contractor] || "").trim() : "";

    return {
      _rowNumber: index + 2, // +2: 1 for header row, 1 for 0-index -> 1-index
      expense: expenseText || `Imported row ${index + 1}`,
      amount,
      date: date || new Date().toISOString().split("T")[0],
      master,
      vehicleText,
      contractorText,
      include: amount !== null, // auto-uncheck rows we couldn't even get an amount for
    };
  });

  return { rows, warnings, columnMapping: mapping };
};

/**
 * Parses an uploaded spreadsheet buffer (.csv/.xls/.xlsx) into a preview
 * array of expense-shaped rows.
 */
export const parseSheetToPreview = (buffer, filename) => {
  const isCsv = /\.csv$/i.test(filename || "");

  let rawRows;
  if (isCsv) {
    rawRows = parseCsvToRows(buffer.toString("utf8"));
  } else {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return { rows: [], warnings: ["The file doesn't seem to contain any sheet/tab with data."], columnMapping: {} };
    }
    const sheet = workbook.Sheets[firstSheetName];
    rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  }

  if (!rawRows.length) {
    return { rows: [], warnings: ["No data rows found — is the first row a header row?"], columnMapping: {} };
  }

  return mapRowsToPreview(rawRows, Object.keys(rawRows[0]));
};

/**
 * Converts a raw 2D array of cell values (as returned by the Google Sheets
 * API — values[0] is the header row) into the same preview row shape.
 */
export const parseSheetValuesToPreview = (values) => {
  if (!Array.isArray(values) || values.length < 2) {
    return { rows: [], warnings: ["That sheet doesn't have a header row plus at least one data row."], columnMapping: {} };
  }
  const headers = values[0].map((h) => String(h || "").trim());
  const rawRows = values.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? "";
    });
    return obj;
  });
  return mapRowsToPreview(rawRows, headers);
};
