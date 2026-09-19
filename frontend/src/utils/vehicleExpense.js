// Keeping vehicle spending and general spending from drifting apart.
//
// There is only ONE pool of expenses. A vehicle expense is just an ordinary
// expense row that happens to carry a vehicleId. That's a good data model, but
// it leaves two ways for the books to go wrong:
//
//   1. Someone logs "Diesel for Truck 1" on the main Expense Sheet without
//      picking a vehicle. It never appears in the vehicle totals or the fuel
//      figures, so later someone re-enters it on the Vehicles page — and now
//      the same diesel is counted twice.
//   2. An import brings in rows that are already in the sheet.
//
// The fix for (1) is to notice a vehicle-shaped expense at the moment it's
// typed and ask which vehicle, so it gets tagged once and never needs
// re-entering. The fix for (2) is to spot a row that looks like one already
// there, before it's saved.

// Masters that describe money spent on a vehicle. Matched on words rather than
// exact names so a free-typed "Diesel", "tyre change" or "truck servicing"
// still gets caught.
const VEHICLE_WORDS =
  /fuel|diesel|petrol|tyre|tire|puncture|spare part|service|maintenance|toll|parking|permit|fitness|driver wage|challan|fine|vehicle|truck|tempo|lorry|rto|insurance premium/i;

export const looksLikeVehicleExpense = ({ master, expense }) =>
  VEHICLE_WORDS.test(master || "") || VEHICLE_WORDS.test(expense || "");

// Two entries are "the same" when they're for the same money on the same day
// under the same master. Description is deliberately NOT part of the test —
// the whole problem is the same spend written up two different ways ("Diesel
// Truck 1" vs "diesel fill"), which a description check would miss.
const sameDay = (a, b) => {
  if (!a || !b) return false;
  const d1 = new Date(a);
  const d2 = new Date(b);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return false;
  return d1.toDateString() === d2.toDateString();
};

export const findPossibleDuplicate = (candidate, rows, { ignoreId } = {}) => {
  const amount = Number(candidate.amount) || 0;
  if (!amount) return null;
  return (
    rows.find(
      (r) =>
        r._id !== ignoreId &&
        (Number(r.amount) || 0) === amount &&
        (r.master || "").toLowerCase() === (candidate.master || "").toLowerCase() &&
        sameDay(r.date, candidate.date)
    ) || null
  );
};

// Wording for the confirm box. Says exactly what already exists, so the person
// can tell a genuine second fill on the same day from an accidental re-entry.
export const duplicateWarning = (existing, vehicleName) => {
  const when = existing.date ? new Date(existing.date).toLocaleDateString("en-IN") : "an unknown date";
  const money = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(existing.amount) || 0);

  return (
    `This looks like it may already be entered:\n\n` +
    `    ${existing.expense || "(no description)"} — ${money} on ${when}` +
    (vehicleName ? `\n    Already logged against ${vehicleName}` : "") +
    `\n\nSave it anyway?`
  );
};
