import React, { useState, useEffect, useRef } from "react";
import { previewImportSheet, commitImportRows } from "/src/api/imports";
import { fetchCategories } from "/src/api/meta";
import {
  FiUploadCloud,
  FiFileText,
  FiAlertTriangle,
  FiCheckCircle,
  FiTrash2,
  FiRefreshCw,
} from "react-icons/fi";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_PAYMENT_MODES,
} from "/src/constants/categories";

const FIELD_LABELS = {
  date: "Date",
  amount: "Amount",
  description: "Description",
  category: "Category",
  party: "Party",
  paymentMode: "Payment mode",
  type: "Income/Expense",
};

const Import = () => {
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [defaultType, setDefaultType] = useState("expense");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [previewMeta, setPreviewMeta] = useState(null); // { warnings, columnMapping, totalRows }
  const [rows, setRows] = useState([]);
  const [resultSummary, setResultSummary] = useState(null);
  const [expenseCategories, setExpenseCategories] = useState(DEFAULT_EXPENSE_CATEGORIES);
  const [incomeCategories, setIncomeCategories] = useState(DEFAULT_INCOME_CATEGORIES);
  const [paymentModes, setPaymentModes] = useState(DEFAULT_PAYMENT_MODES);

  const notifySuccess = (message) => toast.success(message, { position: "top-right", autoClose: 3000 });
  const notifyError = (message) => toast.error(message, { position: "top-right", autoClose: 4000 });

  useEffect(() => {
    fetchCategories().then((categories) => {
      setExpenseCategories(categories.expenseCategories || DEFAULT_EXPENSE_CATEGORIES);
      setIncomeCategories(categories.incomeCategories || DEFAULT_INCOME_CATEGORIES);
      setPaymentModes(categories.paymentModes || DEFAULT_PAYMENT_MODES);
    });
  }, []);

  const resetAll = () => {
    setFile(null);
    setPreviewMeta(null);
    setRows([]);
    setResultSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = (e) => {
    setFile(e.target.files?.[0] || null);
    setPreviewMeta(null);
    setRows([]);
    setResultSummary(null);
  };

  const handlePreview = async () => {
    if (!file) {
      notifyError("Please choose a spreadsheet file first.");
      return;
    }
    try {
      setLoadingPreview(true);
      setResultSummary(null);
      const data = await previewImportSheet(file, defaultType);
      if (!data.rows?.length) {
        notifyError("No data rows were found in that file.");
        setPreviewMeta(null);
        setRows([]);
        return;
      }
      setPreviewMeta({ warnings: data.warnings || [], columnMapping: data.columnMapping || {}, totalRows: data.totalRows });
      setRows(data.rows.map((r) => ({ ...r })));
      notifySuccess(`Found ${data.rows.length} row(s). Check them over below before importing.`);
    } catch (err) {
      notifyError(err.message || "Failed to read that file.");
    } finally {
      setLoadingPreview(false);
    }
  };

  const updateRow = (index, patch) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const handleEntryTypeChange = (index, newType) => {
    // Category options differ between expense/income, so a manual type
    // switch clears the category to make sure the user re-picks a valid one.
    updateRow(index, { entryType: newType, category: "", customCategory: undefined });
  };

  const includedCount = rows.filter((r) => r.include).length;
  const includedTotal = rows.filter((r) => r.include).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  const formatCurrency = (amount) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
      amount || 0
    );

  const handleCommit = async () => {
    if (includedCount === 0) {
      notifyError("Select at least one row to import (checkbox on the left).");
      return;
    }
    const missingAmount = rows.some((r) => r.include && (!r.amount || Number(r.amount) <= 0));
    if (missingAmount) {
      notifyError("Some selected rows have no amount — fill it in or uncheck that row.");
      return;
    }
    try {
      setCommitting(true);
      const result = await commitImportRows(rows);
      setResultSummary(result);
      notifySuccess(`Imported ${result.expensesImported} expense(s) and ${result.incomesImported} income(s)!`);
      setRows([]);
      setPreviewMeta(null);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      notifyError(err.message || "Failed to import.");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="p-6 sm:px-12 lg:px-20 bg-gradient-to-br from-gray-50 to-gray-100 min-h-screen">
      <ToastContainer />
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Import from Spreadsheet</h1>
          <p className="text-gray-600">
            Upload an expense or income sheet (.csv, .xls or .xlsx) — we'll read it, guess the categories, and let
            you check everything before it's saved.
          </p>
        </div>

        {/* Step 1: Upload */}
        <div className="bg-white shadow-lg rounded-xl p-6 border border-gray-200 mb-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-800">1. Choose a file</h2>
          <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Spreadsheet file</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileChange}
                className="w-full border border-gray-300 p-2.5 rounded-lg text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-600"
              />
              <p className="text-xs text-gray-400 mt-1">Up to 5MB. First row should be column headers.</p>
            </div>
            <div className="sm:w-64">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                If a row doesn't say income/expense, treat it as
              </label>
              <select
                value={defaultType}
                onChange={(e) => setDefaultType(e.target.value)}
                className="w-full border border-gray-300 p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </div>
            <button
              onClick={handlePreview}
              disabled={loadingPreview || !file}
              className="bg-blue-600 text-white px-5 py-3 rounded-lg shadow-md hover:bg-blue-700 transition duration-300 flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loadingPreview ? (
                <FiRefreshCw size={18} className="mr-2 animate-spin" />
              ) : (
                <FiUploadCloud size={18} className="mr-2" />
              )}
              {loadingPreview ? "Reading..." : "Preview"}
            </button>
          </div>
        </div>

        {/* Result summary after a successful import */}
        {resultSummary && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 mb-6">
            <div className="flex items-center mb-2">
              <FiCheckCircle size={22} className="text-green-600 mr-2" />
              <h3 className="text-lg font-semibold text-green-800">Import complete</h3>
            </div>
            <p className="text-green-700">
              Saved {resultSummary.expensesImported} expense(s) and {resultSummary.incomesImported} income(s).
            </p>
            {resultSummary.skipped?.length > 0 && (
              <div className="mt-3 text-sm text-amber-700">
                <p className="font-medium">Skipped {resultSummary.skipped.length} row(s):</p>
                <ul className="list-disc list-inside">
                  {resultSummary.skipped.map((s, i) => (
                    <li key={i}>
                      Row {s.row}: {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              onClick={resetAll}
              className="mt-4 px-4 py-2 bg-white border border-green-300 text-green-700 rounded-lg hover:bg-green-100 transition"
            >
              Import another file
            </button>
          </div>
        )}

        {/* Step 2: Preview + edit */}
        {previewMeta && rows.length > 0 && (
          <div className="bg-white shadow-lg rounded-xl p-6 border border-gray-200 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-semibold text-gray-800">2. Review before importing</h2>
              <div className="bg-blue-50 px-4 py-2 rounded-lg text-sm text-blue-800">
                <strong>{includedCount}</strong> of {rows.length} row(s) selected · {formatCurrency(includedTotal)}
              </div>
            </div>

            {previewMeta.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 text-sm text-amber-800">
                <div className="flex items-center font-medium mb-1">
                  <FiAlertTriangle size={16} className="mr-2" /> Heads up
                </div>
                <ul className="list-disc list-inside">
                  {previewMeta.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-gray-400 mb-4 flex items-center flex-wrap gap-x-4">
              <FiFileText size={14} className="mr-1" />
              Detected columns:
              {Object.entries(previewMeta.columnMapping).map(([field, header]) => (
                <span key={field} className="whitespace-nowrap">
                  {FIELD_LABELS[field] || field} → "{header}"
                </span>
              ))}
              {Object.keys(previewMeta.columnMapping).length === 0 && "none — please fill everything in manually"}
            </p>

            <div className="overflow-x-auto -mx-6">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left"></th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Party</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Payment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row, index) => {
                    const categoryList = row.entryType === "income" ? incomeCategories : expenseCategories;
                    return (
                      <tr key={index} className={row.include ? "" : "opacity-40"}>
                        <td className="px-3 py-2 align-top">
                          <input
                            type="checkbox"
                            checked={!!row.include}
                            onChange={(e) => updateRow(index, { include: e.target.checked })}
                            className="h-4 w-4"
                          />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <select
                            value={row.entryType}
                            onChange={(e) => handleEntryTypeChange(index, e.target.value)}
                            className="border border-gray-300 rounded-md p-1.5 text-sm w-28"
                          >
                            <option value="expense">Expense</option>
                            <option value="income">Income</option>
                          </select>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <input
                            type="text"
                            value={row.title || ""}
                            onChange={(e) => updateRow(index, { title: e.target.value, source: e.target.value })}
                            className="border border-gray-300 rounded-md p-1.5 text-sm w-48"
                          />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.amount ?? ""}
                            onChange={(e) => updateRow(index, { amount: e.target.value })}
                            className="border border-gray-300 rounded-md p-1.5 text-sm w-28"
                          />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <input
                            type="date"
                            value={row.date || ""}
                            onChange={(e) => updateRow(index, { date: e.target.value })}
                            className="border border-gray-300 rounded-md p-1.5 text-sm w-36"
                          />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <select
                            value={row.category || ""}
                            onChange={(e) => updateRow(index, { category: e.target.value })}
                            className="border border-gray-300 rounded-md p-1.5 text-sm w-40"
                          >
                            <option value="">Select...</option>
                            {categoryList.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                          {row.category === "Other" && (
                            <input
                              type="text"
                              placeholder="Specify category"
                              value={row.customCategory || ""}
                              onChange={(e) => updateRow(index, { customCategory: e.target.value })}
                              className="mt-1 border border-gray-300 rounded-md p-1.5 text-sm w-40"
                            />
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <input
                            type="text"
                            value={row.party || ""}
                            onChange={(e) => updateRow(index, { party: e.target.value })}
                            className="border border-gray-300 rounded-md p-1.5 text-sm w-32"
                          />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <select
                            value={row.paymentMode || "Cash"}
                            onChange={(e) => updateRow(index, { paymentMode: e.target.value })}
                            className="border border-gray-300 rounded-md p-1.5 text-sm w-28"
                          >
                            {paymentModes.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={resetAll}
                className="px-5 py-2.5 bg-gray-100 rounded-lg hover:bg-gray-200 transition duration-200 font-medium text-gray-700 flex items-center"
              >
                <FiTrash2 size={16} className="mr-2" /> Discard
              </button>
              <button
                onClick={handleCommit}
                disabled={committing || includedCount === 0}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition duration-200 font-medium disabled:opacity-60 flex items-center"
              >
                {committing && <FiRefreshCw size={16} className="mr-2 animate-spin" />}
                {committing ? "Importing..." : `Import ${includedCount} row(s)`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Import;
