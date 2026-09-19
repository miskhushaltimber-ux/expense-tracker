import React, { useEffect, useMemo, useRef, useState } from "react";
import { FiChevronDown, FiCheck } from "react-icons/fi";

// Master filter as a checkbox list rather than a single-choice dropdown, so a
// few specific ledger heads can be compared against each other — "timber,
// transport and labour, but nothing else" was impossible with a plain select.
//
// An empty selection means "all masters", which keeps the default behaviour
// identical to before and avoids an empty-screen state if everything gets
// unticked.
const MasterMultiSelect = ({ options, selected, onChange, inputRef, onKeyDown, buttonClassName }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapperRef = useRef(null);

  // Click-away closes it; without this the panel stays open behind other
  // controls and looks stuck.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, search]);

  const toggle = (master) => {
    onChange(selected.includes(master) ? selected.filter((m) => m !== master) : [...selected, master]);
  };

  const label =
    selected.length === 0
      ? "All masters"
      : selected.length === 1
      ? selected[0]
      : `${selected.length} masters`;

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        ref={inputRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        className={
          buttonClassName ||
          "flex items-center justify-between gap-2 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-red-400 min-w-[11rem]"
        }
      >
        <span className="truncate">{label}</span>
        <FiChevronDown size={14} className="shrink-0 text-gray-400 dark:text-gray-500" />
      </button>

      {open && (
        <div className="absolute z-30 left-0 mt-1 w-72 max-w-[80vw] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <div className="p-2 border-b border-gray-100 dark:border-gray-700">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a master..."
              autoFocus
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-900 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            />
          </div>

          <div className="max-h-56 overflow-y-auto py-1">
            {visible.length === 0 && (
              <p className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500">No matching master</p>
            )}
            {visible.map((m) => {
              const isOn = selected.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggle(m)}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-900 text-gray-700 dark:text-gray-200"
                >
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                      isOn
                        ? "bg-red-600 border-red-600 text-white"
                        : "border-gray-300 dark:border-gray-600"
                    }`}
                  >
                    {isOn && <FiCheck size={11} />}
                  </span>
                  <span className="truncate" title={m}>
                    {m}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex justify-between items-center p-2 border-t border-gray-100 dark:border-gray-700">
            <button
              type="button"
              onClick={() => onChange([...options])}
              className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-red-600"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-red-600"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MasterMultiSelect;
