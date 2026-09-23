import React, { useEffect, useMemo, useRef, useState } from "react";
import { FiTrash2, FiSearch, FiFilter, FiXCircle, FiUploadCloud, FiGrid, FiFileText, FiCalendar } from "react-icons/fi";
import {
  fetchMills,
  fetchContractors,
  fetchWageEntries,
  addWageEntry,
  deleteWageEntry,
  bulkAddWageEntries,
  bulkDeleteWageEntries,
  fetchPayments,
  addPayment,
  deletePayment,
  bulkAddPayments,
  bulkDeletePayments,
} from "../../api/labour";
import { previewLabourImportSheet } from "../../api/imports";
import { fetchLabourSheetsStatus, exportLabourToGoogleSheet, previewLabourFromGoogleSheet, emailLabourSheet, downloadLabourSheetXlsx } from "../../api/sheets";
import { FILE_PREFIX } from "../../constants/brand";
import { downloadCsv } from "../../utils/exportCsv";
import ImportSheetModal from "../../components/ImportSheetModal";
import ExportSheetModal from "../../components/ExportSheetModal";
import { CustomCell, ManageColumnsButton } from "../../components/CustomColumns";
import DownloadMenu from "../../components/DownloadMenu";
import { fetchColumns } from "../../api/columns";

const todayStr = () => new Date().toISOString().split("T")[0];

// Matches an imported row's free-text contractor name against the real
// contractor list (case-insensitive, exact-name match) — the backend parser
// deliberately leaves this to the frontend, which already has the list
// loaded. Rows with no match keep contractorId "" and get excluded by
// default, same as a row missing its amount does elsewhere in the app.
const withContractorMatch = (data, contractors) => ({
  ...data,
  rows: data.rows.map((r) => {
    const match = contractors.find((c) => (c.name || "").trim().toLowerCase() === (r.contractorText || "").trim().toLowerCase());
    return { ...r, contractorId: match ? match._id : "", include: r.include && !!match };
  }),
});

// Labor Wages — simplified 18 Sep per Rishi: "the labor page is a bit
// complicated to use... in labor page there will be only a sheet grid
// similar to expense sheet page." All the add/edit/delete for mills,
// contractors and labor moved to Manage Data (the new hamburger-icon page);
// this page is just flat grids — the CFT work log and the payments/advances
// log from sir's paper sheet — each with a Contractor picker column, same
// shape as the Vehicle picker on the Vehicle Expense Sheet.
//
// Split into three inner tabs (18 Sep, same day): Work Log, Payments, and a
// third read-only Summary/Report tab — "we dont edit we just see the
// summary and report" — showing per contractor what's been paid, what's
// still pending, and (the reverse case) if a contractor has been overpaid
// and owes money back. Balance math: openingBalance + totalEarned -
// totalPaid, same formula used on the paper ledger's running balance.
const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

const useRowCommit = (ref, commit) => () => {
  setTimeout(() => {
    if (ref.current && !ref.current.contains(document.activeElement)) commit();
  }, 0);
};

// "22-06-2026 TO 27-06-2026" style label, built from two real
// <input type="date"> values (18 Sep, per Rishi: Work Log keeps its
// multi-day period concept but gets real date pickers instead of a free-text
// box — "DD-MM-YYYY" to match sir's paper sheet while keeping the year, since
// dropping it made rows ambiguous once records span into a new year; no "TO"
// at all when it's a single-day batch).
const ddmmyyyy = (iso) => {
  const parts = String(iso || "").split("-");
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : "";
};
const combineDateRange = (from, to) => {
  if (!from || !to) return "";
  return from === to ? ddmmyyyy(from) : `${ddmmyyyy(from)} TO ${ddmmyyyy(to)}`;
};

// One flat sheet: a draft row (Date + Contractor + whatever fields this
// ledger needs) that commits once Date and Contractor are both set, plus
// existing rows. Used for both the work log and the payments log — they
// differ only in which extra fields they carry and how the date is entered:
// dateMode="single" (Payments — one real date picker) or "range" (Work Log —
// From/To date pickers combined into the same dateLabel string the sheet
// already stored, so no backend change was needed).
//
// Enter-key navigation (18 Sep, per Rishi: "the enters dont go to the next
// column") walks FIELD_ORDER left to right, same pattern as Expenses.jsx/
// Vehicles.jsx's own draft rows: Enter moves to the next field, and Enter on
// the LAST field commits the row instead of just sitting there.
// Draft row, isolated into its own component (21 Sep, per Rishi: "it is
// lagging way too much when i enter any data in it"). Before this, `draft`
// state lived in LedgerSheet itself, right alongside the (potentially
// hundreds-of-rows-long) `rows` list — every keystroke re-rendered the WHOLE
// ledger, existing rows included, which is what got slower and slower as a
// contractor's history grew. Typing now only re-renders this one small row;
// LedgerSheet's existing-row list is completely untouched by it.
const DraftRow = ({ isRange, dateType, fields, contractorOptions, customColumns, computeAmount, onAdd, onBulkDelete, setRows, millPicker }) => {
  const emptyDraft = () => ({
    contractorId: "",
    ...(millPicker ? { millId: "" } : {}),
    ...(isRange ? { dateFrom: "", dateTo: "" } : { date: "" }),
    ...Object.fromEntries(fields.map((f) => [f.key, ""])),
    customFields: {},
  });
  const [draft, setDraft] = useState(emptyDraft());
  const rowRef = useRef(null);
  const fieldRefs = useRef({});
  const setFieldRef = (key) => (el) => {
    fieldRefs.current[key] = el;
  };

  const handleDraftCustomFieldChange = (colDef, value) => {
    setDraft((d) => ({ ...d, customFields: { ...d.customFields, [colDef.key]: value } }));
  };

  // Which mills the currently-picked contractor covers (23 Sep) — drives
  // whether the Mill field below renders as a required picker (>1 mill), is
  // silently auto-filled (exactly 1 mill, nothing to disambiguate), or stays
  // empty (no mill assigned yet on Manage Data — same as before this field
  // existed).
  const contractorMills = millPicker ? contractorOptions.find((o) => o.value === draft.contractorId)?.millList || [] : [];

  const FIELD_ORDER = isRange
    ? ["dateFrom", "dateTo", "contractorId", ...(millPicker ? ["millId"] : []), ...fields.map((f) => f.key)]
    : ["date", "contractorId", ...(millPicker ? ["millId"] : []), ...fields.map((f) => f.key)];

  const commit = async () => {
    const dateValue = isRange ? combineDateRange(draft.dateFrom, draft.dateTo) : draft.date.trim();
    if (!dateValue || !draft.contractorId) return;
    // A multi-mill contractor MUST pick which mill this batch belongs to —
    // that's the whole point (23 Sep, per Rishi: lumping Jamir's three
    // mills' CFT into one entry loses which mill produced what). A
    // single-mill (or not-yet-assigned) contractor has nothing to pick, so
    // it's auto-filled instead of forcing a pointless extra click.
    if (millPicker && contractorMills.length > 1 && !draft.millId) return;
    const resolvedMillId = millPicker ? draft.millId || (contractorMills.length === 1 ? contractorMills[0]._id : "") : undefined;

    // Optimistic insert (22 Sep, per Rishi: hitting Enter used to visibly
    // freeze for 1-2s before the row appeared — because LaborWages used to
    // reload the WHOLE ledger from the server after every add. Now the row
    // appears and the draft resets INSTANTLY; the real saved row (with its
    // real id) quietly swaps in once the server responds, and rolls back —
    // draft restored, nothing lost — if the save actually fails.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const submittedDraft = millPicker ? { ...draft, millId: resolvedMillId } : draft;
    const tempAmount = computeAmount ? computeAmount(submittedDraft) : Number(submittedDraft.amount || 0);
    const tempRow = {
      _id: tempId,
      contractorId: submittedDraft.contractorId,
      ...(millPicker ? { millId: submittedDraft.millId } : {}),
      date: dateValue,
      dateLabel: dateValue,
      ...Object.fromEntries(fields.map((f) => [f.key, submittedDraft[f.key]])),
      amount: tempAmount,
      customFields: submittedDraft.customFields,
      _pending: true,
    };
    setRows((prev) => [tempRow, ...prev]);
    setDraft(emptyDraft());
    // Same as the Expense Sheet/Vehicle Expense Sheet draft rows: after a
    // successful add, put focus back on the first field so a fast typist
    // can keep logging entries back-to-back without reaching for the mouse.
    setTimeout(() => fieldRefs.current[FIELD_ORDER[0]]?.focus(), 0);

    try {
      const saved = await onAdd({ ...submittedDraft, date: dateValue });
      setRows((prev) => prev.map((r) => (r._id === tempId ? saved : r)));
    } catch (err) {
      setRows((prev) => prev.filter((r) => r._id !== tempId));
      setDraft(submittedDraft);
      alert(err.message || "Failed to add — restored it to the row above");
    }
  };
  const handleRowBlur = useRowCommit(rowRef, commit);

  const handleKeyDown = (e, key) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const idx = FIELD_ORDER.indexOf(key);
    let nextIdx = idx + 1;
    while (nextIdx < FIELD_ORDER.length && !fieldRefs.current[FIELD_ORDER[nextIdx]]) {
      nextIdx++;
    }
    if (nextIdx < FIELD_ORDER.length) {
      fieldRefs.current[FIELD_ORDER[nextIdx]]?.focus();
    } else {
      commit();
    }
  };

  const liveAmount = computeAmount ? computeAmount(draft) : null;

  return (
    <tr ref={rowRef} onBlur={handleRowBlur} className="border-b divide-x divide-gray-200 dark:divide-gray-700 border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30">
      {onBulkDelete && <td className="px-3 py-2"></td>}
      {isRange ? (
        <>
          <td className="px-3 py-2">
            <input
              ref={setFieldRef("dateFrom")}
              type="date"
              value={draft.dateFrom}
              onChange={(e) => setDraft((d) => ({ ...d, dateFrom: e.target.value }))}
              onKeyDown={(e) => handleKeyDown(e, "dateFrom")}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
            />
          </td>
          <td className="px-3 py-2">
            <input
              ref={setFieldRef("dateTo")}
              type="date"
              value={draft.dateTo}
              onChange={(e) => setDraft((d) => ({ ...d, dateTo: e.target.value }))}
              onKeyDown={(e) => handleKeyDown(e, "dateTo")}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
            />
          </td>
        </>
      ) : (
        <td className="px-3 py-2">
          <input
            ref={setFieldRef("date")}
            type={dateType}
            value={draft.date}
            onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
            onKeyDown={(e) => handleKeyDown(e, "date")}
            className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
          />
        </td>
      )}
      <td className="px-3 py-2">
        <select
          ref={setFieldRef("contractorId")}
          value={draft.contractorId}
          onChange={(e) => setDraft((d) => ({ ...d, contractorId: e.target.value, ...(millPicker ? { millId: "" } : {}) }))}
          onKeyDown={(e) => handleKeyDown(e, "contractorId")}
          className="border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
        >
          <option value="">Choose contractor…</option>
          {contractorOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </td>
      {millPicker && (
        <td className="px-3 py-2">
          {contractorMills.length > 1 ? (
            <select
              ref={setFieldRef("millId")}
              value={draft.millId}
              onChange={(e) => setDraft((d) => ({ ...d, millId: e.target.value }))}
              onKeyDown={(e) => handleKeyDown(e, "millId")}
              className="border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              <option value="">Which mill?</option>
              {contractorMills.map((m) => (
                <option key={m._id} value={m._id}>{m.name}</option>
              ))}
            </select>
          ) : (
            <span className="text-gray-400 text-xs">{contractorMills[0]?.name || "—"}</span>
          )}
        </td>
      )}
      <td className="px-3 py-2 text-gray-400">
        {contractorOptions.find((o) => o.value === draft.contractorId)?.master || "—"}
      </td>
      {fields.map((f) => (
        <td key={f.key} className="px-3 py-2">
          <input
            ref={setFieldRef(f.key)}
            type={f.type || "text"}
            value={draft[f.key]}
            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            onKeyDown={(e) => handleKeyDown(e, f.key)}
            placeholder={f.placeholder}
            style={f.width ? { width: f.width } : undefined}
            className="border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
          />
        </td>
      ))}
      {customColumns.map((col) => (
        <td key={col._id} className="px-3 py-2">
          <CustomCell
            colDef={col}
            value={draft.customFields?.[col.key]}
            onChange={(value) => handleDraftCustomFieldChange(col, value)}
          />
        </td>
      ))}
      {computeAmount && <td className="px-3 py-2 text-gray-400">{liveAmount != null ? money(liveAmount) : "—"}</td>}
      <td className="px-3 py-2"></td>
    </tr>
  );
};

const LedgerSheet = ({
  rows,
  setRows, // (updater) => void — the parent's wageEntries/payments state setter, used for the draft row's optimistic insert (22 Sep, performance fix)
  contractorOptions,
  dateLabel,
  dateMode = "single", // "single" | "range"
  dateType = "text", // only used when dateMode === "single"
  fields, // [{ key, placeholder, type, width }]
  computeAmount, // (draft) => number|null — shown live in the draft row; null hides it
  renderAmount, // (row) => string
  onAdd,
  onDelete,
  onBulkDelete, // (ids) => Promise — omit to leave bulk-delete off for this sheet
  search,
  allowedContractorIds, // Set of contractorId, or null/undefined for "no filter"
  sheetKey, // "wageEntries" | "payments" — this ledger's own custom-column set
  millPicker, // true only for Work Log (23 Sep) — shows a per-entry Mill column/picker
  filterMillId, // optional — narrows rows to just this one mill's entries (Work Log only)
}) => {
  const isRange = dateMode === "range";

  // A row's mill, resolved the same way everywhere it's needed (display,
  // filtering): trust the row's own millId if it has one; otherwise, if the
  // contractor only covers one mill, there was never any ambiguity to begin
  // with, so fall back to that — keeps rows saved before this field existed
  // showing correctly instead of going blank.
  const resolveMillId = (row) => {
    if (row.millId) return row.millId;
    const millList = contractorOptions.find((o) => o.value === row.contractorId)?.millList || [];
    return millList.length === 1 ? millList[0]._id : null;
  };
  const resolveMillName = (row) => {
    const id = resolveMillId(row);
    if (!id) return "—";
    const millList = contractorOptions.find((o) => o.value === row.contractorId)?.millList || [];
    return millList.find((m) => m._id === id)?.name || "—";
  };

  // Custom columns (21 Sep) — Work Log and Payments keep independent column
  // sets even though they share this component, since they're genuinely
  // different ledger shapes (see backend/models/columnDefStore.js's header).
  const [customColumns, setCustomColumns] = useState([]);
  const loadColumns = () => fetchColumns(sheetKey).then(setCustomColumns).catch(() => setCustomColumns([]));
  useEffect(() => {
    loadColumns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetKey]);

  const filtered = rows.filter((r) => {
    if (allowedContractorIds && !allowedContractorIds.has(r.contractorId)) return false;
    if (filterMillId && resolveMillId(r) !== filterMillId) return false;
    if (!search) return true;
    const c = contractorOptions.find((o) => o.value === r.contractorId);
    const haystack = `${c?.label || ""} ${c?.master || ""} ${r.date || ""} ${r.label || ""} ${r.dateLabel || ""}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  // --- Selecting rows for bulk delete (18 Sep, per Rishi: "add multi
  // deletation in vehicle and labor wages page just like the feature that we
  // added in the expense sheets") — same pattern as Expenses.jsx/Vehicles.jsx:
  // selection is by row id, "select all" means all rows currently VISIBLE
  // (i.e. after search/filter), and it's off entirely when the caller
  // doesn't pass onBulkDelete. -------------------------------------------
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const toggleSelected = (id) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const visibleIds = filtered.filter((r) => !r._pending).map((r) => r._id);
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.has(id)).length;
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
    if (!ids.length || !onBulkDelete) return;
    setBulkDeleting(true);
    try {
      await onBulkDelete(ids);
      clearSelection();
    } catch (err) {
      alert(err.message || "Failed to delete those rows");
    } finally {
      setBulkDeleting(false);
    }
  };

  const dateCols = isRange ? 2 : 1;

  return (
    <div>
      <div className="flex justify-end px-4 pt-3">
        <ManageColumnsButton sheetKey={sheetKey} columns={customColumns} onChanged={loadColumns} />
      </div>
      {onBulkDelete && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-red-50 dark:bg-red-900/25 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2.5 mx-4 mb-2">
          <span className="text-sm font-medium text-red-800 dark:text-red-200">
            {selectedIds.size} {selectedIds.size === 1 ? "row" : "rows"} selected
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
      <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b divide-x divide-gray-200 dark:divide-gray-700 border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400 text-xs">
          {onBulkDelete && (
            <th className="px-3 py-2 w-8">
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
          )}
          {isRange ? (
            <>
              <th className="px-3 py-2 font-medium">{dateLabel} From</th>
              <th className="px-3 py-2 font-medium">{dateLabel} To</th>
            </>
          ) : (
            <th className="px-3 py-2 font-medium">{dateLabel}</th>
          )}
          <th className="px-3 py-2 font-medium">Contractor</th>
          {millPicker && <th className="px-3 py-2 font-medium">Mill</th>}
          <th className="px-3 py-2 font-medium">Master</th>
          {fields.map((f) => (
            <th key={f.key} className="px-3 py-2 font-medium">{f.label}</th>
          ))}
          {customColumns.map((col) => (
            <th key={col._id} className="px-3 py-2 font-medium whitespace-nowrap">{col.label}</th>
          ))}
          {computeAmount && <th className="px-3 py-2 font-medium">Amount</th>}
          <th className="px-3 py-2"></th>
        </tr>
      </thead>
      <tbody>
        <DraftRow
          isRange={isRange}
          dateType={dateType}
          fields={fields}
          contractorOptions={contractorOptions}
          customColumns={customColumns}
          computeAmount={computeAmount}
          onAdd={onAdd}
          onBulkDelete={onBulkDelete}
          setRows={setRows}
          millPicker={millPicker}
        />

        {filtered.length === 0 && (
          <tr>
            <td
              colSpan={(onBulkDelete ? 1 : 0) + dateCols + 3 + (millPicker ? 1 : 0) + fields.length + customColumns.length + (computeAmount ? 1 : 0)}
              className="px-3 py-2 text-gray-400 italic"
            >
              {rows.length === 0 ? "Nothing logged yet." : "No rows match your search/filters."}
            </td>
          </tr>
        )}

        {filtered.map((row) => {
          const c = contractorOptions.find((o) => o.value === row.contractorId);
          return (
            <tr
              key={row._id}
              className={`border-b divide-x divide-gray-200 dark:divide-gray-700 ${row._pending ? "opacity-50" : ""} ${
                onBulkDelete && selectedIds.has(row._id)
                  ? "border-gray-100 dark:border-gray-800 bg-red-50/60 dark:bg-red-900/20"
                  : "border-gray-100 dark:border-gray-800"
              }`}
            >
              {onBulkDelete && (
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
              )}
              <td className="px-3 py-2" colSpan={dateCols}>{row.date || row.dateLabel}</td>
              <td className="px-3 py-2">{c?.label || "—"}</td>
              {millPicker && <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{resolveMillName(row)}</td>}
              <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{c?.master || "—"}</td>
              {fields.map((f) => (
                <td key={f.key} className="px-3 py-2">{f.format ? f.format(row[f.key]) : row[f.key]}</td>
              ))}
              {customColumns.map((col) => (
                <td key={col._id} className="px-3 py-2">
                  <CustomCell colDef={col} value={row.customFields?.[col.key]} disabled />
                </td>
              ))}
              {computeAmount && <td className="px-3 py-2 font-medium">{renderAmount(row)}</td>}
              <td className="px-3 py-2">
                {!row._pending && (
                  <button onClick={() => onDelete(row._id)} title="Delete" className="text-gray-300 dark:text-gray-500 hover:text-red-600">
                    <FiTrash2 size={14} />
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
      </table>
    </div>
  );
};

// Read-only per-contractor report: total earned (from CFT work log), total
// paid (from payments/advances), opening balance carried over, and the
// resulting balance — worded either as "pending to pay" or, when a
// contractor's been paid more than they've earned, "owes back". Each
// contractor's numbers are self-contained so "every report can be seen
// separately" — the dropdown just filters which card(s) show.
const contractorReport = (contractor, wageEntries, payments) => {
  const totalEarned = wageEntries
    .filter((w) => w.contractorId === contractor._id)
    .reduce((sum, w) => sum + Number(w.amount || 0), 0);
  const totalPaid = payments
    .filter((p) => p.contractorId === contractor._id)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const openingBalance = Number(contractor.openingBalance || 0);
  const balance = openingBalance + totalEarned - totalPaid;
  return { totalEarned, totalPaid, openingBalance, balance };
};

// A payment counts as an ADVANCE if its Label mentions it (23 Sep, per
// Rishi: "my boss pays the contractors in advance too but mainly the
// payments are done on weekly workflow basis"). Deliberately no new field/
// checkbox anywhere — Rishi's team already writes things like "CASH/ADV" in
// the Label column on real entries (see labourStore.js's own comment on that
// field), so reading that same free text is the simplest way to split
// advances out without adding another input to the Payments sheet.
const isAdvancePayment = (payment) => /\badv/i.test(payment.label || "");

// Weekly/Monthly/Yearly report view (23 Sep, per Rishi: "give option to see
// report on weekly basis monthly bases and yearly basis"). Payments carry a
// real <input type="date"> value, so they filter cleanly. Work Log only
// carries dateLabel — a formatted "DD-MM-YYYY" or "DD-MM-YYYY TO DD-MM-YYYY"
// string (see combineDateRange above) — but that string is always built from
// real date pickers under the hood, so the first date in it can be parsed
// back out for period filtering without needing a backend change.
const PERIOD_OPTIONS = [
  { key: "all", label: "All Time" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "year", label: "This Year" },
];
const parseDateLabel = (label) => {
  const first = String(label || "").split(" TO ")[0].trim();
  const [d, m, y] = first.split("-");
  if (!d || !m || !y) return null;
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  return isNaN(dt.getTime()) ? null : dt;
};
const periodStart = (periodKey) => {
  const now = new Date();
  if (periodKey === "week") {
    const dt = new Date(now);
    dt.setHours(0, 0, 0, 0);
    const day = dt.getDay(); // 0=Sun..6=Sat, week starts Monday
    dt.setDate(dt.getDate() - (day === 0 ? 6 : day - 1));
    return dt;
  }
  if (periodKey === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (periodKey === "year") return new Date(now.getFullYear(), 0, 1);
  return null; // "all"
};
const inPeriod = (date, periodKey) => {
  if (periodKey === "all") return true;
  const start = periodStart(periodKey);
  return !!date && date >= start;
};
const formatShortDate = (iso) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso || "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
};

// Per-contractor numbers scoped to the selected period — Earned/Paid/Advance
// only count activity that falls inside the chosen window, and
// `recentPayments` is the bill-style Date + Amount list shown in the
// report's rightmost column (23 Sep, per Rishi: "on the right side you will
// report the date and payments all together which looks like a bill" — sir's
// paper ledger always shows a payment next to the date it was made on, so
// the report should too, not bury dates out of view). Balance is
// deliberately NOT computed here — it's real money owed and has to stay the
// true running total regardless of which period is being viewed; see
// contractorReport above for that.
const periodStats = (contractor, wageEntries, payments, periodKey) => {
  const earned = wageEntries
    .filter((w) => w.contractorId === contractor._id && inPeriod(parseDateLabel(w.dateLabel), periodKey))
    .reduce((sum, w) => sum + Number(w.amount || 0), 0);

  const periodPayments = payments
    .filter((p) => p.contractorId === contractor._id && inPeriod(p.date ? new Date(p.date) : null, periodKey))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const paid = periodPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const advance = periodPayments.filter(isAdvancePayment).reduce((s, p) => s + Number(p.amount || 0), 0);

  return { earned, paid, advance, recentPayments: periodPayments };
};

// Report-tab payment-status colour rule (23 Sep, per Rishi: "give colours...
// green if we payed fully yellow if we owe them red if we delayed the
// payment etc make rules according to you man"). Rule, spelled out so it's
// easy to retune later: GREEN once the balance is settled (paid >= earned +
// opening); otherwise YELLOW while there's still a pending balance but the
// most recent payment was within the last DELAY_THRESHOLD_DAYS (matches
// "mainly weekly" — two weeks' grace before calling it late); RED once that
// window has passed with money still owed, or nothing has ever been paid at
// all despite work being logged.
const DELAY_THRESHOLD_DAYS = 14;
const paymentStatus = (contractor, wageEntries, payments, balance) => {
  if (balance <= 0) return { key: "green", label: "Paid up" };
  const contractorPayments = payments.filter((p) => p.contractorId === contractor._id && p.date);
  const lastPaymentMs = contractorPayments.length
    ? Math.max(...contractorPayments.map((p) => new Date(p.date).getTime()))
    : null;
  const daysSincePayment = lastPaymentMs ? (Date.now() - lastPaymentMs) / 86400000 : Infinity;
  return daysSincePayment > DELAY_THRESHOLD_DAYS
    ? { key: "red", label: "Delayed" }
    : { key: "yellow", label: "Pending" };
};

// 23 Sep, per Rishi: "colours just mix up with the background" — the
// original row tints were a near-transparent 20% overlay in dark mode
// (bg-green-900/20 etc.), which barely showed up against the card's own
// dark-gray background, and the status badge used the same light tint +
// colored text as the row it sat on top of, so the badge itself blended
// into the row instead of standing out. Fixed two ways: a solid, saturated
// LEFT BORDER strip per row (a strong signal that never depends on how it
// mixes with whatever's behind it) plus a slightly stronger, still-readable
// background tint; and the badge is now a solid color fill with white text
// instead of tint-on-tint, so it reads clearly on any row/background.
const REPORT_ROW_TINT = {
  green: "bg-green-50 dark:bg-green-950/40 border-l-4 border-l-green-500",
  yellow: "bg-amber-50 dark:bg-amber-950/40 border-l-4 border-l-amber-500",
  red: "bg-red-50 dark:bg-red-950/40 border-l-4 border-l-red-500",
};
const REPORT_BADGE = {
  green: "bg-green-600 text-white",
  yellow: "bg-amber-500 text-white",
  red: "bg-red-600 text-white",
};

// Redesigned 23 Sep, per Rishi's notebook: "go with this format... looks
// like sheet too but we cant enter or alter the data we can just see the
// data" — a read-only spreadsheet-style table (same grid-line/header look as
// the Work Log and Payments sheets) instead of the earlier card grid,
// row-tinted by the status rule above, showing only the numbers Rishi
// actually asked for (earned/paid/advance/balance/status) — "make it simple
// and report shows the most important data only", so Opening Balance and the
// per-mill breakdown are left off this table (still visible on Manage Data
// and the Mill filter respectively) to keep it to what he said matters.
const SummaryReport = ({ contractors, contractorOptions, wageEntries, payments, allowedContractorIds }) => {
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [filterMaster, setFilterMaster] = useState("");
  const [period, setPeriod] = useState("all");
  const periodLabel = PERIOD_OPTIONS.find((p) => p.key === period)?.label || "All Time";

  const inScope = allowedContractorIds ? contractors.filter((c) => allowedContractorIds.has(c._id)) : contractors;
  const optionsInScope = allowedContractorIds
    ? contractorOptions.filter((o) => allowedContractorIds.has(o.value))
    : contractorOptions;
  const masterOptions = useMemo(
    () => [...new Set(inScope.map((c) => c.contractorType).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [inScope]
  );

  const q = search.trim().toLowerCase();
  const shownContractors = inScope.filter((c) => {
    if (selected && c._id !== selected) return false;
    if (filterMaster && c.contractorType !== filterMaster) return false;
    if (q && !c.name.toLowerCase().includes(q)) return false;
    return true;
  });

  // One row per contractor, every number pre-computed once here so both the
  // table body and the totals footer read from the same values. `report`
  // (all-time) drives the real running Balance; `stats` (period-scoped)
  // drives Earned/Paid/Advance and the Recent Payments column, so switching
  // the period above never makes the Balance column lie about what's
  // actually owed.
  const rows = useMemo(() => {
    return shownContractors.map((c) => {
      const report = contractorReport(c, wageEntries, payments);
      const stats = periodStats(c, wageEntries, payments, period);
      const status = paymentStatus(c, wageEntries, payments, report.balance);
      return { contractor: c, report, stats, status };
    });
  }, [shownContractors, wageEntries, payments, period]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.earned += r.stats.earned;
          acc.paid += r.stats.paid;
          acc.advance += r.stats.advance;
          acc.balance += r.report.balance;
          return acc;
        },
        { earned: 0, paid: 0, advance: 0, balance: 0 }
      ),
    [rows]
  );

  const activeFilterCount = (filterMaster ? 1 : 0) + (selected ? 1 : 0);
  const generatedAt = useMemo(
    () => new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }),
    []
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[12rem]">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contractor…"
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1 text-gray-500 dark:text-gray-400">Master</label>
          <select
            value={filterMaster}
            onChange={(e) => setFilterMaster(e.target.value)}
            className="border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            <option value="">All masters</option>
            {masterOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1 text-gray-500 dark:text-gray-400">Contractor</label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            <option value="">All contractors</option>
            {optionsInScope.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1 text-gray-500 dark:text-gray-400">Report period</label>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-gray-800 font-medium focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        </div>
        {activeFilterCount > 0 && (
          <button
            onClick={() => {
              setSelected("");
              setFilterMaster("");
            }}
            className="flex items-center gap-1.5 text-sm font-medium pb-2 text-gray-500 dark:text-gray-400 hover:text-red-600"
          >
            <FiXCircle size={15} />
            Clear
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-gray-400 italic">
          {inScope.length === 0 ? "No contractors yet." : "No contractors match your search/filters."}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30">
            <div>
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Contractor Report — {periodLabel}</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                Earned, Paid &amp; Advance reflect {periodLabel === "All Time" ? "all-time" : periodLabel.toLowerCase()} activity — Balance is always the running total as of today.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
              <FiCalendar size={12} />
              Generated {generatedAt}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b divide-x divide-gray-200 dark:divide-gray-700 border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Contractor</th>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Master</th>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Earned</th>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Paid</th>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Advance</th>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Balance</th>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">
                    <span className="flex items-center gap-1"><FiFileText size={12} /> Recent Payments</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ contractor: c, report, stats, status }) => (
                  <tr
                    key={c._id}
                    className={`border-b divide-x divide-gray-200 dark:divide-gray-700 border-gray-100 dark:border-gray-800 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.05] ${REPORT_ROW_TINT[status.key]}`}
                  >
                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100 align-top">{c.name}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 align-top">{c.contractorType || "—"}</td>
                    <td className="px-4 py-3 align-top">{money(stats.earned)}</td>
                    <td className="px-4 py-3 align-top">{money(stats.paid)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 align-top">{stats.advance > 0 ? money(stats.advance) : "—"}</td>
                    <td className="px-4 py-3 font-semibold align-top">
                      {report.balance < 0 ? `${money(-report.balance)} owed back` : money(report.balance)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${REPORT_BADGE[status.key]}`}>{status.label}</span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {stats.recentPayments.length === 0 ? (
                        <span className="text-xs text-gray-400 italic">No payments{period !== "all" ? " this period" : " yet"}</span>
                      ) : (
                        <div className="min-w-[130px] divide-y divide-gray-100 dark:divide-gray-700">
                          {stats.recentPayments.slice(0, 3).map((p) => (
                            <div key={p._id} className="flex items-center justify-between gap-3 py-0.5 text-xs first:pt-0">
                              <span className="text-gray-500 dark:text-gray-400">{formatShortDate(p.date)}</span>
                              <span className="font-medium text-gray-700 dark:text-gray-200">{money(p.amount)}</span>
                            </div>
                          ))}
                          {stats.recentPayments.length > 3 && (
                            <div className="text-[11px] text-gray-400 pt-0.5">+{stats.recentPayments.length - 3} more</div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 divide-x divide-gray-200 dark:divide-gray-700 border-gray-300 dark:border-gray-600 font-semibold text-gray-800 dark:text-gray-100 bg-gray-50 dark:bg-gray-900/40">
                  <td className="px-4 py-3" colSpan={2}>
                    Total ({rows.length} {rows.length === 1 ? "contractor" : "contractors"})
                  </td>
                  <td className="px-4 py-3">{money(totals.earned)}</td>
                  <td className="px-4 py-3">{money(totals.paid)}</td>
                  <td className="px-4 py-3">{totals.advance > 0 ? money(totals.advance) : "—"}</td>
                  <td className="px-4 py-3">{totals.balance < 0 ? `${money(-totals.balance)} owed back` : money(totals.balance)}</td>
                  <td className="px-4 py-3" colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400 px-4 sm:px-5 py-3 border-t border-gray-100 dark:border-gray-700">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-600 inline-block" /> Paid up</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" /> Pending</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-600 inline-block" /> Delayed (14+ days)</span>
          </div>
        </div>
      )}
    </div>
  );
};

const TABS = [
  { key: "worklog", label: "Work Log" },
  { key: "payments", label: "Payments" },
  { key: "summary", label: "Report" },
];

const LaborWages = () => {
  const [mills, setMills] = useState([]);
  const [contractors, setContractors] = useState([]);
  const [wageEntries, setWageEntries] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("worklog");

  // Filters — same "Filters" toggle pattern as the Dashboard and Expense
  // Sheet pages (item 7: "add filters switch just like other two pages
  // have"), scoped to what's meaningful here: which mill, which contractors.
  const [showFilters, setShowFilters] = useState(false);
  const [filterMill, setFilterMill] = useState("");
  const [filterContractors, setFilterContractors] = useState([]);
  const activeFilterCount = (filterMill ? 1 : 0) + (filterContractors.length > 0 ? 1 : 0);
  const clearFilters = () => {
    setFilterMill("");
    setFilterContractors([]);
  };

  // Import/Download/Share for Work Log and Payments (18 Sep, per Rishi: "add
  // import download and export option in the vehicle section and labor
  // section") — same three-button toolbar as the Expense Sheet, one set per
  // ledger since each is its own tab/sheet.
  const [showWorkLogImportModal, setShowWorkLogImportModal] = useState(false);
  const [showWorkLogExportModal, setShowWorkLogExportModal] = useState(false);
  const [showPaymentsImportModal, setShowPaymentsImportModal] = useState(false);
  const [showPaymentsExportModal, setShowPaymentsExportModal] = useState(false);

  const contractorName = (id) => contractors.find((c) => c._id === id)?.name || "";
  const contractorMaster = (id) => contractors.find((c) => c._id === id)?.contractorType || "";
  // Resolves the same way LedgerSheet's own resolveMillName does (23 Sep) —
  // trust the entry's own millId, fall back to the contractor's sole mill
  // when there's no ambiguity, otherwise "—".
  const wageEntryMillName = (w) => {
    const millList = contractorOptions.find((o) => o.value === w.contractorId)?.millList || [];
    const id = w.millId || (millList.length === 1 ? millList[0]._id : null);
    return millList.find((m) => m._id === id)?.name || "—";
  };

  const handleExportWorkLogCsv = () => {
    if (wageEntries.length === 0) {
      alert("No work log entries to export yet");
      return;
    }
    downloadCsv(
      `${FILE_PREFIX}-work-log-${todayStr()}.csv`,
      [
        { key: "contractor", label: "Contractor" },
        { key: "mill", label: "Mill" },
        { key: "master", label: "Master" },
        { key: "date", label: "Date" },
        { key: "cft", label: "CFT" },
        { key: "rate", label: "Rate" },
        { key: "amount", label: "Amount (INR)" },
      ],
      wageEntries.map((w) => ({
        contractor: contractorName(w.contractorId),
        mill: wageEntryMillName(w),
        master: contractorMaster(w.contractorId),
        date: w.dateLabel,
        cft: w.cft,
        rate: w.rate,
        amount: w.amount,
      }))
    );
  };

  const handleExportPaymentsCsv = () => {
    if (payments.length === 0) {
      alert("No payments to export yet");
      return;
    }
    downloadCsv(
      `${FILE_PREFIX}-payments-${todayStr()}.csv`,
      [
        { key: "contractor", label: "Contractor" },
        { key: "master", label: "Master" },
        { key: "date", label: "Date" },
        { key: "label", label: "Label" },
        { key: "amount", label: "Amount (INR)" },
      ],
      payments.map((p) => ({
        contractor: contractorName(p.contractorId),
        master: contractorMaster(p.contractorId),
        date: p.date,
        label: p.label,
        amount: p.amount,
      }))
    );
  };

  // Combined Work Log + Payments export (22 Sep, per Rishi's notebook: "add
  // both work log and payment in the same sheet whenever we export or share
  // regardless of which tab triggers it" — also the same underlying ask as
  // the Eighteenth update's flagged "export only exports the currently-open
  // tab" bug). Available from either tab's toolbar, always pulls BOTH
  // ledgers together into one CSV, tagged by a Type column so the two kinds
  // of rows (CFT work vs. a payment) stay distinguishable once merged. A
  // downloadable CSV rather than a Google-Sheet share — the Share Sheet
  // button still exports one ledger at a time; combining that flow too is
  // a separate, not-yet-built piece (see status.md).
  const handleExportCombinedCsv = () => {
    if (wageEntries.length === 0 && payments.length === 0) {
      alert("No work log entries or payments to export yet");
      return;
    }
    const combined = [
      ...wageEntries.map((w) => ({
        type: "Work Log",
        contractor: contractorName(w.contractorId),
        master: contractorMaster(w.contractorId),
        date: w.dateLabel,
        details: `${wageEntryMillName(w)} — ${w.cft || 0} CFT × ₹${w.rate || 0}`,
        amount: w.amount,
      })),
      ...payments.map((p) => ({
        type: "Payment",
        contractor: contractorName(p.contractorId),
        master: contractorMaster(p.contractorId),
        date: p.date,
        details: p.label || "",
        amount: p.amount,
      })),
    ];
    downloadCsv(
      `${FILE_PREFIX}-work-log-and-payments-${todayStr()}.csv`,
      [
        { key: "type", label: "Type" },
        { key: "contractor", label: "Contractor" },
        { key: "master", label: "Master" },
        { key: "date", label: "Date" },
        { key: "details", label: "Details" },
        { key: "amount", label: "Amount (INR)" },
      ],
      combined
    );
  };

  // 23 Sep, per Rishi: needs real formatted .xlsx downloads, not just CSV —
  // same reasoning as Expenses.jsx's handleDownloadXlsx. One shared handler
  // parameterized by type since all three buttons (Work Log / Payments /
  // Combined) just hit the same download endpoint with a different type.
  const [downloadingXlsxType, setDownloadingXlsxType] = useState(null);
  const handleDownloadXlsx = async (type, emptyMessage) => {
    const isEmpty =
      type === "combined" ? wageEntries.length === 0 && payments.length === 0
      : type === "payments" ? payments.length === 0
      : wageEntries.length === 0;
    if (isEmpty) {
      alert(emptyMessage);
      return;
    }
    try {
      setDownloadingXlsxType(type);
      await downloadLabourSheetXlsx(type);
    } catch (err) {
      alert(err.message);
    } finally {
      setDownloadingXlsxType(null);
    }
  };

  const loadData = async () => {
    try {
      const [m, c, w, p] = await Promise.all([fetchMills(), fetchContractors(), fetchWageEntries(), fetchPayments()]);
      setMills(m);
      setContractors(c);
      setWageEntries(w);
      setPayments(p);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // "Ramesh (Mill No-01, KTPL I)" — enough to tell two same-named
  // contractors at different mills apart without leaving this page. A
  // contractor covering several mills (22 Sep, multi-mill support — e.g.
  // Jamir on Mill-11/12/13) lists all of them instead of just one.
  const contractorOptions = useMemo(() => {
    const millsById = new Map(mills.map((m) => [m._id, m]));
    return contractors.map((c) => {
      const millList = (c.millIds || []).map((id) => millsById.get(id)).filter(Boolean);
      const millLabel =
        millList.length === 0 ? "" : millList.length === 1 ? `${millList[0].name}, ${millList[0].location}` : millList.map((m) => m.name).join("/");
      // master (21 Sep, per Rishi: "add one master column in labour wages
      // sheet in workflow and payment sub split pages both") — carried along
      // here so LedgerSheet can show it without a separate lookup.
      // millList (23 Sep, per Rishi: a multi-mill contractor's CFT output is
      // different per mill and lumping it into one entry loses which mill
      // produced what) — the real Mill objects (not just the label string
      // above), so the Work Log draft row can offer them as a per-entry
      // picker and existing rows can resolve their own millId back to a name.
      return { value: c._id, label: millLabel ? `${c.name} (${millLabel})` : c.name, master: c.contractorType || "", millList };
    });
  }, [contractors, mills]);

  const allowedContractorIds = useMemo(() => {
    if (!filterMill && filterContractors.length === 0) return null;
    let ids = contractors.map((c) => c._id);
    if (filterMill) ids = ids.filter((id) => (contractors.find((c) => c._id === id)?.millIds || []).includes(filterMill));
    if (filterContractors.length > 0) ids = ids.filter((id) => filterContractors.includes(id));
    return new Set(ids);
  }, [contractors, filterMill, filterContractors]);

  if (loading) {
    return <div className="p-4 sm:p-6 text-sm text-gray-400">Loading…</div>;
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">Labor Wages</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Log CFT cut and payments here. Add or edit mills, contractors and labor from the menu icon, top right.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-2 border rounded-lg px-3 py-2.5 text-sm font-medium ${
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
          {tab !== "summary" && (
            <div className="relative w-full sm:w-64">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search contractor, date..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 flex flex-wrap items-start gap-5">
          <div>
            <label className="block text-xs font-medium mb-1 text-gray-500 dark:text-gray-400">Mill</label>
            <select
              value={filterMill}
              onChange={(e) => setFilterMill(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400 min-w-[11rem]"
            >
              <option value="">All mills</option>
              {mills.map((m) => (
                <option key={m._id} value={m._id}>{m.name} ({m.location})</option>
              ))}
            </select>
          </div>
          <div className="min-w-[14rem]">
            <label className="block text-xs font-medium mb-1 text-gray-500 dark:text-gray-400">Contractor</label>
            <div className="flex flex-wrap gap-1.5 max-w-md">
              {contractorOptions.length === 0 && <span className="text-sm text-gray-400 italic">No contractors yet</span>}
              {contractorOptions.map((o) => {
                const active = filterContractors.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() =>
                      setFilterContractors((prev) => (active ? prev.filter((v) => v !== o.value) : [...prev, o.value]))
                    }
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      active
                        ? "bg-red-600 border-red-600 text-white"
                        : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 text-sm font-medium pb-2 self-end text-gray-500 dark:text-gray-400 hover:text-red-600"
            >
              <FiXCircle size={15} />
              Clear filters
            </button>
          )}
        </div>
      )}

      {contractors.length === 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          No contractors yet — add a mill and a contractor from the menu icon (top right) before logging wages here.
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
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

      {tab === "worklog" && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Work Log (CFT)</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowWorkLogImportModal(true)}
                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center text-xs font-medium"
              >
                <FiUploadCloud size={14} className="mr-1.5" /> Import
              </button>
              <DownloadMenu
                options={[
                  { key: "csv", label: "Download CSV", description: "Work Log only", onClick: handleExportWorkLogCsv },
                  {
                    key: "xlsx",
                    label: "Download Excel",
                    description: "Work Log only — formatted, ready to print",
                    onClick: () => handleDownloadXlsx("worklog", "No work log entries to export yet"),
                    busy: downloadingXlsxType === "worklog",
                  },
                  {
                    key: "combined-csv",
                    label: "Download Combined CSV",
                    description: "Work Log + Payments together",
                    onClick: handleExportCombinedCsv,
                  },
                  {
                    key: "combined-xlsx",
                    label: "Download Combined Excel",
                    description: "Work Log + Payments — two tabs, formatted",
                    onClick: () => handleDownloadXlsx("combined", "No work log entries or payments to export yet"),
                    busy: downloadingXlsxType === "combined",
                  },
                ]}
              />
              <button
                onClick={() => setShowWorkLogExportModal(true)}
                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center text-xs font-medium"
              >
                <FiGrid size={14} className="mr-1.5" /> Share Sheet
              </button>
            </div>
          </div>
          <div className="min-w-[720px]">
            <LedgerSheet
              rows={wageEntries}
              setRows={setWageEntries}
              contractorOptions={contractorOptions}
              dateLabel="Period"
              dateMode="range"
              fields={[
                { key: "cft", label: "CFT", placeholder: "CFT", type: "number", width: 90 },
                { key: "rate", label: "Rate (@)", placeholder: "@", type: "number", width: 80 },
              ]}
              computeAmount={(d) => (d.cft && d.rate ? Number(d.cft) * Number(d.rate) : null)}
              renderAmount={(row) => money(row.amount)}
              onAdd={(draft) =>
                // No more `.then(loadData)` here (22 Sep, performance fix) —
                // that used to re-fetch the WHOLE work log after every single
                // add, which is what made Enter feel like it froze for 1-2s.
                // DraftRow now does its own optimistic insert via setRows and
                // just needs the saved entity back to replace its temp row.
                addWageEntry({
                  contractorId: draft.contractorId,
                  millId: draft.millId, // 23 Sep — which mill this CFT batch belongs to, for a multi-mill contractor
                  dateLabel: draft.date,
                  cft: draft.cft,
                  rate: draft.rate,
                  customFields: draft.customFields,
                })
              }
              onDelete={(id) => deleteWageEntry(id).then(loadData)}
              onBulkDelete={(ids) => bulkDeleteWageEntries(ids).then(loadData)}
              search={search}
              allowedContractorIds={allowedContractorIds}
              sheetKey="wageEntries"
              millPicker
              filterMillId={filterMill}
            />
          </div>
        </div>
      )}

      {tab === "payments" && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Payments &amp; Advances</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowPaymentsImportModal(true)}
                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center text-xs font-medium"
              >
                <FiUploadCloud size={14} className="mr-1.5" /> Import
              </button>
              <DownloadMenu
                options={[
                  { key: "csv", label: "Download CSV", description: "Payments only", onClick: handleExportPaymentsCsv },
                  {
                    key: "xlsx",
                    label: "Download Excel",
                    description: "Payments only — formatted, ready to print",
                    onClick: () => handleDownloadXlsx("payments", "No payments to export yet"),
                    busy: downloadingXlsxType === "payments",
                  },
                  {
                    key: "combined-csv",
                    label: "Download Combined CSV",
                    description: "Work Log + Payments together",
                    onClick: handleExportCombinedCsv,
                  },
                  {
                    key: "combined-xlsx",
                    label: "Download Combined Excel",
                    description: "Work Log + Payments — two tabs, formatted",
                    onClick: () => handleDownloadXlsx("combined", "No work log entries or payments to export yet"),
                    busy: downloadingXlsxType === "combined",
                  },
                ]}
              />
              <button
                onClick={() => setShowPaymentsExportModal(true)}
                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center text-xs font-medium"
              >
                <FiGrid size={14} className="mr-1.5" /> Share Sheet
              </button>
            </div>
          </div>
          <div className="min-w-[640px]">
            <LedgerSheet
              rows={payments}
              setRows={setPayments}
              contractorOptions={contractorOptions}
              dateLabel="Date"
              dateType="date"
              fields={[
                { key: "label", label: "Label", placeholder: "CASH/ADV, S&E, ..." },
                { key: "amount", label: "Amount", placeholder: "Amount", type: "number", width: 100, format: money },
              ]}
              onAdd={(draft) =>
                // Same optimistic-insert change as Work Log above — no more
                // `.then(loadData)` reloading everything after each add.
                addPayment({
                  contractorId: draft.contractorId,
                  date: draft.date,
                  label: draft.label,
                  amount: draft.amount,
                  customFields: draft.customFields,
                })
              }
              onDelete={(id) => deletePayment(id).then(loadData)}
              onBulkDelete={(ids) => bulkDeletePayments(ids).then(loadData)}
              search={search}
              allowedContractorIds={allowedContractorIds}
              sheetKey="payments"
            />
          </div>
        </div>
      )}

      {tab === "summary" && (
        <SummaryReport
          contractors={contractors}
          contractorOptions={contractorOptions}
          wageEntries={wageEntries}
          payments={payments}
          allowedContractorIds={allowedContractorIds}
        />
      )}

      {showWorkLogImportModal && (
        <ImportSheetModal
          title="Import Work Log"
          onClose={() => setShowWorkLogImportModal(false)}
          onImported={() => {
            setShowWorkLogImportModal(false);
            loadData();
          }}
          previewFile={(file) => previewLabourImportSheet(file, "worklog").then((data) => withContractorMatch(data, contractors))}
          previewSheet={(url) => previewLabourFromGoogleSheet(url, "worklog").then((data) => withContractorMatch(data, contractors))}
          onCommit={(rows) => bulkAddWageEntries(rows.map((r) => ({ contractorId: r.contractorId, dateLabel: r.dateLabel, cft: r.cft, rate: r.rate })))}
          sheetHint="Paste the link (or just the ID) of a Google Sheet with columns for contractor, date, CFT and rate — it needs to be shared with the app's service account as an Editor."
          headerCells={
            <>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Contractor</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">CFT</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Rate</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount</th>
            </>
          }
          renderRow={(r, { updateRow }) => (
            <>
              <td className="px-3 py-2">
                <select
                  value={r.contractorId}
                  onChange={(e) =>
                    updateRow(r._rowNumber, { contractorId: e.target.value, include: !!e.target.value && r.cft !== "" && r.rate !== "" })
                  }
                  className={`border rounded px-1.5 py-1 text-xs bg-white dark:bg-gray-900 ${r.contractorId ? "border-gray-300 dark:border-gray-600" : "border-amber-400"}`}
                >
                  <option value="">{r.contractorText ? `"${r.contractorText}" — pick one` : "Pick a contractor"}</option>
                  {contractorOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{r.dateLabel}</td>
              <td className="px-3 py-2 text-right">{r.cft === "" ? "—" : r.cft}</td>
              <td className="px-3 py-2 text-right">{r.rate === "" ? "—" : r.rate}</td>
              <td className="px-3 py-2 text-right">{r.amount === null ? "—" : money(r.amount)}</td>
            </>
          )}
        />
      )}

      {showWorkLogExportModal && (
        <ExportSheetModal
          title="Share the Work Log"
          onClose={() => setShowWorkLogExportModal(false)}
          fetchStatus={fetchLabourSheetsStatus}
          onEmail={(email, note, scope) => emailLabourSheet(email, note, scope || "worklog")}
          onExport={(sheetUrl, scope) => exportLabourToGoogleSheet(sheetUrl, scope || "worklog")}
          emailDescription='Sends the sheet as a spreadsheet attachment. No setup needed at the other end — in Gmail they can click the file and choose "Open with Google Sheets".'
          sheetDescription="For a Sheet you want kept up to date in place. Paste the link of a Google Sheet shared with the app's service account as an Editor — its contents get replaced."
          scopeOptions={[
            { key: "worklog", label: "Work Log only" },
            { key: "combined", label: "Work Log + Payments (combined)" },
          ]}
        />
      )}

      {showPaymentsImportModal && (
        <ImportSheetModal
          title="Import Payments"
          onClose={() => setShowPaymentsImportModal(false)}
          onImported={() => {
            setShowPaymentsImportModal(false);
            loadData();
          }}
          previewFile={(file) => previewLabourImportSheet(file, "payments").then((data) => withContractorMatch(data, contractors))}
          previewSheet={(url) => previewLabourFromGoogleSheet(url, "payments").then((data) => withContractorMatch(data, contractors))}
          onCommit={(rows) => bulkAddPayments(rows.map((r) => ({ contractorId: r.contractorId, date: r.date, label: r.label, amount: r.amount })))}
          sheetHint="Paste the link (or just the ID) of a Google Sheet with columns for contractor, date, label and amount — it needs to be shared with the app's service account as an Editor."
          headerCells={
            <>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Contractor</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Label</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount</th>
            </>
          }
          renderRow={(r, { updateRow }) => (
            <>
              <td className="px-3 py-2">
                <select
                  value={r.contractorId}
                  onChange={(e) => updateRow(r._rowNumber, { contractorId: e.target.value, include: !!e.target.value && r.amount !== "" })}
                  className={`border rounded px-1.5 py-1 text-xs bg-white dark:bg-gray-900 ${r.contractorId ? "border-gray-300 dark:border-gray-600" : "border-amber-400"}`}
                >
                  <option value="">{r.contractorText ? `"${r.contractorText}" — pick one` : "Pick a contractor"}</option>
                  {contractorOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{r.date}</td>
              <td className="px-3 py-2">{r.label}</td>
              <td className="px-3 py-2 text-right">{r.amount === "" ? "—" : money(r.amount)}</td>
            </>
          )}
        />
      )}

      {showPaymentsExportModal && (
        <ExportSheetModal
          title="Share the Payments Sheet"
          onClose={() => setShowPaymentsExportModal(false)}
          fetchStatus={fetchLabourSheetsStatus}
          onEmail={(email, note, scope) => emailLabourSheet(email, note, scope || "payments")}
          onExport={(sheetUrl, scope) => exportLabourToGoogleSheet(sheetUrl, scope || "payments")}
          emailDescription='Sends the sheet as a spreadsheet attachment. No setup needed at the other end — in Gmail they can click the file and choose "Open with Google Sheets".'
          sheetDescription="For a Sheet you want kept up to date in place. Paste the link of a Google Sheet shared with the app's service account as an Editor — its contents get replaced."
          scopeOptions={[
            { key: "payments", label: "Payments only" },
            { key: "combined", label: "Work Log + Payments (combined)" },
          ]}
        />
      )}
    </div>
  );
};

export default LaborWages;
