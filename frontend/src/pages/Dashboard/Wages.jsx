import React, { useEffect, useState } from "react";
import { fetchWages, fetchWageSummary, addWageEntry, deleteWageEntry } from "/src/api/wages";
import { DEFAULT_PAYMENT_MODES, DEFAULT_PAYMENT_STATUSES } from "/src/constants/categories";
import { FiUser, FiPlus, FiTrash2, FiClock, FiDollarSign } from "react-icons/fi";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const emptyForm = {
  workerName: "",
  workDescription: "",
  amount: "",
  paymentMode: "Cash",
  paymentStatus: "Paid",
  dueDate: "",
  date: new Date().toISOString().split("T")[0],
  notes: "",
};

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    amount || 0
  );

const formatDate = (date) =>
  date ? new Date(date).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }) : "";

const isOverdue = (w) => w?.paymentStatus === "Pending" && w?.dueDate && new Date(w.dueDate) < new Date();

const Wages = () => {
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const notifySuccess = (message) => toast.success(message, { position: "top-right", autoClose: 3000 });
  const notifyError = (message) => toast.error(message, { position: "top-right", autoClose: 4000 });

  const loadData = async () => {
    try {
      setLoading(true);
      const [entriesData, summaryData] = await Promise.all([fetchWages(), fetchWageSummary()]);
      setEntries(Array.isArray(entriesData) ? entriesData : []);
      setSummary(Array.isArray(summaryData) ? summaryData : []);
      setError(null);
    } catch (err) {
      setError("Failed to load wage data");
      notifyError("Error loading wage data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const totalPaid = summary.reduce((sum, s) => sum + s.totalPaid, 0);
  const totalPending = summary.reduce((sum, s) => sum + s.totalPending, 0);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.workerName || !form.amount) {
      notifyError("Worker name and amount are required");
      return;
    }
    if (form.paymentStatus === "Pending" && !form.dueDate) {
      notifyError("Please set a due date for a pending wage");
      return;
    }
    try {
      setSubmitting(true);
      await addWageEntry({ ...form, amount: Number(form.amount) });
      notifySuccess("Wage entry added");
      setShowModal(false);
      setForm(emptyForm);
      loadData();
    } catch (err) {
      notifyError(err.message || "Failed to add wage entry");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteWageEntry(id);
      notifySuccess("Wage entry deleted");
      loadData();
    } catch (err) {
      notifyError(err.message || "Failed to delete wage entry");
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:px-12 bg-gradient-to-br from-gray-50 to-gray-100 min-h-screen">
      <ToastContainer />
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-1">Worker Wages</h1>
            <p className="text-gray-600 text-sm sm:text-base">Loading, unloading and labor payments, by worker</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="bg-orange-600 text-white px-4 sm:px-5 py-2.5 sm:py-3 rounded-lg shadow-md hover:bg-orange-700 transition duration-300 flex items-center shrink-0"
          >
            <FiPlus size={20} className="mr-2" /> Add Wage Entry
          </button>
        </div>

        <div className="mb-3 flex items-start bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs sm:text-sm text-blue-800">
          Every wage entry here also appears as a "Labor Wages" expense automatically, so it's already counted in
          your dashboard totals and reports — no double entry needed.
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-6">
          <div className="bg-white shadow-lg rounded-xl p-5 sm:p-6 border border-gray-200">
            <h3 className="text-sm font-medium text-gray-500 mb-1">Total Paid</h3>
            <p className="text-xl sm:text-2xl font-bold text-green-600">{formatCurrency(totalPaid)}</p>
          </div>
          <div className="bg-white shadow-lg rounded-xl p-5 sm:p-6 border border-gray-200">
            <h3 className="text-sm font-medium text-gray-500 mb-1">Pending</h3>
            <p className="text-xl sm:text-2xl font-bold text-amber-600">{formatCurrency(totalPending)}</p>
          </div>
        </div>

        <div className="bg-white shadow-lg rounded-xl p-4 sm:p-6 border border-gray-200 mb-6">
          <h2 className="text-lg sm:text-xl font-semibold mb-4 text-gray-800">By Worker</h2>
          {summary.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <FiUser size={36} className="mx-auto mb-3 text-gray-400" />
              <p>No wage entries yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Worker</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Entries</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Paid</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Pending</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {summary.map((s) => (
                    <tr key={s.workerName} className="hover:bg-gray-50">
                      <td className="px-3 py-3 font-medium text-gray-900 whitespace-nowrap">{s.workerName}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">{s.entryCount}</td>
                      <td className="px-3 py-3 text-right text-green-600 font-semibold whitespace-nowrap">
                        {formatCurrency(s.totalPaid)}
                      </td>
                      <td className="px-3 py-3 text-right text-amber-600 font-semibold whitespace-nowrap">
                        {s.totalPending > 0 ? formatCurrency(s.totalPending) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white shadow-lg rounded-xl p-4 sm:p-6 border border-gray-200">
          <h2 className="text-lg sm:text-xl font-semibold mb-4 text-gray-800">All Entries</h2>
          {loading ? (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-orange-500"></div>
            </div>
          ) : error ? (
            <div className="bg-red-50 p-4 rounded-lg text-red-600 text-center">{error}</div>
          ) : entries.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <p>No wage entries recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Worker</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Work</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {entries.map((w) => (
                    <tr key={w._id} className="hover:bg-gray-50">
                      <td className="px-3 py-3 whitespace-nowrap">{formatDate(w.date)}</td>
                      <td className="px-3 py-3 font-medium text-gray-900 whitespace-nowrap">{w.workerName}</td>
                      <td className="px-3 py-3 whitespace-nowrap">{w.workDescription || "—"}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {w.paymentStatus === "Pending" ? (
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              isOverdue(w) ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            <FiClock size={12} className="mr-1" />
                            {isOverdue(w) ? "Overdue" : "Pending"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            Paid
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold whitespace-nowrap">
                        {formatCurrency(w.amount)}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => handleDelete(w._id)}
                          className="inline-flex items-center px-2.5 py-1.5 bg-red-100 text-red-600 rounded-lg hover:bg-red-200"
                        >
                          <FiTrash2 size={14} />
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

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
          <div className="bg-white p-5 sm:p-6 rounded-xl shadow-xl w-full max-w-md relative border-2 border-gray-200 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-5 text-gray-800 border-b pb-3">Add Wage Entry</h2>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Worker Name</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiUser className="text-gray-400" />
                  </div>
                  <input
                    type="text"
                    value={form.workerName}
                    onChange={(e) => setForm({ ...form, workerName: e.target.value })}
                    className="w-full pl-10 border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Work Description (optional)</label>
                <input
                  type="text"
                  value={form.workDescription}
                  onChange={(e) => setForm({ ...form, workDescription: e.target.value })}
                  className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="E.g., Loading truck no. 4"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiDollarSign className="text-gray-400" />
                  </div>
                  <input
                    type="number"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="w-full pl-10 border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Mode</label>
                <select
                  value={form.paymentMode}
                  onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}
                  className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  {DEFAULT_PAYMENT_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Status</label>
                <select
                  value={form.paymentStatus}
                  onChange={(e) => setForm({ ...form, paymentStatus: e.target.value })}
                  className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  {DEFAULT_PAYMENT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              {form.paymentStatus === "Pending" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                    className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    required
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>
              <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
                <button
                  type="button"
                  className="px-5 py-2.5 bg-gray-200 rounded-lg hover:bg-gray-300 font-medium text-gray-700"
                  onClick={() => {
                    setShowModal(false);
                    setForm(emptyForm);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium disabled:opacity-60"
                >
                  {submitting ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Wages;
