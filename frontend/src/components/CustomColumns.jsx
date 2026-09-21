import React, { useEffect, useRef, useState } from "react";
import { FiPlus, FiTrash2, FiColumns } from "react-icons/fi";
import { addColumn, updateColumn, deleteColumn } from "../api/columns";

// Custom columns (21 Sep, per Rishi: "wht if in future they need anything
// added in the sheet"). Two exports, shared by the Expense Sheet, the
// Vehicle Expense Sheet, and Labor Wages' Work Log/Payments tabs:
//
//   <CustomCell colDef value onChange disabled /> — one editable cell for
//   one custom column, rendering the right input for its type (a select's
//   own dropdown, a real date/number input, or plain text). The caller owns
//   when the value actually gets saved (on blur vs. immediately), same as
//   every other cell in these sheets already does — this only renders the
//   control and reports changes upward.
//
//   <ManageColumnsButton sheetKey columns onChanged /> — the small toolbar
//   button + popover for adding, renaming, or removing a column. Any login
//   can use this (not owner-only, unlike Masters/Mills/Contractors/
//   Vehicles) — see backend/routes/columnDefRoutes.js.
//
// NOT wired into: Tab/Enter column-navigation chains (each sheet's fixed
// FIELD_ORDER array would need to be rebuilt dynamically per company, which
// is a bigger change on its own — a custom cell is reachable by Tab/click,
// just not the auto-jump-to-next-field Enter behaviour), import/export,
// filters, bulk-delete, or Dashboard charts. Flagged to Rishi as known gaps
// for this round rather than silently left half-done.

export const COLUMN_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown" },
];

const cellBase =
  "w-full border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1.5 text-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-red-400";

export const CustomCell = ({ colDef, value, onChange, onBlur, onKeyDown, inputRef, disabled = false }) => {
  if (disabled) {
    return <span className="text-sm text-gray-600 dark:text-gray-300">{value || value === 0 ? value : "—"}</span>;
  }
  if (colDef.type === "select") {
    return (
      <select ref={inputRef} value={value ?? ""} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} onKeyDown={onKeyDown} className={cellBase}>
        <option value="">—</option>
        {colDef.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (colDef.type === "number") {
    return (
      <input
        ref={inputRef}
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className={cellBase}
      />
    );
  }
  if (colDef.type === "date") {
    return (
      <input
        ref={inputRef}
        type="date"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className={cellBase}
      />
    );
  }
  return (
    <input
      ref={inputRef}
      type="text"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className={cellBase}
    />
  );
};

export const ManageColumnsButton = ({ sheetKey, columns, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: "", type: "text", optionsText: "" });
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const resetForm = () => setForm({ label: "", type: "text", optionsText: "" });

  const handleAdd = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.label.trim()) {
      setError("Column name is required");
      return;
    }
    const options = form.type === "select" ? form.optionsText.split(",").map((o) => o.trim()).filter(Boolean) : undefined;
    if (form.type === "select" && (!options || options.length === 0)) {
      setError("Add at least one option, separated by commas");
      return;
    }
    setAdding(true);
    try {
      await addColumn(sheetKey, { label: form.label.trim(), type: form.type, options });
      resetForm();
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (col) => {
    if (!window.confirm(`Remove the "${col.label}" column? Values already saved in it aren't deleted, they just won't show anymore.`)) return;
    setBusyId(col._id);
    try {
      await deleteColumn(col._id);
      await onChanged();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleRename = async (col, newLabel) => {
    if (!newLabel.trim() || newLabel.trim() === col.label) return;
    try {
      await updateColumn(col._id, { label: newLabel.trim() });
      await onChanged();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900"
        title="Add or manage columns"
      >
        <FiColumns size={14} /> Columns{columns.length ? ` (${columns.length})` : ""}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 z-40 space-y-3">
          {columns.length > 0 && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {columns.map((col) => (
                <div key={col._id} className="flex items-center gap-2">
                  <input
                    key={`${col._id}-${col.label}`}
                    defaultValue={col.label}
                    onBlur={(e) => handleRename(col, e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    className="flex-1 min-w-0 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                  <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{col.type}</span>
                  <button
                    type="button"
                    onClick={() => handleDelete(col)}
                    disabled={busyId === col._id}
                    className="text-gray-300 dark:text-gray-500 hover:text-red-600 p-1 shrink-0 disabled:opacity-50"
                    title={`Remove ${col.label}`}
                  >
                    <FiTrash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleAdd} className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-2">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Add a column</p>
            <input
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="Column name"
              disabled={adding}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
            />
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              disabled={adding}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              {COLUMN_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            {form.type === "select" && (
              <input
                value={form.optionsText}
                onChange={(e) => setForm((f) => ({ ...f, optionsText: e.target.value }))}
                placeholder="Options, comma separated (e.g. Yes, No)"
                disabled={adding}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            )}
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={adding}
              className="w-full flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
            >
              <FiPlus size={13} /> {adding ? "Adding…" : "Add column"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
