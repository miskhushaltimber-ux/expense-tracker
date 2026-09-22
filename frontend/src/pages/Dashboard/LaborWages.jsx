import React, { useEffect, useMemo, useRef, useState } from "react";
import { FiTrash2, FiSearch, FiFilter, FiXCircle, FiUploadCloud, FiDownload, FiGrid } from "react-icons/fi";
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
import { fetchLabourSheetsStatus, exportLabourToGoogleSheet, previewLabourFromGoogleSheet, emailLabourSheet } from "../../api/sheets";
import { FILE_PREFIX } from "../../constants/brand";
import { downloadCsv } from "../../utils/exportCsv";
import ImportSheetModal from "../../components/ImportSheetModal";
import ExportSheetModal from "../../components/ExportSheetModal";
import { CustomCell, ManageColumnsButton } from "../../components/CustomColumns";
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
const DraftRow = ({ isRange, dateType, fields, contractorOptions, customColumns, computeAmount, onAdd, onBulkDelete, setRows }) => {
  const emptyDraft = () => ({
    contractorId: "",
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

  const FIELD_ORDER = isRange
    ? ["dateFrom", "dateTo", "contractorId", ...fields.map((f) => f.key)]
    : ["date", "contractorId", ...fields.map((f) => f.key)];

  const commit = async () => {
    const dateValue = isRange ? combineDateRange(draft.dateFrom, draft.dateTo) : draft.date.trim();
    if (!dateValue || !draft.contractorId) return;

    // Optimistic insert (22 Sep, per Rishi: hitting Enter used to visibly
    // freeze for 1-2s before the row appeared — because LaborWages used to
    // reload the WHOLE ledger from the server after every add. Now the row
    // appears and the draft resets INSTANTLY; the real saved row (with its
    // real id) quietly swaps in once the server responds, and rolls back —
    // draft restored, nothing lost — if the save actually fails.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const submittedDraft = draft;
    const tempAmount = computeAmount ? computeAmount(submittedDraft) : Number(submittedDraft.amount || 0);
    const tempRow = {
      _id: tempId,
      contractorId: submittedDraft.contractorId,
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
          onChange={(e) => setDraft((d) => ({ ...d, contractorId: e.target.value }))}
          onKeyDown={(e) => handleKeyDown(e, "contractorId")}
          className="border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400"
        >
          <option value="">Choose contractor…</option>
          {contractorOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </td>
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
}) => {
  const isRange = dateMode === "range";

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
        />

        {filtered.length === 0 && (
          <tr>
            <td
              colSpan={(onBulkDelete ? 1 : 0) + dateCols + 3 + fields.length + customColumns.length + (computeAmount ? 1 : 0)}
              className="px-3 py-2 text-gray-400 italic"
            >
              {rows.length === 0 ? "Nothing logged yet." : "No rows match your search."}
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

// Redesigned 22 Sep, per Rishi's notebook: "looks bad as hell" — a colored
// left accent bar (green/amber/red, matching the settle status) replaces the
// plain status line as the card's primary signal, a Master chip sits next to
// the mill label when the contractor has one, and the numbers are laid out
// as small stat blocks instead of a loose 3-column grid.
const ReportCard = ({ contractor, millLabel, report }) => {
  const { totalEarned, totalPaid, openingBalance, balance } = report;
  const status =
    balance > 0
      ? { text: `Pending — you owe ${money(balance)}`, cls: "text-amber-700 dark:text-amber-400", bar: "border-l-amber-400", badge: "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" }
      : balance < 0
      ? { text: `${contractor.name} owes back ${money(-balance)}`, cls: "text-red-700 dark:text-red-400", bar: "border-l-red-400", badge: "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300" }
      : { text: "Settled", cls: "text-green-700 dark:text-green-400", bar: "border-l-green-400", badge: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300" };

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow border-l-4 ${status.bar} p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100 truncate">{contractor.name}</h3>
          {millLabel && <p className="text-xs text-gray-400 truncate">{millLabel}</p>}
        </div>
        {contractor.contractorType && (
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300">
            {contractor.contractorType}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <div className="text-gray-400 text-[11px]">Paid</div>
          <div className="font-medium text-gray-800 dark:text-gray-100">{money(totalPaid)}</div>
        </div>
        <div>
          <div className="text-gray-400 text-[11px]">Earned</div>
          <div className="font-medium text-gray-800 dark:text-gray-100">{money(totalEarned)}</div>
        </div>
        <div>
          <div className="text-gray-400 text-[11px]">Opening</div>
          <div className="font-medium text-gray-800 dark:text-gray-100">{money(openingBalance)}</div>
        </div>
      </div>
      <span className={`inline-block text-xs font-medium px-2 py-1 rounded-full ${status.badge}`}>{status.text}</span>
    </div>
  );
};

const SummaryReport = ({ contractors, contractorOptions, wageEntries, payments, allowedContractorIds }) => {
  const [selected, setSelected] = useState("");
  // Search + Master filter (22 Sep, per Rishi's notebook) — a Master filter
  // is only meaningful now that contractorType (Manage Data's "Master" tag)
  // exists at all, see the Eighteenth update.
  const [search, setSearch] = useState("");
  const [filterMaster, setFilterMaster] = useState("");

  const inScope = allowedContractorIds ? contractors.filter((c) => allowedContractorIds.has(c._id)) : contractors;
  // The dropdown/filter options themselves should only offer contractors the
  // page-level Mill/Contractor filter left in scope — otherwise picking a
  // filtered-out name here would silently ignore that filter.
  const optionsInScope = allowedContractorIds
    ? contractorOptions.filter((o) => allowedContractorIds.has(o.value))
    : contractorOptions;
  const masterOptions = useMemo(
    () => [...new Set(inScope.map((c) => c.contractorType).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [inScope]
  );

  const q = search.trim().toLowerCase();
  const shown = inScope.filter((c) => {
    if (selected && c._id !== selected) return false;
    if (filterMaster && c.contractorType !== filterMaster) return false;
    if (q && !c.name.toLowerCase().includes(q)) return false;
    return true;
  });

  // A small totals strip across whatever's actually shown — lets Rishi see
  // "how much pending across these N contractors" without adding every
  // card's own number in his head.
  const shownTotals = useMemo(() => {
    return shown.reduce(
      (acc, c) => {
        const r = contractorReport(c, wageEntries, payments);
        acc.earned += r.totalEarned;
        acc.paid += r.totalPaid;
        acc.balance += r.balance;
        return acc;
      },
      { earned: 0, paid: 0, balance: 0 }
    );
  }, [shown, wageEntries, payments]);

  const activeFilterCount = (filterMaster ? 1 : 0) + (selected ? 1 : 0);

  return (
    <div className="space-y-4">
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

      {shown.length > 0 && (
        <div className="flex flex-wrap gap-4 bg-gray-50 dark:bg-gray-900/40 rounded-lg px-4 py-3 text-sm">
          <span className="text-gray-500 dark:text-gray-400">
            {shown.length} {shown.length === 1 ? "contractor" : "contractors"}
          </span>
          <span>Earned <span className="font-semibold text-gray-800 dark:text-gray-100">{money(shownTotals.earned)}</span></span>
          <span>Paid <span className="font-semibold text-gray-800 dark:text-gray-100">{money(shownTotals.paid)}</span></span>
          <span>
            {shownTotals.balance < 0 ? "Owed back" : "Pending"}{" "}
            <span className={`font-semibold ${shownTotals.balance > 0 ? "text-amber-700 dark:text-amber-400" : shownTotals.balance < 0 ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
              {money(Math.abs(shownTotals.balance))}
            </span>
          </span>
        </div>
      )}

      {shown.length === 0 && (
        <div className="text-sm text-gray-400 italic">
          {inScope.length === 0 ? "No contractors yet." : "No contractors match your search/filters."}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {shown.map((c) => {
          const opt = contractorOptions.find((o) => o.value === c._id);
          const millLabel = opt?.label?.includes("(") ? opt.label.slice(opt.label.indexOf("(") + 1, -1) : null;
          return (
            <ReportCard
              key={c._id}
              contractor={c}
              millLabel={millLabel}
              report={contractorReport(c, wageEntries, payments)}
            />
          );
        })}
      </div>
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

  const handleExportWorkLogCsv = () => {
    if (wageEntries.length === 0) {
      alert("No work log entries to export yet");
      return;
    }
    downloadCsv(
      `${FILE_PREFIX}-work-log-${todayStr()}.csv`,
      [
        { key: "contractor", label: "Contractor" },
        { key: "master", label: "Master" },
        { key: "date", label: "Date" },
        { key: "cft", label: "CFT" },
        { key: "rate", label: "Rate" },
        { key: "amount", label: "Amount (INR)" },
      ],
      wageEntries.map((w) => ({
        contractor: contractorName(w.contractorId),
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
        details: `${w.cft || 0} CFT × ₹${w.rate || 0}`,
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
      return { value: c._id, label: millLabel ? `${c.name} (${millLabel})` : c.name, master: c.contractorType || "" };
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
              <button
                onClick={handleExportWorkLogCsv}
                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center text-xs font-medium"
                title="Download as a .csv file (opens in Excel or Google Sheets)"
              >
                <FiDownload size={14} className="mr-1.5" /> Download CSV
              </button>
              <button
                onClick={handleExportCombinedCsv}
                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center text-xs font-medium"
                title="Download Work Log + Payments together as one .csv file"
              >
                <FiDownload size={14} className="mr-1.5" /> Download Combined CSV
              </button>
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
              <button
                onClick={handleExportPaymentsCsv}
                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center text-xs font-medium"
                title="Download as a .csv file (opens in Excel or Google Sheets)"
              >
                <FiDownload size={14} className="mr-1.5" /> Download CSV
              </button>
              <button
                onClick={handleExportCombinedCsv}
                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center text-xs font-medium"
                title="Download Work Log + Payments together as one .csv file"
              >
                <FiDownload size={14} className="mr-1.5" /> Download Combined CSV
              </button>
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
          onEmail={(email, note) => emailLabourSheet(email, note, "worklog")}
          onExport={(sheetUrl) => exportLabourToGoogleSheet(sheetUrl, "worklog")}
          emailDescription='Sends the Work Log (CFT) as a spreadsheet attachment. No setup needed at the other end — in Gmail they can click the file and choose "Open with Google Sheets".'
          sheetDescription="For a Sheet you want kept up to date in place. Paste the link of a Google Sheet shared with the app's service account as an Editor — its contents get replaced with the work log."
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
          onEmail={(email, note) => emailLabourSheet(email, note, "payments")}
          onExport={(sheetUrl) => exportLabourToGoogleSheet(sheetUrl, "payments")}
          emailDescription='Sends the Payments & Advances sheet as a spreadsheet attachment. No setup needed at the other end — in Gmail they can click the file and choose "Open with Google Sheets".'
          sheetDescription="For a Sheet you want kept up to date in place. Paste the link of a Google Sheet shared with the app's service account as an Editor — its contents get replaced with the payments sheet."
        />
      )}
    </div>
  );
};

export default LaborWages;
