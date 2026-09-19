import { listVehiclesByUser } from "../models/vehicleStore.js";
import { listContractorsByUser } from "../models/labourStore.js";

// The Expenses page's importer (file upload or "From Google Sheet") only
// ever created plain expense rows, with no way to notice a row was actually
// a vehicle expense or a labor payment — which is exactly why those never
// showed up on the Vehicles or Labor Wages pages (18/19 Sep, per Rishi:
// "vehicle expense and labor wages dont go to there dedicated pages because
// the system dont recongnize it").
//
// 19 Sep, per Rishi (correcting an earlier assumption): his real sheets have
// NO separate "Vehicle" or "Contractor" column — everything is one mixed
// expense/description column ("Diesel for Truck 1", "Payment to Ramesh
// Contractor", ...). So the real signal has to come from scanning that
// description text for a name that matches something the user already has
// saved as a vehicle or a contractor.
//
// Two matching paths, tried in this order per row:
//   1. Dedicated "Vehicle"/"Contractor" columns, if importParser.js found
//      them (kept for anyone who DOES lay their sheet out that way — a
//      column value is a much more reliable signal than free text).
//   2. Free-text: does the expense description contain, as a whole word/
//      phrase, the name (or number plate) of one of this user's saved
//      vehicles or contractors?
//
// Either way the result is a "route" per row:
//   - "vehicle": still an ordinary Expense (same shape as always), just with
//     vehicleId set — exactly what picking a vehicle in the Vehicles page's
//     own "Add Expense" form does. Vehicles.jsx already shows any expense
//     with a vehicleId, so this alone makes it appear there.
//   - "payment": a genuinely different destination (the Payments collection
//     Labor Wages reads from), committed through a different endpoint.
//   - "expense": the fallback whenever nothing matches (or nothing was even
//     attempted) — the money is still recorded, just untagged.
//
// Free-text matching can misfire (a contractor named "Suresh" matching an
// unrelated line that happens to mention a person called Suresh), so this
// is a REVIEW-BEFORE-SAVE step, not an auto-save: the frontend shows every
// row's resolved destination, with the full vehicle/contractor list, so a
// wrong guess can be fixed before anything is written to the database.

const normalize = (s) => (s || "").trim().toLowerCase();

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whole-word/phrase containment, not a bare substring check — "Ram" must not
// match inside "Frame", and a 1-2 character name is too short to trust at
// all (state codes, serial numbers, etc. would match constantly).
const containsWhole = (haystack, needle) => {
  const h = haystack || "";
  const n = (needle || "").trim();
  if (n.length < 3) return false;
  const re = new RegExp(`\\b${escapeRegex(n)}\\b`, "i");
  return re.test(h);
};

// Column-value matching (exact first, then loose) — used only when the
// sheet actually has a dedicated Vehicle/Contractor column, where the value
// is already isolated rather than buried in a sentence.
const findVehicleByColumn = (vehicles, text) => {
  const t = normalize(text);
  if (!t) return null;
  return (
    vehicles.find((v) => normalize(v.name) === t || normalize(v.numberPlate) === t) ||
    vehicles.find((v) => normalize(v.name) && (normalize(v.name).includes(t) || t.includes(normalize(v.name)))) ||
    null
  );
};

const findContractorByColumn = (contractors, text) => {
  const t = normalize(text);
  if (!t) return null;
  return (
    contractors.find((c) => normalize(c.name) === t) ||
    contractors.find((c) => normalize(c.name) && (normalize(c.name).includes(t) || t.includes(normalize(c.name)))) ||
    null
  );
};

// Free-text matching — scans a whole description sentence. Longer/more
// specific names are tried first, so "Ramesh Kumar Contractor" is preferred
// over a shorter, more generic "Ramesh" that might also technically match.
const findVehicleInText = (vehicles, text) => {
  const sorted = [...vehicles].sort((a, b) => (b.name || "").length - (a.name || "").length);
  return (
    sorted.find((v) => v.numberPlate && containsWhole(text, v.numberPlate)) ||
    sorted.find((v) => v.name && containsWhole(text, v.name)) ||
    null
  );
};

const findContractorInText = (contractors, text) => {
  const sorted = [...contractors].sort((a, b) => (b.name || "").length - (a.name || "").length);
  return sorted.find((c) => c.name && containsWhole(text, c.name)) || null;
};

export const resolveImportDestinations = async (rows, userId) => {
  // Free-text scanning needs both lists on every import, not just when a
  // dedicated column is present — that's the whole point of this path.
  const [vehicles, contractors] = await Promise.all([listVehiclesByUser(userId), listContractorsByUser(userId)]);

  const warnings = [];
  let autoMatchedFromText = 0;

  const resolvedRows = rows.map((row) => {
    if (row.vehicleText) {
      const vehicle = findVehicleByColumn(vehicles, row.vehicleText);
      if (vehicle) return { ...row, route: "vehicle", vehicleId: vehicle.id, vehicleName: vehicle.name };
      warnings.push(
        `Row ${row._rowNumber}: vehicle "${row.vehicleText}" doesn't match any saved vehicle — will be saved as a plain expense unless you pick one below. Add it on the Vehicles page first if it should exist.`
      );
      return { ...row, route: "expense" };
    }

    if (row.contractorText) {
      const contractor = findContractorByColumn(contractors, row.contractorText);
      if (contractor) return { ...row, route: "payment", contractorId: contractor.id, contractorName: contractor.name };
      warnings.push(
        `Row ${row._rowNumber}: contractor "${row.contractorText}" doesn't match any saved contractor — will be saved as a plain expense unless you pick one below. Add them on the Labor Wages page first if they should exist.`
      );
      return { ...row, route: "expense" };
    }

    // No dedicated column — the common case for Rishi's sheets — so scan the
    // expense/description text itself.
    const vehicleHit = findVehicleInText(vehicles, row.expense);
    if (vehicleHit) {
      autoMatchedFromText += 1;
      return { ...row, route: "vehicle", vehicleId: vehicleHit.id, vehicleName: vehicleHit.name };
    }

    const contractorHit = findContractorInText(contractors, row.expense);
    if (contractorHit) {
      autoMatchedFromText += 1;
      return { ...row, route: "payment", contractorId: contractorHit.id, contractorName: contractorHit.name };
    }

    return { ...row, route: "expense" };
  });

  if (autoMatchedFromText > 0) {
    warnings.push(
      `${autoMatchedFromText} row${autoMatchedFromText === 1 ? "" : "s"} ${
        autoMatchedFromText === 1 ? "was" : "were"
      } auto-matched to a vehicle or contractor by name found in the description — double-check the Destination column below before importing, since a name appearing in the text isn't always a reliable signal.`
    );
  }

  return {
    rows: resolvedRows,
    warnings,
    vehicleOptions: vehicles.map((v) => ({ id: v.id, name: v.name })),
    contractorOptions: contractors.map((c) => ({ id: c.id, name: c.name })),
  };
};
