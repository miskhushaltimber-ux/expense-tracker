// Shared helpers for the "customFields" field added to expenseStore.js and
// labourStore.js's wageEntries/payments (21 Sep, custom-columns feature).
// Firestore documents support a nested map natively, so a row's custom
// values are stored as a genuine object field (not a JSON string) —
// {columnKey: value}. That fits inside the existing fixed-HEADERS data
// layer (firestoreDb.js's `fill()` just copies whatever value is under that
// header, object or not) with a one-line addition per store, instead of the
// store's write path needing to know about however many custom columns a
// company has defined today.
//
// Only strings/numbers/booleans survive sanitizing (a select/date/number/
// text column value is always one of these) — anything else is dropped
// rather than risk storing something that can't cleanly round-trip.
const sanitize = (obj) => {
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") clean[k] = v;
  }
  return clean;
};

// A row read back from Firestore normally already has customFields as a
// real object (or "" if the row predates this field existing at all). The
// JSON.parse fallback is defensive only, in case a value ever arrives as a
// stringified blob instead.
export const parseCustomFields = (raw) => {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return sanitize(raw);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? sanitize(parsed) : {};
    } catch {
      return {};
    }
  }
  return {};
};

// Prepares a customFields value for writing. Returns "" for an empty result
// (matching every other optional field in this app, which is "" when unset)
// so a row with no custom values at all looks the same as before this
// feature existed.
export const serializeCustomFields = (obj) => {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "";
  const clean = sanitize(obj);
  return Object.keys(clean).length ? clean : "";
};
