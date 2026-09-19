import React, { useEffect, useMemo, useState } from "react";
import {
  fetchInventoryTransactions,
  fetchStockSummary,
  addInventoryTransaction,
  deleteInventoryTransaction,
} from "/src/api/inventory";
import { fetchCategories } from "/src/api/meta";
import { DEFAULT_INVENTORY_UNITS } from "/src/constants/categories";
import {
  FiBox,
  FiPlus,
  FiTrash2,
  FiArrowDownCircle,
  FiArrowUpCircle,
  FiPackage,
} from "react-icons/fi";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const emptyForm = {
  item: "",
  direction: "in",
  quantity: "",
  unit: "CFT",
  rate: "",
  party: "",
  date: new Date().toISOString().split("T")[0],
  notes: "",
};

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    amount || 0
  );

const formatDate = (date) =>
  date ? new Date(date).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }) : "";

const Inventory = () => {
  const [transactions, setTransactions] = useState([]);
  const [stock, setStock] = useState([]);
  const [units, setUnits] = useState(DEFAULT_INVENTORY_UNITS);
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
      const [tx, summary, categories] = await Promise.all([
        fetchInventoryTransactions(),
        fetchStockSummary(),
        fetchCategories(),
      ]);
      setTransactions(Array.isArray(tx) ? tx : []);
      setStock(Array.isArray(summary) ? summary : []);
      setUnits(categories.inventoryUnits || DEFAULT_INVENTORY_UNITS);
      setError(null);
    } catch (err) {
      setError("Failed to load inventory data");
      notifyError("Error loading inventory data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const totalStockValue = useMemo(() => stock.reduce((sum, s) => sum + (s.stockValue || 0), 0), [stock]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.item || !form.quantity || !form.rate) {
      notifyError("Item, quantity and rate are required");
      return;
    }
    try {
      setSubmitting(true);
      await addInventoryTransaction({
        ...form,
        quantity: Number(form.quantity),
        rate: Number(form.rate),
      });
      notifySuccess("Stock entry recorded");
      setShowModal(false);
      setForm(emptyForm);
      loadData();
    } catch (err) {
      notifyError(err.message || "Failed to record stock entry");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteInventoryTransaction(id);
      notifySuccess("Entry deleted");
      loadData();
    } catch (err) {
      notifyError(err.message || "Failed to delete entry");
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:px-12 bg-gradient-to-br from-gray-50 to-gray-100 min-h-screen">
      <ToastContainer />
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-1">Inventory</h1>
            <p className="text-gray-600 text-sm sm:text-base">Timber stock on hand, by item</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="bg-blue-600 text-white px-4 sm:px-5 py-2.5 sm:py-3 rounded-lg shadow-md hover:bg-blue-700 transition duration-300 flex items-center shrink-0"
          >
            <FiPlus size={20} className="mr-2" /> Record Stock
          </button>
        </div>

        <div className="mb-3 flex items-start bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs sm:text-sm text-blue-800">
          Recording stock here does not create an expense or income entry — keep logging actual payments on the
          Expenses/Income pages as usual. This just tracks physical quantity and book value.
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-6">
          <div className="bg-white shadow-lg rounded-xl p-5 sm:p-6 border border-gray-200">
            <h3 className="text-sm font-medium text-gray-500 mb-1">Total Stock Value</h3>
            <p className="text-xl sm:text-2xl font-bold text-blue-600">{formatCurrency(totalStockValue)}</p>
          </div>
          <div className="bg-white shadow-lg rounded-xl p-5 sm:p-6 border border-gray-200">
            <h3 className="text-sm font-medium text-gray-500 mb-1">Items Tracked</h3>
            <p className="text-xl sm:text-2xl font-bold text-gray-800">{stock.length}</p>
          </div>
        </div>

        <div className="bg-white shadow-lg rounded-xl p-4 sm:p-6 border border-gray-200 mb-6">
          <h2 className="text-lg sm:text-xl font-semibold mb-4 text-gray-800">Current Stock</h2>
          {loading ? (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
            </div>
          ) : stock.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <FiPackage size={36} className="mx-auto mb-3 text-gray-400" />
              <p>No stock recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">In Stock</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Rate</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Value</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {stock.map((s) => (
                    <tr key={s.item} className="hover:bg-gray-50">
                      <td className="px-3 py-3 font-medium text-gray-900 whitespace-nowrap">{s.item}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {s.currentStock} {s.unit}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">{formatCurrency(s.avgRate)}</td>
                      <td className="px-3 py-3 text-right font-semibold text-blue-600 whitespace-nowrap">
                        {formatCurrency(s.stockValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white shadow-lg rounded-xl p-4 sm:p-6 border border-gray-200">
          <h2 className="text-lg sm:text-xl font-semibold mb-4 text-gray-800">Stock Movement Log</h2>
          {error ? (
            <div className="bg-red-50 p-4 rounded-lg text-red-600 text-center">{error}</div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <p>No stock movements recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Direction</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Party</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Rate</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {transactions.map((t) => (
                    <tr key={t._id} className="hover:bg-gray-50">
                      <td className="px-3 py-3 whitespace-nowrap">{formatDate(t.date)}</td>
                      <td className="px-3 py-3 font-medium text-gray-900 whitespace-nowrap">{t.item}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {t.direction === "in" ? (
                          <span className="inline-flex items-center text-green-700">
                            <FiArrowDownCircle className="mr-1" /> In
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-red-700">
                            <FiArrowUpCircle className="mr-1" /> Out
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{t.party || "—"}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {t.quantity} {t.unit}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">{formatCurrency(t.rate)}</td>
                      <td className="px-3 py-3 text-right font-semibold whitespace-nowrap">
                        {formatCurrency(t.amount)}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => handleDelete(t._id)}
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
            <h2 className="text-xl font-bold mb-5 text-gray-800 border-b pb-3">Record Stock Movement</h2>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Item</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiBox className="text-gray-400" />
                  </div>
                  <input
                    type="text"
                    value={form.item}
                    onChange={(e) => setForm({ ...form, item: e.target.value })}
                    className="w-full pl-10 border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="E.g., Teak Wood - 8ft logs"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Direction</label>
                  <select
                    value={form.direction}
                    onChange={(e) => setForm({ ...form, direction: e.target.value })}
                    className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="in">Stock In (purchase)</option>
                    <option value="out">Stock Out (sale)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                  <select
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {units.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                  <input
                    type="number"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                    className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rate (₹/unit)</label>
                  <input
                    type="number"
                    value={form.rate}
                    onChange={(e) => setForm({ ...form, rate: e.target.value })}
                    className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Party (optional)</label>
                <input
                  type="text"
                  value={form.party}
                  onChange={(e) => setForm({ ...form, party: e.target.value })}
                  className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Supplier or customer"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
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
                  className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-60"
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

export default Inventory;
