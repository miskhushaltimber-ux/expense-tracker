import React, { useEffect, useMemo, useState } from "react";
import { fetchFinancialYearSummary, fetchGstSummary } from "/src/api/reports";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { FiFileText, FiTrendingUp, FiTrendingDown } from "react-icons/fi";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    amount || 0
  );

// The financial year (Apr-Mar) containing today, as a start year, e.g. 2026.
const getCurrentFYStartYear = () => {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
};

const fyLabel = (startYear) => `${startYear}-${String(startYear + 1).slice(-2)}`;
const fyValue = (startYear) => `${startYear}-${startYear + 1}`;

const Reports = () => {
  const currentFYStart = getCurrentFYStartYear();
  const fyOptions = [currentFYStart, currentFYStart - 1, currentFYStart - 2];

  const [selectedFY, setSelectedFY] = useState(fyValue(currentFYStart));
  const [fySummary, setFySummary] = useState(null);
  const [gstPeriod, setGstPeriod] = useState("month"); // "month" | "fy"
  const [gstSummary, setGstSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const notifyError = (message) => toast.error(message, { position: "top-right", autoClose: 4000 });

  const loadFY = async (fy) => {
    try {
      const data = await fetchFinancialYearSummary(fy);
      setFySummary(data);
    } catch (err) {
      notifyError("Error loading financial year summary");
    }
  };

  const loadGst = async (period, fy) => {
    try {
      const data = await fetchGstSummary(period === "fy" ? { fy } : {});
      setGstSummary(data);
    } catch (err) {
      notifyError("Error loading GST summary");
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        await Promise.all([loadFY(selectedFY), loadGst(gstPeriod, selectedFY)]);
        setError(null);
      } catch (err) {
        setError("Failed to load reports");
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadFY(selectedFY);
    if (gstPeriod === "fy") loadGst("fy", selectedFY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFY]);

  useEffect(() => {
    loadGst(gstPeriod, selectedFY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gstPeriod]);

  const chartData = useMemo(() => fySummary?.months || [], [fySummary]);

  return (
    <div className="p-4 sm:p-6 lg:px-12 bg-gradient-to-br from-gray-50 to-gray-100 min-h-screen">
      <ToastContainer />
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-1">Reports</h1>
          <p className="text-gray-600 text-sm sm:text-base">Financial year summary and GST</p>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-40">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
          </div>
        ) : error ? (
          <div className="bg-red-50 p-4 rounded-lg text-red-600 text-center">{error}</div>
        ) : (
          <>
            {/* Financial Year summary */}
            <div className="bg-white shadow-lg rounded-xl p-4 sm:p-6 border border-gray-200 mb-6">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-4">
                <h2 className="text-lg sm:text-xl font-semibold text-gray-800">
                  Financial Year {fySummary?.fy || fyLabel(currentFYStart)}
                </h2>
                <select
                  value={selectedFY}
                  onChange={(e) => setSelectedFY(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {fyOptions.map((y) => (
                    <option key={y} value={fyValue(y)}>
                      FY {fyLabel(y)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                  <p className="text-xs text-gray-500 mb-1">Total Income</p>
                  <p className="text-lg sm:text-xl font-bold text-green-600">
                    {formatCurrency(fySummary?.totals?.income)}
                  </p>
                </div>
                <div className="bg-red-50 rounded-lg p-4 border border-red-100">
                  <p className="text-xs text-gray-500 mb-1">Total Expense</p>
                  <p className="text-lg sm:text-xl font-bold text-red-600">
                    {formatCurrency(fySummary?.totals?.expense)}
                  </p>
                </div>
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                  <p className="text-xs text-gray-500 mb-1">Net Profit</p>
                  <p className="text-lg sm:text-xl font-bold text-blue-600">
                    {formatCurrency(fySummary?.totals?.profit)}
                  </p>
                </div>
              </div>

              <div className="w-full h-64 sm:h-72">
                {chartData.every((m) => !m.income && !m.expense) ? (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    No transactions recorded for this financial year yet
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={50} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${v}`} />
                      <Tooltip formatter={(value, name) => [formatCurrency(value), name === "income" ? "Income" : "Expense"]} />
                      <Bar dataKey="income" fill="#4CAF50" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="expense" fill="#F44336" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* GST summary */}
            <div className="bg-white shadow-lg rounded-xl p-4 sm:p-6 border border-gray-200">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 mb-4">
                <h2 className="text-lg sm:text-xl font-semibold text-gray-800 flex items-center">
                  <FiFileText className="mr-2 text-gray-500" /> GST Summary
                  {gstSummary?.label ? <span className="ml-2 text-sm font-normal text-gray-500">({gstSummary.label})</span> : null}
                </h2>
                <div className="flex rounded-lg border border-gray-300 overflow-hidden self-start">
                  <button
                    onClick={() => setGstPeriod("month")}
                    className={`px-3 py-1.5 text-sm ${gstPeriod === "month" ? "bg-blue-600 text-white" : "bg-white text-gray-600"}`}
                  >
                    This Month
                  </button>
                  <button
                    onClick={() => setGstPeriod("fy")}
                    className={`px-3 py-1.5 text-sm ${gstPeriod === "fy" ? "bg-blue-600 text-white" : "bg-white text-gray-600"}`}
                  >
                    This FY
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                  <p className="text-xs text-gray-500 mb-1 flex items-center">
                    <FiTrendingUp className="mr-1" /> GST Collected (sales)
                  </p>
                  <p className="text-lg sm:text-xl font-bold text-green-600">{formatCurrency(gstSummary?.gstCollected)}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-4 border border-red-100">
                  <p className="text-xs text-gray-500 mb-1 flex items-center">
                    <FiTrendingDown className="mr-1" /> GST Paid (purchases)
                  </p>
                  <p className="text-lg sm:text-xl font-bold text-red-600">{formatCurrency(gstSummary?.gstPaid)}</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                  <p className="text-xs text-gray-500 mb-1">Net Payable</p>
                  <p className="text-lg sm:text-xl font-bold text-blue-600">{formatCurrency(gstSummary?.netPayable)}</p>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-4">
                Only counts entries marked "GST Applicable" on the Expenses/Income pages. This is a helper for your
                own records — always confirm figures with your accountant before filing.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Reports;
