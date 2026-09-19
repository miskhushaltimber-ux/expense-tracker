import React, { useEffect, useMemo, useState } from "react";
import { FiFile, FiExternalLink, FiTruck, FiUsers, FiClipboard, FiChevronDown, FiChevronRight } from "react-icons/fi";
import { fetchVehicles } from "/src/api/vehicles";
import { fetchExpenses } from "/src/api/expenses";
import { fetchContractors, fetchLabors } from "/src/api/labour";
import { resolveFileUrl, looksLikeImage } from "/src/utils/fileUrl";

// Read-only "everything you've uploaded, in one place" page (18 Sep, per
// Rishi: "add one section where we the user can see the images and
// documents uploaded in the sheets ... vehicle documents stays in vehicle
// section and labor documents stays in the labor section and expense bill
// documents stays in the expense section"). Reached from the navbar's
// hamburger dropdown, next to Manage Data. Nothing here is editable — to
// change a document, go to the page that owns it (Vehicles, Manage Data, or
// the Expense Sheet / Vehicle Expense Sheet).

const VEHICLE_DOC_FIELDS = [
  { key: "rcFile", label: "RC" },
  { key: "insuranceFile", label: "Insurance" },
  { key: "permitFile", label: "Permit" },
  { key: "plateFile", label: "Number Plate" },
];

const PERSON_DOC_FIELDS = [
  { key: "aadharFile", label: "Aadhar" },
  { key: "panFile", label: "PAN" },
  { key: "greenCardFile", label: "Green Card" },
];

const money = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// One uploaded file — a small thumbnail if it looks like an image, otherwise
// a file icon, both opening the original in a new tab.
const FileChip = ({ file, label }) => {
  const url = resolveFileUrl(file);
  if (!url) return null;
  const isImage = looksLikeImage(file);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-900 hover:border-red-300 dark:hover:border-red-700 transition-colors"
      title={label}
    >
      {isImage ? (
        <img src={url} alt={label} className="w-8 h-8 object-cover rounded shrink-0" />
      ) : (
        <FiFile size={16} className="text-gray-400 dark:text-gray-500 shrink-0" />
      )}
      <span className="truncate max-w-[9rem]">{label}</span>
      <FiExternalLink size={12} className="text-gray-400 dark:text-gray-500 shrink-0" />
    </a>
  );
};

// Collapsible by default — 18 Sep, per Rishi: "all the sections should have
// switch and one click opens it other clicks close dont make them look open
// all the time so when we need vehicle details we go in vehicle docs and
// everything is closed". Each card tracks its own open/closed state.
const SectionCard = ({ icon: Icon, title, subtitle, count, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full px-4 sm:px-6 py-4 flex items-center justify-between text-left ${
          open ? "border-b border-gray-100 dark:border-gray-700" : ""
        }`}
      >
        <div className="flex items-center gap-2">
          <Icon size={19} className="text-red-600" />
          <div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs font-medium bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-400 rounded-full px-2.5 py-1">
            {count} {count === 1 ? "file" : "files"}
          </span>
          {open ? <FiChevronDown size={18} className="text-gray-400" /> : <FiChevronRight size={18} className="text-gray-400" />}
        </div>
      </button>
      {open && <div className="p-4 sm:p-6 space-y-4">{children}</div>}
    </div>
  );
};

const EmptyRow = ({ children }) => (
  <p className="text-sm text-gray-400 dark:text-gray-500 italic">{children}</p>
);

const Documents = () => {
  const [vehicles, setVehicles] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [contractors, setContractors] = useState([]);
  const [labors, setLabors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [v, e, c, l] = await Promise.all([
          fetchVehicles().catch(() => []),
          fetchExpenses().catch(() => []),
          fetchContractors().catch(() => []),
          fetchLabors().catch(() => []),
        ]);
        setVehicles(Array.isArray(v) ? v : []);
        setExpenses(Array.isArray(e) ? e : []);
        setContractors(Array.isArray(c) ? c : []);
        setLabors(Array.isArray(l) ? l : []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // --- Vehicles: each vehicle's own documents + its tagged expense bills ---
  const vehicleGroups = useMemo(() => {
    return vehicles
      .map((v) => {
        const ownDocs = VEHICLE_DOC_FIELDS.filter((f) => v[f.key]);
        const bills = expenses.filter((e) => e.vehicleId === v._id && e.billFile);
        return { vehicle: v, ownDocs, bills };
      })
      .filter((g) => g.ownDocs.length > 0 || g.bills.length > 0);
  }, [vehicles, expenses]);
  const vehicleFileCount = vehicleGroups.reduce((sum, g) => sum + g.ownDocs.length + g.bills.length, 0);

  // --- Labor: each contractor's own documents + the labor under them ---
  const laborGroups = useMemo(() => {
    return contractors
      .map((c) => {
        const ownDocs = PERSON_DOC_FIELDS.filter((f) => c[f.key]);
        const laborUnder = labors
          .filter((l) => l.contractorId === c._id)
          .map((l) => ({ labor: l, docs: PERSON_DOC_FIELDS.filter((f) => l[f.key]) }))
          .filter((l) => l.docs.length > 0);
        return { contractor: c, ownDocs, laborUnder };
      })
      .filter((g) => g.ownDocs.length > 0 || g.laborUnder.length > 0);
  }, [contractors, labors]);
  const laborFileCount = laborGroups.reduce(
    (sum, g) => sum + g.ownDocs.length + g.laborUnder.reduce((s, l) => s + l.docs.length, 0),
    0
  );

  // --- Expenses: bills on expenses that AREN'T tagged to a vehicle ---
  const expenseBills = useMemo(() => expenses.filter((e) => !e.vehicleId && e.billFile), [expenses]);

  if (loading) {
    return <div className="p-4 sm:p-6 text-sm text-gray-400">Loading…</div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:px-12">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-gray-100 mb-1">Documents</h1>
          <p className="text-gray-600 dark:text-gray-300 text-sm sm:text-base">
            Every image and document uploaded across the app, organized by section. Read-only — edit a document from
            the page it belongs to.
          </p>
        </div>

        <SectionCard icon={FiTruck} title="Vehicles" subtitle="RC, insurance, permit & bills, by vehicle" count={vehicleFileCount}>
          {vehicleGroups.length === 0 ? (
            <EmptyRow>No vehicle documents uploaded yet.</EmptyRow>
          ) : (
            vehicleGroups.map(({ vehicle, ownDocs, bills }) => (
              <div key={vehicle._id} className="border-t first:border-t-0 border-gray-100 dark:border-gray-700 pt-4 first:pt-0">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{vehicle.name}</h3>
                <div className="flex flex-wrap gap-2">
                  {ownDocs.map((f) => (
                    <FileChip key={f.key} file={vehicle[f.key]} label={f.label} />
                  ))}
                  {bills.map((e) => (
                    <FileChip
                      key={e._id}
                      file={e.billFile}
                      label={`${e.expense || "Bill"} — ${money(e.amount)}`}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </SectionCard>

        <SectionCard icon={FiUsers} title="Labor" subtitle="Aadhar, PAN & green card, by contractor" count={laborFileCount}>
          {laborGroups.length === 0 ? (
            <EmptyRow>No contractor or labor documents uploaded yet.</EmptyRow>
          ) : (
            laborGroups.map(({ contractor, ownDocs, laborUnder }) => (
              <div key={contractor._id} className="border-t first:border-t-0 border-gray-100 dark:border-gray-700 pt-4 first:pt-0">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{contractor.name}</h3>
                {ownDocs.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {ownDocs.map((f) => (
                      <FileChip key={f.key} file={contractor[f.key]} label={f.label} />
                    ))}
                  </div>
                )}
                {laborUnder.map(({ labor, docs }) => (
                  <div key={labor._id} className="ml-3 mt-2">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">{labor.name}</p>
                    <div className="flex flex-wrap gap-2">
                      {docs.map((f) => (
                        <FileChip key={f.key} file={labor[f.key]} label={f.label} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </SectionCard>

        <SectionCard icon={FiClipboard} title="Expenses" subtitle="Bills not tagged to a vehicle" count={expenseBills.length}>
          {expenseBills.length === 0 ? (
            <EmptyRow>No non-vehicle expense bills uploaded yet.</EmptyRow>
          ) : (
            <div className="flex flex-wrap gap-2">
              {expenseBills.map((e) => (
                <FileChip key={e._id} file={e.billFile} label={`${e.expense || "Bill"} — ${money(e.amount)}`} />
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
};

export default Documents;
