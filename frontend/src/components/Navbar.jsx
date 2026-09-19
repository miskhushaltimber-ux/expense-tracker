import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Menu, PieChart, Database, FolderOpen } from "lucide-react";
import { APP_NAME } from "../constants/brand";

// The top-right corner sat empty since this navbar was first built — this
// hamburger opened a single page (Manage Data) for a while. 18 Sep, per
// Rishi: "in three lines in nav bar add one section where we the user can
// see the images and documents uploaded" — it's now a small dropdown with
// two destinations: Manage Data (master/reference data) and the new
// Documents page (every uploaded file, organized by section).

// onMenuClick opens the mobile/tablet sidebar drawer (owned by DashboardLayout).
// The hamburger only renders below the lg breakpoint — on desktop the sidebar
// is always visible so there's nothing to toggle.
const Navbar = ({ onMenuClick }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  return (
    <nav className="bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-3 sm:px-6 py-3">
      <div className="flex justify-between items-center gap-3">
        <div className="flex items-center min-w-0">
          <button
            onClick={onMenuClick}
            className="lg:hidden mr-2 p-2 -ml-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-all shrink-0"
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <Link
            to="/dashboard"
            className="flex items-center min-w-0 text-blue-600 dark:text-blue-400 font-bold text-base sm:text-xl tracking-wide hover:text-blue-800 dark:hover:text-blue-300 transition-all"
          >
            <PieChart className="h-5 w-5 sm:h-6 sm:w-6 mr-2 shrink-0" />
            <span className="truncate">{APP_NAME}</span>
          </Link>
        </div>

        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-all"
            aria-label="More"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            title="More"
          >
            <Menu size={22} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-1 w-52 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-40">
              <Link
                to="/dashboard/manage-data"
                onClick={() => setMenuOpen(false)}
                className="flex items-center px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-900"
              >
                <Database size={17} className="mr-3 shrink-0" />
                Manage Data
              </Link>
              <Link
                to="/dashboard/documents"
                onClick={() => setMenuOpen(false)}
                className="flex items-center px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-900"
              >
                <FolderOpen size={17} className="mr-3 shrink-0" />
                Documents
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
