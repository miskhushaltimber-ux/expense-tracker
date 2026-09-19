#!/usr/bin/env node
/**
 * Fills an account with realistic sample data so every feature has
 * something to show. Built so nothing is left untested: every master, six
 * months of history, vehicle expenses with fuel readings, deliberate outliers,
 * and deliberate mistakes that the app is supposed to catch.
 *
 * ---------------------------------------------------------------------------
 * READ THIS FIRST
 *
 * Run it against a SEPARATE TEST LOGIN, never the real one.
 *
 * Every expense row is tagged with the user who created it, and the app only
 * ever shows you your own. So a second account is a completely clean sandbox:
 * sir's real figures are untouched, and nothing you do here can confuse the
 * real books. The script refuses to run without --i-understand for that reason.
 *
 * Removing it afterwards: there is no "delete everything" button in the app.
 * You'd open the Google Sheet, sort or filter the Expenses tab by the test
 * account's userId, and delete those rows. Which is exactly why it should not
 * be mixed into the real account in the first place.
 * ---------------------------------------------------------------------------
 *
 * Usage:
 *   node scripts/seed-test-data.js \
 *     --api https://your-backend.onrender.com/api \
 *     --email test@example.com --password somepassword \
 *     --i-understand
 *
 * Add --register if the test account doesn't exist yet.
 */

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const API = (arg("api", "http://localhost:3000/api") || "").replace(/\/$/, "");
const EMAIL = arg("email");
const PASSWORD = arg("password");

if (!EMAIL || !PASSWORD) {
  console.error("Need --email and --password. See the comment at the top of this file.");
  process.exit(1);
}
if (!flag("i-understand")) {
  console.error(
    "\nThis writes several hundred fake rows into whichever account you point it at.\n" +
      "Use a SEPARATE TEST LOGIN, not the real one — there is no bulk delete to undo it.\n" +
      "Re-run with --i-understand once you're pointing at a test account.\n"
  );
  process.exit(1);
}

// --- tiny http helper -------------------------------------------------------
let token = null;
const call = async (path, { method = "GET", body } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${typeof data === "string" ? data.slice(0, 200) : data.message}`);
  return data;
};

// --- the data ---------------------------------------------------------------
const DAY = 86400000;
const today = new Date();
const daysAgo = (n) => new Date(today.getTime() - n * DAY).toISOString();

// Descriptions repeat on purpose. Real sheets have recurring wording, and the
// "split by expense" chart only groups meaningfully when they do.
const CATALOGUE = [
  { master: "Raw Timber Purchase", items: ["Teak logs — Nagpur lot", "Sal wood consignment", "Rosewood billets", "Pine logs — local"], min: 45000, max: 180000, perMonth: 4 },
  { master: "Transport & Freight", items: ["Lorry hire — Nagpur", "Freight to yard", "Return load charges"], min: 8000, max: 32000, perMonth: 5 },
  { master: "Labor Wages", items: ["Weekly wages — yard crew", "Weekly wages — sawmill crew", "Overtime — loading"], min: 12000, max: 38000, perMonth: 4 },
  { master: "Loading & Unloading", items: ["Unloading charges", "Hamali — timber lot"], min: 1500, max: 6500, perMonth: 4 },
  { master: "Sawmill & Machinery Maintenance", items: ["Blade replacement", "Belt & bearing change", "Sawmill servicing"], min: 3000, max: 24000, perMonth: 2 },
  { master: "Electricity Bill", items: ["Sawmill electricity"], min: 18000, max: 34000, perMonth: 1 },
  { master: "Rent", items: ["Yard rent"], min: 40000, max: 40000, perMonth: 1 },
  { master: "GST & Taxes", items: ["GST payment", "Professional tax"], min: 9000, max: 60000, perMonth: 2 },
  { master: "Packing Material", items: ["Strapping rolls", "Tarpaulin sheets"], min: 1200, max: 7500, perMonth: 2 },
  { master: "Office & Stationery", items: ["Printer cartridge", "Register & files"], min: 400, max: 2600, perMonth: 2 },
  { master: "Miscellaneous", items: ["Tea & refreshments", "Yard repairs", "Courier charges"], min: 300, max: 4200, perMonth: 3 },
  { master: "Service & Maintenance", items: ["Truck servicing", "Oil change"], min: 2500, max: 14000, perMonth: 1 },
  { master: "Tyre & Puncture", items: ["Puncture repair", "Tyre replacement"], min: 300, max: 18000, perMonth: 1 },
  { master: "Spare Parts", items: ["Clutch plate", "Brake shoes"], min: 1800, max: 12000, perMonth: 1 },
  { master: "Toll & Parking", items: ["Toll charges — highway", "Parking fees"], min: 200, max: 2400, perMonth: 3 },
  { master: "Vehicle Insurance Premium", items: ["Truck insurance renewal"], min: 22000, max: 34000, perMonth: 0.34 },
  { master: "Driver Wages", items: ["Driver salary", "Driver bata — outstation"], min: 9000, max: 22000, perMonth: 2 },
  { master: "Fines & Challans", items: ["Overload challan", "RTO fine"], min: 500, max: 6000, perMonth: 0.5 },
  { master: "Vehicle Expenses", items: ["Miscellaneous vehicle spend"], min: 800, max: 6000, perMonth: 1 },
  { master: "Permit & Fitness Fees", items: ["Fitness certificate renewal"], min: 3500, max: 9000, perMonth: 0.34 },
];

// Deterministic pseudo-random, so a re-run produces the same shape and you can
// compare two runs meaningfully.
let seed = 20260917;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const between = (min, max) => Math.round((min + rnd() * (max - min)) / 50) * 50;
const pick = (list) => list[Math.floor(rnd() * list.length)];

const MONTHS = 6;

const buildGeneralExpenses = () => {
  const rows = [];
  for (const cat of CATALOGUE) {
    for (let m = 0; m < MONTHS; m++) {
      const count = cat.perMonth < 1 ? (rnd() < cat.perMonth ? 1 : 0) : Math.round(cat.perMonth);
      for (let i = 0; i < count; i++) {
        const dayOffset = m * 30 + Math.floor(rnd() * 28);
        rows.push({
          date: daysAgo(dayOffset),
          expense: pick(cat.items),
          amount: between(cat.min, cat.max),
          master: cat.master,
          // Roughly two thirds have a bill, so the "entries with no bill"
          // reminder has something real to report.
          billFile: rnd() < 0.66 ? "https://res.cloudinary.com/demo/image/upload/sample.jpg" : "",
        });
      }
    }
  }
  return rows;
};

// Vehicles, with documents deliberately in three states so the reminders fire.
const VEHICLES = [
  { name: "Truck 1", numberPlate: "GJ01AB1234", rcExpiry: daysAgo(-400), insuranceExpiry: daysAgo(12) },   // insurance EXPIRED
  { name: "Truck 2", numberPlate: "GJ01CD5678", rcExpiry: daysAgo(-300), insuranceExpiry: daysAgo(-18) },  // insurance expiring within 30 days
  { name: "Tempo 1", numberPlate: "GJ01EF9012", rcExpiry: daysAgo(-500), insuranceExpiry: daysAgo(-260) }, // both healthy
];

// Fuel history, built so every fuel check has something to find.
const buildFuelRows = (vehicleIds) => {
  const rows = [];
  const plan = [
    // Truck 1 — a steady ~4 km/L, then one fill billed well above the going
    // rate (inflated bill), then one stretch with mileage well down (fuel
    // going missing), then a backwards odometer reading (data-entry typo).
    { v: 0, odo: 41000, litres: 90, rate: 95, day: 170 },
    { v: 0, odo: 41360, litres: 90, rate: 95, day: 145 },
    { v: 0, odo: 41720, litres: 90, rate: 96, day: 120 },
    { v: 0, odo: 42080, litres: 90, rate: 138, day: 95 },  // ← rate spike
    { v: 0, odo: 42440, litres: 90, rate: 95, day: 70 },
    { v: 0, odo: 42620, litres: 90, rate: 96, day: 45 },   // ← only 180km on 90L
    { v: 0, odo: 4298, litres: 90, rate: 95, day: 20 },    // ← typo, reads lower
    // Truck 2 — clean history, nothing should flag.
    { v: 1, odo: 88000, litres: 80, rate: 94, day: 150 },
    { v: 1, odo: 88320, litres: 80, rate: 95, day: 120 },
    { v: 1, odo: 88640, litres: 80, rate: 95, day: 90 },
    { v: 1, odo: 88960, litres: 80, rate: 96, day: 60 },
    { v: 1, odo: 89280, litres: 80, rate: 95, day: 30 },
    // Tempo 1 — litres recorded but no odometer, so mileage should read
    // "needs odometer" while rate per litre still works.
    { v: 2, odo: "", litres: 35, rate: 95, day: 100 },
    { v: 2, odo: "", litres: 35, rate: 96, day: 70 },
    { v: 2, odo: "", litres: 35, rate: 95, day: 40 },
  ];
  for (const f of plan) {
    rows.push({
      date: daysAgo(f.day),
      expense: "Diesel fill",
      amount: Math.round(f.litres * f.rate),
      master: "Fuel & Diesel",
      vehicleId: vehicleIds[f.v],
      litres: f.litres,
      odometer: f.odo,
      billFile: "",
    });
  }
  return rows;
};

// Non-fuel vehicle spending, so the per-vehicle breakdown table has columns
// filled in rather than a row of dashes.
const buildVehicleExtras = (vehicleIds) => {
  const rows = [];
  const kinds = [
    { master: "Service & Maintenance", expense: "Truck servicing", min: 4000, max: 14000 },
    { master: "Tyre & Puncture", expense: "Puncture repair", min: 300, max: 1200 },
    { master: "Toll & Parking", expense: "Toll charges — highway", min: 400, max: 2200 },
    { master: "Driver Wages", expense: "Driver salary", min: 12000, max: 18000 },
    { master: "Spare Parts", expense: "Brake shoes", min: 2200, max: 9000 },
  ];
  vehicleIds.forEach((id, vi) => {
    kinds.forEach((k, ki) => {
      rows.push({
        date: daysAgo(15 + vi * 11 + ki * 23),
        expense: k.expense,
        amount: between(k.min, k.max),
        master: k.master,
        vehicleId: id,
        billFile: "",
      });
    });
  });
  return rows;
};

const main = async () => {
  console.log(`\nSeeding ${API}`);
  console.log(`Account: ${EMAIL}\n`);

  if (flag("register")) {
    try {
      await call("/auth/register", { method: "POST", body: { name: "Test Account", email: EMAIL, password: PASSWORD } });
      console.log("  registered the account");
    } catch (e) {
      console.log(`  register skipped (${e.message.slice(0, 80)})`);
    }
  }

  const login = await call("/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
  token = login.token;
  if (!token) throw new Error("Login succeeded but returned no token");
  console.log("  logged in");

  const existing = await call("/expenses");
  if (existing.length > 0) {
    console.log(`\n  ⚠ This account already has ${existing.length} expenses.`);
    console.log("    Seeding adds MORE on top — it does not replace them.");
    if (!flag("add-anyway")) {
      console.log("    Re-run with --add-anyway if that's what you want.\n");
      process.exit(1);
    }
  }

  // Vehicles first — their ids are needed to tag the vehicle expenses.
  const vehicleIds = [];
  for (const v of VEHICLES) {
    const saved = await call("/vehicles", { method: "POST", body: v });
    vehicleIds.push(saved._id);
    console.log(`  vehicle: ${v.name}`);
  }

  const general = buildGeneralExpenses();
  const fuel = buildFuelRows(vehicleIds);
  const extras = buildVehicleExtras(vehicleIds);

  // One deliberately identical pair, so the duplicate guard has something to
  // catch the next time someone enters that amount on that date.
  const dupSource = general[0];
  const duplicate = { ...dupSource, expense: `${dupSource.expense} (re-entered)` };

  // One very large entry, to trip the "unusually large" reminder.
  const outlier = {
    date: daysAgo(6),
    expense: "Bulk teak consignment — annual contract",
    amount: 1450000,
    master: "Raw Timber Purchase",
    billFile: "",
  };

  const all = [...general, ...fuel, ...extras, duplicate, outlier];

  // Batched, because every write goes through the Google Sheets API and its
  // quota is per-minute. One call per batch instead of one call per row.
  const BATCH = 100;
  let imported = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const res = await call("/expenses/bulk", { method: "POST", body: { rows: batch } });
    imported += res.imported;
    console.log(`  expenses: ${imported}/${all.length}`);
    if (i + BATCH < all.length) await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`\nDone — ${vehicleIds.length} vehicles, ${imported} expenses.\n`);
  console.log("What to check, and what you should see:");
  console.log("  Expense Sheet   reminders at the top: spending up/down, biggest riser,");
  console.log("                  the ₹14,50,000 outlier, and a count of entries with no bill");
  console.log("  Dashboard       6 months of trend; tick one master and the charts retitle to");
  console.log("                  'Spend within …'; click a slice for the drawer");
  console.log("  Vehicles        Truck 1 insurance EXPIRED, Truck 2 expiring within 30 days");
  console.log("                  Fuel & Mileage: Truck 1 flagged on BOTH rate (₹138/L) and");
  console.log("                  mileage (180km on 90L), plus a backwards-odometer warning;");
  console.log("                  Truck 2 clean; Tempo 1 shows 'needs odometer'");
  console.log("  Duplicates      re-enter ₹" + dupSource.amount + " under " + dupSource.master);
  console.log("                  dated " + new Date(dupSource.date).toLocaleDateString("en-IN") + " — it should warn you");
  console.log("  Filters         type 'diesel' in search, suggestions should appear\n");
};

main().catch((e) => {
  console.error("\nFailed:", e.message, "\n");
  process.exit(1);
});
