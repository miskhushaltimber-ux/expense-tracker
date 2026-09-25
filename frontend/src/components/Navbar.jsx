import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Menu, PieChart, Database, FolderOpen, Settings, Users, Grid } from "lucide-react";
import { toast } from "react-toastify";
import { APP_NAME } from "../constants/brand";
import { useAuth } from "../context/AuthContext";
import { prefetchHome, prefetchManageData, prefetchDocuments, prefetchTeam } from "../utils/routePrefetch";
import { fetchSettings, updateLinkedSheet } from "../api/settings";

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
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
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

  // Linked Google Sheet (25 Sep, per Rishi: "add a link google sheet bar in
  // the settings menu where we just link one sheet in it") — every new
  // Expense/Vehicle/Work Log/Payment entry auto-syncs here from then on (see
  // backend/utils/sheetSync.js). Owner-only, same as Team & Activity above.
  // Fetched once on mount rather than per dropdown-open — it's one cheap GET
  // and the value rarely changes.
  const [sheetUrl, setSheetUrl] = useState("");
  const [savedSheetUrl, setSavedSheetUrl] = useState("");
  const [savingSheet, setSavingSheet] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    fetchSettings().then((s) => {
      setSheetUrl(s.linkedSheetUrl || "");
      setSavedSheetUrl(s.linkedSheetUrl || "");
    });
  }, [isOwner]);

  const handleSaveSheet = async () => {
    if (savingSheet) return;
    setSavingSheet(true);
    try {
      const result = await updateLinkedSheet(sheetUrl.trim());
      setSavedSheetUrl(result.linkedSheetUrl || "");
      setSheetUrl(result.linkedSheetUrl || "");
      toast.success(result.message || "Saved");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingSheet(false);
    }
  };

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
            onMouseEnter={prefetchHome}
            onFocus={prefetchHome}
            onTouchStart={prefetchHome}
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
            <Settings size={22} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-1 w-52 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-40">
              <Link
                to="/dashboard/manage-data"
                onClick={() => setMenuOpen(false)}
                onMouseEnter={prefetchManageData}
                onFocus={prefetchManageData}
                onTouchStart={prefetchManageData}
                className="flex items-center px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-900"
              >
                <Database size={17} className="mr-3 shrink-0" />
                Manage Data
              </Link>
              <Link
                to="/dashboard/documents"
                onClick={() => setMenuOpen(false)}
                onMouseEnter={prefetchDocuments}
                onFocus={prefetchDocuments}
                onTouchStart={prefetchDocuments}
                className="flex items-center px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-900"
              >
                <FolderOpen size={17} className="mr-3 shrink-0" />
                Documents
              </Link>
              {/* Owner-only (19 Sep, multi-user accounts) — staff have no use
                  for the team list or activity log, and the page itself
                  redirects them away even if they browse here directly. */}
              {isOwner && (
                <Link
                  to="/dashboard/team"
                  onClick={() => setMenuOpen(false)}
                  onMouseEnter={prefetchTeam}
                  onFocus={prefetchTeam}
                  onTouchStart={prefetchTeam}
                  className="flex items-center px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-900"
                >
                  <Users size={17} className="mr-3 shrink-0" />
                  Team &amp; Activity
                </Link>
              )}
              {isOwner && (
                <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-3 px-4 pb-3">
                  <p className="flex items-center text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    <Grid size={14} className="mr-1.5 shrink-0" /> Linked Google Sheet
                  </p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2 leading-snug">
                    Every new entry syncs here automatically. Share it with the service account as an Editor first.
                  </p>
                  <input
                    type="text"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveSheet()}
                    placeholder="Paste a Google Sheet link..."
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-900 px-2.5 py-1.5 rounded-md text-xs mb-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveSheet}
                      disabled={savingSheet || sheetUrl.trim() === savedSheetUrl.trim()}
                      className="flex-1 bg-blue-600 text-white text-xs font-medium py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      {savingSheet ? "Saving..." : "Save"}
                    </button>
                    {savedSheetUrl && (
                      <button
                        onClick={() => setSheetUrl("")}
                        disabled={savingSheet}
                        className="text-xs text-gray-400 hover:text-red-500 px-1"
                        title="Clear the field (still need to Save to unlink)"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] mt-1.5" style={{ color: savedSheetUrl ? "#16a34a" : "#9ca3af" }}>
                    {savedSheetUrl ? "Linked — auto-syncing" : "Not linked"}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
