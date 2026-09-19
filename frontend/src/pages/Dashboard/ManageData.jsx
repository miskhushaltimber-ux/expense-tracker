import React, { useEffect, useMemo, useRef, useState } from "react";
import { FiPaperclip, FiX, FiTrash2, FiHome, FiUsers, FiUser, FiTruck, FiFilter, FiXCircle, FiPlus, FiChevronDown, FiChevronRight, FiMapPin } from "react-icons/fi";
import {
  fetchLocations,
  addLocation,
  updateLocation,
  deleteLocation,
  fetchMills,
  addMill,
  updateMill,
  deleteMill,
  fetchContractors,
  addContractor,
  updateContractor,
  deleteContractor,
  fetchLabors,
  addLabor,
  updateLabor,
  deleteLabor,
} from "../../api/labour";
import { fetchVehicles, addVehicle, updateVehicle, deleteVehicle } from "../../api/vehicles";
import { API_BASE_URL } from "../../api/config";
import AlertsStrip, { buildVehicleAlerts } from "../../components/AlertsStrip";

// Manage Data — reached from the hamburger icon Rishi asked to finally put
// in the navbar's empty top-right corner. Everything here is master/
// reference data (add, rename, delete) rather than day-to-day entries, so
// the sheet pages (Expense Sheet, Vehicle Expense Sheet, Labor Wages) can
// stay just a grid instead of also being an add/edit form — that's what made
// Labor Wages feel complicated before this round.
//
// Vehicles moved in here 18 Sep, per Rishi: "why is vehicle data not in
// manage data and is showing in vehicle section". Vehicles.jsx keeps reading
// `vehicles` for everything that's actually about logged expenses (the
// Vehicle Expense Sheet, fuel-cheat detection, the category breakdown) — only
// the add/edit/delete sheet and its document-expiry alerts moved here.
//
// Locations used to be a hardcoded list here (and had a "Rolling" typo —
// fixed to "Reeling"). 18 Sep, per Rishi: "in location give an edit create
// and delete option there to because we gonna add more in near future" — so
// it's now its own per-user, editable list (see api/labour.js's
// fetchLocations/addLocation/updateLocation/deleteLocation), and Mills' picker
// reads from it live instead of a fixed array.

const SERVER_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

// Documents now live in cloud storage, so this is usually a full https URL.
// Older rows still hold a "/uploads/..." path from when files were saved on
// the server's own disk — those keep resolving against the API origin.
const fileUrl = (file) => {
  if (!file) return null;
  return file.startsWith("http") ? file : `${SERVER_ORIGIN}${file}`;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// A document's status, based purely on its expiry date — "none" if there's
// no date on file at all yet. Used to color the date cell itself, spreadsheet
// conditional-formatting style, instead of a separate badge.
const getDocStatus = (expiryDateStr) => {
  if (!expiryDateStr) return "none";
  const expiry = new Date(expiryDateStr);
  if (isNaN(expiry.getTime())) return "none";
  const daysLeft = Math.ceil((expiry - new Date()) / DAY_MS);
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 30) return "expiring";
  return "valid";
};

const DATE_STATUS_CLASSES = {
  valid: "border-green-300 dark:border-green-700 bg-green-50/40 dark:bg-green-900/25 focus:ring-green-400",
  expiring: "border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-900/25 focus:ring-amber-400",
  expired: "border-red-300 dark:border-red-700 bg-red-50/40 dark:bg-red-900/25 focus:ring-red-400",
  none: "border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 focus:ring-red-400",
};

// The 2 tracked vehicle documents — Permit was dropped at Rishi's request;
// the column and its reminder are gone from the UI, but permitExpiry/
// permitFile stay in the sheet so no existing data is destroyed.
const VEHICLE_DOC_FIELDS = [
  { key: "rc", label: "RC", expiryField: "rcExpiry", fileField: "rcFile" },
  { key: "insurance", label: "Insurance", expiryField: "insuranceExpiry", fileField: "insuranceFile" },
];
const LAST_VEHICLE_DOC_FIELD = VEHICLE_DOC_FIELDS[VEHICLE_DOC_FIELDS.length - 1];

// Column order for Tab/Enter navigation across the vehicle sheet's row —
// same "type across, it saves" pattern as the main Expense Sheet.
const VEHICLE_FIELD_ORDER = ["name", "numberPlate", ...VEHICLE_DOC_FIELDS.map((f) => f.expiryField)];
const emptyVehicleDraft = () => ({
  name: "",
  numberPlate: "",
  rcExpiry: "",
  insuranceExpiry: "",
  permitExpiry: "",
  rcFileObj: null,
  insuranceFileObj: null,
  permitFileObj: null,
});

const DOC_COLUMNS = [
  { objField: "aadharFileObj", storedField: "aadharFile", label: "Aadhar" },
  { objField: "panFileObj", storedField: "panFile", label: "PAN Card" },
  { objField: "greenCardFileObj", storedField: "greenCardFile", label: "Green Card" },
];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Same "commit only once focus truly leaves the row" fix shipped for the
// Labor Wages draft rows (18 Sep) — reused here for every draft row on this
// page, since they all have the same shape (name + a parent picker, maybe
// mobile/docs too).
const useRowCommit = (ref, commit) => () => {
  setTimeout(() => {
    if (ref.current && !ref.current.contains(document.activeElement)) commit();
  }, 0);
};

const DocCell = ({ value, label, onAttach, onRemove }) =>
  value ? (
    <span className="inline-flex items-center gap-0.5">
      <a href={value} target="_blank" rel="noopener noreferrer" title={`View ${label}`} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300">
        <FiPaperclip size={14} />
      </a>
      <button onClick={onRemove} title={`Remove ${label}`} className="text-gray-300 dark:text-gray-500 hover:text-red-600">
        <FiX size={12} />
      </button>
    </span>
  ) : (
    <label className="cursor-pointer text-gray-300 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400" title={`Attach ${label}`}>
      <FiPaperclip size={14} />
      <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => onAttach(e.target.files?.[0] || null)} />
    </label>
  );

const DraftDocCell = ({ file, label, onAttach, onClear }) =>
  file ? (
    <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
      <FiPaperclip size={13} />
      <span className="truncate max-w-[56px]" title={file.name}>{file.name}</span>
      <button onClick={onClear} title={`Remove ${label}`} className="text-gray-300 dark:text-gray-500 hover:text-red-600">
        <FiX size={11} />
      </button>
    </span>
  ) : (
    <label className="cursor-pointer text-gray-300 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400" title={`Attach ${label}`}>
      <FiPaperclip size={14} />
      <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => onAttach(e.target.files?.[0] || null)} />
    </label>
  );

// One generic management sheet, used for Mills, Contractors, Labor and now
// Locations — they're all "a name, maybe a parent to pick, maybe mobile/
// documents/an opening balance" underneath. `parent` is null for a flat list
// (Locations); otherwise a mill needs a location, a contractor needs a mill,
// a labor needs a contractor. `showMobile` / `showDocs` / `showOpeningBalance`
// turn the optional columns on.
const PersonManager = ({
  rows,
  onAdd,
  onUpdate,
  onDelete,
  namePlaceholder,
  parent = null, // { field, label, options: [{value,label}] } or null for a flat list
  showMobile = true,
  showDocs = true,
  showOpeningBalance = false,
  emptyText,
}) => {
  const emptyDraft = () => ({
    name: "",
    mobile: "",
    ...(parent ? { [parent.field]: "" } : {}),
    openingBalance: "",
    aadharFileObj: null,
    panFileObj: null,
    greenCardFileObj: null,
  });
  const [draft, setDraft] = useState(emptyDraft());
  const [adding, setAdding] = useState(false);
  const nameRef = useRef(null);
  const rowRef = useRef(null);

  const commitDraft = async () => {
    if (!draft.name.trim() || (parent && !draft[parent.field]) || adding) return;
    setAdding(true);
    try {
      await onAdd(draft);
      setDraft(emptyDraft());
      nameRef.current?.focus();
    } catch (err) {
      alert(err.message);
    } finally {
      setAdding(false);
    }
  };
  const handleRowBlur = useRowCommit(rowRef, commitDraft);

  const saveField = async (id, field, value) => {
    try {
      await onUpdate(id, { [field]: value });
    } catch (err) {
      alert(err.message);
    }
  };

  const colCount = 1 + (parent ? 1 : 0) + (showMobile ? 1 : 0) + (showDocs ? 3 : 0) + (showOpeningBalance ? 1 : 0) + 1;

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400 text-xs">
          {parent && <th className="px-3 py-2 font-medium">{parent.label}</th>}
          <th className="px-3 py-2 font-medium">Name</th>
          {showMobile && <th className="px-3 py-2 font-medium">Mobile</th>}
          {showDocs && DOC_COLUMNS.map((d) => <th key={d.objField} className="px-3 py-2 font-medium">{d.label}</th>)}
          {showOpeningBalance && <th className="px-3 py-2 font-medium">Opening Bal.</th>}
          <th className="px-3 py-2"></th>
        </tr>
      </thead>
      <tbody>
        <tr ref={rowRef} onBlur={handleRowBlur} className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30">
          {parent && (
            <td className="px-3 py-2">
              <select
                value={draft[parent.field]}
                onChange={(e) => setDraft((d) => ({ ...d, [parent.field]: e.target.value }))}
                className="border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
              >
                <option value="">Choose {parent.label.toLowerCase()}…</option>
                {parent.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </td>
          )}
          <td className="px-3 py-2">
            <input
              ref={nameRef}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && commitDraft()}
              placeholder={namePlaceholder}
              disabled={adding}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
            />
          </td>
          {showMobile && (
            <td className="px-3 py-2">
              <input
                value={draft.mobile}
                onChange={(e) => setDraft((d) => ({ ...d, mobile: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && commitDraft()}
                placeholder="Mobile no."
                disabled={adding}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </td>
          )}
          {showDocs &&
            DOC_COLUMNS.map(({ objField, label }) => (
              <td key={objField} className="px-3 py-2">
                <DraftDocCell
                  file={draft[objField]}
                  label={label}
                  onAttach={(file) => setDraft((d) => ({ ...d, [objField]: file }))}
                  onClear={() => setDraft((d) => ({ ...d, [objField]: null }))}
                />
              </td>
            ))}
          {showOpeningBalance && (
            <td className="px-3 py-2">
              <input
                type="number"
                value={draft.openingBalance}
                onChange={(e) => setDraft((d) => ({ ...d, openingBalance: e.target.value }))}
                placeholder="0"
                className="w-24 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </td>
          )}
          <td className="px-3 py-2"></td>
        </tr>

        {rows.length === 0 && (
          <tr>
            <td colSpan={colCount} className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500 italic">
              {emptyText}
            </td>
          </tr>
        )}

        {rows.map((row) => (
          <tr key={row._id} className="border-b border-gray-100 dark:border-gray-800">
            {parent && (
              <td className="px-3 py-2">
                <select
                  value={row[parent.field] || ""}
                  onChange={(e) => saveField(row._id, parent.field, e.target.value)}
                  className="border border-transparent hover:border-gray-200 dark:hover:border-gray-700 rounded-md px-2 py-1.5 text-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-red-400"
                >
                  <option value="">—</option>
                  {parent.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </td>
            )}
            <td className="px-3 py-2">
              <input
                key={`${row._id}-name`}
                defaultValue={row.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== row.name && saveField(row._id, "name", e.target.value.trim())}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className="w-full border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </td>
            {showMobile && (
              <td className="px-3 py-2">
                <input
                  key={`${row._id}-mobile`}
                  defaultValue={row.mobile}
                  onBlur={(e) => e.target.value !== row.mobile && saveField(row._id, "mobile", e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  className="w-full border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </td>
            )}
            {showDocs &&
              DOC_COLUMNS.map(({ objField, storedField, label }) => (
                <td key={objField} className="px-3 py-2">
                  <DocCell
                    value={row[storedField]}
                    label={label}
                    onAttach={(file) => saveField(row._id, objField, file)}
                    onRemove={() => saveField(row._id, `remove${cap(storedField)}`, "true")}
                  />
                </td>
              ))}
            {showOpeningBalance && (
              <td className="px-3 py-2">
                <input
                  key={`${row._id}-ob`}
                  type="number"
                  defaultValue={row.openingBalance}
                  onBlur={(e) => Number(e.target.value) !== row.openingBalance && saveField(row._id, "openingBalance", Number(e.target.value) || 0)}
                  className="w-24 border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </td>
            )}
            <td className="px-3 py-2">
              <button onClick={() => window.confirm(`Remove ${row.name}?`) && onDelete(row._id)} title={`Delete ${row.name}`} className="text-gray-300 dark:text-gray-500 hover:text-red-600">
                <FiTrash2 size={14} />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

// Vehicles' own management sheet — kept separate from PersonManager since
// vehicles don't have a parent picker but do have two expiry-dated document
// columns (RC/Insurance) plus a number-plate photo, none of which fit that
// generic shape. Same draft-row + Enter-key-navigation + document-status
// coloring the sheet had on the Vehicles page itself.
const VehicleManager = ({ vehicles, onAdd, onUpdate, onDelete }) => {
  const [rows, setRows] = useState(vehicles);
  useEffect(() => setRows(vehicles), [vehicles]);

  const [draft, setDraft] = useState(emptyVehicleDraft());
  const [saving, setSaving] = useState(false);
  const cellRefs = useRef({});
  const setCellRef = (rowKey, field) => (el) => {
    cellRefs.current[`${rowKey}:${field}`] = el;
  };
  const focusCell = (rowKey, field) => {
    cellRefs.current[`${rowKey}:${field}`]?.focus();
  };
  const handleCellKeyDown = (e, rowKey, field, { isDraft }) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const idx = VEHICLE_FIELD_ORDER.indexOf(field);
    if (idx < VEHICLE_FIELD_ORDER.length - 1) {
      focusCell(rowKey, VEHICLE_FIELD_ORDER[idx + 1]);
    } else if (isDraft) {
      commitDraftIfReady();
    } else {
      e.target.blur();
    }
  };

  const setDraftField = (field, value) => setDraft((d) => ({ ...d, [field]: value }));

  const commitDraftIfReady = async () => {
    if (!draft.name.trim()) return;
    try {
      setSaving(true);
      await onAdd({
        name: draft.name.trim(),
        numberPlate: draft.numberPlate,
        rcExpiry: draft.rcExpiry,
        insuranceExpiry: draft.insuranceExpiry,
        permitExpiry: draft.permitExpiry,
        rcFileObj: draft.rcFileObj,
        insuranceFileObj: draft.insuranceFileObj,
        permitFileObj: draft.permitFileObj,
        plateFileObj: draft.plateFileObj,
      });
      setDraft(emptyVehicleDraft());
      setTimeout(() => focusCell("draft", "name"), 0);
    } catch (err) {
      alert(err.message || "Failed to add vehicle");
    } finally {
      setSaving(false);
    }
  };

  // A file picked in the draft row usually means "that's the last thing I'm
  // attaching for this vehicle" — try committing right after, same as
  // finishing the row via Tab/Enter. commitDraftIfReady no-ops if the name
  // isn't filled in yet, so this is always safe to call.
  const handleDraftFileChange = (fileObjKey, file) => {
    setDraft((d) => ({ ...d, [fileObjKey]: file }));
    setTimeout(() => commitDraftIfReady(), 0);
  };

  const updateField = (id, field, value) => {
    setRows((prev) => prev.map((v) => (v._id === id ? { ...v, [field]: value } : v)));
  };

  const saveRow = async (id) => {
    const vehicle = rows.find((v) => v._id === id);
    if (!vehicle) return;
    if (!vehicle.name || !vehicle.name.trim()) {
      alert("Vehicle name can't be left blank");
      setRows(vehicles);
      return;
    }
    try {
      await onUpdate(id, {
        name: vehicle.name,
        numberPlate: vehicle.numberPlate,
        rcExpiry: vehicle.rcExpiry,
        insuranceExpiry: vehicle.insuranceExpiry,
        permitExpiry: vehicle.permitExpiry,
      });
    } catch (err) {
      alert(err.message || "Failed to save that change");
      setRows(vehicles);
    }
  };

  const handleRowFileChange = async (id, fileObjKey, file, label) => {
    if (!file) return;
    try {
      await onUpdate(id, { [fileObjKey]: file });
    } catch (err) {
      alert(err.message || `Failed to attach ${label}`);
    }
  };

  // Detaching one document without touching the rest of the vehicle.
  // Replacing is "remove, then attach again" — the cell reverts to its
  // upload state. The backend flag is removeRcFile / removeInsuranceFile.
  const handleRemoveDoc = async (vehicleId, fileField, label) => {
    const flag = `remove${fileField.charAt(0).toUpperCase()}${fileField.slice(1)}`;
    try {
      await onUpdate(vehicleId, { [flag]: true });
    } catch (err) {
      alert(err.message || `Failed to remove ${label}`);
    }
  };

  const handleDelete = async (vehicle) => {
    if (!window.confirm(`Delete "${vehicle.name}"? Its logged expenses will stay in the Expense Sheet, just no longer linked to a vehicle name.`)) {
      return;
    }
    try {
      await onDelete(vehicle._id);
    } catch (err) {
      alert(err.message || "Failed to delete vehicle");
    }
  };

  // A "Filters" switch scoped to what's useful here: which documents need
  // attention. 30 days mirrors the "expiring soon" window the alert banner
  // above uses.
  const [showFilters, setShowFilters] = useState(false);
  const [docFilter, setDocFilter] = useState("all");
  const getVehicleDocStatus = (vehicle) => {
    const dates = [vehicle.rcExpiry, vehicle.insuranceExpiry, vehicle.permitExpiry].filter(Boolean);
    if (dates.length === 0) return "none";
    const now = new Date();
    const soon = new Date();
    soon.setDate(now.getDate() + 30);
    let status = "ok";
    for (const d of dates) {
      const exp = new Date(d);
      if (exp < now) return "expired";
      if (exp <= soon) status = "expiring";
    }
    return status;
  };
  const filteredRows = useMemo(() => {
    if (docFilter === "all") return rows;
    return rows.filter((v) => getVehicleDocStatus(v) === docFilter);
  }, [rows, docFilter]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-4 pb-3">
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-2 border rounded-lg px-3 py-2 text-sm font-medium ${
            showFilters || docFilter !== "all"
              ? "bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300"
              : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-900"
          }`}
        >
          <FiFilter size={14} />
          Filters
          {docFilter !== "all" && (
            <span className="bg-red-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">1</span>
          )}
        </button>
        {docFilter !== "all" && (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Showing {filteredRows.length} of {rows.length} vehicles
          </span>
        )}
      </div>

      {showFilters && (
        <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg mx-4 mb-3 p-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium mb-1 text-gray-500 dark:text-gray-400">Documents</label>
            <select
              value={docFilter}
              onChange={(e) => setDocFilter(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400 min-w-[12rem]"
            >
              <option value="all">All vehicles</option>
              <option value="expired">Expired documents</option>
              <option value="expiring">Expiring within 30 days</option>
              <option value="ok">Documents up to date</option>
              <option value="none">No document dates on file</option>
            </select>
          </div>
          {docFilter !== "all" && (
            <button
              onClick={() => setDocFilter("all")}
              className="flex items-center gap-1.5 text-sm font-medium pb-2 text-gray-500 dark:text-gray-400 hover:text-red-600"
            >
              <FiXCircle size={15} />
              Clear filter
            </button>
          )}
        </div>
      )}

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400 text-xs">
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Number Plate</th>
            {VEHICLE_DOC_FIELDS.map((f) => (
              <th key={f.key} className="px-3 py-2 font-medium">{f.label}</th>
            ))}
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {/* Draft row — always present at the top, fills in like a spreadsheet */}
          <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30">
            <td className="px-3 py-2">
              <input
                ref={setCellRef("draft", "name")}
                type="text"
                value={draft.name}
                onChange={(e) => setDraftField("name", e.target.value)}
                onKeyDown={(e) => handleCellKeyDown(e, "draft", "name", { isDraft: true })}
                placeholder="E.g., Truck 1"
                disabled={saving}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </td>
            <td className="px-3 py-2">
              <div className="flex items-center gap-1.5">
                <input
                  ref={setCellRef("draft", "numberPlate")}
                  type="text"
                  value={draft.numberPlate}
                  onChange={(e) => setDraftField("numberPlate", e.target.value)}
                  onKeyDown={(e) => handleCellKeyDown(e, "draft", "numberPlate", { isDraft: true })}
                  placeholder="E.g., GJ01AB1234"
                  className="min-w-0 flex-1 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
                />
                {/* Inside the existing cell rather than a new column: the
                    photo is of the plate, so it belongs beside it. */}
                <label className="shrink-0 cursor-pointer text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400" title="Attach a photo of the number plate">
                  <FiPaperclip size={14} className={draft.plateFileObj ? "text-blue-600 dark:text-blue-400" : ""} />
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    className="hidden"
                    onChange={(e) => handleDraftFileChange("plateFileObj", e.target.files?.[0] || null)}
                  />
                </label>
              </div>
            </td>
            {VEHICLE_DOC_FIELDS.map((f) => (
              <td key={f.key} className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <input
                    ref={setCellRef("draft", f.expiryField)}
                    type="date"
                    value={draft[f.expiryField]}
                    onChange={(e) => setDraftField(f.expiryField, e.target.value)}
                    onBlur={f.key === LAST_VEHICLE_DOC_FIELD.key ? commitDraftIfReady : undefined}
                    onKeyDown={(e) => handleCellKeyDown(e, "draft", f.expiryField, { isDraft: true })}
                    className="min-w-0 flex-1 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                  <label className="shrink-0 cursor-pointer text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400" title={`Attach ${f.label}`}>
                    <FiPaperclip size={14} className={draft[`${f.key}FileObj`] ? "text-blue-600 dark:text-blue-400" : ""} />
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="hidden"
                      onChange={(e) => handleDraftFileChange(`${f.key}FileObj`, e.target.files?.[0] || null)}
                    />
                  </label>
                </div>
              </td>
            ))}
            <td className="px-3 py-2 text-center text-gray-300 dark:text-gray-500">
              {saving ? (
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-red-500 mx-auto"></div>
              ) : (
                <FiPlus size={16} className="mx-auto" />
              )}
            </td>
          </tr>

          {rows.length === 0 && (
            <tr>
              <td colSpan={2 + VEHICLE_DOC_FIELDS.length + 1} className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500 italic">
                No vehicles yet — start typing in the row above.
              </td>
            </tr>
          )}
          {rows.length > 0 && filteredRows.length === 0 && (
            <tr>
              <td colSpan={2 + VEHICLE_DOC_FIELDS.length + 1} className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500 italic">
                No vehicles match this filter.
              </td>
            </tr>
          )}

          {filteredRows.map((vehicle) => (
            <tr key={vehicle._id} className="border-b border-gray-100 dark:border-gray-800">
              <td className="px-3 py-2">
                <input
                  ref={setCellRef(vehicle._id, "name")}
                  type="text"
                  value={vehicle.name}
                  onChange={(e) => updateField(vehicle._id, "name", e.target.value)}
                  onBlur={() => saveRow(vehicle._id)}
                  onKeyDown={(e) => handleCellKeyDown(e, vehicle._id, "name", { isDraft: false })}
                  className="w-full border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <input
                    ref={setCellRef(vehicle._id, "numberPlate")}
                    type="text"
                    value={vehicle.numberPlate || ""}
                    onChange={(e) => updateField(vehicle._id, "numberPlate", e.target.value)}
                    onBlur={() => saveRow(vehicle._id)}
                    onKeyDown={(e) => handleCellKeyDown(e, vehicle._id, "numberPlate", { isDraft: false })}
                    className="min-w-0 flex-1 border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                  {fileUrl(vehicle.plateFile) ? (
                    <span className="shrink-0 inline-flex items-center gap-0.5">
                      <a
                        href={fileUrl(vehicle.plateFile)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                        title="View the number plate photo"
                      >
                        <FiPaperclip size={14} />
                      </a>
                      <button
                        onClick={() => handleRemoveDoc(vehicle._id, "plateFile", "Number plate photo")}
                        className="text-gray-300 dark:text-gray-500 hover:text-red-600"
                        title="Remove the number plate photo"
                      >
                        <FiX size={12} />
                      </button>
                    </span>
                  ) : (
                    <label className="shrink-0 cursor-pointer text-gray-300 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400" title="Attach a photo of the number plate">
                      <FiPaperclip size={14} />
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="hidden"
                        onChange={(e) => handleRowFileChange(vehicle._id, "plateFileObj", e.target.files?.[0], "Number plate photo")}
                      />
                    </label>
                  )}
                </div>
              </td>
              {VEHICLE_DOC_FIELDS.map((f) => {
                const status = getDocStatus(vehicle[f.expiryField]);
                const fileHref = fileUrl(vehicle[f.fileField]);
                return (
                  <td key={f.key} className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        ref={setCellRef(vehicle._id, f.expiryField)}
                        type="date"
                        value={vehicle[f.expiryField] ? new Date(vehicle[f.expiryField]).toISOString().split("T")[0] : ""}
                        onChange={(e) => updateField(vehicle._id, f.expiryField, e.target.value)}
                        onBlur={() => saveRow(vehicle._id)}
                        onKeyDown={(e) => handleCellKeyDown(e, vehicle._id, f.expiryField, { isDraft: false })}
                        className={`min-w-0 flex-1 border rounded-md px-2 py-1.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 ${DATE_STATUS_CLASSES[status]}`}
                        title={status === "expired" ? "Expired" : status === "expiring" ? "Expiring within 30 days" : ""}
                      />
                      {fileHref ? (
                        <span className="shrink-0 inline-flex items-center gap-0.5">
                          <a
                            href={fileHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                            title={`View ${f.label}`}
                          >
                            <FiPaperclip size={14} />
                          </a>
                          <button
                            onClick={() => handleRemoveDoc(vehicle._id, f.fileField, f.label)}
                            className="text-gray-300 dark:text-gray-500 hover:text-red-600"
                            title={`Remove ${f.label}`}
                          >
                            <FiX size={12} />
                          </button>
                        </span>
                      ) : (
                        <label className="shrink-0 cursor-pointer text-gray-300 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400" title={`Attach ${f.label}`}>
                          <FiPaperclip size={14} />
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            className="hidden"
                            onChange={(e) => handleRowFileChange(vehicle._id, `${f.key}FileObj`, e.target.files?.[0], f.label)}
                          />
                        </label>
                      )}
                    </div>
                  </td>
                );
              })}
              <td className="px-3 py-2">
                <button onClick={() => handleDelete(vehicle)} title={`Delete ${vehicle.name}`} className="text-gray-300 dark:text-gray-500 hover:text-red-600">
                  <FiTrash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Collapsible by default — 18 Sep, per Rishi: "all the sections should have
// switch and one click opens it other clicks close dont make them look open
// all the time so when we need vehicle details we go in vehicle docs and
// everything is closed". Each section tracks its own open/closed state, so
// opening one never affects the others.
const Section = ({ icon: Icon, title, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-4 text-sm font-semibold text-gray-700 dark:text-gray-200 text-left"
      >
        <span className="flex items-center gap-2">
          <Icon size={16} /> {title}
        </span>
        {open ? <FiChevronDown size={16} className="text-gray-400 shrink-0" /> : <FiChevronRight size={16} className="text-gray-400 shrink-0" />}
      </button>
      {open && <div className="min-w-[640px] pb-2">{children}</div>}
    </div>
  );
};

const ManageData = () => {
  const [locations, setLocations] = useState([]);
  const [mills, setMills] = useState([]);
  const [contractors, setContractors] = useState([]);
  const [labors, setLabors] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [loc, m, c, l, v] = await Promise.all([
        fetchLocations(),
        fetchMills(),
        fetchContractors(),
        fetchLabors(),
        fetchVehicles(),
      ]);
      setLocations(loc);
      setMills(m);
      setContractors(c);
      setLabors(l);
      setVehicles(Array.isArray(v) ? v : []);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const vehicleAlerts = useMemo(() => buildVehicleAlerts(vehicles), [vehicles]);

  if (loading) {
    return <div className="p-4 sm:p-6 text-sm text-gray-400">Loading…</div>;
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">Manage Data</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Add, rename or remove mills, contractors, labor and vehicles here. The Labor Wages sheet and Vehicle Expense
          Sheet only log their day-to-day entries.
        </p>
      </div>

      <AlertsStrip alerts={vehicleAlerts} />

      <Section icon={FiTruck} title="Vehicles">
        <VehicleManager
          vehicles={vehicles}
          onAdd={(fields) => addVehicle(fields).then(loadData)}
          onUpdate={(id, fields) => updateVehicle(id, fields).then(loadData)}
          onDelete={(id) => deleteVehicle(id).then(loadData)}
        />
      </Section>

      <Section icon={FiMapPin} title="Locations">
        <PersonManager
          rows={locations.map((l) => ({ ...l, _id: l._id || l.id }))}
          onAdd={(fields) => addLocation({ name: fields.name }).then(loadData)}
          onUpdate={(id, fields) => updateLocation(id, fields).then(loadData)}
          onDelete={(id) =>
            deleteLocation(id)
              .then(loadData)
              .catch((err) => alert(err.message))
          }
          namePlaceholder="Location name (e.g., Reeling)"
          showMobile={false}
          showDocs={false}
          emptyText="No locations yet — type a name above."
        />
      </Section>

      <Section icon={FiHome} title="Mills">
        <PersonManager
          rows={mills}
          onAdd={(fields) => addMill(fields).then(loadData)}
          onUpdate={(id, fields) => updateMill(id, fields).then(loadData)}
          onDelete={(id) => deleteMill(id).then(loadData)}
          namePlaceholder="Mill name (e.g., Mill No-01)"
          parent={{ field: "location", label: "Location", options: locations.map((l) => ({ value: l.name, label: l.name })) }}
          showMobile={false}
          showDocs={false}
          emptyText={locations.length === 0 ? "Add a location above first." : "No mills yet — pick a location and type a name above."}
        />
      </Section>

      <Section icon={FiUsers} title="Contractors">
        <PersonManager
          rows={contractors}
          onAdd={(fields) => addContractor(fields).then(loadData)}
          onUpdate={(id, fields) => updateContractor(id, fields).then(loadData)}
          onDelete={(id) => deleteContractor(id).then(loadData)}
          namePlaceholder="Contractor name"
          parent={{
            field: "millId",
            label: "Mill",
            options: mills.map((m) => ({ value: m._id, label: `${m.name} (${m.location})` })),
          }}
          showOpeningBalance
          emptyText={mills.length === 0 ? "Add a mill above first." : "No contractors yet — pick a mill and type a name above."}
        />
      </Section>

      <Section icon={FiUser} title="Labor">
        <PersonManager
          rows={labors}
          onAdd={(fields) => addLabor(fields).then(loadData)}
          onUpdate={(id, fields) => updateLabor(id, fields).then(loadData)}
          onDelete={(id) => deleteLabor(id).then(loadData)}
          namePlaceholder="Labor name"
          parent={{ field: "contractorId", label: "Contractor", options: contractors.map((c) => ({ value: c._id, label: c.name })) }}
          emptyText={contractors.length === 0 ? "Add a contractor above first." : "No labor yet — pick a contractor and type a name above."}
        />
      </Section>
    </div>
  );
};

export default ManageData;
