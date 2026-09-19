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
import { fetchVehicles } from "/src/api/vehicles";
import { fetchExpenses } from "/src/api/expenses";

// Vehicles' own analytics page — split out of the main Dashboard (18 Sep,
// per Rishi: "vehicle page dedicated page, labour wage dedicated page and so
// on"). Deliberately independent of Vehicles.jsx's own logic (fuel-cheat
// detection, document alerts, filters, draft rows) — that file is large and
// fragile, so this page just re-fetches vehicles + expenses and summarizes,
// same as LaborDashboard.jsx does for contractors/wages/payments.
const SERIES_COLORS = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
const INKS = {
  light: { primary: "#0b0b0b", secondary: "#52514e", muted: "#898781", grid: "#e1e0d9", axis: "#c3c2b7", surface: "#ffffff" },
  dark: { primary: "#f3f4f6", secondary: "#c3c2b7", muted: "#898781", grid: "#374151", axis: "#4b5563", surface: "#1f2937" },
};

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount || 0);

const Card = ({ children, className = "" }) => (
  <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm ${className}`}>{children}</div>
);

const VehicleDashboard = () => {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const INK = INKS[isDark ? "dark" : "light"];
  const seriesColors = SERIES_COLORS[isDark ? "dark" : "light"];

  const [vehicles, setVehicles] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [v, e] = await Promise.all([fetchVehicles(), fetchExpenses()]);
        setVehicles(Array.isArray(v) ? v : []);
        setExpenses(Array.isArray(e) ? e : []);
      } catch (err) {
        setError("Failed to load vehicle data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const vehicleExpenses = useMemo(() => expenses.filter((e) => e.vehicleId), [expenses]);

  const totals = useMemo(() => {
    const totalSpend = vehicleExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    return { totalSpend, vehicleCount: vehicles.length, entryCount: vehicleExpenses.length };
  }, [vehicles, vehicleExpenses]);

  const bySpend = useMemo(() => {
    return vehicles
      .map((v) => ({
        name: v.name,
        spend: vehicleExpenses.filter((e) => e.vehicleId === v._id).reduce((s, e) => s + (Number(e.amount) || 0), 0),
      }))
      .filter((v) => v.spend > 0)
      .sort((a, b) => b.spend - a.spend);
  }, [vehicles, vehicleExpenses]);

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
        <h1 className="text-2xl font-semibold" style={{ color: INK.primary }}>Vehicle Dashboard</h1>
        <p className="text-sm" style={{ color: INK.muted }}>
          Spend across all vehicles. Log entries and manage documents on the Vehicles page.
        </p>
      </div>

      {vehicles.length === 0 ? (
        <Card className="p-8 text-center text-sm" style={{ color: INK.muted }}>
          No vehicles yet — add one from the Vehicles page.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <Card className="p-5">
              <h3 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: INK.muted }}>Total Spend</h3>
              <p className="text-3xl font-semibold" style={{ color: INK.primary }}>{formatCurrency(totals.totalSpend)}</p>
            </Card>
            <Card className="p-5">
              <h3 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: INK.muted }}>Vehicles</h3>
              <p className="text-3xl font-semibold" style={{ color: INK.primary }}>{totals.vehicleCount}</p>
            </Card>
            <Card className="p-5">
              <h3 className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: INK.muted }}>Logged Entries</h3>
              <p className="text-3xl font-semibold" style={{ color: INK.primary }}>{totals.entryCount}</p>
            </Card>
          </div>

          {bySpend.length > 0 && (
            <Card className="p-4 h-96">
              <p className="text-sm font-semibold px-1 pb-2" style={{ color: INK.primary }}>Spend by vehicle</p>
              <ResponsiveContainer width="100%" height="90%">
                <BarChart data={bySpend} margin={{ top: 8, right: 8, left: 0, bottom: 8 }} barGap={2}>
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
                  <Bar dataKey="spend" name="Spend" fill={seriesColors[0]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default VehicleDashboard;
