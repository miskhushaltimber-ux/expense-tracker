import React from "react";
import {
  FiAlertTriangle,
  FiTrendingUp,
  FiTrendingDown,
  FiClock,
  FiTruck,
  FiFileText,
  FiTarget,
} from "react-icons/fi";

// Automatic reminders — computed from data the page already has, so nothing
// here needs anyone to remember to check it. The expense alerts live on the
// Expense Sheet and the vehicle ones on the Vehicles page, beside the thing
// they're actually about.

// Status colours are reserved: never reused as a chart series colour, and
// always paired with an icon and words so they never signal by hue alone.
const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
};

const DAY_MS = 24 * 60 * 60 * 1000;

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    amount || 0
  );

const formatDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN") : "No date");
const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;

// --- Expense alerts ------------------------------------------------------
export const buildExpenseAlerts = (expenses) => {
  const out = [];
  if (!expenses?.length) return out;

  const now = new Date();
  const thisKey = monthKey(now);
  const lastKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const sumFor = (key) =>
    expenses.reduce(
      (s, e) => (e.date && monthKey(new Date(e.date)) === key ? s + (Number(e.amount) || 0) : s),
      0
    );
  const thisTotal = sumFor(thisKey);
  const lastTotal = sumFor(lastKey);

  if (lastTotal > 0) {
    const delta = ((thisTotal - lastTotal) / lastTotal) * 100;
    const up = thisTotal > lastTotal;
    out.push({
      tone: up ? "serious" : "good",
      icon: up ? FiTrendingUp : FiTrendingDown,
      title: `Spending is ${up ? "up" : "down"} ${Math.abs(delta).toFixed(0)}% this month`,
      detail: `${formatCurrency(thisTotal)} so far vs ${formatCurrency(lastTotal)} last month`,
    });

    const perMaster = (key) => {
      const totals = {};
      for (const e of expenses) {
        if (!e.date || monthKey(new Date(e.date)) !== key) continue;
        totals[e.master] = (totals[e.master] || 0) + (Number(e.amount) || 0);
      }
      return totals;
    };
    const nowTotals = perMaster(thisKey);
    const prevTotals = perMaster(lastKey);
    let biggest = null;
    for (const [name, value] of Object.entries(nowTotals)) {
      const diff = value - (prevTotals[name] || 0);
      if (!biggest || diff > biggest.diff) biggest = { name, diff };
    }
    if (biggest && biggest.diff > 0) {
      out.push({
        tone: "warning",
        icon: FiTrendingUp,
        title: `${biggest.name} is up ${formatCurrency(biggest.diff)} vs last month`,
        detail: "Biggest increase of any master this month",
      });
    }
  }

  // Any single entry far above the norm is worth a second look.
  if (expenses.length >= 5) {
    const amounts = expenses.map((e) => Number(e.amount) || 0);
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const largest = expenses.reduce((m, e) => ((Number(e.amount) || 0) > (Number(m.amount) || 0) ? e : m));
    if (avg > 0 && Number(largest.amount) > avg * 4) {
      out.push({
        tone: "serious",
        icon: FiAlertTriangle,
        title: `Unusually large entry: ${formatCurrency(largest.amount)}`,
        detail: `"${largest.expense}" on ${formatDate(largest.date)} — around ${Math.round(
          Number(largest.amount) / avg
        )}× the average entry`,
      });
    }
  }

  const noBill = expenses.filter((e) => !e.billFile).length;
  if (noBill > 0) {
    out.push({
      tone: "warning",
      icon: FiFileText,
      title: `${noBill} of ${expenses.length} entries have no bill attached`,
      detail: "Attach them from the Bill column below",
    });
  }

  return out;
};

// --- Budget alerts -------------------------------------------------------
// Deliberately condensed into at most two lines. One alert per master would
// mean twenty-one cards in a busy month, which is the same as no alerts at
// all — nobody reads a wall of warnings.
export const buildBudgetAlerts = (expenses, budgets) => {
  const out = [];
  if (!budgets?.length || !expenses?.length) return out;

  const now = new Date();
  const thisKey = monthKey(now);

  const spentThisMonth = {};
  for (const e of expenses) {
    if (!e.date) continue;
    const when = new Date(e.date);
    if (isNaN(when.getTime()) || monthKey(when) !== thisKey) continue;
    const k = (e.master || "").trim().toLowerCase();
    spentThisMonth[k] = (spentThisMonth[k] || 0) + (Number(e.amount) || 0);
  }

  const over = [];
  const close = [];
  for (const b of budgets) {
    if (!b.monthlyBudget || b.monthlyBudget <= 0) continue;
    // Matched case-insensitively: an entry typed as "diesel" and a budget set
    // on "Diesel" are the same thing to everyone except a string comparison.
    const spent = spentThisMonth[(b.master || "").trim().toLowerCase()] || 0;
    const pct = (spent / b.monthlyBudget) * 100;
    if (pct > 100) over.push(`${b.master} (${formatCurrency(spent - b.monthlyBudget)} over)`);
    else if (pct > 85) close.push(`${b.master} (${Math.round(pct)}%)`);
  }

  const shortlist = (list) => list.slice(0, 3).join(", ") + (list.length > 3 ? ` +${list.length - 3} more` : "");

  if (over.length) {
    out.push({
      tone: "critical",
      icon: FiAlertTriangle,
      title: `${over.length} master${over.length === 1 ? " is" : "s are"} over budget this month`,
      detail: shortlist(over),
    });
  }
  if (close.length) {
    out.push({
      tone: "warning",
      icon: FiTarget,
      title: `${close.length} master${close.length === 1 ? " is" : "s are"} close to the monthly limit`,
      detail: shortlist(close),
    });
  }

  return out;
};

// --- Vehicle alerts ------------------------------------------------------
export const buildVehicleAlerts = (vehicles) => {
  const out = [];
  if (!vehicles?.length) return out;

  const today = new Date();
  const docs = [
    { key: "rcExpiry", label: "RC" },
    { key: "insuranceExpiry", label: "Insurance" },
    // Permit deliberately not tracked — removed from the vehicle sheet.
  ];

  const expired = [];
  const expiring = [];
  for (const v of vehicles) {
    for (const d of docs) {
      const raw = v[d.key];
      if (!raw) continue;
      const when = new Date(raw);
      if (isNaN(when.getTime())) continue;
      const daysLeft = Math.ceil((when - today) / DAY_MS);
      if (daysLeft < 0) expired.push(`${v.name} ${d.label}`);
      else if (daysLeft <= 30) expiring.push(`${v.name} ${d.label} (${daysLeft}d)`);
    }
  }

  const summarise = (list) =>
    list.slice(0, 3).join(", ") + (list.length > 3 ? ` +${list.length - 3} more` : "");

  if (expired.length) {
    out.push({
      tone: "critical",
      icon: FiTruck,
      title: `${expired.length} vehicle document${expired.length === 1 ? "" : "s"} expired`,
      detail: summarise(expired),
    });
  }
  if (expiring.length) {
    out.push({
      tone: "warning",
      icon: FiClock,
      title: `${expiring.length} document${expiring.length === 1 ? "" : "s"} expiring within 30 days`,
      detail: summarise(expiring),
    });
  }

  return out;
};

const AlertsStrip = ({ alerts }) => {
  if (!alerts?.length) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
      {alerts.map((a, i) => {
        const Icon = a.icon;
        return (
          <div
            key={i}
            className="flex items-start gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3.5"
            style={{ borderLeft: `3px solid ${STATUS[a.tone]}` }}
          >
            <Icon size={17} className="shrink-0 mt-0.5" style={{ color: STATUS[a.tone] }} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-50">{a.title}</p>
              <p className="text-xs mt-0.5 text-gray-500 dark:text-gray-400">{a.detail}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default AlertsStrip;
