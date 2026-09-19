import React, { useState } from "react";
import { DEFAULT_EXPENSE_MASTERS } from "/src/constants/categories";
import { FiEdit2, FiTrash2, FiPlus, FiCheck, FiX } from "react-icons/fi";
import SuggestInput from "./SuggestInput";
import { createMaster, renameMaster, deleteMaster } from "/src/api/masters";

// The Master column's autocomplete.
//
// Without a `catalog` prop this is what it always was: a thin wrapper over
// SuggestInput that supplies the ledger-head list. Pass a catalog (objects with
// id + name) and `onCatalogChange`, and the dropdown also becomes the place to
// rename, delete and add masters — which is where sir asked for it: "we can add
// a new one there only".
const MasterAutocomplete = ({ masters, catalog, onCatalogChange, ...props }) => {
  // props.value / props.onChange are the cell this dropdown belongs to.
  // Hooks run unconditionally — the read-only path below is a render choice,
  // never an early return before hooks.
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const options = masters?.length ? masters : DEFAULT_EXPENSE_MASTERS;

  // Management needs real ids. A catalog that came from the offline fallback
  // has none, so the dropdown quietly stays read-only rather than offering
  // buttons that cannot work.
  const manageable = Array.isArray(catalog) && catalog.some((m) => m.id);

  const entryFor = (name) =>
    (catalog || []).find((m) => (m.name || "").trim().toLowerCase() === (name || "").trim().toLowerCase());

  const reset = () => {
    setEditingId(null);
    setEditingText("");
    setNotice("");
  };

  // `settle` runs after a successful change, to put the result into the cell:
  // adding a master selects it (that is why you typed it), and renaming one
  // updates the cell if it was showing the old name.
  const run = async (fn, settle) => {
    setBusy(true);
    setNotice("");
    try {
      await fn();
      settle?.();
      await onCatalogChange?.();
      reset();
    } catch (err) {
      // Shown inside the dropdown rather than as a toast: the refusal explains
      // why this particular master can't go, so it belongs next to it.
      setNotice(err.message || "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (name) => {
    const entry = entryFor(name);
    if (!entry) return;
    setEditingId(entry.id);
    setEditingText(entry.name);
    setNotice("");
  };

  // Stops a click inside the dropdown from committing the cell or letting the
  // input's delayed blur close the list before the click has done its job.
  const swallow = (keepOpen) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    keepOpen();
  };

  const renderRow = (name, { highlighted, select, keepOpen }) => {
    const entry = entryFor(name);
    if (!entry) return null; // falls back to SuggestInput's plain row

    if (editingId === entry.id) {
      return (
        <div
          className="flex items-center gap-1 px-2 py-1.5 bg-gray-50 dark:bg-gray-900"
          onMouseDown={swallow(keepOpen)}
        >
          <input
            autoFocus
            aria-label={`New name for ${entry.name}`}
            value={editingText}
            disabled={busy}
            onChange={(e) => setEditingText(e.target.value)}
            onKeyDown={(e) => {
              // Kept off the cell's own key handling — Enter here means "save
              // this name", not "move to the next column".
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                run(() => renameMaster(entry.id, editingText), () => {
                  if (props.value === entry.name) props.onChange(editingText.trim());
                });
              }
              if (e.key === "Escape") {
                e.preventDefault();
                reset();
              }
            }}
            className="flex-1 min-w-0 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
          <button
            onClick={() =>
              run(() => renameMaster(entry.id, editingText), () => {
                if (props.value === entry.name) props.onChange(editingText.trim());
              })
            }
            disabled={busy || !editingText.trim()}
            title="Save the new name"
            className="p-1 text-green-700 dark:text-green-400 disabled:opacity-40"
          >
            <FiCheck size={15} />
          </button>
          <button onClick={reset} disabled={busy} title="Cancel" className="p-1 text-gray-500 dark:text-gray-400">
            <FiX size={15} />
          </button>
        </div>
      );
    }

    return (
      <div
        className={`flex items-center ${
          highlighted ? "bg-red-50 dark:bg-red-900/30" : "hover:bg-gray-50 dark:hover:bg-gray-900"
        }`}
      >
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            keepOpen();
            select();
          }}
          className={`flex-1 min-w-0 px-3 py-1.5 cursor-pointer truncate ${
            highlighted ? "text-red-700 dark:text-red-300" : "text-gray-700 dark:text-gray-200"
          }`}
          title={name}
        >
          {name}
        </div>
        <div className="flex items-center pr-2 shrink-0" onMouseDown={swallow(keepOpen)}>
          <button
            onClick={() => startEdit(name)}
            disabled={busy}
            title={`Rename "${name}"`}
            aria-label={`Rename ${name}`}
            className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
          >
            <FiEdit2 size={13} />
          </button>
          <button
            onClick={() => run(() => deleteMaster(entry.id))}
            disabled={busy}
            title={`Delete "${name}"`}
            aria-label={`Delete ${name}`}
            className="p-1 text-gray-400 hover:text-red-600"
          >
            <FiTrash2 size={13} />
          </button>
        </div>
      </div>
    );
  };

  const renderFooter = ({ keepOpen, value }) => {
    const typed = (value || "").trim();
    const canAdd = typed.length > 0 && !entryFor(typed);
    if (!canAdd && !notice) return null;

    return (
      <div className="border-t border-gray-200 dark:border-gray-700" onMouseDown={swallow(keepOpen)}>
        {notice && (
          <p className="px-3 py-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/25">{notice}</p>
        )}
        {canAdd && (
          <button
            onClick={() => run(() => createMaster(typed), () => props.onChange(typed))}
            disabled={busy}
            className="flex items-center gap-2 w-full px-3 py-2 text-left text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/25 disabled:opacity-50"
          >
            <FiPlus size={14} className="shrink-0" />
            <span className="truncate">{busy ? "Adding…" : `Add "${typed}" as a new master`}</span>
          </button>
        )}
      </div>
    );
  };

  if (!manageable) return <SuggestInput {...props} options={options} />;

  return <SuggestInput {...props} options={options} renderRow={renderRow} renderFooter={renderFooter} />;
};

export default MasterAutocomplete;
