// Minimal CSV writer — RFC4180-ish: quotes a field that contains a comma,
// quote, or newline, doubling any inner quotes. 24 Sep, per Rishi: "give one
// dropdown where we can choose in which format we are sharing the sheets" —
// "Email it" can now send a plain .csv instead of always the formatted
// .xlsx. Kept separate from utils/importParser.js's parseCsvToRows, which
// reads CSVs, not writes them.
const escapeCsvField = (value) => {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const rowsToCsv = (header, rows) =>
  [header, ...rows].map((row) => row.map(escapeCsvField).join(",")).join("\r\n");
