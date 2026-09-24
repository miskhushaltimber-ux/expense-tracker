import { listVehiclesByUser } from "../models/vehicleStore.js";
import { listContractorsByUser, createContractor } from "../models/labourStore.js";

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
//
// 21 Sep, per Rishi (pasted his real ledger): his sheets DO have a Master
// column, and for labor rows it's already the strongest signal there is —
// "Repso Thekedar", "Mill Thekedar", "Pilling Thekedar", "Loading Thekedar",
// "Bundle Thekedar" — but individual worker names in the expense text
// ("Sanoj", "Vikas", "Mukesh", ...) essentially never match a saved
// Contractor, which is why almost nothing was auto-routing. Scoped via
// AskUserQuestion: Rishi chose to auto-create one Contractor per Thekedar
// Master category the first time it's seen (e.g. every "Repso Thekedar" row
// lands under one Contractor named "Repso Thekedar"), rather than requiring
// every individual worker to be a pre-created Contractor, or requiring the
// Contractor to already exist before it'll match. A "Kn"/"Mn" mill-unit
// suffix some Masters carry ("Bundle Thekedar K-2") is stripped before
// matching/creating, so it collapses onto the same Contractor as the
// suffix-free form ("Bundle Thekedar") rather than fragmenting into one
// Contractor per mill unit. Vehicle matching is untouched — Rishi confirmed
// keeping description-text matching there (equipment names like "Loader",
// "JCB", "Bike" already appear directly in his expense text).
const THEKEDAR_RE = /thekedar/i;
const MILL_UNIT_SUFFIX_RE = /\s+[A-Za-z]-?\d+(?:\/\d+)?$/;

export const isThekedarMaster = (master) => THEKEDAR_RE.test(master || "");

const contractorNameFromMaster = (master) => (master || "").trim().replace(MILL_UNIT_SUFFIX_RE, "").trim();

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

// Single-row version of the Thekedar-Master auto-routing above (24 Sep, per
// Rishi: "the app itself gets to know what type of payment it is just by
// reading the master... example in expense sheet we put peeling thekedar
// and the app recongnizes it as new master for the labor section") — same
// matching/mill-suffix-stripping/auto-create-Contractor logic as the import
// path, just usable for ONE row at a time so addExpense (a normal typed-in
// row on the Expense Sheet, not an import) can reroute it before it's ever
// saved as a plain expense. Returns null when the master doesn't look like
// a Thekedar category at all, so the caller's normal expense path runs
// unchanged.
export const resolveThekedarContractor = async (master, userId) => {
  if (!isThekedarMaster(master)) return null;
  const contractorName = contractorNameFromMaster(master);
  if (!contractorName) return null;

  const contractors = await listContractorsByUser(userId);
  let contractor = findContractorByColumn(contractors, contractorName);
  let created = false;
  if (!contractor) {
    contractor = await createContractor({ userId, name: contractorName, millId: "" });
    created = true;
  }
  return { contractor, created };
};

export const resolveImportDestinations = async (rows, userId) => {
  // Free-text scanning needs both lists on every import, not just when a
  // dedicated column is present — that's the whole point of this path.
  // `contractors` is mutated in place below as new ones get auto-created, so
  // a second "Repso Thekedar" row later in the SAME import reuses the one
  // just created for the first, instead of creating a duplicate.
  const [vehicles, contractors] = await Promise.all([listVehiclesByUser(userId), listContractorsByUser(userId)]);

  const warnings = [];
  let autoMatchedFromText = 0;
  const autoCreatedContractorNames = [];

  // Sequential, not Promise.all/map — a row that auto-creates a Contractor
  // must be visible to every later row in this same import before they run.
  const resolvedRows = [];
  for (const row of rows) {
    if (row.vehicleText) {
      const vehicle = findVehicleByColumn(vehicles, row.vehicleText);
      if (vehicle) {
        resolvedRows.push({ ...row, route: "vehicle", vehicleId: vehicle.id, vehicleName: vehicle.name });
        continue;
      }
      warnings.push(
        `Row ${row._rowNumber}: vehicle "${row.vehicleText}" doesn't match any saved vehicle — will be saved as a plain expense unless you pick one below. Add it on the Vehicles page first if it should exist.`
      );
      resolvedRows.push({ ...row, route: "expense" });
      continue;
    }

    if (row.contractorText) {
      const contractor = findContractorByColumn(contractors, row.contractorText);
      if (contractor) {
        resolvedRows.push({ ...row, route: "payment", contractorId: contractor.id, contractorName: contractor.name });
        continue;
      }
      warnings.push(
        `Row ${row._rowNumber}: contractor "${row.contractorText}" doesn't match any saved contractor — will be saved as a plain expense unless you pick one below. Add them on the Labor Wages page first if they should exist.`
      );
      resolvedRows.push({ ...row, route: "expense" });
      continue;
    }

    // No dedicated column — the common case for Rishi's sheets. A Thekedar
    // Master is the strongest signal available and is checked first; only
    // if that doesn't apply do we fall back to scanning the description text
    // for a vehicle or contractor name.
    if (isThekedarMaster(row.master)) {
      const contractorName = contractorNameFromMaster(row.master);
      if (contractorName) {
        let contractor = findContractorByColumn(contractors, contractorName);
        if (!contractor) {
          try {
            contractor = await createContractor({ userId, name: contractorName, millId: "" });
            contractors.push(contractor);
            autoCreatedContractorNames.push(contractorName);
          } catch (err) {
            warnings.push(
              `Row ${row._rowNumber}: couldn't auto-create a Contractor for Master "${row.master}" (${err.message}) — will be saved as a plain expense unless you pick a destination below.`
            );
          }
        }
        if (contractor) {
          resolvedRows.push({ ...row, route: "payment", contractorId: contractor.id, contractorName: contractor.name });
          continue;
        }
      }
    }

    const vehicleHit = findVehicleInText(vehicles, row.expense);
    if (vehicleHit) {
      autoMatchedFromText += 1;
      resolvedRows.push({ ...row, route: "vehicle", vehicleId: vehicleHit.id, vehicleName: vehicleHit.name });
      continue;
    }

    const contractorHit = findContractorInText(contractors, row.expense);
    if (contractorHit) {
      autoMatchedFromText += 1;
      resolvedRows.push({ ...row, route: "payment", contractorId: contractorHit.id, contractorName: contractorHit.name });
      continue;
    }

    resolvedRows.push({ ...row, route: "expense" });
  }

  if (autoCreatedContractorNames.length > 0) {
    const unique = [...new Set(autoCreatedContractorNames)];
    warnings.push(
      `Created ${unique.length} new Contractor${unique.length === 1 ? "" : "s"} to match your Master categories: ${unique.join(
        ", "
      )}. You can assign a mill, mobile number, or opening balance to ${unique.length === 1 ? "it" : "them"} any time on the Manage Data page.`
    );
  }

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
