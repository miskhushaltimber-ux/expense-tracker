  import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useTheme } from "/src/context/ThemeContext";
import { fetchContractors, fetchWageEntries, fetchPayments } from "/src/api/labour";

// Labor Wages' own analytics page — split out of the main Dashboard (18 Sep,
// per Rishi: "vehicle page dedicated page, labour wage dedicated page and so
// on"). Was a card bolted onto Home.jsx; now it's a full page of its own, so
// the main Dashboard can stay a lighter overview. Same numbers, same chart,
// same balance formula as before — just living on its own route now.
const SERIES_COLORS = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
const STATUS = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" };
const INKS = {
  light: { primary: "#0b0b0b", secondary: "#52514e", muted: "#898781", grid: "#e1e0d9", axis: "#c3c2b7", surface: "#ffffff" },
  dark: { primary: "#f3f4f6", secondary: "#c3c2b7", muted: "#898781", grid: "#374151", axis: "#4b5563", surface: "#1f2937" },
};

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount || 0);

const Card = ({ children, className = "" }) => (
  <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm ${className}`}>{children}</div>
);

const LaborDashboard = () => {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const INK = INKS[isDark ? "dark" : "light"];
  const seriesColors = SERIES_COLORS[isDark ? "dark" : "light"];

  const [contractors, setContractors] = useState([]);
  const [wageEntries, setWageEntries] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [c, w, p] = await Promise.all([fetchContractors(), fetchWageEntries(), fetchPayments()]);
        setContractors(Array.isArray(c) ? c : []);
        setWageEntries(Array.isArray(w) ? w : []);
        setPayments(Array.isArray(p) ? p : []);
      } catch (err) {
        setError("Failed to load labor wages data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totals = useMemo(() => {
    const totalEarned = wageEntries.reduce((s, w) => s + (Number(w.amount) || 0), 0);
    const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const totalOpening = contractors.reduce((s, c) => s + (Number(c.openingBalance) || 0), 0);
    return { totalEarned, totalPaid, pending: totalOpening + totalEarned - totalPaid };
  }, [contractors, wageEntries, payments]);

  const byContractor = useMemo(() => {
    return contractors
      .map((c) => ({
        name: c.name,
        earned: wageEntries.filter((w) => w.contractorId === c._id).reduce((s, w) => s + (Number(w.amount) || 0), 0),
        paid: payments.filter((p) => p.contractorId === c._id).reduce((s, p) => s + (Number(p.amount) || 0), 0),
      }))
      .filter((c) => c.earned > 0 || c.paid > 0);
  }, [contractors, wageEntries, payments]);

  const tooltipStyle = {
    borderRadius: 8,
    border: `1px solid ${INK.grid}`,
    backgroundColor: INK.surface,
    color: INK.primary,
    fontSize: 13,
    boxShadow: isDark ? "0 2px 8px rgba(0,0,0,0.5)" : "0 2px 8px rgba(0,0,0,0.06)",
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full p-6 text-sm text-gray-400">Loading…</div>;
  }
  if (error) {
    return <div className="p-6 text-sm text-red-600">{error}</div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:px-12 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: INK.primary }}>Labor Dashboard</h1>
        <p className="text-sm" style={{ color: INK.muted }}>
          Wages across all contractors. Log entries and see per-contractor reports on the Labor Wages page.
        </p>
      </div>

      {contractors.length === 0 ? (
        <Card className="p-8 text-center text-sm" style={{ color: INK.muted }}>
          No contractors yet — add one from the menu icon on the Labor Wages page.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <Card className="p-5">
              <h3 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: INK.muted }}>Total Earned (CFT)</h3>
              <p className="text-3xl font-semibold" style={{ color: INK.primary }}>{formatCurrency(totals.totalEarned)}</p>
            </Card>
            <Card className="p-5">
              <h3 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: INK.muted }}>Total Paid</h3>
              <p className="text-3xl font-semibold" style={{ color: INK.primary }}>{formatCurrency(totals.totalPaid)}</p>
            </Card>
            <Card className="p-5">
              <h3 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: INK.muted }}>
                {totals.pending < 0 ? "Owed Back" : "Pending"}
              </h3>
              <p
                className="text-3xl font-semibold"
                style={{ color: totals.pending > 0 ? STATUS.warning : totals.pending < 0 ? STATUS.critical : INK.primary }}
              >
                {formatCurrency(Math.abs(totals.pending))}
              </p>
            </Card>
          </div>

          {byContractor.length > 0 && (
            <Card className="p-4 h-96">
              <p className="text-sm font-semibold px-1 pb-2" style={{ color: INK.primary }}>Earned vs Paid, by contractor</p>
              <ResponsiveContainer width="100%" height="90%">
                <BarChart data={byContractor} margin={{ top: 8, right: 8, left: 0, bottom: 8 }} barGap={2}>
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
                  <Bar dataKey="earned" name="Earned" fill={seriesColors[1]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="paid" name="Paid" fill={seriesColors[2]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default LaborDashboard;
