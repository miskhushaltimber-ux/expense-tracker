// Indian financial year: April 1 – March 31.

export const getFYRange = (fyStartYear) => {
  const start = new Date(fyStartYear, 3, 1); // April = month index 3
  const end = new Date(fyStartYear + 1, 2, 31, 23, 59, 59, 999); // following March 31
  return { start, end };
};

export const getCurrentFYStartYear = (date = new Date()) => {
  const month = date.getMonth(); // 0-11
  return month >= 3 ? date.getFullYear() : date.getFullYear() - 1;
};

export const fyLabel = (fyStartYear) => `${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;

// Parses "2025-2026" or "2025-26" -> the FY's start year, or null if the
// param is missing/malformed (callers fall back to the current FY).
export const parseFYParam = (fy) => {
  if (!fy || typeof fy !== "string") return null;
  const match = /^(\d{4})-(\d{2,4})$/.exec(fy.trim());
  if (!match) return null;
  return parseInt(match[1], 10);
};
