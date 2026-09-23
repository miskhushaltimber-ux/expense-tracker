import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchExpenses,
  addExpense,
  updateExpense,
  deleteExpense,
  bulkAddExpenses,
  bulkDeleteExpenses,
} from "/src/api/expenses";
import { bulkAddPayments } from "/src/api/labour";
import { fetchMasterCatalog } from "/src/api/masters";
import { previewImportSheet } from "/src/api/imports";
import { fetchSheetsStatus, exportToGoogleSheet, previewFromGoogleSheet, emailExpenseSheet, downloadExpenseSheetXlsx } from "/src/api/sheets";
import { API_BASE_URL } from "/src/api/config";
import { DEFAULT_EXPENSE_MASTERS } from "/src/constants/categories";
import { FILE_PREFIX } from "/src/constants/brand";
import { downloadCsv } from "/src/utils/exportCsv";
import MasterAutocomplete from "/src/components/MasterAutocomplete";
import { CustomCell, ManageColumnsButton } from "/src/components/CustomColumns";
import { fetchColumns } from "/src/api/columns";
import AlertsStrip, { buildExpenseAlerts, buildBudgetAlerts } from "/src/components/AlertsStrip";
import { fetchBudgets, saveBudgets } from "/src/api/budgets";
import SuggestInput from "/src/components/SuggestInput";
import MasterMultiSelect from "/src/components/MasterMultiSelect";
import DownloadMenu from "/src/components/DownloadMenu";
import { fetchVehicles } from "/src/api/vehicles";
import { looksLikeVehicleExpense, findPossibleDuplicate, duplicateWarning } from "/src/utils/vehicleExpense";
import {
  FiPlus,
  FiTrash2,
  FiPaperclip,
  FiUploadCloud,
  FiGrid,
  FiX,
  FiCheck,
  FiSearch,
  FiChevronDown,
  FiChevronRight,
  FiFilter,
  FiXCircle,
} from "react-icons/fi";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const SERVER_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

// Bills now live in cloud storage, so billFile is usually a full https URL.
// Older rows still hold a "/uploads/..." path from when files were saved on
// the server's own disk — those keep resolving against the API origin.
const billUrl = (billFile) => {
  if (!billFile) return null;
  return billFile.startsWith("http") ? billFile : `${SERVER_ORIGIN}${billFile}`;
};

const todayStr = () => new Date().toISOString().split("T")[0];

const emptyDraft = () => ({ date: todayStr(), expense: "", amount: "", master: "", billFileObj: null, customFields: {} });

const notifySuccess = (message) => toast.success(message, { position: "top-right", autoClose: 3000 });
const notifyError = (message) => toast.error(message, { position: "top-right", autoClose: 4000 });

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    amount || 0
  );

// Column order used for Tab/Enter navigation across a sheet row — pressing
// Enter in any of these fields jumps to the next one, spreadsheet-style,
// instead of doing nothing/submitting immediately.
const FIELD_ORDER = ["date", "expense", "amount", "master"];

// Draft row, isolated into its own component (21 Sep, per Rishi: "it is
// lagging way too much when i enter any data in it"). `draft` state used to
// live in the Expenses component itself, right next to the full `rows` list
// (potentially hundreds of entries by now) — every keystroke re-rendered the
// WHOLE sheet, existing rows included, which is what got slower as the sheet
// grew. Typing now only re-renders this one row; the rest of the sheet is
// completely untouched by it. `cellRefs`/`handleCellKeyDown`/`focusCell` stay
// in the parent since existing rows share that same Tab/Enter-navigation
// mechanism — only the draft's own state and commit logic moved.
const DraftRow = ({
  masters,
  masterCatalog,
  reloadAfterMasterChange,
  customColumns,
  renderBudgetCell,
  rows,
  vehicles,
  setRows,
  askForVehicle,
  setCellRef,
  handleCellKeyDown,
  focusCell,
}) => {
  const [draft, setDraft] = useState(emptyDraft());
  const [savingDraft, setSavingDraft] = useState(false);

  const handleDraftChange = (field, value) => setDraft((d) => ({ ...d, [field]: value }));
  const handleDraftCustomFieldChange = (colDef, value) => {
    setDraft((d) => ({ ...d, customFields: { ...d.customFields, [colDef.key]: value } }));
  };

  const commitDraftIfReady = async () => {
    if (!draft.expense.trim() || !draft.amount || !draft.master.trim()) return;

    // Same money, same day, same master as something already in the sheet —
    // usually a re-entry rather than a genuine second spend.
    const duplicate = findPossibleDuplicate(draft, rows);
    if (duplicate) {
      const vehicleName = duplicate.vehicleId
        ? vehicles.find((v) => v._id === duplicate.vehicleId)?.name
        : null;
      if (!window.confirm(duplicateWarning(duplicate, vehicleName))) return;
    }

    // A vehicle-shaped expense typed here would otherwise never reach the
    // vehicle totals, and would likely get entered a second time on the
    // Vehicles page. Offer to tag it now so it's only ever entered once.
    let vehicleId;
    if (vehicles.length > 0 && looksLikeVehicleExpense(draft)) {
      vehicleId = await askForVehicle(draft);
      if (vehicleId === "cancelled") return;
    }

    // Optimistic insert (22 Sep, per Rishi: "whenever i give input in the
    // sheet manually and hit enter to add it in the expenses it loads
    // almost 1-2 seconds... make it fast as f***"). The row used to only
    // appear — and the draft only clear — AFTER awaiting the server, so
    // every add had a visible 1-2s freeze (Render free tier + Firestore
    // round-trip). Now the draft clears and a placeholder row appears in
    // the sheet INSTANTLY, before the network call even starts; the real
    // saved row (real id, cloud bill URL, etc.) quietly swaps in once the
    // server responds, and the whole thing rolls back — draft restored,
    // nothing lost — if the save actually fails.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const submittedDraft = draft;
    setRows((prev) => [
      {
        _id: tempId,
        date: submittedDraft.date,
        expense: submittedDraft.expense.trim(),
        amount: Number(submittedDraft.amount),
        master: submittedDraft.master.trim(),
        billFile: null,
        vehicleId: vehicleId || undefined,
        customFields: submittedDraft.customFields,
        _pending: true,
      },
      ...prev,
    ]);
    setDraft(emptyDraft());
    focusCell("draft", "date");

    try {
      setSavingDraft(true);
      const saved = await addExpense({
        date: submittedDraft.date,
        expense: submittedDraft.expense.trim(),
        amount: Number(submittedDraft.amount),
        master: submittedDraft.master.trim(),
        bill: submittedDraft.billFileObj || undefined,
        vehicleId: vehicleId || undefined,
        customFields: submittedDraft.customFields,
      });
      setRows((prev) => prev.map((r) => (r._id === tempId ? saved : r)));
      notifySuccess("Row added");
    } catch (err) {
      setRows((prev) => prev.filter((r) => r._id !== tempId));
      setDraft(submittedDraft);
      notifyError(err.message || "Failed to add row — restored it to the draft row above");
    } finally {
      setSavingDraft(false);
    }
  };

  return (
    <tr className="divide-x divide-gray-200 dark:divide-gray-700 bg-blue-50/40 dark:bg-blue-900/20">
      <td className="px-3 py-2"></td>
      <td className="px-2 py-2">
        <input
          ref={setCellRef("draft", "date")}
          type="date"
          value={draft.date}
          onChange={(e) => handleDraftChange("date", e.target.value)}
          onKeyDown={(e) => handleCellKeyDown(e, "draft", "date", { isDraft: true, onCommit: commitDraftIfReady })}
          className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
        />
      </td>
      <td className="px-2 py-2">
        <input
          ref={setCellRef("draft", "expense")}
          type="text"
          value={draft.expense}
          onChange={(e) => handleDraftChange("expense", e.target.value)}
          onBlur={commitDraftIfReady}
          onKeyDown={(e) => handleCellKeyDown(e, "draft", "expense", { isDraft: true, onCommit: commitDraftIfReady })}
          placeholder="E.g., Diesel for delivery truck"
          className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
        />
      </td>
      <td className="px-2 py-2">
        <input
          ref={setCellRef("draft", "amount")}
          type="number"
          value={draft.amount}
          onChange={(e) => handleDraftChange("amount", e.target.value)}
          onBlur={commitDraftIfReady}
          onKeyDown={(e) => handleCellKeyDown(e, "draft", "amount", { isDraft: true, onCommit: commitDraftIfReady })}
          placeholder="0"
          min="0"
          step="0.01"
          className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-red-400"
        />
      </td>
      <td className="px-2 py-2">
        <MasterAutocomplete
          inputRef={setCellRef("draft", "master")}
          value={draft.master}
          masters={masters}
          catalog={masterCatalog}
          onCatalogChange={reloadAfterMasterChange}
          onChange={(value) => handleDraftChange("master", value)}
          onBlur={commitDraftIfReady}
          onKeyDown={(e) => handleCellKeyDown(e, "draft", "master", { isDraft: true, onCommit: commitDraftIfReady })}
          placeholder="E.g., Fuel"
          className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
        />
      </td>
      <td className="px-2 py-2">
        {renderBudgetCell(draft.master)}
      </td>
      {customColumns.map((col) => (
        <td key={col._id} className="px-2 py-2">
          <CustomCell
            colDef={col}
            value={draft.customFields?.[col.key]}
            onChange={(value) => handleDraftCustomFieldChange(col, value)}
          />
        </td>
      ))}
      <td className="px-2 py-2 text-center">
        <label className="inline-flex items-center justify-center cursor-pointer text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400" title="Attach a bill">
          <FiPaperclip size={16} className={draft.billFileObj ? "text-blue-600 dark:text-blue-400" : ""} />
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => handleDraftChange("billFileObj", e.target.files?.[0] || null)}
          />
        </label>
      </td>
      <td className="px-2 py-2 text-center text-gray-300 dark:text-gray-500">
        {savingDraft ? (
          <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-red-500 mx-auto"></div>
        ) : (
          <FiPlus size={16} className="mx-auto" />
        )}
      </td>
    </tr>
  );
};

const Expenses = () => {
  const [rows, setRows] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [masters, setMasters] = useState(DEFAULT_EXPENSE_MASTERS);
  // The same masters, with their ids — what lets the Master dropdown rename
  // and delete them. `masters` stays a plain list of names because that is all
  // the suggestion matching needs, and every other caller expects it.
  const [masterCatalog, setMasterCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  // Custom columns (21 Sep) — this sheet's column set, shared with the
  // Vehicle Expense Sheet since both read/write the same Expenses rows.
  const [customColumns, setCustomColumns] = useState([]);

  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState("none"); // "none" | "date" | "master"
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());

  // --- Filter toolbar: Master + date range, layered on top of the search box ---
  const [showFilters, setShowFilters] = useState(false);
  const [filterExpense, setFilterExpense] = useState("");
  const [filterMasters, setFilterMasters] = useState([]); // empty = all masters
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const activeFilterCount =
    [filterExpense, filterDateFrom, filterDateTo].filter((v) => v !== "").length +
    (filterMasters.length > 0 ? 1 : 0);

  const clearFilters = () => {
    setFilterExpense("");
    setFilterMasters([]);
    setFilterDateFrom("");
    setFilterDateTo("");
  };

  // Enter walks across the filter controls the same way it walks across a
  // sheet row, so filtering never needs the mouse. The last field's Enter
  // closes the panel — results are already live, so there's nothing to submit.
  const FILTER_ORDER = ["search", "expense", "master", "from", "to"];
  const filterRefs = useRef({});
  const setFilterRef = (key) => (el) => {
    filterRefs.current[key] = el;
  };
  const handleFilterKeyDown = (e, key) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const idx = FILTER_ORDER.indexOf(key);
    const next = FILTER_ORDER[idx + 1];
    if (next) {
      // Opening the panel on the way through, so Enter from the search box
      // lands somewhere visible rather than on a hidden control.
      if (!showFilters) setShowFilters(true);
      setTimeout(() => filterRefs.current[next]?.focus(), 0);
    } else {
      e.target.blur();
      setShowFilters(false);
    }
  };

  // Masters actually present in the sheet right now — keeps the filter dropdown
  // relevant to what's searchable instead of showing every preset category.
  const presentMasters = useMemo(() => {
    const set = new Set(rows.map((r) => r.master).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // Everything already typed into this sheet, offered as suggestions so
  // nobody has to remember an entry's exact wording to search for it.
  const expenseSuggestions = useMemo(() => {
    const set = new Set(rows.map((r) => r.expense).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const searchSuggestions = useMemo(
    () => Array.from(new Set([...expenseSuggestions, ...presentMasters])),
    [expenseSuggestions, presentMasters]
  );

  // When a vehicle-shaped expense is typed here, we pause the save and ask
  // which vehicle it belongs to. Held as a promise resolver so the commit
  // flow can simply await the answer.
  const [vehiclePrompt, setVehiclePrompt] = useState(null); // { draft, resolve }
  const askForVehicle = (forDraft) =>
    new Promise((resolve) => setVehiclePrompt({ draft: forDraft, resolve }));
  const answerVehiclePrompt = (value) => {
    vehiclePrompt?.resolve(value);
    setVehiclePrompt(null);
  };

  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  // rowKey (row._id, or "draft") + field name -> the actual <input> DOM node,
  // so Enter can move focus to a specific cell like Tab does natively.
  const cellRefs = useRef({});
  const setCellRef = (rowKey, field) => (el) => {
    cellRefs.current[`${rowKey}:${field}`] = el;
  };
  const focusCell = (rowKey, field) => {
    cellRefs.current[`${rowKey}:${field}`]?.focus();
  };

  // `onCommit` is DraftRow's own local commitDraftIfReady, passed through on
  // each call (21 Sep — commit logic moved into DraftRow itself so typing
  // stays isolated there; this function only knows about field-to-field
  // navigation, not what "committing" means for whichever row called it).
  const handleCellKeyDown = (e, rowKey, field, { isDraft, onCommit } = {}) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const idx = FIELD_ORDER.indexOf(field);
    if (idx < FIELD_ORDER.length - 1) {
      focusCell(rowKey, FIELD_ORDER[idx + 1]);
    } else if (isDraft) {
      onCommit?.();
    } else {
      e.target.blur(); // triggers the existing row's onBlur -> saveRow
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [expenseData, masterData, vehicleData, columnData] = await Promise.all([
        fetchExpenses(),
        fetchMasterCatalog(),
        // Only used to offer a vehicle when one is clearly meant — a failure
        // here shouldn't stop the sheet loading.
        fetchVehicles().catch(() => []),
        // Custom columns — a failure here shouldn't stop the sheet loading either.
        fetchColumns("expenses").catch(() => []),
      ]);
      setRows(Array.isArray(expenseData) ? expenseData : []);
      setMasterCatalog(Array.isArray(masterData) ? masterData : []);
      setMasters(masterData?.length ? masterData.map((m) => m.name) : DEFAULT_EXPENSE_MASTERS);
      setVehicles(Array.isArray(vehicleData) ? vehicleData : []);
      setCustomColumns(Array.isArray(columnData) ? columnData : []);
    } catch (err) {
      notifyError("Failed to load the expense sheet");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // ManageColumnsButton's onChanged — reloading just the column list avoids
  // re-fetching the whole expense sheet for what's only a shape change.
  const reloadColumns = async () => {
    try {
      const columnData = await fetchColumns("expenses");
      setCustomColumns(Array.isArray(columnData) ? columnData : []);
    } catch (err) {
      notifyError("Failed to refresh the columns");
    }
  };

  // Called after a master is added, renamed or deleted from the dropdown.
  // A rename rewrites the Master column on every entry that used it, so the
  // rows have to come back too — refreshing only the name list would leave
  // the sheet showing the old one.
  const reloadAfterMasterChange = () => loadData();

  // Budgets are fetched here purely to power the over-budget reminders; a
  // failure is non-fatal, the sheet just shows one fewer alert.
  const [budgets, setBudgets] = useState([]);
  useEffect(() => {
    let alive = true;
    fetchBudgets()
      .then((b) => alive && setBudgets(Array.isArray(b) ? b : []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const alerts = useMemo(
    () => [...buildBudgetAlerts(rows, budgets), ...buildExpenseAlerts(rows)],
    [rows, budgets]
  );

  // --- Search + filters + group-by (display only — never affects what's actually stored) ---
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const expenseQ = filterExpense.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !(r.expense || "").toLowerCase().includes(q) && !(r.master || "").toLowerCase().includes(q)) {
        return false;
      }
      if (expenseQ && !(r.expense || "").toLowerCase().includes(expenseQ)) return false;
      if (filterMasters.length > 0 && !filterMasters.includes(r.master)) return false;
      if (filterDateFrom && (!r.date || new Date(r.date) < new Date(filterDateFrom))) return false;
      if (filterDateTo && (!r.date || new Date(r.date) > new Date(filterDateTo))) return false;
      return true;
    });
  }, [rows, search, filterExpense, filterMasters, filterDateFrom, filterDateTo]);

  // Was computed from the raw `rows` before — never moved when a master/
  // date/search filter was applied, even though the filtering logic above
  // already existed. Fixed 18 Sep per Rishi's report.
  const total = useMemo(() => filteredRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0), [filteredRows]);

  const groupedRows = useMemo(() => {
    if (groupBy === "none") return null;
    const groups = new Map();
    for (const r of filteredRows) {
      const key =
        groupBy === "date"
          ? r.date
            ? new Date(r.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
            : "No date"
          : r.master || "Uncategorized";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const entries = Array.from(groups.entries()).map(([key, items]) => ({
      key,
      items,
      total: items.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    }));
    if (groupBy === "master") entries.sort((a, b) => b.total - a.total);
    return entries;
  }, [filteredRows, groupBy]);

  const toggleGroup = (key) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // --- Existing-row editing: update local state as they type, save on blur ---
  const updateRowField = (id, field, value) => {
    setRows((prev) => prev.map((r) => (r._id === id ? { ...r, [field]: value } : r)));
  };

  const saveRow = async (id) => {
    const row = rows.find((r) => r._id === id);
    if (!row || row._pending) return; // still-saving optimistic row — no real id to PATCH yet
    if (!row.expense || !row.amount || !row.master) {
      notifyError("Expense, amount and master can't be left blank");
      loadData(); // revert to last-saved values
      return;
    }
    try {
      await updateExpense(id, { date: row.date, expense: row.expense, amount: Number(row.amount), master: row.master });
    } catch (err) {
      notifyError(err.message || "Failed to save that change");
      loadData();
    }
  };

  // Custom columns: select/date types save the moment they change (that's
  // how a dropdown/date picker already behaves elsewhere in this sheet),
  // text/number save on blur like every other typed cell. Either way it's a
  // one-field PATCH — the backend merges it onto the row's existing
  // customFields rather than replacing the whole blob.
  const saveCustomField = async (id, key, value) => {
    if (id.startsWith("temp-")) return;
    try {
      await updateExpense(id, { customFields: { [key]: value } });
    } catch (err) {
      notifyError(err.message || "Failed to save that value");
      loadData();
    }
  };

  const handleCustomFieldChange = (colDef, id, value) => {
    setRows((prev) =>
      prev.map((r) => (r._id === id ? { ...r, customFields: { ...r.customFields, [colDef.key]: value } } : r))
    );
    if (colDef.type === "select" || colDef.type === "date") saveCustomField(id, colDef.key, value);
  };

  const handleCustomFieldBlur = (colDef, id) => {
    if (colDef.type === "select" || colDef.type === "date") return; // already saved on change
    const row = rows.find((r) => r._id === id);
    saveCustomField(id, colDef.key, row?.customFields?.[colDef.key]);
  };

  const handleRowBillChange = async (id, file) => {
    if (!file || id.startsWith("temp-")) return;
    try {
      const updated = await updateExpense(id, { bill: file });
      setRows((prev) => prev.map((r) => (r._id === id ? updated : r)));
      notifySuccess("Bill attached");
    } catch (err) {
      notifyError(err.message || "Failed to attach bill");
    }
  };

  // Detaching a bill without deleting the whole row. Replacing one is
  // "remove, then attach again" — the cell reverts to its upload state.
  const handleRemoveBill = async (id) => {
    if (id.startsWith("temp-")) return;
    try {
      const updated = await updateExpense(id, { removeBill: true });
      setRows((prev) => prev.map((r) => (r._id === id ? updated : r)));
      notifySuccess("Bill removed");
    } catch (err) {
      notifyError(err.message || "Failed to remove bill");
    }
  };

  const handleDeleteRow = async (id) => {
    if (id.startsWith("temp-")) return;
    try {
      await deleteExpense(id);
      setRows((prev) => prev.filter((r) => r._id !== id));
      notifySuccess("Row deleted");
    } catch (err) {
      notifyError(err.message || "Failed to delete row");
    }
  };

  const handleExportCsv = () => {
    if (rows.length === 0) {
      notifyError("No expenses to export yet");
      return;
    }
    downloadCsv(
      `${FILE_PREFIX}-${todayStr()}.csv`,
      [
        { key: "date", label: "Date" },
        { key: "expense", label: "Expense" },
        { key: "amount", label: "Amount (INR)" },
        { key: "master", label: "Master" },
      ],
      rows.map((r) => ({
        date: r.date ? new Date(r.date).toLocaleDateString("en-IN") : "",
        expense: r.expense,
        amount: r.amount,
        master: r.master,
      }))
    );
  };

  // 23 Sep, per Rishi: the downloaded sheet needs to look presentable enough
  // to hand to someone else — a real formatted .xlsx (headers, borders, a
  // total row), not just a raw .csv. Same file the "Email it" option sends.
  const [downloadingXlsx, setDownloadingXlsx] = useState(false);
  const handleDownloadXlsx = async () => {
    if (rows.length === 0) {
      notifyError("No expenses to export yet");
      return;
    }
    try {
      setDownloadingXlsx(true);
      await downloadExpenseSheetXlsx();
    } catch (err) {
      notifyError(err.message);
    } finally {
      setDownloadingXlsx(false);
    }
  };

  // --- Selecting rows for bulk delete -------------------------------------
  // Selection is by row id, so it survives sorting, grouping and re-rendering.
  // "Select all" deliberately means "all rows currently VISIBLE" — never the
  // whole sheet. With a filter applied, ticking the header box and hitting
  // delete should remove what is on screen and nothing else; anything else
  // would be a very unpleasant surprise.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const toggleSelected = (id) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const visibleIds = useMemo(() => filteredRows.map((r) => r._id), [filteredRows]);
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
      // Trust the server's list of what actually went, not what was selected —
      // a row someone else deleted in the meantime should stay off the screen
      // without pretending we removed it.
      const gone = new Set(result.deletedIds || ids);
      setRows((prev) => prev.filter((r) => !gone.has(r._id)));
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

  // --- the Budget column ---------------------------------------------------
  // A budget belongs to a MASTER, not to a single entry, so every row sharing
  // a master shows (and edits) the same figure. Typing one on any Diesel row
  // sets the Diesel budget everywhere at once.
  //
  // Deliberately NOT part of FIELD_ORDER: Enter still walks
  // date -> expense -> amount -> master -> commit, exactly as before. A budget
  // is set once in a while, not on every entry, so putting it in the entry
  // path would slow down the thing people do a hundred times a day.
  const budgetByMaster = useMemo(() => {
    const map = {};
    for (const b of budgets) {
      if (b.monthlyBudget != null) map[(b.master || "").trim().toLowerCase()] = b.monthlyBudget;
    }
    return map;
  }, [budgets]);

  const budgetDirty = useRef(new Set());
  const budgetTimer = useRef(null);

  // Saves every changed budget in ONE request, a moment after typing stops.
  // Google Sheets allows 60 writes a minute across the whole app, so one
  // request per keystroke (or even per master) is not affordable.
  const flushBudgets = () => {
    const names = [...budgetDirty.current];
    if (!names.length) return;
    budgetDirty.current.clear();
    setBudgets((current) => {
      const byKey = {};
      for (const b of current) byKey[(b.master || "").trim().toLowerCase()] = b;
      const payload = names.map((name) => {
        const existing = byKey[name.trim().toLowerCase()];
        return {
          master: name,
          monthlyBudget: existing?.monthlyBudget ?? "",
          yearlyBudget: existing?.yearlyBudget ?? "",
        };
      });
      saveBudgets(payload).catch((err) => notifyError(err.message || "Couldn't save the budget"));
      return current;
    });
  };

  const setBudgetForMaster = (master, raw) => {
    const name = (master || "").trim();
    if (!name) return;
    const digits = String(raw).replace(/[^\d]/g, "");
    const value = digits === "" ? null : Number(digits);
    const key = name.toLowerCase();

    setBudgets((current) => {
      const i = current.findIndex((b) => (b.master || "").trim().toLowerCase() === key);
      if (i === -1) return [...current, { master: name, monthlyBudget: value, yearlyBudget: null }];
      const next = [...current];
      next[i] = { ...next[i], monthlyBudget: value };
      return next;
    });

    budgetDirty.current.add(name);
    if (budgetTimer.current) clearTimeout(budgetTimer.current);
    budgetTimer.current = setTimeout(flushBudgets, 1200);
  };

  // One cell, shared by the draft row and every existing row.
  //
  // A render FUNCTION, not a nested component. Declaring a component inside
  // another component's body gives it a fresh identity on every render, so
  // React unmounts and remounts it — the input would lose focus after a single
  // keystroke, making the cell impossible to type in. renderRow above is
  // written the same way for the same reason.
  const renderBudgetCell = (master) => {
    const has = !!(master || "").trim();
    const value = has ? budgetByMaster[master.trim().toLowerCase()] : undefined;
    return (
      <input
        type="text"
        inputMode="numeric"
        disabled={!has}
        value={value != null ? String(value) : ""}
        onChange={(e) => setBudgetForMaster(master, e.target.value)}
        onBlur={flushBudgets}
        placeholder={has ? "—" : ""}
        title={has ? `Monthly budget for ${master}` : "Choose a master first"}
        aria-label={has ? `Monthly budget for ${master}` : "Monthly budget"}
        className="w-full border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-red-400 disabled:bg-transparent disabled:cursor-not-allowed placeholder-gray-300 dark:placeholder-gray-600"
      />
    );
  };

  // One table row, used both for the flat list and inside a group. A
  // `_pending` row is the optimistic placeholder for something still being
  // saved (22 Sep, performance fix) — shown faded and non-interactive until
  // the server confirms it and swaps in the real row.
  const renderRow = (row) => (
    <tr
      key={row._id}
      className={`divide-x divide-gray-200 dark:divide-gray-700 ${row._pending ? "opacity-50" : ""} ${
        selectedIds.has(row._id)
          ? "bg-red-50/60 dark:bg-red-900/20"
          : "hover:bg-gray-50 dark:hover:bg-gray-900"
      }`}
    >
      <td className="px-3 py-2">
        {row._pending ? (
          <div className="h-4 w-4 rounded-full border-2 border-gray-300 dark:border-gray-600 border-t-red-500 animate-spin" title="Saving…" />
        ) : (
          <input
            type="checkbox"
            checked={selectedIds.has(row._id)}
            onChange={() => toggleSelected(row._id)}
            aria-label="Select this row"
            className="h-4 w-4 accent-red-600 cursor-pointer align-middle"
          />
        )}
      </td>
      <td className="px-2 py-2">
        <input
          ref={setCellRef(row._id, "date")}
          type="date"
          value={row.date ? new Date(row.date).toISOString().split("T")[0] : ""}
          onChange={(e) => updateRowField(row._id, "date", e.target.value)}
          onBlur={() => saveRow(row._id)}
          onKeyDown={(e) => handleCellKeyDown(e, row._id, "date", { isDraft: false })}
          disabled={row._pending}
          className="w-full border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 disabled:cursor-wait"
        />
      </td>
      <td className="px-2 py-2">
        <input
          ref={setCellRef(row._id, "expense")}
          type="text"
          value={row.expense}
          onChange={(e) => updateRowField(row._id, "expense", e.target.value)}
          onBlur={() => saveRow(row._id)}
          onKeyDown={(e) => handleCellKeyDown(e, row._id, "expense", { isDraft: false })}
          disabled={row._pending}
          className="w-full border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 disabled:cursor-wait"
        />
      </td>
      <td className="px-2 py-2">
        <input
          ref={setCellRef(row._id, "amount")}
          type="number"
          value={row.amount}
          onChange={(e) => updateRowField(row._id, "amount", e.target.value)}
          onBlur={() => saveRow(row._id)}
          onKeyDown={(e) => handleCellKeyDown(e, row._id, "amount", { isDraft: false })}
          min="0"
          step="0.01"
          disabled={row._pending}
          className="w-full border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-red-400 disabled:cursor-wait"
        />
      </td>
      <td className="px-2 py-2">
        <MasterAutocomplete
          inputRef={setCellRef(row._id, "master")}
          value={row.master}
          masters={masters}
          catalog={masterCatalog}
          onCatalogChange={reloadAfterMasterChange}
          onChange={(value) => updateRowField(row._id, "master", value)}
          onBlur={() => saveRow(row._id)}
          onKeyDown={(e) => handleCellKeyDown(e, row._id, "master", { isDraft: false })}
          disabled={row._pending}
          className="w-full border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
        />
      </td>
      <td className="px-2 py-2">
        {renderBudgetCell(row.master)}
      </td>
      {customColumns.map((col) => (
        <td key={col._id} className="px-2 py-2">
          <CustomCell
            colDef={col}
            value={row.customFields?.[col.key]}
            onChange={(value) => handleCustomFieldChange(col, row._id, value)}
            onBlur={() => handleCustomFieldBlur(col, row._id)}
          />
        </td>
      ))}
      <td className="px-2 py-2 text-center">
        {row._pending ? (
          <FiPaperclip size={16} className="inline text-gray-200 dark:text-gray-700" />
        ) : row.billFile ? (
          <div className="inline-flex items-center justify-center gap-0.5">
            <a
              href={billUrl(row.billFile)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
              title="View bill"
            >
              <FiPaperclip size={16} />
            </a>
            <button
              onClick={() => handleRemoveBill(row._id)}
              className="text-gray-300 dark:text-gray-500 hover:text-red-600"
              title="Remove this bill"
            >
              <FiX size={13} />
            </button>
          </div>
        ) : (
          <label className="inline-flex items-center justify-center cursor-pointer text-gray-300 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400" title="Attach a bill">
            <FiPaperclip size={16} />
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => handleRowBillChange(row._id, e.target.files?.[0])}
            />
          </label>
        )}
      </td>
      <td className="px-2 py-2 text-center">
        {!row._pending && (
          <button onClick={() => handleDeleteRow(row._id)} className="text-gray-300 dark:text-gray-500 hover:text-red-600" title="Delete row">
            <FiTrash2 size={16} />
          </button>
        )}
      </td>
    </tr>
  );

  return (
    <div className="p-4 sm:p-6 lg:px-12">
      <ToastContainer />
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-gray-100 mb-1">Expense Sheet</h1>
            <p className="text-gray-600 dark:text-gray-300 text-sm sm:text-base">Type straight into the sheet — it saves as you go</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-md">
              <span className="block text-xs text-gray-500 dark:text-gray-400">Total</span>
              <span className="text-xl font-bold text-red-600">{formatCurrency(total)}</span>
            </div>
            <button
              onClick={() => setShowImportModal(true)}
              className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2.5 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center text-sm font-medium"
            >
              <FiUploadCloud size={17} className="mr-2" /> Import
            </button>
            <DownloadMenu
              options={[
                { key: "csv", label: "Download CSV", description: "Opens in Excel or Google Sheets", onClick: handleExportCsv },
                {
                  key: "xlsx",
                  label: "Download Excel",
                  description: "Formatted report — ready to print or send",
                  onClick: handleDownloadXlsx,
                  busy: downloadingXlsx,
                },
              ]}
            />
            <button
              onClick={() => setShowExportModal(true)}
              className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2.5 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center text-sm font-medium"
            >
              <FiGrid size={17} className="mr-2" /> Share Sheet
            </button>
          </div>
        </div>

        <AlertsStrip alerts={alerts} />

        {/* Search + filter + group-by toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <FiSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <SuggestInput
              inputRef={setFilterRef("search")}
              value={search}
              onChange={setSearch}
              onKeyDown={(e) => handleFilterKeyDown(e, "search")}
              options={searchSuggestions}
              placeholder="Search by expense or master..."
              className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg pl-9 pr-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-2 border rounded-lg shadow-sm px-3 py-2.5 text-sm font-medium ${
              showFilters || activeFilterCount > 0
                ? "bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300"
                : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-900"
            }`}
          >
            <FiFilter size={15} />
            Filters
            {activeFilterCount > 0 && (
              <span className="bg-red-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
          <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm px-3 py-2.5">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">Group by</span>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
              className="text-sm text-gray-700 dark:text-gray-200 focus:outline-none bg-transparent"
            >
              <option value="none">None</option>
              <option value="date">Date</option>
              <option value="master">Master</option>
            </select>
          </div>
          <ManageColumnsButton sheetKey="expenses" columns={customColumns} onChanged={reloadColumns} />
        </div>

        {showFilters && (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm p-4 mb-4">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Expense</label>
                <SuggestInput
                  inputRef={setFilterRef("expense")}
                  value={filterExpense}
                  onChange={setFilterExpense}
                  onKeyDown={(e) => handleFilterKeyDown(e, "expense")}
                  options={expenseSuggestions}
                  placeholder="Any expense..."
                  className="border border-gray-300 dark:border-gray-600 dark:bg-gray-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 min-w-[11rem]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Master</label>
                <MasterMultiSelect
                  inputRef={setFilterRef("master")}
                  onKeyDown={(e) => handleFilterKeyDown(e, "master")}
                  options={presentMasters}
                  selected={filterMasters}
                  onChange={setFilterMasters}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From date</label>
                <input
                  ref={setFilterRef("from")}
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  onKeyDown={(e) => handleFilterKeyDown(e, "from")}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">To date</label>
                <input
                  ref={setFilterRef("to")}
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  onKeyDown={(e) => handleFilterKeyDown(e, "to")}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </div>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearFilters}
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
                  <tr className="divide-x divide-gray-200 dark:divide-gray-700">
                    <th className="px-3 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        ref={(el) => {
                          // A partial selection shows a dash rather than a tick, so
                          // "some of these" never looks like "all of these".
                          if (el) el.indeterminate = selectedVisibleCount > 0 && !allVisibleSelected;
                        }}
                        onChange={toggleSelectAllVisible}
                        aria-label="Select all visible rows"
                        title="Select everything currently shown"
                        className="h-4 w-4 accent-red-600 cursor-pointer align-middle"
                      />
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-36">Date</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Expense</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-32">Amount</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-48">Master</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-32" title="Monthly budget for that master">Budget / mo</th>
                    {customColumns.map((col) => (
                      <th key={col._id} className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">
                        {col.label}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-20">Bill</th>
                    <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-16"></th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {/* Draft row — always present at the top for fast entry, regardless of search/grouping */}
                  <DraftRow
                    masters={masters}
                    masterCatalog={masterCatalog}
                    reloadAfterMasterChange={reloadAfterMasterChange}
                    customColumns={customColumns}
                    renderBudgetCell={renderBudgetCell}
                    rows={rows}
                    vehicles={vehicles}
                    setRows={setRows}
                    askForVehicle={askForVehicle}
                    setCellRef={setCellRef}
                    handleCellKeyDown={handleCellKeyDown}
                    focusCell={focusCell}
                  />

                  {filteredRows.length === 0 && !loading && (
                    <tr>
                      <td colSpan={8 + customColumns.length} className="px-4 py-10 text-center text-gray-400 dark:text-gray-500">
                        {rows.length === 0
                          ? "No expenses yet — start typing in the row above."
                          : "No expenses match your search/filters."}
                      </td>
                    </tr>
                  )}

                  {/* Flat list, or grouped by Date/Master */}
                  {groupedRows === null
                    ? filteredRows.map(renderRow)
                    : groupedRows.map((group) => {
                        const isCollapsed = collapsedGroups.has(group.key);
                        return (
                          <React.Fragment key={group.key}>
                            <tr
                              className="bg-gray-100 dark:bg-gray-800 cursor-pointer select-none"
                              onClick={() => toggleGroup(group.key)}
                            >
                              <td colSpan={8 + customColumns.length} className="px-3 py-2">
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
                            {!isCollapsed && group.items.map(renderRow)}
                          </React.Fragment>
                        );
                      })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showImportModal && (
        <ImportModal
          existingRows={rows}
          onClose={() => setShowImportModal(false)}
          onImported={() => {
            setShowImportModal(false);
            loadData();
          }}
        />
      )}

      {showExportModal && <ExportModal onClose={() => setShowExportModal(false)} />}

      {vehiclePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
          <div className="bg-white dark:bg-gray-800 p-5 sm:p-6 rounded-xl shadow-xl w-full max-w-md border-2 border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-1">
              Is this a vehicle expense?
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              "{vehiclePrompt.draft.expense}" under {vehiclePrompt.draft.master} looks like it belongs
              to a vehicle. Tagging it now keeps it out of the vehicle sheet being entered twice, and
              counts it in that vehicle's totals.
            </p>

            <div className="space-y-2 mb-4 max-h-56 overflow-y-auto">
              {vehicles.map((v) => (
                <button
                  key={v._id}
                  onClick={() => answerVehiclePrompt(v._id)}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm text-gray-700 dark:text-gray-200"
                >
                  <span className="font-medium">{v.name}</span>
                  {v.numberPlate && (
                    <span className="text-gray-400 dark:text-gray-500 ml-2">{v.numberPlate}</span>
                  )}
                </button>
              ))}
            </div>

            <div className="flex justify-between gap-3">
              <button
                onClick={() => answerVehiclePrompt("cancelled")}
                className="px-4 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => answerVehiclePrompt(null)}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium"
              >
                Not a vehicle expense
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Rows that match something already in the sheet are unticked before the
// person even sees the preview — importing the same month twice is the
// easiest way to double every figure, and it's silent when it happens.
const markDuplicates = (data, existingRows) => {
  if (!data?.rows) return data;
  let duplicates = 0;
  const rows = data.rows.map((r) => {
    const existing = findPossibleDuplicate(r, existingRows);
    if (!existing) return r;
    duplicates += 1;
    return { ...r, include: false, _duplicateOf: existing };
  });
  const warnings = [...(data.warnings || [])];
  if (duplicates > 0) {
    warnings.push(
      `${duplicates} row${duplicates === 1 ? " looks" : "s look"} like ${
        duplicates === 1 ? "an entry" : "entries"
      } already in the sheet (same date, amount and master) — unticked below. Tick them if they really are separate.`
    );
  }
  return { ...data, rows, warnings };
};

// --- Import modal: upload a file OR pull from a live Google Sheet, review, then save ---
const ImportModal = ({ onClose, onImported, existingRows = [] }) => {
  const [mode, setMode] = useState("file"); // "file" | "sheet"
  const [sheetUrl, setSheetUrl] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState(null); // { rows, warnings }
  const [committing, setCommitting] = useState(false);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setLoadingPreview(true);
      const data = await previewImportSheet(file);
      setPreview(markDuplicates(data, existingRows));
    } catch (err) {
      notifyError(err.message || "Couldn't read that file");
    } finally {
      setLoadingPreview(false);
      e.target.value = "";
    }
  };

  const handleSheetPreview = async () => {
    if (!sheetUrl.trim()) {
      notifyError("Paste the Google Sheet's link or ID first");
      return;
    }
    try {
      setLoadingPreview(true);
      const data = await previewFromGoogleSheet(sheetUrl.trim());
      setPreview(markDuplicates(data, existingRows));
    } catch (err) {
      notifyError(err.message || "Couldn't read that Google Sheet");
    } finally {
      setLoadingPreview(false);
    }
  };

  const toggleInclude = (rowNumber) => {
    setPreview((p) => ({
      ...p,
      rows: p.rows.map((r) => (r._rowNumber === rowNumber ? { ...r, include: !r.include } : r)),
    }));
  };

  // Lets the user correct the server's guess before anything is saved — e.g.
  // a "Vehicle"/"Contractor" column value that didn't match anything on
  // file, or a match it got wrong. `value` is "expense", "vehicle:<id>" or
  // "payment:<id>".
  const updateRoute = (rowNumber, value) => {
    setPreview((p) => ({
      ...p,
      rows: p.rows.map((r) => {
        if (r._rowNumber !== rowNumber) return r;
        if (value === "expense") {
          return { ...r, route: "expense", vehicleId: undefined, vehicleName: undefined, contractorId: undefined, contractorName: undefined };
        }
        const [kind, id] = value.split(":");
        if (kind === "vehicle") {
          const v = (p.vehicleOptions || []).find((x) => x.id === id);
          return { ...r, route: "vehicle", vehicleId: id, vehicleName: v?.name, contractorId: undefined, contractorName: undefined };
        }
        const c = (p.contractorOptions || []).find((x) => x.id === id);
        return { ...r, route: "payment", contractorId: id, contractorName: c?.name, vehicleId: undefined, vehicleName: undefined };
      }),
    }));
  };

  // A single import can now end up split across two destinations: rows
  // routed to a vehicle are still plain expenses (just with vehicleId set,
  // same as picking a vehicle on the Vehicles page) so they go through the
  // usual bulk-expenses endpoint; rows routed to a labor payment go through
  // the Labor Wages payments endpoint instead, since that's a different
  // table entirely.
  const handleCommit = async () => {
    const toImport = preview.rows.filter((r) => r.include);
    if (toImport.length === 0) {
      notifyError("Nothing selected to import");
      return;
    }
    const expenseRows = toImport.filter((r) => r.route !== "payment");
    const paymentRows = toImport.filter((r) => r.route === "payment");

    try {
      setCommitting(true);
      let importedExpenses = 0;
      let importedPayments = 0;

      if (expenseRows.length) {
        const result = await bulkAddExpenses(expenseRows);
        importedExpenses = result.imported;
      }
      if (paymentRows.length) {
        const result = await bulkAddPayments(
          paymentRows.map((r) => ({ contractorId: r.contractorId, date: r.date, label: r.expense, amount: r.amount }))
        );
        importedPayments = result.added;
      }

      const parts = [];
      if (importedExpenses) parts.push(`${importedExpenses} expense${importedExpenses === 1 ? "" : "s"}`);
      if (importedPayments) parts.push(`${importedPayments} labor payment${importedPayments === 1 ? "" : "s"}`);
      notifySuccess(parts.length ? `Imported ${parts.join(" and ")}` : "Nothing was imported");
      onImported();
    } catch (err) {
      notifyError(err.message || "Failed to save imported rows");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
      <div className="bg-white dark:bg-gray-800 p-5 sm:p-6 rounded-xl shadow-xl w-full max-w-3xl relative border-2 border-gray-200 dark:border-gray-700 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4 border-b pb-3">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Import Expenses</h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
            <FiX size={20} />
          </button>
        </div>

        {!preview ? (
          <>
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setMode("file")}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${mode === "file" ? "bg-red-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"}`}
              >
                Upload a File
              </button>
              <button
                onClick={() => setMode("sheet")}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${mode === "sheet" ? "bg-red-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"}`}
              >
                From Google Sheet
              </button>
            </div>

            {mode === "file" ? (
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                  Upload a .csv, .xls or .xlsx file (including a file exported/downloaded from Google Sheets).
                </p>
                <label className="cursor-pointer bg-gray-50 dark:bg-gray-900 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 flex flex-col items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800">
                  <FiUploadCloud size={28} className="text-gray-400 dark:text-gray-500 mb-2" />
                  <span className="text-sm text-gray-600 dark:text-gray-300">Click to choose a file</span>
                  <input type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={handleFileChange} />
                </label>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                  Paste the link (or just the ID) of a Google Sheet that's been shared with the app's service account
                  as an Editor.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="flex-1 border border-gray-300 dark:border-gray-600 p-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <button
                    onClick={handleSheetPreview}
                    className="bg-red-600 text-white px-4 py-2.5 rounded-lg hover:bg-red-700 text-sm font-medium"
                  >
                    Fetch
                  </button>
                </div>
              </div>
            )}

            {loadingPreview && (
              <div className="flex justify-center items-center h-24">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-red-500"></div>
              </div>
            )}
          </>
        ) : (
          <>
            {preview.warnings?.length > 0 && (
              <div className="mb-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs sm:text-sm text-amber-800 dark:text-amber-200 space-y-1">
                {preview.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            )}
            <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg mb-4">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-10"></th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Expense</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Master</th>
                    {(preview.vehicleOptions?.length > 0 || preview.contractorOptions?.length > 0) && (
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Destination</th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {preview.rows.map((r) => (
                    <tr key={r._rowNumber} className={r.include ? "" : "opacity-40"}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={r.include} onChange={() => toggleInclude(r._rowNumber)} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.date}</td>
                      <td className="px-3 py-2">{r.expense}</td>
                      <td className="px-3 py-2 text-right">{r.amount ?? "—"}</td>
                      <td className="px-3 py-2">
                        {r.master}
                        {r._duplicateOf && (
                          <span className="block text-[11px] text-amber-600 dark:text-amber-400">
                            possible duplicate
                          </span>
                        )}
                      </td>
                      {(preview.vehicleOptions?.length > 0 || preview.contractorOptions?.length > 0) && (
                        <td className="px-3 py-2">
                          <select
                            value={r.route === "vehicle" ? `vehicle:${r.vehicleId}` : r.route === "payment" ? `payment:${r.contractorId}` : "expense"}
                            onChange={(e) => updateRoute(r._rowNumber, e.target.value)}
                            className="text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 rounded px-1.5 py-1 max-w-[150px]"
                          >
                            <option value="expense">Plain expense</option>
                            {(preview.vehicleOptions || []).map((v) => (
                              <option key={v.id} value={`vehicle:${v.id}`}>
                                Vehicle: {v.name}
                              </option>
                            ))}
                            {(preview.contractorOptions || []).map((c) => (
                              <option key={c.id} value={`payment:${c.id}`}>
                                Payment: {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setPreview(null)}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 text-sm font-medium"
              >
                Back
              </button>
              <button
                onClick={handleCommit}
                disabled={committing}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium disabled:opacity-60 flex items-center"
              >
                <FiCheck size={16} className="mr-1.5" />
                {committing ? "Importing..." : `Import ${preview.rows.filter((r) => r.include).length} Rows`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// --- Export modal: email the sheet, or push it into a Google Sheet you own ---
//
// Emailing is the default because it needs no setup from anyone: type an
// address, hit send. The app deliberately does NOT create a Google Sheet and
// share it — service accounts on free Google accounts have zero Drive storage
// quota, so creating one is impossible. Emailing an .xlsx gets the same result
// with less friction, and Gmail's "Open with Google Sheets" turns it into a
// live Sheet in one click.
const ExportModal = ({ onClose }) => {
  const [status, setStatus] = useState(null);
  const [mode, setMode] = useState("email"); // "email" | "sheet"

  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const [sheetUrl, setSheetUrl] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchSheetsStatus().then(setStatus).catch(() => {});
  }, []);

  const handleEmail = async () => {
    if (!email.trim()) {
      notifyError("Enter an email address first");
      return;
    }
    try {
      setSending(true);
      const result = await emailExpenseSheet(email.trim(), note.trim());
      notifySuccess(result.message || "Sheet emailed");
      onClose();
    } catch (err) {
      notifyError(err.message || "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const handleExport = async () => {
    if (!sheetUrl.trim()) {
      notifyError("Paste the Google Sheet's link or ID first");
      return;
    }
    try {
      setExporting(true);
      const result = await exportToGoogleSheet(sheetUrl.trim());
      notifySuccess(result.message || "Exported to Google Sheet");
    } catch (err) {
      notifyError(err.message || "Failed to export");
    } finally {
      setExporting(false);
    }
  };

  const tabClass = (active) =>
    `px-4 py-2 rounded-lg text-sm font-medium ${
      active ? "bg-red-600 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
      <div className="bg-white dark:bg-gray-800 p-5 sm:p-6 rounded-xl shadow-xl w-full max-w-md relative border-2 border-gray-200 dark:border-gray-700">
        <div className="flex justify-between items-center mb-4 border-b border-gray-100 dark:border-gray-700 pb-3">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center">
            <FiGrid className="mr-2" /> Share the Sheet
          </h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
            <FiX size={20} />
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <button onClick={() => setMode("email")} className={tabClass(mode === "email")}>
            Email it
          </button>
          <button onClick={() => setMode("sheet")} className={tabClass(mode === "sheet")}>
            To a Google Sheet
          </button>
        </div>

        {mode === "email" ? (
          <>
            {status && status.emailConfigured === false && (
              <div className="mb-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs sm:text-sm text-amber-800 dark:text-amber-200">
                Email isn't set up on the server yet — it needs
                <code className="mx-1 px-1 bg-amber-100 dark:bg-amber-900/50 rounded">EMAIL_USER</code> and
                <code className="mx-1 px-1 bg-amber-100 dark:bg-amber-900/50 rounded">EMAIL_APP_PASSWORD</code>
                (the same two the password reset needs). See
                <code className="ml-1 px-1 bg-amber-100 dark:bg-amber-900/50 rounded">backend/.env.example</code>.
              </div>
            )}

            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Sends the whole expense sheet as a spreadsheet attachment. No setup needed at the other
              end — in Gmail they can click the file and choose "Open with Google Sheets".
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleEmail()}
              placeholder="name@example.com"
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-900 p-2.5 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Optional message to include..."
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-900 p-2.5 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <button
              onClick={handleEmail}
              disabled={sending}
              className="w-full bg-red-600 text-white px-4 py-2.5 rounded-lg hover:bg-red-700 text-sm font-medium disabled:opacity-60"
            >
              {sending ? "Sending..." : "Send Sheet"}
            </button>
          </>
        ) : (
          <>
            {status && !status.configured && (
              <div className="mb-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs sm:text-sm text-amber-800 dark:text-amber-200">
                Google Sheets sync isn't set up on the server yet — it needs the
                <code className="mx-1 px-1 bg-amber-100 dark:bg-amber-900/50 rounded">GOOGLE_SERVICE_ACCOUNT_KEY</code>
                env var (see <code className="px-1 bg-amber-100 dark:bg-amber-900/50 rounded">backend/.env.example</code>).
              </div>
            )}

            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              For a Sheet you want kept up to date in place. Paste the link of a Google Sheet shared
              with the app's service account as an Editor — its contents get replaced with everything
              in this expense sheet.
            </p>
            <input
              type="text"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-900 p-2.5 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <button
              onClick={handleExport}
              disabled={exporting}
              className="w-full bg-red-600 text-white px-4 py-2.5 rounded-lg hover:bg-red-700 text-sm font-medium disabled:opacity-60"
            >
              {exporting ? "Exporting..." : "Export"}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default Expenses;
