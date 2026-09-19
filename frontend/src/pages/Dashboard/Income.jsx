import React, { useState, useEffect, useMemo } from "react";
import { getIncome, deleteIncome, addIncome } from "/src/api/income";
import { fetchCategories } from "/src/api/meta";
import { API_BASE_URL } from "/src/api/config";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { FiPlus, FiTrash2, FiCalendar, FiDollarSign, FiTag, FiAlertTriangle, FiPaperclip, FiUser, FiCreditCard, FiDownload, FiClock } from "react-icons/fi";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import {
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_PAYMENT_MODES,
  DEFAULT_PAYMENT_STATUSES,
  DEFAULT_GST_RATES,
} from "/src/constants/categories";
import { downloadCsv } from "/src/utils/exportCsv";

const SERVER_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");
const billUrl = (billFile) => (billFile ? `${SERVER_ORIGIN}${billFile}` : null);

const emptyIncomeForm = {
  amount: "",
  source: "",
  category: "",
  customCategory: "",
  party: "",
  paymentMode: "Cash",
  paymentStatus: "Paid",
  dueDate: "",
  gstApplicable: false,
  gstRate: "0",
  notes: "",
  date: new Date().toISOString().split("T")[0],
  bill: null,
};

const isOverdue = (entry) =>
  entry?.paymentStatus === "Pending" && entry?.dueDate && new Date(entry.dueDate) < new Date();

const CATEGORY_COLORS = {
  "Timber Sales": "#4CAF50",
  "Plywood & Board Sales": "#2196F3",
  "Sawdust / Byproduct Sales": "#FF9800",
  "Job Work / Sawing Charges": "#E91E63",
  "Other Income": "#9C27B0",
};

const Income = () => {
  const [income, setIncome] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [incomeCategories, setIncomeCategories] = useState(DEFAULT_INCOME_CATEGORIES);
  const [paymentModes, setPaymentModes] = useState(DEFAULT_PAYMENT_MODES);
  const [paymentStatuses, setPaymentStatuses] = useState(DEFAULT_PAYMENT_STATUSES);
  const [gstRates, setGstRates] = useState(DEFAULT_GST_RATES);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [newIncome, setNewIncome] = useState(emptyIncomeForm);

  const notifySuccess = (message) => toast.success(message, { position: "top-right", autoClose: 3000 });
  const notifyError = (message) => toast.error(message, { position: "top-right", autoClose: 4000 });

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [data, categories] = await Promise.all([getIncome(), fetchCategories()]);
        setIncome(Array.isArray(data) ? data.sort((a, b) => new Date(a.date) - new Date(b.date)) : []);
        setIncomeCategories(categories.incomeCategories || DEFAULT_INCOME_CATEGORIES);
        setPaymentModes(categories.paymentModes || DEFAULT_PAYMENT_MODES);
        setPaymentStatuses(categories.paymentStatuses || DEFAULT_PAYMENT_STATUSES);
        setGstRates(categories.gstRates || DEFAULT_GST_RATES);
        setError(null);
      } catch (err) {
        setError("Failed to load income");
        notifyError("Error loading income data");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const openDeleteConfirmation = (incomeId, incomeSource, incomeAmount) => {
    setItemToDelete({ id: incomeId, source: incomeSource, amount: incomeAmount });
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!itemToDelete) return;

    try {
      await deleteIncome(itemToDelete.id);
      setIncome(income.filter((i) => i._id !== itemToDelete.id));
      notifySuccess("Income deleted successfully!");
      setShowDeleteModal(false);
      setItemToDelete(null);
    } catch (err) {
      notifyError(err.message || "Error deleting income");
    }
  };

  const handleAddIncome = async (e) => {
    e.preventDefault();
    if (!newIncome.amount || !newIncome.source || !newIncome.category || !newIncome.date) {
      notifyError("Source, amount, category and date are required!");
      return;
    }
    if (newIncome.category === "Other" && !newIncome.customCategory.trim()) {
      notifyError("Please specify the category");
      return;
    }
    if (newIncome.paymentStatus === "Pending" && !newIncome.dueDate) {
      notifyError("Please set a due date for a pending payment");
      return;
    }

    try {
      setSubmitting(true);
      const addedIncome = await addIncome({
        ...newIncome,
        amount: Number(newIncome.amount),
        dueDate: newIncome.paymentStatus === "Pending" ? newIncome.dueDate : undefined,
      });
      setIncome([...income, addedIncome].sort((a, b) => new Date(a.date) - new Date(b.date)));
      notifySuccess("Income added successfully!");
      setShowAddModal(false);
      setNewIncome(emptyIncomeForm);
    } catch (err) {
      notifyError(err.message || "Failed to add income!");
    } finally {
      setSubmitting(false);
    }
  };

  const displayCategory = (item) => (item.category === "Other" ? item.customCategory || "Other" : item.category);

  const totalIncome = income.reduce((sum, entry) => sum + (Number(entry?.amount) || 0), 0);

  const barData = income.map((entry) => ({
    date: entry?.date ? new Date(entry.date).toLocaleDateString("en-IN", { month: "short", day: "numeric" }) : "Unknown",
    amount: entry?.amount || 0,
  }));

  const categoryTotals = useMemo(
    () =>
      income.reduce((acc, entry) => {
        const category = displayCategory(entry) || "Uncategorized";
        acc[category] = (acc[category] || 0) + Number(entry?.amount || 0);
        return acc;
      }, {}),
    [income]
  );

  const getCategoryColor = (category) => CATEGORY_COLORS[category] || "#607D8B";

  const formatCurrency = (amount) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
      amount || 0
    );

  const handleExportCsv = () => {
    if (income.length === 0) {
      notifyError("No income to export yet");
      return;
    }
    downloadCsv(
      `kushal-timbers-income-${new Date().toISOString().split("T")[0]}.csv`,
      [
        { key: "date", label: "Date" },
        { key: "source", label: "Source" },
        { key: "category", label: "Category" },
        { key: "party", label: "Party" },
        { key: "paymentMode", label: "Payment Mode" },
        { key: "paymentStatus", label: "Status" },
        { key: "dueDate", label: "Due Date" },
        { key: "amount", label: "Amount (INR)" },
        { key: "notes", label: "Notes" },
      ],
      income.map((entry) => ({
        date: entry?.date ? new Date(entry.date).toLocaleDateString("en-IN") : "",
        source: entry?.source || "",
        category: displayCategory(entry),
        party: entry?.party || "",
        paymentMode: entry?.paymentMode || "",
        paymentStatus: entry?.paymentStatus || "Paid",
        dueDate: entry?.dueDate ? new Date(entry.dueDate).toLocaleDateString("en-IN") : "",
        amount: entry?.amount ?? "",
        notes: entry?.notes || "",
      }))
    );
  };

  return (
    <div className="p-6 sm:px-12 lg:px-20 bg-gradient-to-br from-gray-50 to-gray-100 min-h-screen">
      <ToastContainer />
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Income</h1>
            <p className="text-gray-600">Track everything Kushal Timbers earns</p>
          </div>
          <div className="flex items-center">
            <div className="mr-6 bg-white p-3 rounded-lg shadow-md">
              <span className="block text-sm text-gray-500">Total Income</span>
              <span className="text-2xl font-bold text-green-600">{formatCurrency(totalIncome)}</span>
            </div>
            <button
              onClick={handleExportCsv}
              className="mr-3 bg-white border border-gray-300 text-gray-700 px-4 py-3 rounded-lg shadow-sm hover:bg-gray-50 transition duration-300 flex items-center"
            >
              <FiDownload size={18} className="mr-2" /> Export
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-green-600 text-white px-5 py-3 rounded-lg shadow-md hover:bg-green-700 transition duration-300 flex items-center"
            >
              <FiPlus size={20} className="mr-2" /> Add Income
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2 bg-white shadow-lg rounded-xl p-6 border border-gray-200">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">Income Over Time</h2>
            <div className="w-full h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(value) => `₹${value}`} tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value) => [formatCurrency(value), "Amount"]}
                    contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                  />
                  <Bar dataKey="amount" fill="#4CAF50" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white shadow-lg rounded-xl p-6 border border-gray-200">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">Income by Category</h2>
            {Object.entries(categoryTotals).length === 0 ? (
              <p className="text-gray-500 text-center py-8">No categories found</p>
            ) : (
              <div className="space-y-4">
                {Object.entries(categoryTotals).map(([category, amount]) => (
                  <div key={category} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div className="w-4 h-4 rounded-full mr-3" style={{ backgroundColor: getCategoryColor(category) }}></div>
                      <span className="font-medium">{category}</span>
                    </div>
                    <span className="font-semibold">{formatCurrency(amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white shadow-lg rounded-xl p-6 border border-gray-200">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Income Details</h2>
          {loading ? (
            <div className="flex justify-center items-center h-40">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-green-500"></div>
            </div>
          ) : error ? (
            <div className="bg-red-50 p-4 rounded-lg text-red-600 text-center">{error}</div>
          ) : income.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <FiDollarSign size={40} className="mx-auto mb-4 text-gray-400" />
              <p className="text-lg">No income records found.</p>
              <p className="text-sm mt-2">Add your first income by clicking the "Add Income" button.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Party</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Payment</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bill</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {income.map((entry, index) => (
                    <tr key={entry?._id || `income-${index}`} className="hover:bg-gray-50 transition duration-200">
                      <td className="px-4 py-4 whitespace-nowrap font-medium text-gray-900">{entry?.source || "Unknown"}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-gray-700">{displayCategory(entry) || "No category"}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-gray-700">{entry?.party || "—"}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-gray-700">{entry?.paymentMode || "—"}</td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        {entry?.paymentStatus === "Pending" ? (
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              isOverdue(entry) ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            <FiClock size={12} className="mr-1" />
                            {isOverdue(entry) ? "Overdue" : "Pending"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            Paid
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-gray-700">
                        {entry?.date
                          ? new Date(entry.date).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })
                          : ""}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        {entry?.billFile ? (
                          <a
                            href={billUrl(entry.billFile)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-blue-600 hover:text-blue-800"
                          >
                            <FiPaperclip size={14} className="mr-1" /> View
                          </a>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-right font-bold text-green-600">
                        {formatCurrency(entry?.amount)}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-right">
                        <button
                          onClick={() => openDeleteConfirmation(entry?._id, entry?.source, entry?.amount)}
                          className="inline-flex items-center px-3 py-1.5 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition duration-200"
                        >
                          <FiTrash2 size={16} className="mr-1" /> Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Add Income Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
          <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-md relative border-2 border-gray-200 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-5 text-gray-800 border-b pb-3">Add New Income</h2>
            <form onSubmit={handleAddIncome} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiDollarSign className="text-gray-400" />
                  </div>
                  <input
                    type="number"
                    value={newIncome.amount}
                    onChange={(e) => setNewIncome({ ...newIncome, amount: e.target.value })}
                    className="w-full pl-10 border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition duration-200"
                    placeholder="0"
                    step="0.01"
                    min="0"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
                <input
                  type="text"
                  value={newIncome.source}
                  onChange={(e) => setNewIncome({ ...newIncome, source: e.target.value })}
                  className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition duration-200"
                  placeholder="E.g., Timber sale to a local contractor"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiTag className="text-gray-400" />
                  </div>
                  <select
                    value={newIncome.category}
                    onChange={(e) => setNewIncome({ ...newIncome, category: e.target.value })}
                    className="w-full pl-10 border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition duration-200 appearance-none"
                    required
                  >
                    <option value="">Select Category</option>
                    {incomeCategories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {newIncome.category === "Other" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Specify Category</label>
                  <input
                    type="text"
                    value={newIncome.customCategory}
                    onChange={(e) => setNewIncome({ ...newIncome, customCategory: e.target.value })}
                    className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition duration-200"
                    placeholder="E.g., Machinery rental income"
                    required
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Party / Customer (optional)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiUser className="text-gray-400" />
                  </div>
                  <input
                    type="text"
                    value={newIncome.party}
                    onChange={(e) => setNewIncome({ ...newIncome, party: e.target.value })}
                    className="w-full pl-10 border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition duration-200"
                    placeholder="E.g., Patel Furniture Works"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Mode</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiCreditCard className="text-gray-400" />
                  </div>
                  <select
                    value={newIncome.paymentMode}
                    onChange={(e) => setNewIncome({ ...newIncome, paymentMode: e.target.value })}
                    className="w-full pl-10 border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition duration-200 appearance-none"
                  >
                    {paymentModes.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Status</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiClock className="text-gray-400" />
                  </div>
                  <select
                    value={newIncome.paymentStatus}
                    onChange={(e) => setNewIncome({ ...newIncome, paymentStatus: e.target.value })}
                    className="w-full pl-10 border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition duration-200 appearance-none"
                  >
                    {paymentStatuses.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Use "Pending" for a sale on credit that hasn't been received from the customer yet.
                </p>
              </div>
              {newIncome.paymentStatus === "Pending" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={newIncome.dueDate}
                    onChange={(e) => setNewIncome({ ...newIncome, dueDate: e.target.value })}
                    className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition duration-200"
                    required
                  />
                </div>
              )}
              <div>
                <label className="flex items-center text-sm font-medium text-gray-700 mb-1">
                  <input
                    type="checkbox"
                    checked={newIncome.gstApplicable}
                    onChange={(e) => setNewIncome({ ...newIncome, gstApplicable: e.target.checked })}
                    className="mr-2 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  GST Applicable
                </label>
                {newIncome.gstApplicable && (
                  <select
                    value={newIncome.gstRate}
                    onChange={(e) => setNewIncome({ ...newIncome, gstRate: e.target.value })}
                    className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition duration-200 appearance-none"
                  >
                    {gstRates.map((rate) => (
                      <option key={rate} value={rate}>
                        {rate}%
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiCalendar className="text-gray-400" />
                  </div>
                  <input
                    type="date"
                    value={newIncome.date}
                    onChange={(e) => setNewIncome({ ...newIncome, date: e.target.value })}
                    className="w-full pl-10 border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition duration-200"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bill / Receipt (optional)</label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => setNewIncome({ ...newIncome, bill: e.target.files?.[0] || null })}
                  className="w-full border border-gray-300 p-2.5 rounded-lg text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-green-50 file:text-green-600"
                />
                <p className="text-xs text-gray-400 mt-1">JPG, PNG or PDF, up to 5MB</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea
                  value={newIncome.notes}
                  onChange={(e) => setNewIncome({ ...newIncome, notes: e.target.value })}
                  className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition duration-200"
                  rows={2}
                  placeholder="Any extra detail worth remembering"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  className="px-5 py-2.5 bg-gray-200 rounded-lg hover:bg-gray-300 transition duration-200 font-medium text-gray-700"
                  onClick={() => {
                    setShowAddModal(false);
                    setNewIncome(emptyIncomeForm);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition duration-200 font-medium disabled:opacity-60"
                >
                  {submitting ? "Adding..." : "Add Income"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
          <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-md relative border-2 border-gray-200">
            <div className="text-center mb-6">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4">
                <FiAlertTriangle size={24} className="text-red-600" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Confirm Deletion</h3>
              <p className="text-sm text-gray-500">
                Are you sure you want to delete income from{" "}
                <span className="font-medium text-gray-900">{itemToDelete?.source}</span> worth{" "}
                <span className="font-medium text-gray-900">{formatCurrency(itemToDelete?.amount)}</span>?
              </p>
              <p className="text-xs text-gray-500 mt-2">This action cannot be undone.</p>
            </div>
            <div className="flex justify-center space-x-4">
              <button
                type="button"
                className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 transition duration-200 font-medium text-gray-700 min-w-24"
                onClick={() => {
                  setShowDeleteModal(false);
                  setItemToDelete(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition duration-200 font-medium min-w-24"
                onClick={handleDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Income;
