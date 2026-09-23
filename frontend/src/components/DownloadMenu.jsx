import React, { useEffect, useRef, useState } from "react";
import { FiDownload, FiChevronDown } from "react-icons/fi";

// Single "Download" button + dropdown (23 Sep, per Rishi: "on every page i
// see it choking the screen" — the Expense Sheet/Vehicle Expense Sheet had
// two separate Download buttons side by side, and Labor Wages had FOUR
// [CSV / Excel / Combined CSV / Combined Excel] on top of Import and Share
// Sheet — six buttons in one toolbar). Nothing about what any option
// actually downloads changed here, just how many buttons it takes to reach
// it: one "Download" button now opens a small menu listing every option for
// that sheet. Same click-outside-to-close pattern as Navbar's own dropdown.
const DownloadMenu = ({ options }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2.5 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center text-sm font-medium"
      >
        <FiDownload size={17} className="mr-2" /> Download
        <FiChevronDown size={15} className={`ml-2 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-40">
          {options.map((opt) => (
            <button
              key={opt.key}
              onClick={() => {
                setOpen(false);
                opt.onClick();
              }}
              disabled={opt.busy}
              className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-900 disabled:opacity-60"
            >
              <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
                {opt.busy ? opt.busyLabel || "Preparing…" : opt.label}
              </div>
              {opt.description && (
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{opt.description}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default DownloadMenu;
