import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchVehicles } from "/src/api/vehicles";
import { fetchExpenses, addExpense, updateExpense, deleteExpense, bulkAddExpenses, bulkDeleteExpenses } from "/src/api/expenses";
import { fetchMasterCatalog } from "/src/api/masters";
import { previewImportSheet } from "/src/api/imports";
import { fetchSheetsStatus, exportToGoogleSheet, previewFromGoogleSheet, emailExpenseSheet } from "/src/api/sheets";
import { API_BASE_URL } from "/src/api/config";
import { DEFAULT_EXPENSE_MASTERS } from "/src/constants/categories";
import { FILE_PREFIX } from "/src/constants/brand";
import { downloadCsv } from "/src/utils/exportCsv";
import MasterAutocomplete from "/src/components/MasterAutocomplete";
import SuggestInput from "/src/components/SuggestInput";
import MasterMultiSelect from "/src/components/MasterMultiSelect";
import ImportSheetModal from "/src/components/ImportSheetModal";
import ExportSheetModal from "/src/components/ExportSheetModal";
import { findPossibleDuplicate, duplicateWarning } from "/src/utils/vehicleExpense";
import {
  FiPlus,
  FiTrash2,
  FiPaperclip,
  FiSearch,
  FiChevronDown,
  FiChevronRight,
  FiFilter,
  FiXCircle,
  FiAlertTriangle,
  FiUploadCloud,
  FiDownload,
  FiGrid,
} from "react-icons/fi";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const SERVER_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

// Documents now live in cloud storage, so this is usually a full https URL.
// Older rows still hold a "/uploads/..." path from when files were saved on
// the server's own disk — those keep resolving against the API origin.
const fileUrl = (file) => {
  if (!file) return null;
  return file.startsWith("http") ? file : `${SERVER_ORIGIN}${file}`;
};

const todayStr = () => new Date().toISOString().split("T")[0];

const notifySuccess = (message) => toast.success(message, { position: "top-right", autoClose: 3000 });
const notifyError = (message) => toast.error(message, { position: "top-right", autoClose: 4000 });

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    amount || 0
  );

// Column order for the consolidated Vehicle Expense Sheet below — same
// "type across, it saves" pattern as the main Expense Sheet, with a Vehicle
// column added so any vehicle's expense can be logged from one place.
const EXPENSE_FIELD_ORDER = ["date", "vehicleId", "expense", "amount", "master", "litres", "odometer"];
const emptyExpenseDraft = () => ({ date: todayStr(), vehicleId: "", expense: "", amount: "", master: "", litres: "", odometer: "", billFileObj: null });

// Litres only makes sense on a fuel entry, so the Litres cell is live on those
// rows and a quiet dash everywhere else. Matching on the words rather than the
// exact master name means a typed "Diesel for truck 2" still counts.
const isFuelMaster = (master) => /fuel|diesel|petrol/i.test(master || "");

// Rate per litre is the cheating check this data supports: a bill charged well
// above the going pump rate stands out. (Mileage — litres against distance —
// would need an odometer reading per fill, which we deliberately don't ask for.)
const ratePerLitre = (row) => {
  const litres = Number(row.litres) || 0;
  const amount = Number(row.amount) || 0;
  return litres > 0 ? amount / litres : null;
};

// Masters that make up the category-wise breakdown table further down —
// each gets its own dedicated column. Anything logged under a master outside
// this list (a custom one someone typed, or a non-vehicle master used by
// mistake) still counts — it just falls into the "Other" column so the Total
// column always adds up correctly.
const VEHICLE_BREAKDOWN_MASTERS = [
  "Fuel & Diesel",
  "Service & Maintenance",
  "Tyre & Puncture",
  "Spare Parts",
  "Toll & Parking",
  "Vehicle Insurance Premium",
  "Permit & Fitness Fees",
  "Driver Wages",
  "Fines & Challans",
  "Vehicle Expenses",
];

// Split into Sheet / Report tabs (18 Sep, per Rishi: "in vehicle page the
// expense breakdown category and fuel mileige should also go in seperate
// page known as report in the vehicle page like we did in the labor sheet")
// — same tab-bar pattern as Labor Wages' Work Log / Payments / Report tabs.
const TABS = [
  { key: "sheet", label: "Vehicle Expense Sheet" },
  { key: "report", label: "Report" },
];

const Vehicles = () => {
  const [vehicles, setVehicles] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [masters, setMasters] = useState(DEFAULT_EXPENSE_MASTERS);
  // 19 Sep, per Rishi: the master list here was mismatched against the
  // Expenses page — this page was reading /api/meta/masters (a fixed,
  // never-changes constant) instead of this user's own per-user masters
  // (rename/add/delete from the Expenses or Manage Data page), so a master
  // renamed or added there never showed up here. masterCatalog is the same
  // {id, name} shape Expenses.jsx keeps, needed for MasterAutocomplete's
  // inline rename/add/delete to work here too, not just show a stale list.
  const [masterCatalog, setMasterCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("sheet");

  // --- Vehicle Expense Sheet state (one consolidated sheet, all vehicles) ---
  const [expenseDraft, setExpenseDraft] = useState(emptyExpenseDraft());
  const [savingExpenseDraft, setSavingExpenseDraft] = useState(false);
  const [expenseSearch, setExpenseSearch] = useState("");
  const [expenseGroupBy, setExpenseGroupBy] = useState("none"); // "none" | "date" | "master" | "vehicle"
  const [collapsedExpenseGroups, setCollapsedExpenseGroups] = useState(() => new Set());

  // --- Filter toolbar: Vehicle + Master + date range ---
  const [showExpenseFilters, setShowExpenseFilters] = useState(false);
  // Import/Download/Share for the Vehicle Expense Sheet (18 Sep, per Rishi:
  // "add import download and export option in the vehicle section") — same
  // three-button toolbar as the main Expense Sheet, reused via the generic
  // ImportSheetModal/ExportSheetModal. Imported rows have no vehicle column of
  // their own, so the import modal asks which vehicle they belong to.
  const [showVehicleImportModal, setShowVehicleImportModal] = useState(false);
  const [showVehicleExportModal, setShowVehicleExportModal] = useState(false);
  const [importVehicleId, setImportVehicleId] = useState("");
  const [filterVehicleId, setFilterVehicleId] = useState("");
  const [filterExpenseText, setFilterExpenseText] = useState("");
  const [filterExpenseMasters, setFilterExpenseMasters] = useState([]); // empty = all
  const [filterExpenseDateFrom, setFilterExpenseDateFrom] = useState("");
  const [filterExpenseDateTo, setFilterExpenseDateTo] = useState("");

  const activeExpenseFilterCount =
    [filterVehicleId, filterExpenseText, filterExpenseDateFrom, filterExpenseDateTo].filter((v) => v !== "")
      .length + (filterExpenseMasters.length > 0 ? 1 : 0);

  const clearExpenseFilters = () => {
    setFilterVehicleId("");
    setFilterExpenseText("");
    setFilterExpenseMasters([]);
    setFilterExpenseDateFrom("");
    setFilterExpenseDateTo("");
  };

  // Enter walks across the filter controls, same as it walks across a sheet
  // row — the whole page stays keyboard-only. The last field closes the panel.
  const EXPENSE_FILTER_ORDER = ["search", "expense", "vehicle", "master", "from", "to"];
  const expenseFilterRefs = useRef({});
  const setExpenseFilterRef = (key) => (el) => {
    expenseFilterRefs.current[key] = el;
  };
  const handleExpenseFilterKeyDown = (e, key) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const next = EXPENSE_FILTER_ORDER[EXPENSE_FILTER_ORDER.indexOf(key) + 1];
    if (next) {
      if (!showExpenseFilters) setShowExpenseFilters(true);
      setTimeout(() => expenseFilterRefs.current[next]?.focus(), 0);
    } else {
      e.target.blur();
      setShowExpenseFilters(false);
    }
  };
  const expenseCellRefs = useRef({});
  const setExpenseCellRef = (rowKey, field) => (el) => {
    expenseCellRefs.current[`${rowKey}:${field}`] = el;
  };
  const focusExpenseCell = (rowKey, field) => {
    expenseCellRefs.current[`${rowKey}:${field}`]?.focus();
  };
  const handleExpenseCellKeyDown = (e, rowKey, field, { isDraft }) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const idx = EXPENSE_FIELD_ORDER.indexOf(field);
    // The draft row doesn't always render every field in the order — Litres
    // only shows for a fuel master, and Odometer isn't editable until the
    // row already exists — so Enter used to try to focus a field with no
    // input there and land nowhere, leaving the row looking stuck (part of
    // Rishi's "enter doesn't go to next" report). Walk forward to the next
    // field that's actually rendered right now instead of assuming every
    // name in the order has a live ref.
    let nextIdx = idx + 1;
    while (nextIdx < EXPENSE_FIELD_ORDER.length && !expenseCellRefs.current[`${rowKey}:${EXPENSE_FIELD_ORDER[nextIdx]}`]) {
      nextIdx++;
    }
    if (nextIdx < EXPENSE_FIELD_ORDER.length) {
      focusExpenseCell(rowKey, EXPENSE_FIELD_ORDER[nextIdx]);
    } else if (isDraft) {
      commitExpenseDraftIfReady();
    } else {
      e.target.blur();
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [vehicleData, expenseData, masterData] = await Promise.all([fetchVehicles(), fetchExpenses(), fetchMasterCatalog()]);
      setVehicles(Array.isArray(vehicleData) ? vehicleData : []);
      setExpenses(Array.isArray(expenseData) ? expenseData : []);
      setMasterCatalog(Array.isArray(masterData) ? masterData : []);
      setMasters(masterData?.length ? masterData.map((m) => m.name) : DEFAULT_EXPENSE_MASTERS);
    } catch (err) {
      notifyError("Failed to load vehicles");
    } finally {
      setLoading(false);
    }
  };

  // Called after a master is added, renamed or deleted from the dropdown
  // here — same reasoning as Expenses.jsx's reloadAfterMasterChange: a
  // rename rewrites the Master column on every expense that used it, so the
  // rows need to come back too, not just the name list.
  const reloadAfterMasterChange = () => loadData();

  useEffect(() => {
    loadData();
  }, []);

  const expensesByVehicle = useMemo(() => {
    const map = new Map();
    for (const e of expenses) {
      if (!e.vehicleId) continue;
      if (!map.has(e.vehicleId)) map.set(e.vehicleId, []);
      map.get(e.vehicleId).push(e);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(b.date) - new Date(a.date));
    }
    return map;
  }, [expenses]);

  // Category-wise breakdown: one row per vehicle, one column per master in
  // VEHICLE_BREAKDOWN_MASTERS, all-time totals (not just this month).
  const breakdownRows = useMemo(() => {
    return vehicles.map((vehicle) => {
      const vehicleExpenses = expensesByVehicle.get(vehicle._id) || [];
      const byMaster = {};
      VEHICLE_BREAKDOWN_MASTERS.forEach((m) => (byMaster[m] = 0));
      let other = 0;
      let total = 0;
      for (const e of vehicleExpenses) {
        const amt = Number(e.amount) || 0;
        total += amt;
        if (Object.prototype.hasOwnProperty.call(byMaster, e.master)) byMaster[e.master] += amt;
        else other += amt;
      }
      return { vehicle, byMaster, other, total };
    });
  }, [vehicles, expensesByVehicle]);

  const breakdownGrandTotals = useMemo(() => {
    const byMaster = {};
    VEHICLE_BREAKDOWN_MASTERS.forEach((m) => (byMaster[m] = 0));
    let other = 0;
    let total = 0;
    for (const row of breakdownRows) {
      VEHICLE_BREAKDOWN_MASTERS.forEach((m) => (byMaster[m] += row.byMaster[m]));
      other += row.other;
      total += row.total;
    }
    return { byMaster, other, total };
  }, [breakdownRows]);

  const vehiclesById = useMemo(() => new Map(vehicles.map((v) => [v._id, v])), [vehicles]);

  // Fuel summary per vehicle: what was paid per litre, and how far the truck
  // actually went on it.
  //
  // Mileage uses the standard full-tank method — distance since the previous
  // fill, divided by the litres put in at THIS fill. That means the first fill
  // for a vehicle can never have a mileage (there is nothing to measure from),
  // and a reading lower than the one before it is treated as a bad entry
  // rather than a negative distance.
  const fuelSummary = useMemo(() => {
    return vehicles
      .map((vehicle) => {
        const fills = (expensesByVehicle.get(vehicle._id) || [])
          .filter((e) => isFuelMaster(e.master) && Number(e.litres) > 0)
          .sort((a, b) => new Date(a.date) - new Date(b.date));
        if (!fills.length) return null;

        const litres = fills.reduce((acc, e) => acc + Number(e.litres), 0);
        const spend = fills.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
        const avgRate = litres > 0 ? spend / litres : 0;

        // Walk the fills in date order, pairing each against the last one that
        // carried a usable odometer reading.
        const legs = [];
        let badReadings = 0;
        let previous = null;
        for (const fill of fills) {
          const reading = Number(fill.odometer);
          if (!reading || reading <= 0) continue;
          if (previous) {
            const distance = reading - previous;
            if (distance <= 0) badReadings += 1;
            else legs.push({ row: fill, distance, kmPerLitre: distance / Number(fill.litres) });
          }
          previous = reading;
        }

        const distanceTotal = legs.reduce((acc, l) => acc + l.distance, 0);
        const litresOverLegs = legs.reduce((acc, l) => acc + Number(l.row.litres), 0);
        // Weighted by litres rather than averaging the per-leg figures, so one
        // small top-up doesn't swing the number as much as a full tank.
        const avgKmPerLitre = litresOverLegs > 0 ? distanceTotal / litresOverLegs : null;

        // Dearest fill — the inflated-bill check.
        let dearest = null;
        for (const f of fills) {
          const rate = ratePerLitre(f);
          if (rate && (!dearest || rate > dearest.rate)) dearest = { row: f, rate };
        }
        const dearFlag = dearest && avgRate > 0 && dearest.rate > avgRate * 1.15 ? dearest : null;

        // Worst mileage — the fuel-going-missing check. More than 20% below
        // this vehicle's own average is worth a look; anything less is normal
        // variation between loaded and empty runs.
        let worst = null;
        for (const leg of legs) {
          if (!worst || leg.kmPerLitre < worst.kmPerLitre) worst = leg;
        }
        const mileageFlag =
          worst && avgKmPerLitre && legs.length >= 3 && worst.kmPerLitre < avgKmPerLitre * 0.8 ? worst : null;

        return {
          vehicle,
          fills: fills.length,
          litres,
          spend,
          avgRate,
          avgKmPerLitre,
          distanceTotal,
          legs: legs.length,
          badReadings,
          dearFlag,
          mileageFlag,
        };
      })
      .filter(Boolean);
  }, [vehicles, expensesByVehicle]);

  // All vehicle-tagged expenses, across every vehicle — this is what the
  // consolidated Vehicle Expense Sheet below shows and edits.
  const vehicleExpenseRows = useMemo(() => expenses.filter((e) => e.vehicleId), [expenses]);
  const vehicleExpenseTotal = useMemo(
    () => vehicleExpenseRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
    [vehicleExpenseRows]
  );

  const handleExportVehicleCsv = () => {
    if (vehicleExpenseRows.length === 0) {
      notifyError("No vehicle expenses to export yet");
      return;
    }
    downloadCsv(
      `${FILE_PREFIX}-vehicles-${todayStr()}.csv`,
      [
        { key: "date", label: "Date" },
        { key: "vehicle", label: "Vehicle" },
        { key: "expense", label: "Expense" },
        { key: "amount", label: "Amount (INR)" },
        { key: "master", label: "Master" },
      ],
      vehicleExpenseRows.map((r) => ({
        date: r.date ? new Date(r.date).toLocaleDateString("en-IN") : "",
        vehicle: vehiclesById.get(r.vehicleId)?.name || "",
        expense: r.expense,
        amount: r.amount,
        master: r.master,
      }))
    );
  };

  // Masters actually present among logged vehicle expenses — keeps the filter
  // dropdown relevant instead of showing every preset category.
  const presentExpenseMasters = useMemo(() => {
    const set = new Set(vehicleExpenseRows.map((r) => r.master).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [vehicleExpenseRows]);

  // Suggestions drawn from what's already logged against vehicles.
  const vehicleExpenseSuggestions = useMemo(
    () => Array.from(new Set(vehicleExpenseRows.map((r) => r.expense).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [vehicleExpenseRows]
  );
  const vehicleSearchSuggestions = useMemo(
    () =>
      Array.from(
        new Set([
          ...vehicleExpenseSuggestions,
          ...presentExpenseMasters,
          ...vehicles.map((v) => v.name).filter(Boolean),
        ])
      ),
    [vehicleExpenseSuggestions, presentExpenseMasters, vehicles]
  );

  const filteredVehicleExpenseRows = useMemo(() => {
    const q = expenseSearch.trim().toLowerCase();
    const expenseQ = filterExpenseText.trim().toLowerCase();
    return vehicleExpenseRows.filter((r) => {
      if (q) {
        const matches =
          (r.expense || "").toLowerCase().includes(q) ||
          (r.master || "").toLowerCase().includes(q) ||
          (vehiclesById.get(r.vehicleId)?.name || "").toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (expenseQ && !(r.expense || "").toLowerCase().includes(expenseQ)) return false;
      if (filterVehicleId && r.vehicleId !== filterVehicleId) return false;
      if (filterExpenseMasters.length > 0 && !filterExpenseMasters.includes(r.master)) return false;
      if (filterExpenseDateFrom && (!r.date || new Date(r.date) < new Date(filterExpenseDateFrom))) return false;
      if (filterExpenseDateTo && (!r.date || new Date(r.date) > new Date(filterExpenseDateTo))) return false;
      return true;
    });
  }, [
    vehicleExpenseRows,
    expenseSearch,
    vehiclesById,
    filterVehicleId,
    filterExpenseText,
    filterExpenseMasters,
    filterExpenseDateFrom,
    filterExpenseDateTo,
  ]);

  // --- Selecting rows for bulk delete (18 Sep, per Rishi: "add multi
  // deletation in vehicle and labor wages page just like the feature that we
  // added in the expense sheets") — same pattern as Expenses.jsx: selection
  // is by row id, "select all" means all rows currently VISIBLE, and the
  // server's actually-deleted list is what removes rows from state. -------
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const toggleSelected = (id) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const visibleIds = useMemo(() => filteredVehicleExpenseRows.map((r) => r._id), [filteredVehicleExpenseRows]);
  const selectedVisibleCount = useMemo(
    () => visibleIds.filter((id) => selectedIds.has(id)).length,
    [visibleIds, selectedIds]
  );
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;

  const toggleSelectAllVisible = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });

  const clearSelection = () => {
    setSelectedIds(new Set());
    setConfirmingBulkDelete(false);
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBulkDeleting(true);
    try {
      const result = await bulkDeleteExpenses(ids);
      const gone = new Set(result.deletedIds || ids);
      setExpenses((prev) => prev.filter((e) => !gone.has(e._id)));
      clearSelection();
      notifySuccess(result.message || `${gone.size} entries deleted`);
      const stale = (result.skipped?.notFound || []).length;
      if (stale) notifyError(`${stale} of those had already been removed`);
    } catch (err) {
      notifyError(err.message || "Failed to delete those entries");
    } finally {
      setBulkDeleting(false);
    }
  };

  const groupedExpenseRows = useMemo(() => {
    if (expenseGroupBy === "none") return null;
    const groups = new Map();
    for (const r of filteredVehicleExpenseRows) {
      let key;
      if (expenseGroupBy === "date") {
        key = r.date ? new Date(r.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "No date";
      } else if (expenseGroupBy === "vehicle") {
        key = vehiclesById.get(r.vehicleId)?.name || "Unknown vehicle";
      } else {
        key = r.master || "Uncategorized";
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const entries = Array.from(groups.entries()).map(([key, items]) => ({
      key,
      items,
      total: items.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    }));
    if (expenseGroupBy === "master" || expenseGroupBy === "vehicle") entries.sort((a, b) => b.total - a.total);
    return entries;
  }, [filteredVehicleExpenseRows, expenseGroupBy, vehiclesById]);

  const toggleExpenseGroup = (key) => {
    setCollapsedExpenseGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ================= Consolidated Vehicle Expense Sheet =================
  const setExpenseDraftField = (field, value) => setExpenseDraft((d) => ({ ...d, [field]: value }));

  // Master's field used to commit on its OWN blur, same bug class fixed
  // elsewhere in the app: for a fuel master, Litres comes right after
  // Master, so clicking from Master into Litres fired the save before
  // Litres/Odometer were ever typed — silently dropping data the fuel-cheat
  // detection depends on. Fixed 18 Sep by moving the commit to the row
  // itself, checked a tick after blur (real focus, not the field's own
  // blur event) — same fix as Labor Wages / Manage Data's useRowCommit.
  const expenseDraftRowRef = useRef(null);
  const handleExpenseDraftRowBlur = () => {
    setTimeout(() => {
      if (expenseDraftRowRef.current && !expenseDraftRowRef.current.contains(document.activeElement)) {
        commitExpenseDraftIfReady();
      }
    }, 0);
  };

  const commitExpenseDraftIfReady = async () => {
    if (!expenseDraft.vehicleId || !expenseDraft.expense.trim() || !expenseDraft.amount || !expenseDraft.master.trim()) return;

    // Checked against EVERY expense, not just vehicle-tagged ones — the common
    // mistake is the same spend already sitting untagged on the main sheet.
    const duplicate = findPossibleDuplicate(expenseDraft, expenses);
    if (duplicate) {
      const vehicleName = duplicate.vehicleId ? vehiclesById.get(duplicate.vehicleId)?.name : null;
      if (!window.confirm(duplicateWarning(duplicate, vehicleName))) return;
    }

    try {
      setSavingExpenseDraft(true);
      const saved = await addExpense({
        date: expenseDraft.date,
        expense: expenseDraft.expense.trim(),
        amount: Number(expenseDraft.amount),
        master: expenseDraft.master.trim(),
        bill: expenseDraft.billFileObj || undefined,
        vehicleId: expenseDraft.vehicleId,
        litres: isFuelMaster(expenseDraft.master) ? expenseDraft.litres : "",
        odometer: isFuelMaster(expenseDraft.master) ? expenseDraft.odometer : "",
      });
      setExpenses((prev) => [saved, ...prev]);
      // Keep the vehicle selected — logging several expenses for the same
      // truck in a row is the common case, so only the rest of the row resets.
      setExpenseDraft({ ...emptyExpenseDraft(), vehicleId: expenseDraft.vehicleId });
      notifySuccess("Expense added");
      focusExpenseCell("draft", "expense");
    } catch (err) {
      notifyError(err.message || "Failed to add expense");
    } finally {
      setSavingExpenseDraft(false);
    }
  };

  const updateExpenseField = (id, field, value) => {
    setExpenses((prev) => prev.map((e) => (e._id === id ? { ...e, [field]: value } : e)));
  };

  const saveExpenseRow = async (id) => {
    const row = expenses.find((e) => e._id === id);
    if (!row) return;
    if (!row.vehicleId || !row.expense || !row.amount || !row.master) {
      notifyError("Vehicle, expense, amount and master can't be left blank");
      loadData();
      return;
    }
    try {
      await updateExpense(id, {
        date: row.date,
        expense: row.expense,
        amount: Number(row.amount),
        master: row.master,
        vehicleId: row.vehicleId,
        litres: isFuelMaster(row.master) ? row.litres ?? "" : "",
        odometer: isFuelMaster(row.master) ? row.odometer ?? "" : "",
      });
    } catch (err) {
      notifyError(err.message || "Failed to save that change");
      loadData();
    }
  };

  const handleExpenseRowBillChange = async (id, file) => {
    if (!file) return;
    try {
      const updated = await updateExpense(id, { bill: file });
      setExpenses((prev) => prev.map((e) => (e._id === id ? updated : e)));
      notifySuccess("Bill attached");
    } catch (err) {
      notifyError(err.message || "Failed to attach bill");
    }
  };

  const handleDeleteExpenseRow = async (id) => {
    try {
      await deleteExpense(id);
      setExpenses((prev) => prev.filter((e) => e._id !== id));
      notifySuccess("Row deleted");
    } catch (err) {
      notifyError(err.message || "Failed to delete row");
    }
  };

  // One row of the Vehicle Expense Sheet — same look/behavior as the main
  // Expense Sheet's row, plus an editable Vehicle picker.
  const renderExpenseRow = (row) => (
    <tr
      key={row._id}
      className={selectedIds.has(row._id) ? "bg-red-50/60 dark:bg-red-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-900"}
    >
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={selectedIds.has(row._id)}
          onChange={() => toggleSelected(row._id)}
          aria-label="Select this row"
          className="h-4 w-4 accent-red-600 cursor-pointer align-middle"
        />
      </td>
      <td className="px-2 py-2">
        <input
          ref={setExpenseCellRef(row._id, "date")}
          type="date"
          value={row.date ? new Date(row.date).toISOString().split("T")[0] : ""}
          onChange={(e) => updateExpenseField(row._id, "date", e.target.value)}
          onBlur={() => saveExpenseRow(row._id)}
          onKeyDown={(e) => handleExpenseCellKeyDown(e, row._id, "date", { isDraft: false })}
          className="w-full border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
        />
      </td>
      <td className="px-2 py-2">
        <select
          ref={setExpenseCellRef(row._id, "vehicleId")}
          value={row.vehicleId || ""}
          onChange={(e) => {
            updateExpenseField(row._id, "vehicleId", e.target.value);
            setTimeout(() => saveExpenseRow(row._id), 0);
          }}
          onKeyDown={(e) => handleExpenseCellKeyDown(e, row._id, "vehicleId", { isDraft: false })}
          className="w-full border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-transparent"
        >
          <option value="" disabled>
            Select vehicle
          </option>
          {vehicles.map((v) => (
            <option key={v._id} value={v._id}>
              {v.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2">
        <input
          ref={setExpenseCellRef(row._id, "expense")}
          type="text"
          value={row.expense}
          onChange={(e) => updateExpenseField(row._id, "expense", e.target.value)}
          onBlur={() => saveExpenseRow(row._id)}
          onKeyDown={(e) => handleExpenseCellKeyDown(e, row._id, "expense", { isDraft: false })}
          className="w-full border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
        />
      </td>
      <td className="px-2 py-2">
        <input
          ref={setExpenseCellRef(row._id, "amount")}
          type="number"
          value={row.amount}
          onChange={(e) => updateExpenseField(row._id, "amount", e.target.value)}
          onBlur={() => saveExpenseRow(row._id)}
          onKeyDown={(e) => handleExpenseCellKeyDown(e, row._id, "amount", { isDraft: false })}
          min="0"
          step="0.01"
          className="w-full border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-red-400"
        />
      </td>
      <td className="px-2 py-2">
        <MasterAutocomplete
          inputRef={setExpenseCellRef(row._id, "master")}
          value={row.master}
          masters={masters}
          catalog={masterCatalog}
          onCatalogChange={reloadAfterMasterChange}
          onChange={(value) => updateExpenseField(row._id, "master", value)}
          onBlur={() => saveExpenseRow(row._id)}
          onKeyDown={(e) => handleExpenseCellKeyDown(e, row._id, "master", { isDraft: false })}
          className="w-full border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
        />
      </td>
      <td className="px-2 py-2">
        {isFuelMaster(row.master) ? (
          <>
            <input
              ref={setExpenseCellRef(row._id, "litres")}
              type="number"
              value={row.litres ?? ""}
              onChange={(e) => updateExpenseField(row._id, "litres", e.target.value)}
              onBlur={() => saveExpenseRow(row._id)}
              onKeyDown={(e) => handleExpenseCellKeyDown(e, row._id, "litres", { isDraft: false })}
              min="0"
              step="0.01"
              placeholder="0"
              className="w-full border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-red-400"
            />
            {ratePerLitre(row) && (
              <span className="block text-right text-[10px] text-gray-400 dark:text-gray-500 pr-2">
                ₹{ratePerLitre(row).toFixed(1)}/L
              </span>
            )}
          </>
        ) : (
          <span className="block text-center text-gray-300 dark:text-gray-500 text-sm">—</span>
        )}
      </td>
      <td className="px-2 py-2">
        {isFuelMaster(row.master) ? (
          <input
            ref={setExpenseCellRef(row._id, "odometer")}
            type="number"
            value={row.odometer ?? ""}
            onChange={(e) => updateExpenseField(row._id, "odometer", e.target.value)}
            onBlur={() => saveExpenseRow(row._id)}
            onKeyDown={(e) => handleExpenseCellKeyDown(e, row._id, "odometer", { isDraft: false })}
            min="0"
            step="1"
            placeholder="km"
            className="w-full border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-red-400"
          />
        ) : (
          <span className="block text-center text-gray-300 dark:text-gray-500 text-sm">—</span>
        )}
      </td>
      <td className="px-2 py-2 text-center">
        {row.billFile ? (
          <a
            href={fileUrl(row.billFile)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
            title="View bill"
          >
            <FiPaperclip size={16} />
          </a>
        ) : (
          <label className="inline-flex items-center justify-center cursor-pointer text-gray-300 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400" title="Attach a bill">
            <FiPaperclip size={16} />
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => handleExpenseRowBillChange(row._id, e.target.files?.[0])}
            />
          </label>
        )}
      </td>
      <td className="px-2 py-2 text-center">
        <button onClick={() => handleDeleteExpenseRow(row._id)} className="text-gray-300 dark:text-gray-500 hover:text-red-600" title="Delete row">
          <FiTrash2 size={16} />
        </button>
      </td>
    </tr>
  );

  return (
    <div className="p-4 sm:p-6 lg:px-12">
      <ToastContainer />
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-gray-100 mb-1">Vehicles</h1>
          <p className="text-gray-600 dark:text-gray-300 text-sm sm:text-base">
            Log fuel, service and other vehicle expenses below. To add, edit or remove a vehicle itself — or its RC/
            insurance documents — head to{" "}
            <Link to="/dashboard/manage-data" className="text-red-600 hover:underline font-medium">
              Manage Data
            </Link>
            .
          </p>
        </div>

        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.key
                  ? "border-red-500 text-red-600 dark:text-red-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "report" && (
        <>
        {/* Category-wise breakdown — one row per vehicle, one dedicated column per master */}
        {!loading && vehicles.length > 0 && (
          <div className="bg-white dark:bg-gray-800 shadow-lg rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-8">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-700 dark:text-gray-200">Expense Breakdown by Category</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">All-time totals per vehicle — anything logged under a different master falls into "Other"</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase sticky left-0 bg-gray-50 dark:bg-gray-900 w-40">Vehicle</th>
                    {VEHICLE_BREAKDOWN_MASTERS.map((m) => (
                      <th key={m} className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">
                        {m}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">Other</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-700 dark:text-gray-200 uppercase whitespace-nowrap">Total</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {breakdownRows.map(({ vehicle, byMaster, other, total }) => (
                    <tr key={vehicle._id} className="hover:bg-gray-50 dark:hover:bg-gray-900">
                      <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap sticky left-0 bg-white dark:bg-gray-800">{vehicle.name}</td>
                      {VEHICLE_BREAKDOWN_MASTERS.map((m) => (
                        <td key={m} className="px-3 py-2 text-right text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {byMaster[m] > 0 ? formatCurrency(byMaster[m]) : <span className="text-gray-300 dark:text-gray-500">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300 whitespace-nowrap">
                        {other > 0 ? formatCurrency(other) : <span className="text-gray-300 dark:text-gray-500">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-red-600 whitespace-nowrap">{formatCurrency(total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <td className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap sticky left-0 bg-gray-50 dark:bg-gray-900">Grand Total</td>
                    {VEHICLE_BREAKDOWN_MASTERS.map((m) => (
                      <td key={m} className="px-3 py-2.5 text-right font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">
                        {breakdownGrandTotals.byMaster[m] > 0 ? formatCurrency(breakdownGrandTotals.byMaster[m]) : <span className="text-gray-300 dark:text-gray-500">—</span>}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">
                      {breakdownGrandTotals.other > 0 ? formatCurrency(breakdownGrandTotals.other) : <span className="text-gray-300 dark:text-gray-500">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold text-red-600 whitespace-nowrap">{formatCurrency(breakdownGrandTotals.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Fuel panel — rate paid per litre, and distance actually covered on it */}
        {fuelSummary.length > 0 && (
          <div className="bg-white dark:bg-gray-800 shadow-lg rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-8">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-700 dark:text-gray-200">Fuel &amp; Mileage</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Rate flags a fill more than 15% above a vehicle's own average — usually an inflated
                bill. Mileage flags a run more than 20% below its average — that's fuel going
                somewhere other than the engine. Mileage needs an odometer reading on every fill.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-36">Vehicle</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Fills</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Litres</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Spend</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-700 dark:text-gray-200 uppercase">Avg Rate</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Distance</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-700 dark:text-gray-200 uppercase">Mileage</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Flags</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {fuelSummary.map((f) => (
                    <tr key={f.vehicle._id} className="hover:bg-gray-50 dark:hover:bg-gray-900">
                      <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">{f.vehicle.name}</td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{f.fills}</td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300 tabular-nums">{f.litres.toFixed(1)} L</td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300 tabular-nums">{formatCurrency(f.spend)}</td>
                      <td className="px-3 py-2 text-right font-bold text-gray-800 dark:text-gray-100 tabular-nums">
                        ₹{f.avgRate.toFixed(2)}/L
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300 tabular-nums">
                        {f.distanceTotal > 0 ? `${f.distanceTotal.toLocaleString("en-IN")} km` : <span className="text-gray-300 dark:text-gray-500">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-gray-800 dark:text-gray-100 tabular-nums">
                        {f.avgKmPerLitre ? (
                          `${f.avgKmPerLitre.toFixed(2)} km/L`
                        ) : (
                          <span className="font-normal text-xs text-gray-400 dark:text-gray-500">needs odometer</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs space-y-1">
                        {f.dearFlag && (
                          <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400 font-medium">
                            <FiAlertTriangle size={13} className="shrink-0" />
                            ₹{f.dearFlag.rate.toFixed(2)}/L on{" "}
                            {f.dearFlag.row.date ? new Date(f.dearFlag.row.date).toLocaleDateString("en-IN") : "—"}
                          </span>
                        )}
                        {f.mileageFlag && (
                          <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400 font-medium">
                            <FiAlertTriangle size={13} className="shrink-0" />
                            {f.mileageFlag.kmPerLitre.toFixed(2)} km/L on{" "}
                            {f.mileageFlag.row.date ? new Date(f.mileageFlag.row.date).toLocaleDateString("en-IN") : "—"}
                          </span>
                        )}
                        {f.badReadings > 0 && (
                          <span className="block text-amber-600 dark:text-amber-400">
                            {f.badReadings} odometer reading{f.badReadings === 1 ? "" : "s"} lower than the one before — check for typos
                          </span>
                        )}
                        {!f.dearFlag && !f.mileageFlag && !f.badReadings && (
                          <span className="text-gray-400 dark:text-gray-500">Nothing unusual</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </>
        )}

        {tab === "sheet" && (
        <>
        {/* Consolidated Vehicle Expense Sheet — every vehicle's expenses, one sheet, same feel as the main Expense Sheet */}
        <div className="mb-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Vehicle Expense Sheet</h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm">Type straight into the sheet — pick a vehicle, it saves as you go</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-md">
                <span className="block text-xs text-gray-500 dark:text-gray-400">Total</span>
                <span className="text-xl font-bold text-red-600">{formatCurrency(vehicleExpenseTotal)}</span>
              </div>
              <button
                onClick={() => setShowVehicleImportModal(true)}
                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2.5 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center text-sm font-medium"
              >
                <FiUploadCloud size={17} className="mr-2" /> Import
              </button>
              <button
                onClick={handleExportVehicleCsv}
                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2.5 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center text-sm font-medium"
                title="Download as a .csv file (opens in Excel or Google Sheets)"
              >
                <FiDownload size={17} className="mr-2" /> Download CSV
              </button>
              <button
                onClick={() => setShowVehicleExportModal(true)}
                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2.5 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center text-sm font-medium"
              >
                <FiGrid size={17} className="mr-2" /> Share Sheet
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <FiSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <SuggestInput
                inputRef={setExpenseFilterRef("search")}
                value={expenseSearch}
                onChange={setExpenseSearch}
                onKeyDown={(e) => handleExpenseFilterKeyDown(e, "search")}
                options={vehicleSearchSuggestions}
                placeholder="Search by expense, master or vehicle..."
                className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg pl-9 pr-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
            <button
              onClick={() => setShowExpenseFilters((v) => !v)}
              className={`flex items-center gap-2 border rounded-lg shadow-sm px-3 py-2.5 text-sm font-medium ${
                showExpenseFilters || activeExpenseFilterCount > 0
                  ? "bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300"
                  : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-900"
              }`}
            >
              <FiFilter size={15} />
              Filters
              {activeExpenseFilterCount > 0 && (
                <span className="bg-red-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {activeExpenseFilterCount}
                </span>
              )}
            </button>
            <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm px-3 py-2.5">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">Group by</span>
              <select
                value={expenseGroupBy}
                onChange={(e) => setExpenseGroupBy(e.target.value)}
                className="text-sm text-gray-700 dark:text-gray-200 focus:outline-none bg-transparent"
              >
                <option value="none">None</option>
                <option value="date">Date</option>
                <option value="master">Master</option>
                <option value="vehicle">Vehicle</option>
              </select>
            </div>
          </div>

          {showExpenseFilters && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm p-4 mb-4">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Expense</label>
                  <SuggestInput
                    inputRef={setExpenseFilterRef("expense")}
                    value={filterExpenseText}
                    onChange={setFilterExpenseText}
                    onKeyDown={(e) => handleExpenseFilterKeyDown(e, "expense")}
                    options={vehicleExpenseSuggestions}
                    placeholder="Any expense..."
                    className="border border-gray-300 dark:border-gray-600 dark:bg-gray-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 min-w-[11rem]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Vehicle</label>
                  <select
                    ref={setExpenseFilterRef("vehicle")}
                    value={filterVehicleId}
                    onChange={(e) => setFilterVehicleId(e.target.value)}
                    onKeyDown={(e) => handleExpenseFilterKeyDown(e, "vehicle")}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 min-w-[9rem]"
                  >
                    <option value="">All vehicles</option>
                    {vehicles.map((v) => (
                      <option key={v._id} value={v._id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Master</label>
                  <MasterMultiSelect
                    inputRef={setExpenseFilterRef("master")}
                    onKeyDown={(e) => handleExpenseFilterKeyDown(e, "master")}
                    options={presentExpenseMasters}
                    selected={filterExpenseMasters}
                    onChange={setFilterExpenseMasters}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From date</label>
                  <input
                    ref={setExpenseFilterRef("from")}
                    type="date"
                    value={filterExpenseDateFrom}
                    onChange={(e) => setFilterExpenseDateFrom(e.target.value)}
                    onKeyDown={(e) => handleExpenseFilterKeyDown(e, "from")}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">To date</label>
                  <input
                    ref={setExpenseFilterRef("to")}
                    type="date"
                    value={filterExpenseDateTo}
                    onChange={(e) => setFilterExpenseDateTo(e.target.value)}
                    onKeyDown={(e) => handleExpenseFilterKeyDown(e, "to")}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </div>
                {activeExpenseFilterCount > 0 && (
                  <button
                    onClick={clearExpenseFilters}
                    className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-red-600 font-medium pb-2"
                  >
                    <FiXCircle size={15} />
                    Clear filters
                  </button>
                )}
              </div>
            </div>
          )}

          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 bg-red-50 dark:bg-red-900/25 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 mb-3">
              <span className="text-sm font-medium text-red-800 dark:text-red-200">
                {selectedIds.size} {selectedIds.size === 1 ? "entry" : "entries"} selected
              </span>

              {confirmingBulkDelete ? (
                <>
                  <span className="text-sm text-red-700 dark:text-red-300">
                    Delete {selectedIds.size === 1 ? "it" : "them"} permanently?
                  </span>
                  <button
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting}
                    className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-3 py-1.5"
                  >
                    <FiTrash2 size={14} />
                    {bulkDeleting ? "Deleting…" : "Yes, delete"}
                  </button>
                  <button
                    onClick={() => setConfirmingBulkDelete(false)}
                    disabled={bulkDeleting}
                    className="text-sm text-gray-600 dark:text-gray-300 hover:underline"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setConfirmingBulkDelete(true)}
                    className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg px-3 py-1.5"
                  >
                    <FiTrash2 size={14} />
                    Delete selected
                  </button>
                  <button onClick={clearSelection} className="text-sm text-gray-600 dark:text-gray-300 hover:underline">
                    Clear selection
                  </button>
                </>
              )}
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 shadow-lg rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {loading ? (
              <div className="flex justify-center items-center h-40">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-red-500"></div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-3 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = selectedVisibleCount > 0 && !allVisibleSelected;
                          }}
                          onChange={toggleSelectAllVisible}
                          aria-label="Select all visible rows"
                          title="Select everything currently shown"
                          className="h-4 w-4 accent-red-600 cursor-pointer align-middle"
                        />
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-36">Date</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-40">Vehicle</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Expense</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-28">Amount</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-44">Master</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-24">Litres</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-28">Odometer</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-16">Bill</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {/* Draft row — always present, regardless of search/grouping */}
                    <tr ref={expenseDraftRowRef} onBlur={handleExpenseDraftRowBlur} className="bg-blue-50/40 dark:bg-blue-900/20">
                      <td className="px-3 py-2"></td>
                      <td className="px-2 py-2">
                        <input
                          ref={setExpenseCellRef("draft", "date")}
                          type="date"
                          value={expenseDraft.date}
                          onChange={(e) => setExpenseDraftField("date", e.target.value)}
                          onKeyDown={(e) => handleExpenseCellKeyDown(e, "draft", "date", { isDraft: true })}
                          className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          ref={setExpenseCellRef("draft", "vehicleId")}
                          value={expenseDraft.vehicleId}
                          onChange={(e) => setExpenseDraftField("vehicleId", e.target.value)}
                          onKeyDown={(e) => handleExpenseCellKeyDown(e, "draft", "vehicleId", { isDraft: true })}
                          className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white dark:bg-gray-800"
                        >
                          <option value="" disabled>
                            Select vehicle
                          </option>
                          {vehicles.map((v) => (
                            <option key={v._id} value={v._id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          ref={setExpenseCellRef("draft", "expense")}
                          type="text"
                          value={expenseDraft.expense}
                          onChange={(e) => setExpenseDraftField("expense", e.target.value)}
                          onKeyDown={(e) => handleExpenseCellKeyDown(e, "draft", "expense", { isDraft: true })}
                          placeholder="E.g., Diesel refill"
                          className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          ref={setExpenseCellRef("draft", "amount")}
                          type="number"
                          value={expenseDraft.amount}
                          onChange={(e) => setExpenseDraftField("amount", e.target.value)}
                          onKeyDown={(e) => handleExpenseCellKeyDown(e, "draft", "amount", { isDraft: true })}
                          placeholder="0"
                          min="0"
                          step="0.01"
                          className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-red-400"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <MasterAutocomplete
                          inputRef={setExpenseCellRef("draft", "master")}
                          value={expenseDraft.master}
                          masters={masters}
                          catalog={masterCatalog}
                          onCatalogChange={reloadAfterMasterChange}
                          onChange={(value) => setExpenseDraftField("master", value)}
                          onKeyDown={(e) => handleExpenseCellKeyDown(e, "draft", "master", { isDraft: true })}
                          placeholder="E.g., Fuel & Diesel"
                          className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                        />
                      </td>
                      <td className="px-2 py-2">
                        {isFuelMaster(expenseDraft.master) ? (
                          <input
                            ref={setExpenseCellRef("draft", "litres")}
                            type="number"
                            value={expenseDraft.litres}
                            onChange={(e) => setExpenseDraftField("litres", e.target.value)}
                            onKeyDown={(e) => handleExpenseCellKeyDown(e, "draft", "litres", { isDraft: true })}
                            placeholder="0"
                            min="0"
                            step="0.01"
                            className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-red-400"
                          />
                        ) : (
                          <span className="block text-center text-gray-300 dark:text-gray-500 text-sm">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <label className="inline-flex items-center justify-center cursor-pointer text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400" title="Attach a bill">
                          <FiPaperclip size={16} className={expenseDraft.billFileObj ? "text-blue-600 dark:text-blue-400" : ""} />
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            className="hidden"
                            onChange={(e) => setExpenseDraftField("billFileObj", e.target.files?.[0] || null)}
                          />
                        </label>
                      </td>
                      <td className="px-2 py-2 text-center text-gray-300 dark:text-gray-500">
                        {savingExpenseDraft ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-red-500 mx-auto"></div>
                        ) : (
                          <FiPlus size={16} className="mx-auto" />
                        )}
                      </td>
                    </tr>

                    {filteredVehicleExpenseRows.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-4 py-10 text-center text-gray-400 dark:text-gray-500">
                          {vehicleExpenseRows.length === 0
                            ? vehicles.length === 0
                              ? "Add a vehicle above first, then log its expenses here."
                              : "No vehicle expenses yet — start typing in the row above."
                            : "No expenses match your search/filters."}
                        </td>
                      </tr>
                    )}

                    {/* Flat list, or grouped by Date/Master/Vehicle */}
                    {groupedExpenseRows === null
                      ? filteredVehicleExpenseRows.map(renderExpenseRow)
                      : groupedExpenseRows.map((group) => {
                          const isCollapsed = collapsedExpenseGroups.has(group.key);
                          return (
                            <React.Fragment key={group.key}>
                              <tr className="bg-gray-100 dark:bg-gray-800 cursor-pointer select-none" onClick={() => toggleExpenseGroup(group.key)}>
                                <td colSpan={10} className="px-3 py-2">
                                  <div className="flex items-center justify-between">
                                    <span className="flex items-center font-semibold text-gray-700 dark:text-gray-200 text-sm">
                                      {isCollapsed ? <FiChevronRight size={14} className="mr-1.5" /> : <FiChevronDown size={14} className="mr-1.5" />}
                                      {group.key}
                                      <span className="ml-2 font-normal text-gray-400 dark:text-gray-500 text-xs">
                                        ({group.items.length} {group.items.length === 1 ? "entry" : "entries"})
                                      </span>
                                    </span>
                                    <span className="font-bold text-red-600 text-sm">{formatCurrency(group.total)}</span>
                                  </div>
                                </td>
                              </tr>
                              {!isCollapsed && group.items.map(renderExpenseRow)}
                            </React.Fragment>
                          );
                        })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        </>
        )}

        {showVehicleImportModal && (
          <ImportSheetModal
            title="Import Vehicle Expenses"
            onClose={() => setShowVehicleImportModal(false)}
            onImported={() => {
              setShowVehicleImportModal(false);
              setImportVehicleId("");
              loadData();
            }}
            previewFile={previewImportSheet}
            previewSheet={previewFromGoogleSheet}
            onCommit={(rows) => {
              if (!importVehicleId) throw new Error("Pick which vehicle these rows belong to first");
              return bulkAddExpenses(rows.map((r) => ({ ...r, vehicleId: importVehicleId })));
            }}
            commitNoun="Rows"
            extraControls={
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Which vehicle do these rows belong to?
                </label>
                <select
                  value={importVehicleId}
                  onChange={(e) => setImportVehicleId(e.target.value)}
                  className="border border-gray-300 dark:border-gray-600 dark:bg-gray-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 min-w-[12rem]"
                >
                  <option value="">Select a vehicle...</option>
                  {vehicles.map((v) => (
                    <option key={v._id} value={v._id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            }
            headerCells={
              <>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Expense</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Master</th>
              </>
            }
            renderRow={(r) => (
              <>
                <td className="px-3 py-2 whitespace-nowrap">{r.date}</td>
                <td className="px-3 py-2">{r.expense}</td>
                <td className="px-3 py-2 text-right">{r.amount ?? "—"}</td>
                <td className="px-3 py-2">{r.master}</td>
              </>
            )}
          />
        )}

        {showVehicleExportModal && (
          <ExportSheetModal
            title="Share the Vehicle Expense Sheet"
            onClose={() => setShowVehicleExportModal(false)}
            fetchStatus={fetchSheetsStatus}
            onEmail={(email, note) => emailExpenseSheet(email, note, "vehicles")}
            onExport={(sheetUrl) => exportToGoogleSheet(sheetUrl, "vehicles")}
            emailDescription='Sends every vehicle-tagged expense as a spreadsheet attachment. No setup needed at the other end — in Gmail they can click the file and choose "Open with Google Sheets".'
            sheetDescription="For a Sheet you want kept up to date in place. Paste the link of a Google Sheet shared with the app's service account as an Editor — its contents get replaced with the vehicle expense sheet."
          />
        )}
      </div>
    </div>
  );
};

export default Vehicles;
