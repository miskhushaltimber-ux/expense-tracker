// Turns an array of row objects into a CSV file and triggers a browser
// download for it — used for the "Export to Excel" buttons. CSV (not a real
// .xlsx) so no extra library is needed; it opens directly in Excel/Sheets.

const escapeCsvValue = (value) => {
  const str = value === null || value === undefined ? "" : String(value);
  // Quote any value containing a comma, quote, or newline, doubling up
  // internal quotes per the CSV spec.
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/**
 * @param {string} filename - e.g. "expenses-2026-09.csv"
 * @param {Array<{key: string, label: string}>} columns
 * @param {Array<object>} rows
 */
export const downloadCsv = (filename, columns, rows) => {
  const header = columns.map((c) => escapeCsvValue(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => escapeCsvValue(row[c.key])).join(","));
  const csvContent = [header, ...lines].join("\r\n");

  // A UTF-8 BOM helps Excel on Windows correctly detect encoding for the ₹ symbol.
  const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
