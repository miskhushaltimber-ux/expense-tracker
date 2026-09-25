import React, { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { fetchExpenses } from "/src/api/expenses";
import { fetchVehicles } from "/src/api/vehicles";
import { fetchContractors, fetchWageEntries, fetchPayments } from "/src/api/labour";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { useAuth } from "/src/context/AuthContext";
import { useTheme } from "/src/context/ThemeContext";
import { APP_NAME, APP_TAGLINE } from "/src/constants/brand";
import SuggestInput from "/src/components/SuggestInput";
import MasterMultiSelect from "/src/components/MasterMultiSelect";
import { FiFilter, FiXCircle, FiX, FiAlertTriangle, FiChevronUp, FiChevronDown, FiGrid } from "react-icons/fi";
import ExportSheetModal from "/src/components/ExportSheetModal";
import { fetchSheetsStatus, exportAllToGoogleSheet } from "/src/api/sheets";

// Dashboard tabs (18 Sep, per Rishi's correction: "i said pages in inside the
// dashboard only just like what we did in labor page with work log, payments
// and report") — Overview / Vehicles / Labor Wages live as tabs on the ONE
// /dashboard route, same tab-bar pattern as LaborWages.jsx, not as separate
// routed pages. An earlier pass built VehicleDashboard.jsx/LaborDashboard.jsx
// as standalone routed pages; that was the wrong shape and has been undone
// here (those two files are now unused — see status.md).
const DASHBOARD_TABS = [
  { key: "overview", label: "Overview" },
  { key: "vehicles", label: "Vehicles" },
  { key: "labor", label: "Labor Wages" },
  // "All Sheets" (25 Sep, per Rishi: "what if i just want to view it and not
  // export?") — the in-app equivalent of the split-tab Google Sheet export:
  // same four categories, but just to look at, live, with nothing to paste
  // or push anywhere.
  { key: "allsheets", label: "All Sheets" },
];

const ALL_SHEETS_VIEWS = [
  { key: "expenses", label: "Expenses" },
  { key: "vehicles", label: "Vehicles" },
  { key: "worklog", label: "Work Log" },
  { key: "payments", label: "Payments" },
];

// --- Palette -----------------------------------------------------------
// Categorical slots, assigned in this fixed order and never cycled. Validated
// against this app's white card surface: lightness band, chroma floor, CVD
// separation (worst adjacent pair ΔE 9.1) and normal-vision separation (worst
// 19.6) all pass. Three of them sit under 3:1 contrast on white, which is why
// every chart here also carries a legend or axis labels — colour never has to
// carry identity on its own.
// Dark isn't an automatic flip of light — these are the same eight hues
// re-stepped for a dark surface and validated as their own set against it
// (worst adjacent CVD ΔE 8.4, normal-vision 19.3).
const SERIES_COLORS = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
const OTHER_COLOR = "#898781";

// Status colours are reserved — never reused as a series colour, and always
// shipped alongside an icon and words so they never signal by hue alone.
const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
};

const INKS = {
  light: { primary: "#0b0b0b", secondary: "#52514e", muted: "#898781", grid: "#e1e0d9", axis: "#c3c2b7", surface: "#ffffff" },
  dark: { primary: "#f3f4f6", secondary: "#c3c2b7", muted: "#898781", grid: "#374151", axis: "#4b5563", surface: "#1f2937" },
};

const TOP_MASTER_COUNT = 7;

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    amount || 0
  );

const formatDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN") : "No date");
const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;

const Card = ({ children, className = "" }) => (
  <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm ${className}`}>{children}</div>
);

// Per-chart period options (item i, take 2 — a global filter panel already
// exists above; these are separate, chart-local windows so e.g. the trend
// line can show 12 months while the pie stays on "this month").
const TREND_PERIOD_OPTIONS = [
  { value: "3m", label: "3 months" },
  { value: "6m", label: "6 months" },
  { value: "12m", label: "12 months" },
];
const BREAKDOWN_PERIOD_OPTIONS = [
  { value: "all", label: "All time" },
  { value: "month", label: "This month" },
  { value: "3m", label: "Last 3 months" },
  { value: "year", label: "This year" },
];
const TREND_MONTHS = { "3m": 3, "6m": 6, "12m": 12 };

// "all"/"month"/"3m"/"year" — a chart-local window, independent of the global
// from/to filter above it. Absent or unrecognised period reads as "all".
const withinPeriod = (dateStr, period) => {
  if (!period || period === "all") return true;
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  if (period === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  if (period === "3m") return d >= new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
  if (period === "year") return d.getFullYear() === now.getFullYear();
  return true;
};

// Every chart card: a header (title + optional period switch + collapse
// toggle) over a body that squeezes shut instead of unmounting. The
// grid-rows-[0fr → 1fr] trick animates to the content's real height with no
// JS measurement and no jank — a hardcoded max-height would either clip a
// tall chart or leave a gap under a short one.
const ChartCard = ({
  title,
  subtitle,
  INK,
  periodOptions,
  period,
  onPeriodChange,
  collapsed,
  onToggleCollapse,
  className = "",
  children,
}) => (
  <Card className={className}>
    <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="font-semibold truncate" style={{ color: INK.primary }}>
          {title}
        </h2>
        {subtitle && (
          <p className="text-xs mt-0.5" style={{ color: INK.muted }}>
            {subtitle}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {periodOptions && !collapsed && (
          <select
            value={period}
            onChange={(e) => onPeriodChange(e.target.value)}
            className="text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-900 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-400"
            style={{ color: INK.secondary }}
          >
            {periodOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={onToggleCollapse}
          title={collapsed ? "Expand this chart" : "Collapse this chart"}
          aria-label={collapsed ? "Expand this chart" : "Collapse this chart"}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-900"
        >
          {collapsed ? <FiChevronDown size={16} /> : <FiChevronUp size={16} />}
        </button>
      </div>
    </div>
    <div className={`grid transition-all duration-300 ease-in-out ${collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}>
      <div className="overflow-hidden">{children}</div>
    </div>
  </Card>
);

const Home = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const INK = INKS[isDark ? "dark" : "light"];
  const seriesColors = SERIES_COLORS[isDark ? "dark" : "light"];

  const [expenses, setExpenses] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [laborContractors, setLaborContractors] = useState([]);
  const [laborWages, setLaborWages] = useState([]);
  const [laborPayments, setLaborPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");

  // "Export Everything" (25 Sep, per Rishi: "one google sheet where things
  // are separated like expense has split sheet, vehicle has separate split
  // sheet, and labor wages split sheet") — lives on the Dashboard, not any
  // one tab, since it spans all three.
  const [showExportAllModal, setShowExportAllModal] = useState(false);
  const [allSheetsView, setAllSheetsView] = useState("expenses");

  // --- Filters (sir's item i: filters on everything, by master and by date) ---
  const [showFilters, setShowFilters] = useState(false);
  const [filterExpense, setFilterExpense] = useState("");
  const [filterMasters, setFilterMasters] = useState([]); // empty = all masters
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  // --- Drill-down drawer (sir's item ii) ---
  const [drillMaster, setDrillMaster] = useState(null);
  // Vehicles/Labor Wages tab drill-downs (22 Sep, per Rishi's notebook: the
  // Overview tab's chart click-through never made it to the other two tabs'
  // charts) — same drawer idea, one per tab since the underlying rows are
  // shaped completely differently (expense rows vs. Work Log+Payments rows).
  const [drillVehicle, setDrillVehicle] = useState(null); // a vehicle's _id
  const [drillContractor, setDrillContractor] = useState(null); // a contractor's _id

  // --- Per-chart period + collapse controls ---
  const [trendPeriod, setTrendPeriod] = useState("6m");
  const [masterPeriod, setMasterPeriod] = useState("all");
  const [vehiclePeriod, setVehiclePeriod] = useState("all");
  const [collapsedCharts, setCollapsedCharts] = useState({});
  const toggleChartCollapsed = (key) => setCollapsedCharts((prev) => ({ ...prev, [key]: !prev[key] }));

  const activeFilterCount =
    [filterExpense, filterFrom, filterTo].filter((v) => v !== "").length + (filterMasters.length > 0 ? 1 : 0);
  const clearFilters = () => {
    setFilterExpense("");
    setFilterMasters([]);
    setFilterFrom("");
    setFilterTo("");
  };

  // Enter walks across the filter controls so the dashboard can be driven from
  // the keyboard, exactly like the sheets. The last field closes the panel —
  // the charts update live, so there is nothing to submit.
  const FILTER_ORDER = ["expense", "master", "from", "to"];
  const filterRefs = useRef({});
  const setFilterRef = (key) => (el) => {
    filterRefs.current[key] = el;
  };
  const handleFilterKeyDown = (e, key) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const next = FILTER_ORDER[FILTER_ORDER.indexOf(key) + 1];
    if (next) filterRefs.current[next]?.focus();
    else {
      e.target.blur();
      setShowFilters(false);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      if (!user) {
        setError("Authentication required");
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const expenseData = await fetchExpenses();
        setExpenses(Array.isArray(expenseData) ? expenseData : []);
        setError(null);
      } catch (err) {
        console.error("Error loading data:", err);
        setError("Failed to load expense data");
      } finally {
        setLoading(false);
      }

      // Best-effort — the Vehicles/Labor Wages tabs failing to load shouldn't
      // block the Overview tab, which is the main expense dashboard.
      try {
        const [v, c, w, p] = await Promise.all([
          fetchVehicles(),
          fetchContractors(),
          fetchWageEntries(),
          fetchPayments(),
        ]);
        setVehicles(Array.isArray(v) ? v : []);
        setLaborContractors(Array.isArray(c) ? c : []);
        setLaborWages(Array.isArray(w) ? w : []);
        setLaborPayments(Array.isArray(p) ? p : []);
      } catch (err) {
        console.error("Error loading vehicle/labor data:", err);
      }
    };
    loadData();
  }, [user]);

  // Close whichever drawer is open on Escape.
  useEffect(() => {
    if (!drillMaster && !drillVehicle && !drillContractor) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setDrillMaster(null);
      setDrillVehicle(null);
      setDrillContractor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drillMaster, drillVehicle, drillContractor]);

  // --- Stable colour assignment -------------------------------------------
  // Colour follows the master, not its rank in the current view. Built from
  // the UNFILTERED data so that applying a filter never repaints the masters
  // that survive it — the same category keeps the same colour all session.
  const masterColors = useMemo(() => {
    const totals = {};
    for (const e of expenses) totals[e.master] = (totals[e.master] || 0) + (Number(e.amount) || 0);
    const ordered = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const map = {};
    ordered.forEach(([name], i) => {
      map[name] = i < seriesColors.length ? seriesColors[i] : OTHER_COLOR;
    });
    return map;
  }, [expenses, seriesColors]);

  const colorFor = (name) => (name === "Other" ? OTHER_COLOR : masterColors[name] || OTHER_COLOR);

  const expenseSuggestions = useMemo(
    () => Array.from(new Set(expenses.map((e) => e.expense).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [expenses]
  );

  const allMasters = useMemo(
    () => Array.from(new Set(expenses.map((e) => e.master).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [expenses]
  );

  // --- Filtering -----------------------------------------------------------
  const filtered = useMemo(() => {
    const q = filterExpense.trim().toLowerCase();
    return expenses.filter((e) => {
      if (q && !(e.expense || "").toLowerCase().includes(q)) return false;
      if (filterMasters.length > 0 && !filterMasters.includes(e.master)) return false;
      if (filterFrom && (!e.date || new Date(e.date) < new Date(filterFrom))) return false;
      if (filterTo && (!e.date || new Date(e.date) > new Date(filterTo))) return false;
      return true;
    });
  }, [expenses, filterExpense, filterMasters, filterFrom, filterTo]);

  const total = useMemo(() => filtered.reduce((s, e) => s + (Number(e.amount) || 0), 0), [filtered]);

  // --- Monthly trend, computed from the FILTERED rows ----------------------
  // Derived client-side rather than from the trend endpoint, so the filters
  // genuinely apply to every chart on the page instead of just some of them.
  const trend = useMemo(() => {
    const months = TREND_MONTHS[trendPeriod] || 6;
    const now = new Date();
    const buckets = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        key: monthKey(d),
        label: d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
        total: 0,
      });
    }
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    for (const e of filtered) {
      if (!e.date) continue;
      const bucket = byKey.get(monthKey(new Date(e.date)));
      if (bucket) bucket.total += Number(e.amount) || 0;
    }
    return buckets;
  }, [filtered, trendPeriod]);

  const thisMonth = trend[trend.length - 1];
  const lastMonth = trend[trend.length - 2];
  const momDelta =
    thisMonth && lastMonth && lastMonth.total > 0
      ? ((thisMonth.total - lastMonth.total) / lastMonth.total) * 100
      : null;

  // --- Breakdown, on whichever dimension is actually informative -----------
  // Narrowing to a single master makes a by-master chart pointless: one slice,
  // 100%. In that case the interesting question is what sits INSIDE that
  // master, so the charts switch to splitting by the individual expenses.
  // Two or more masters selected goes back to comparing them against each
  // other, which is the whole reason for picking several.
  const drillIntoMaster = filterMasters.length === 1 ? filterMasters[0] : null;
  const breakdownKey = drillIntoMaster ? "expense" : "master";

  // Chart-local window for the two master-breakdown cards only — the drawer
  // and every other card keep using the plain `filtered` set above, so
  // narrowing this to "This month" never makes a click-through show 0 rows.
  const masterFiltered = useMemo(
    () => filtered.filter((e) => withinPeriod(e.date, masterPeriod)),
    [filtered, masterPeriod]
  );
  const masterFilteredTotal = useMemo(
    () => masterFiltered.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    [masterFiltered]
  );

  const masterTotals = useMemo(() => {
    const totals = {};
    for (const e of masterFiltered) {
      const key = (breakdownKey === "expense" ? e.expense : e.master) || "Unlabelled";
      totals[key] = (totals[key] || 0) + (Number(e.amount) || 0);
    }
    return Object.entries(totals)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [masterFiltered, breakdownKey]);

  // Expense slices only exist while drilled into a single master, so there is
  // no stable entity to pin a colour to — rank order is fine here, and the
  // master-level rule (colour never moves when filtering) still holds above.
  const drillColors = useMemo(() => {
    if (!drillIntoMaster) return null;
    const map = {};
    masterTotals.forEach(({ name }, i) => {
      map[name] = i < seriesColors.length ? seriesColors[i] : OTHER_COLOR;
    });
    return map;
  }, [drillIntoMaster, masterTotals, seriesColors]);

  const sliceColor = (name) =>
    name === "Other" ? OTHER_COLOR : drillColors ? drillColors[name] || OTHER_COLOR : colorFor(name);

  // Past 8 categories a pie becomes unreadable slivers, so the tail folds into
  // one grey "Other" slice that still adds up correctly.
  const chartMasterData = useMemo(() => {
    if (masterTotals.length <= TOP_MASTER_COUNT) return masterTotals;
    const top = masterTotals.slice(0, TOP_MASTER_COUNT);
    const otherTotal = masterTotals.slice(TOP_MASTER_COUNT).reduce((s, m) => s + m.value, 0);
    return [...top, { name: "Other", value: otherTotal }];
  }, [masterTotals]);

  const otherMasterNames = useMemo(
    () => masterTotals.slice(TOP_MASTER_COUNT).map((m) => m.name),
    [masterTotals]
  );

  // --- Drill-down rows -----------------------------------------------------
  const drillRows = useMemo(() => {
    if (!drillMaster) return [];
    const field = breakdownKey === "expense" ? "expense" : "master";
    const names = drillMaster === "Other" ? otherMasterNames : [drillMaster];
    return filtered
      .filter((e) => names.includes(e[field] || "Unlabelled"))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [drillMaster, filtered, otherMasterNames, breakdownKey]);

  const drillTotal = useMemo(
    () => drillRows.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    [drillRows]
  );

  const recentExpenses = useMemo(() => filtered.slice(0, 8), [filtered]);

  // --- Vehicles tab -------------------------------------------------------
  const vehicleExpenses = useMemo(() => expenses.filter((e) => e.vehicleId), [expenses]);

  // --- All Sheets tab (25 Sep) --------------------------------------------
  // Same 4-way split as the "Export Everything" Google Sheet, just rendered
  // in-app instead of pushed anywhere — reuses the data already fetched for
  // the charts above, so this costs no extra API calls.
  // Note: like the "Export Everything" feature, the Expenses view below
  // includes every expense (vehicle-tagged ones too) — the Vehicles view is
  // that same data narrowed to just the vehicle-tagged rows, not a separate
  // pool, so the two stay consistent with each other.
  const vehiclesById = useMemo(() => new Map(vehicles.map((v) => [v._id, v])), [vehicles]);
  const contractorsById = useMemo(() => new Map(laborContractors.map((c) => [c._id, c])), [laborContractors]);
  const byDateDesc = (a, b, key = "date") => new Date(b[key] || 0) - new Date(a[key] || 0);
  const vehicleTotals = useMemo(() => {
    const totalSpend = vehicleExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    return { totalSpend, vehicleCount: vehicles.length, entryCount: vehicleExpenses.length };
  }, [vehicles, vehicleExpenses]);
  // Chart-local period for "Spend by vehicle" only — the three stat tiles
  // above it stay on the vehicle tab's full, all-time totals.
  const vehicleExpensesForChart = useMemo(
    () => vehicleExpenses.filter((e) => withinPeriod(e.date, vehiclePeriod)),
    [vehicleExpenses, vehiclePeriod]
  );
  const vehicleBySpend = useMemo(() => {
    return vehicles
      .map((v) => ({
        id: v._id,
        name: v.name,
        spend: vehicleExpensesForChart.filter((e) => e.vehicleId === v._id).reduce((s, e) => s + (Number(e.amount) || 0), 0),
      }))
      .filter((v) => v.spend > 0)
      .sort((a, b) => b.spend - a.spend);
  }, [vehicles, vehicleExpensesForChart]);

  // --- Labor Wages tab ------------------------------------------------------
  const laborTotals = useMemo(() => {
    const totalEarned = laborWages.reduce((s, w) => s + (Number(w.amount) || 0), 0);
    const totalPaid = laborPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const totalOpening = laborContractors.reduce((s, c) => s + (Number(c.openingBalance) || 0), 0);
    return { totalEarned, totalPaid, pending: totalOpening + totalEarned - totalPaid };
  }, [laborContractors, laborWages, laborPayments]);
  const laborByContractor = useMemo(() => {
    return laborContractors
      .map((c) => ({
        id: c._id,
        name: c.name,
        earned: laborWages.filter((w) => w.contractorId === c._id).reduce((s, w) => s + (Number(w.amount) || 0), 0),
        paid: laborPayments.filter((p) => p.contractorId === c._id).reduce((s, p) => s + (Number(p.amount) || 0), 0),
      }))
      .filter((c) => c.earned > 0 || c.paid > 0);
  }, [laborContractors, laborWages, laborPayments]);

  // Staff-only accounts have no use for analytics — they enter data, they
  // don't review it (25 Sep, per Rishi: "what is the point to show dashboard
  // data to the staff? staff only enters data and nothing else"). Bounced to
  // their actual work (Expense Sheet) before any of the dashboard's several
  // fetches even fire. Same pattern as Team.jsx's owner-only redirect — the
  // real boundary would need to be a backend one too if this data were ever
  // sensitive, but nothing here is per-user secret, so a client-side redirect
  // is enough to keep staff out of a page that isn't for them.
  if (user && user.role !== "owner") {
    return <Navigate to="/dashboard/expenses" replace />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-t-red-500 border-gray-200 dark:border-gray-700 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <Card className="p-8 max-w-md text-center">
          <FiAlertTriangle size={32} className="mx-auto mb-3" style={{ color: STATUS.critical }} />
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-1">{error}</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Please make sure you're logged in.</p>
        </Card>
      </div>
    );
  }

  const tooltipStyle = {
    borderRadius: 8,
    border: `1px solid ${INK.grid}`,
    backgroundColor: INK.surface,
    color: INK.primary,
    fontSize: 13,
    boxShadow: isDark ? "0 2px 8px rgba(0,0,0,0.5)" : "0 2px 8px rgba(0,0,0,0.06)",
  };

  return (
    <div className="p-4 sm:p-6 lg:px-12 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: INK.primary }}>
            {APP_NAME}
          </h1>
          <p className="text-sm" style={{ color: INK.muted }}>
            {APP_TAGLINE}
          </p>
        </div>
        <button
          onClick={() => setShowExportAllModal(true)}
          className="flex items-center gap-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-900 text-sm font-medium"
        >
          <FiGrid size={15} /> Export Everything to One Google Sheet
        </button>
      </div>

      {showExportAllModal && (
        <ExportSheetModal
          title="Export Everything"
          onClose={() => setShowExportAllModal(false)}
          fetchStatus={fetchSheetsStatus}
          onExport={(sheetUrl) => exportAllToGoogleSheet(sheetUrl)}
          sheetOnly
          defaultMode="sheet"
          sheetDescription="Paste a Google Sheet you own, shared with the app's service account as an Editor — it gets four tabs (Expenses, Vehicles, Work Log, Payments), each formatted and replaced with your current data. Safe to reuse the same Sheet every time; each tab is only ever overwritten, not duplicated."
        />
      )}

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6">
        {DASHBOARD_TABS.map((t) => (
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

      {tab === "overview" && (
        <>
      {/* Filters — one row above everything, applying to every card and chart */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
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
        {activeFilterCount > 0 && (
          <div className="flex items-center text-sm" style={{ color: INK.secondary }}>
            Showing {filtered.length} of {expenses.length} entries
          </div>
        )}
      </div>

      {showFilters && (
        <Card className="p-4 mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: INK.muted }}>
                Expense
              </label>
              <SuggestInput
                inputRef={setFilterRef("expense")}
                value={filterExpense}
                onChange={setFilterExpense}
                onKeyDown={(e) => handleFilterKeyDown(e, "expense")}
                options={expenseSuggestions}
                placeholder="Search expense..."
                className="border border-gray-300 dark:border-gray-600 dark:bg-gray-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 min-w-[11rem]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: INK.muted }}>
                Master
              </label>
              <MasterMultiSelect
                inputRef={setFilterRef("master")}
                onKeyDown={(e) => handleFilterKeyDown(e, "master")}
                options={allMasters}
                selected={filterMasters}
                onChange={setFilterMasters}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: INK.muted }}>
                From date
              </label>
              <input
                ref={setFilterRef("from")}
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                onKeyDown={(e) => handleFilterKeyDown(e, "from")}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: INK.muted }}>
                To date
              </label>
              <input
                ref={setFilterRef("to")}
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                onKeyDown={(e) => handleFilterKeyDown(e, "to")}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1.5 text-sm font-medium pb-2 hover:text-red-600"
                style={{ color: INK.muted }}
              >
                <FiXCircle size={15} />
                Clear filters
              </button>
            )}
          </div>
        </Card>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card className="p-5">
          <h3 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: INK.muted }}>
            Total
          </h3>
          <p className="text-3xl font-semibold" style={{ color: INK.primary }}>
            {formatCurrency(total)}
          </p>
          <p className="mt-1 text-xs" style={{ color: INK.muted }}>
            Across {filtered.length} entries
          </p>
        </Card>

        <Card className="p-5">
          <h3 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: INK.muted }}>
            This Month
          </h3>
          <p className="text-3xl font-semibold" style={{ color: INK.primary }}>
            {formatCurrency(thisMonth?.total)}
          </p>
          <p className="mt-1 text-xs" style={{ color: INK.muted }}>
            {thisMonth?.label}
          </p>
        </Card>

        <Card className="p-5">
          <h3 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: INK.muted }}>
            Vs Last Month
          </h3>
          <p
            className="text-3xl font-semibold"
            style={{ color: momDelta === null ? INK.muted : momDelta > 0 ? STATUS.critical : STATUS.good }}
          >
            {momDelta === null ? "—" : `${momDelta > 0 ? "+" : ""}${momDelta.toFixed(0)}%`}
          </p>
          <p className="mt-1 text-xs" style={{ color: INK.muted }}>
            {momDelta === null ? "Not enough data yet" : momDelta > 0 ? "Spending more" : "Spending less"}
          </p>
        </Card>
      </div>

      {/* Monthly trend */}
      <ChartCard
        className="mb-6"
        title="Monthly Spend"
        subtitle={`Last ${TREND_MONTHS[trendPeriod] || 6} months`}
        INK={INK}
        periodOptions={TREND_PERIOD_OPTIONS}
        period={trendPeriod}
        onPeriodChange={setTrendPeriod}
        collapsed={!!collapsedCharts.trend}
        onToggleCollapse={() => toggleChartCollapsed("trend")}
      >
        <div className="p-4 h-64">
          {trend.some((m) => m.total) ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: INK.muted }}
                  axisLine={{ stroke: INK.axis }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => `₹${v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${Math.round(v / 1000)}k` : v}`}
                  tick={{ fontSize: 12, fill: INK.muted }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="total"
                  name="Spend"
                  stroke={seriesColors[0]}
                  strokeWidth={2}
                  dot={{ r: 4, fill: seriesColors[0], strokeWidth: 0 }}
                  activeDot={{ r: 6, stroke: INK.surface, strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-sm" style={{ color: INK.muted }}>
              Not enough data yet to show a trend
            </div>
          )}
        </div>
      </ChartCard>

      {/* Master breakdown — both charts click through to the drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
        <ChartCard
          title={drillIntoMaster ? `Spend within ${drillIntoMaster}` : "Spend by Master"}
          subtitle={drillIntoMaster ? "Split by individual expense" : "Click any slice to see its entries"}
          INK={INK}
          periodOptions={BREAKDOWN_PERIOD_OPTIONS}
          period={masterPeriod}
          onPeriodChange={setMasterPeriod}
          collapsed={!!collapsedCharts.masterPie}
          onToggleCollapse={() => toggleChartCollapsed("masterPie")}
        >
          <div className="p-4 h-80">
            {chartMasterData.length > 0 ? (
              <div className="relative w-full h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartMasterData}
                      cx="50%"
                      cy="50%"
                      outerRadius={92}
                      innerRadius={62}
                      dataKey="value"
                      paddingAngle={2}
                      onClick={(d) => d?.name && setDrillMaster(d.name)}
                      className="cursor-pointer"
                    >
                      {chartMasterData.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={sliceColor(entry.name)}
                          stroke={INK.surface}
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle} />
                    <Legend
                      wrapperStyle={{ fontSize: 12 }}
                      formatter={(value) => <span style={{ color: INK.secondary }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
                  style={{ paddingBottom: 40 }}
                >
                  <span className="text-xs" style={{ color: INK.muted }}>
                    Total
                  </span>
                  <span className="text-lg font-semibold" style={{ color: INK.primary }}>
                    {formatCurrency(masterFilteredTotal)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-sm" style={{ color: INK.muted }}>
                No expense data yet
              </div>
            )}
          </div>
        </ChartCard>

        <ChartCard
          title={drillIntoMaster ? "Biggest Entries" : "Top Masters"}
          subtitle={drillIntoMaster ? `Within ${drillIntoMaster}` : "Click any bar to see its entries"}
          INK={INK}
          periodOptions={BREAKDOWN_PERIOD_OPTIONS}
          period={masterPeriod}
          onPeriodChange={setMasterPeriod}
          collapsed={!!collapsedCharts.masterBar}
          onToggleCollapse={() => toggleChartCollapsed("masterBar")}
        >
          <div className="p-4 h-80">
            {chartMasterData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartMasterData} margin={{ top: 8, right: 8, left: 0, bottom: 56 }}>
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  <XAxis
                    dataKey="name"
                    // Master names run long ("Sawmill & Machinery Maintenance"),
                    // and rotated labels that long run off the left edge of the
                    // card. Truncate the tick; the tooltip still shows the full
                    // name, and the legend on the donut spells them all out.
                    tickFormatter={(v) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
                    tick={{ fontSize: 11, fill: INK.muted }}
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={72}
                    axisLine={{ stroke: INK.axis }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => `₹${v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${Math.round(v / 1000)}k` : v}`}
                    tick={{ fontSize: 12, fill: INK.muted }}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                  />
                  <Tooltip
                    formatter={(v) => formatCurrency(v)}
                    contentStyle={tooltipStyle}
                    cursor={{ fill: isDark ? "rgba(255,255,255,0.05)" : "rgba(11,11,11,0.04)" }}
                  />
                  <Bar
                    dataKey="value"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={44}
                    onClick={(d) => d?.name && setDrillMaster(d.name)}
                    className="cursor-pointer"
                  >
                    {chartMasterData.map((entry) => (
                      <Cell key={entry.name} fill={sliceColor(entry.name)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-sm" style={{ color: INK.muted }}>
                No expense data yet
              </div>
            )}
          </div>
        </ChartCard>
      </div>

      {/* Recent entries */}
      <Card className="mb-6">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
          <h2 className="font-semibold" style={{ color: INK.primary }}>
            Recent Expenses
          </h2>
          <span className="text-sm font-medium" style={{ color: INK.secondary }}>
            {formatCurrency(total)}
          </span>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {recentExpenses.length > 0 ? (
            recentExpenses.map((expense) => (
              <button
                key={expense._id}
                onClick={() => expense.master && setDrillMaster(expense.master)}
                className="w-full p-3 px-5 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-900 text-left"
              >
                <div className="min-w-0 flex items-center gap-2.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: sliceColor(breakdownKey === "expense" ? expense.expense : expense.master) }}
                  />
                  <div className="min-w-0">
                    <p className="font-medium truncate text-sm" style={{ color: INK.primary }}>
                      {expense.expense}
                    </p>
                    <p className="text-xs" style={{ color: INK.muted }}>
                      {formatDate(expense.date)} · {expense.master}
                    </p>
                  </div>
                </div>
                <span className="font-semibold shrink-0 ml-3 text-sm" style={{ color: INK.primary }}>
                  {formatCurrency(expense.amount)}
                </span>
              </button>
            ))
          ) : (
            <div className="p-8 text-center text-sm" style={{ color: INK.muted }}>
              <p>No expenses match the current filters</p>
            </div>
          )}
        </div>
      </Card>

      {/* Drill-down drawer */}
      {drillMaster && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20" onClick={() => setDrillMaster(null)} />
          <div className="relative bg-white dark:bg-gray-800 w-full max-w-md h-full shadow-xl flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-start justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: sliceColor(drillMaster) }}
                  />
                  <h2 className="font-semibold truncate" style={{ color: INK.primary }}>
                    {drillMaster}
                  </h2>
                </div>
                <p className="text-xs mt-1" style={{ color: INK.muted }}>
                  {drillRows.length} {drillRows.length === 1 ? "entry" : "entries"} ·{" "}
                  {formatCurrency(drillTotal)}
                  {activeFilterCount > 0 && " (within current filters)"}
                </p>
              </div>
              <button
                onClick={() => setDrillMaster(null)}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 shrink-0"
                title="Close"
              >
                <FiX size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
              {drillRows.map((row) => (
                <div key={row._id} className="px-5 py-3 flex justify-between items-start gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: INK.primary }}>
                      {row.expense}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: INK.muted }}>
                      {formatDate(row.date)}
                      {drillMaster === "Other" && ` · ${breakdownKey === "expense" ? row.expense : row.master}`}
                      {row.billFile ? " · bill attached" : " · no bill"}
                    </p>
                  </div>
                  <span
                    className="text-sm font-semibold shrink-0 tabular-nums"
                    style={{ color: INK.primary }}
                  >
                    {formatCurrency(row.amount)}
                  </span>
                </div>
              ))}
              {drillRows.length === 0 && (
                <div className="p-8 text-center text-sm" style={{ color: INK.muted }}>
                  No entries
                </div>
              )}
            </div>
          </div>
        </div>
      )}

        </>
      )}

      {tab === "vehicles" && (
        vehicles.length === 0 ? (
          <Card className="p-8 text-center text-sm" style={{ color: INK.muted }}>
            No vehicles yet — add one from the Vehicles page.
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <Card className="p-5">
                <h3 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: INK.muted }}>Total Spend</h3>
                <p className="text-3xl font-semibold" style={{ color: INK.primary }}>{formatCurrency(vehicleTotals.totalSpend)}</p>
              </Card>
              <Card className="p-5">
                <h3 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: INK.muted }}>Vehicles</h3>
                <p className="text-3xl font-semibold" style={{ color: INK.primary }}>{vehicleTotals.vehicleCount}</p>
              </Card>
              <Card className="p-5">
                <h3 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: INK.muted }}>Logged Entries</h3>
                <p className="text-3xl font-semibold" style={{ color: INK.primary }}>{vehicleTotals.entryCount}</p>
              </Card>
            </div>

            {vehicleBySpend.length > 0 && (
              <ChartCard
                title="Spend by vehicle"
                subtitle="Click any bar to see that vehicle's entries"
                INK={INK}
                periodOptions={BREAKDOWN_PERIOD_OPTIONS}
                period={vehiclePeriod}
                onPeriodChange={setVehiclePeriod}
                collapsed={!!collapsedCharts.vehicle}
                onToggleCollapse={() => toggleChartCollapsed("vehicle")}
              >
                <div className="p-4 h-96">
                <ResponsiveContainer width="100%" height="90%">
                  <BarChart data={vehicleBySpend} margin={{ top: 8, right: 8, left: 0, bottom: 8 }} barGap={2}>
                    <CartesianGrid stroke={INK.grid} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: INK.muted }} axisLine={{ stroke: INK.axis }} tickLine={false} />
                    <YAxis
                      tickFormatter={(v) => `₹${v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${Math.round(v / 1000)}k` : v}`}
                      tick={{ fontSize: 12, fill: INK.muted }}
                      axisLine={false}
                      tickLine={false}
                      width={52}
                    />
                    <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle} cursor={{ fill: isDark ? "rgba(255,255,255,0.05)" : "rgba(11,11,11,0.04)" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span style={{ color: INK.secondary }}>{value}</span>} />
                    <Bar
                      dataKey="spend"
                      name="Spend"
                      fill={seriesColors[0]}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                      onClick={(d) => d?.id && setDrillVehicle(d.id)}
                      className="cursor-pointer"
                    />
                  </BarChart>
                </ResponsiveContainer>
                </div>
              </ChartCard>
            )}
          </>
        )
      )}

      {tab === "labor" && (
        laborContractors.length === 0 ? (
          <Card className="p-8 text-center text-sm" style={{ color: INK.muted }}>
            No contractors yet — add one from the menu icon on the Labor Wages page.
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <Card className="p-5">
                <h3 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: INK.muted }}>Total Earned (CFT)</h3>
                <p className="text-3xl font-semibold" style={{ color: INK.primary }}>{formatCurrency(laborTotals.totalEarned)}</p>
              </Card>
              <Card className="p-5">
                <h3 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: INK.muted }}>Total Paid</h3>
                <p className="text-3xl font-semibold" style={{ color: INK.primary }}>{formatCurrency(laborTotals.totalPaid)}</p>
              </Card>
              <Card className="p-5">
                <h3 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: INK.muted }}>
                  {laborTotals.pending < 0 ? "Owed Back" : "Pending"}
                </h3>
                <p
                  className="text-3xl font-semibold"
                  style={{ color: laborTotals.pending > 0 ? STATUS.warning : laborTotals.pending < 0 ? STATUS.critical : INK.primary }}
                >
                  {formatCurrency(Math.abs(laborTotals.pending))}
                </p>
              </Card>
            </div>

            {laborByContractor.length > 0 && (
              <ChartCard
                title="Earned vs Paid, by contractor"
                subtitle="Click any bar to see that contractor's entries — all time, Work Log entries don't carry a real date to filter by"
                INK={INK}
                collapsed={!!collapsedCharts.labor}
                onToggleCollapse={() => toggleChartCollapsed("labor")}
              >
                <div className="p-4 h-96">
                <ResponsiveContainer width="100%" height="90%">
                  <BarChart data={laborByContractor} margin={{ top: 8, right: 8, left: 0, bottom: 8 }} barGap={2}>
                    <CartesianGrid stroke={INK.grid} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: INK.muted }} axisLine={{ stroke: INK.axis }} tickLine={false} />
                    <YAxis
                      tickFormatter={(v) => `₹${v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${Math.round(v / 1000)}k` : v}`}
                      tick={{ fontSize: 12, fill: INK.muted }}
                      axisLine={false}
                      tickLine={false}
                      width={52}
                    />
                    <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle} cursor={{ fill: isDark ? "rgba(255,255,255,0.05)" : "rgba(11,11,11,0.04)" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span style={{ color: INK.secondary }}>{value}</span>} />
                    <Bar
                      dataKey="earned"
                      name="Earned"
                      fill={seriesColors[1]}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                      onClick={(d) => d?.id && setDrillContractor(d.id)}
                      className="cursor-pointer"
                    />
                    <Bar
                      dataKey="paid"
                      name="Paid"
                      fill={seriesColors[2]}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                      onClick={(d) => d?.id && setDrillContractor(d.id)}
                      className="cursor-pointer"
                    />
                  </BarChart>
                </ResponsiveContainer>
                </div>
              </ChartCard>
            )}
          </>
        )
      )}

      {tab === "allsheets" && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="flex flex-wrap gap-1 border-b border-gray-100 dark:border-gray-700 px-4 pt-3 pb-2">
            {ALL_SHEETS_VIEWS.map((v) => (
              <button
                key={v.key}
                onClick={() => setAllSheetsView(v.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                  allSheetsView === v.key
                    ? "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            {allSheetsView === "expenses" && (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-left text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Expense</th>
                    <th className="px-4 py-2 font-medium">Master</th>
                    <th className="px-4 py-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {[...expenses].sort(byDateDesc).map((e) => (
                    <tr key={e._id}>
                      <td className="px-4 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDate(e.date)}</td>
                      <td className="px-4 py-2" style={{ color: INK.primary }}>{e.expense}</td>
                      <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{e.master || "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums" style={{ color: INK.primary }}>{formatCurrency(e.amount)}</td>
                    </tr>
                  ))}
                  {expenses.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-8 text-center" style={{ color: INK.muted }}>No expenses yet</td></tr>
                  )}
                </tbody>
              </table>
            )}

            {allSheetsView === "vehicles" && (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-left text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Vehicle</th>
                    <th className="px-4 py-2 font-medium">Expense</th>
                    <th className="px-4 py-2 font-medium">Master</th>
                    <th className="px-4 py-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {[...vehicleExpenses].sort(byDateDesc).map((e) => (
                    <tr key={e._id}>
                      <td className="px-4 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDate(e.date)}</td>
                      <td className="px-4 py-2" style={{ color: INK.primary }}>{vehiclesById.get(e.vehicleId)?.name || "—"}</td>
                      <td className="px-4 py-2" style={{ color: INK.primary }}>{e.expense}</td>
                      <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{e.master || "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums" style={{ color: INK.primary }}>{formatCurrency(e.amount)}</td>
                    </tr>
                  ))}
                  {vehicleExpenses.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center" style={{ color: INK.muted }}>No vehicle expenses yet</td></tr>
                  )}
                </tbody>
              </table>
            )}

            {allSheetsView === "worklog" && (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-left text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Contractor</th>
                    <th className="px-4 py-2 font-medium">Period</th>
                    <th className="px-4 py-2 font-medium text-right">CFT</th>
                    <th className="px-4 py-2 font-medium text-right">Rate</th>
                    <th className="px-4 py-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {[...laborWages].sort((a, b) => byDateDesc(a, b, "createdAt")).map((w) => (
                    <tr key={w._id}>
                      <td className="px-4 py-2" style={{ color: INK.primary }}>{contractorsById.get(w.contractorId)?.name || "—"}</td>
                      <td className="px-4 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{w.dateLabel || "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{w.cft || 0}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{w.rate || 0}</td>
                      <td className="px-4 py-2 text-right tabular-nums" style={{ color: INK.primary }}>{formatCurrency(w.amount)}</td>
                    </tr>
                  ))}
                  {laborWages.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center" style={{ color: INK.muted }}>No work log entries yet</td></tr>
                  )}
                </tbody>
              </table>
            )}

            {allSheetsView === "payments" && (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-left text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Contractor</th>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Label</th>
                    <th className="px-4 py-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {[...laborPayments].sort(byDateDesc).map((p) => (
                    <tr key={p._id}>
                      <td className="px-4 py-2" style={{ color: INK.primary }}>{contractorsById.get(p.contractorId)?.name || "—"}</td>
                      <td className="px-4 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDate(p.date)}</td>
                      <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{p.label || "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums" style={{ color: INK.primary }}>{formatCurrency(p.amount)}</td>
                    </tr>
                  ))}
                  {laborPayments.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-8 text-center" style={{ color: INK.muted }}>No payments yet</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Vehicle drill-down drawer (22 Sep, per Rishi's notebook: the
          Overview tab's chart click-through never made it to the Vehicles/
          Labor Wages tabs' charts) — top-level so it renders regardless of
          which tab is active, since drillVehicle only ever gets set from the
          Vehicles tab's chart. */}
      {drillVehicle && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20" onClick={() => setDrillVehicle(null)} />
          <div className="relative bg-white dark:bg-gray-800 w-full max-w-md h-full shadow-xl flex flex-col">
            {(() => {
              const vehicle = vehicles.find((v) => v._id === drillVehicle);
              const rows = vehicleExpenses
                .filter((e) => e.vehicleId === drillVehicle)
                .sort((a, b) => new Date(b.date) - new Date(a.date));
              const rowsTotal = rows.reduce((s, e) => s + (Number(e.amount) || 0), 0);
              return (
                <>
                  <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-start justify-between">
                    <div className="min-w-0">
                      <h2 className="font-semibold truncate" style={{ color: INK.primary }}>{vehicle?.name || "Vehicle"}</h2>
                      <p className="text-xs mt-1" style={{ color: INK.muted }}>
                        {rows.length} {rows.length === 1 ? "entry" : "entries"} · {formatCurrency(rowsTotal)}
                      </p>
                    </div>
                    <button
                      onClick={() => setDrillVehicle(null)}
                      className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 shrink-0"
                      title="Close"
                    >
                      <FiX size={20} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
                    {rows.map((row) => (
                      <div key={row._id} className="px-5 py-3 flex justify-between items-start gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: INK.primary }}>{row.expense}</p>
                          <p className="text-xs mt-0.5" style={{ color: INK.muted }}>
                            {formatDate(row.date)} · {row.master}
                            {row.billFile ? " · bill attached" : " · no bill"}
                          </p>
                        </div>
                        <span className="text-sm font-semibold shrink-0 tabular-nums" style={{ color: INK.primary }}>
                          {formatCurrency(row.amount)}
                        </span>
                      </div>
                    ))}
                    {rows.length === 0 && (
                      <div className="p-8 text-center text-sm" style={{ color: INK.muted }}>No entries</div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Contractor drill-down drawer (22 Sep, per Rishi's notebook) — merges
          that contractor's Work Log entries and Payments into one list, newest
          first by whichever timestamp each row actually has. Also top-level,
          same reasoning as the vehicle drawer above. */}
      {drillContractor && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20" onClick={() => setDrillContractor(null)} />
          <div className="relative bg-white dark:bg-gray-800 w-full max-w-md h-full shadow-xl flex flex-col">
            {(() => {
              const contractor = laborContractors.find((c) => c._id === drillContractor);
              const workRows = laborWages
                .filter((w) => w.contractorId === drillContractor)
                .map((w) => ({ ...w, _kind: "Work Log", _amount: w.amount }));
              const payRows = laborPayments
                .filter((p) => p.contractorId === drillContractor)
                .map((p) => ({ ...p, _kind: "Payment", _amount: p.amount }));
              const rows = [...workRows, ...payRows].sort(
                (a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0)
              );
              const earned = workRows.reduce((s, w) => s + (Number(w.amount) || 0), 0);
              const paid = payRows.reduce((s, p) => s + (Number(p.amount) || 0), 0);
              return (
                <>
                  <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-start justify-between">
                    <div className="min-w-0">
                      <h2 className="font-semibold truncate" style={{ color: INK.primary }}>{contractor?.name || "Contractor"}</h2>
                      <p className="text-xs mt-1" style={{ color: INK.muted }}>
                        Earned {formatCurrency(earned)} · Paid {formatCurrency(paid)}
                      </p>
                    </div>
                    <button
                      onClick={() => setDrillContractor(null)}
                      className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 shrink-0"
                      title="Close"
                    >
                      <FiX size={20} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
                    {rows.map((row) => (
                      <div key={`${row._kind}-${row._id}`} className="px-5 py-3 flex justify-between items-start gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: INK.primary }}>
                            {row._kind}
                            {row._kind === "Payment" && row.label ? ` — ${row.label}` : ""}
                          </p>
                          <p className="text-xs mt-0.5" style={{ color: INK.muted }}>
                            {row._kind === "Work Log" ? `${row.dateLabel || "—"} · ${row.cft || 0} CFT × ₹${row.rate || 0}` : formatDate(row.date)}
                          </p>
                        </div>
                        <span
                          className="text-sm font-semibold shrink-0 tabular-nums"
                          style={{ color: row._kind === "Work Log" ? STATUS.good : STATUS.warning }}
                        >
                          {row._kind === "Work Log" ? "+" : "−"}{formatCurrency(row._amount)}
                        </span>
                      </div>
                    ))}
                    {rows.length === 0 && (
                      <div className="p-8 text-center text-sm" style={{ color: INK.muted }}>No entries</div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
