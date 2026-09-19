import React, { useEffect, useState } from "react";
import { fetchMyCategories, addCategory, deleteCategory } from "/src/api/categories";
import { fetchBudgets, setBudget, deleteBudget } from "/src/api/budgets";
import { fetchRecurring, addRecurring, updateRecurring, deleteRecurring, runRecurringNow } from "/src/api/recurring";
import { fetchCategories } from "/src/api/meta";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_PAYMENT_MODES,
} from "/src/constants/categories";
import { FiPlus, FiTrash2, FiTag, FiPieChart, FiRepeat, FiPlay, FiPause } from "react-icons/fi";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    amount || 0
  );

const TABS = [
  { id: "categories", label: "Categories", icon: FiTag },
  { id: "budgets", label: "Budgets", icon: FiPieChart },
  { id: "recurring", label: "Recurring", icon: FiRepeat },
];

const notifySuccess = (message) => toast.success(message, { position: "top-right", autoClose: 3000 });
const notifyError = (message) => toast.error(message, { position: "top-right", autoClose: 4000 });

// --- Categories tab ---------------------------------------------------
const CategoriesTab = () => {
  const [custom, setCustom] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState({ expense: "", income: "" });

  const load = async () => {
    try {
      setLoading(true);
      setCustom(await fetchMyCategories());
    } catch (err) {
      notifyError("Failed to load categories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async (type) => {
    const name = newName[type]?.trim();
    if (!name) return;
    try {
      await addCategory(type, name);
      setNewName({ ...newName, [type]: "" });
      notifySuccess("Category added");
      load();
    } catch (err) {
      notifyError(err.message || "Failed to add category");
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteCategory(id);
      notifySuccess("Category removed");
      load();
    } catch (err) {
      notifyError(err.message || "Failed to remove category");
    }
  };

  const renderSection = (type, defaults, colorClass) => {
    const customForType = custom.filter((c) => c.type === type);
    return (
      <div className="bg-white shadow-lg rounded-xl p-4 sm:p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800 mb-3 capitalize">{type} Categories</h3>
        <div className="flex flex-wrap gap-2 mb-4">
          {defaults
            .filter((d) => d !== "Other")
            .map((d) => (
              <span key={d} className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs">
                {d}
              </span>
            ))}
        </div>
        {customForType.length > 0 && (
          <div className="space-y-2 mb-4">
            {customForType.map((c) => (
              <div key={c._id} className={`flex items-center justify-between px-3 py-2 rounded-lg ${colorClass}`}>
                <span className="text-sm font-medium">{c.name}</span>
                <button onClick={() => handleDelete(c._id)} className="text-red-500 hover:text-red-700">
                  <FiTrash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={newName[type]}
            onChange={(e) => setNewName({ ...newName, [type]: e.target.value })}
            placeholder="New category name"
            className="flex-1 min-w-0 border border-gray-300 p-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => handleAdd(type)}
            className="shrink-0 bg-blue-600 text-white px-3 py-2.5 rounded-lg hover:bg-blue-700"
          >
            <FiPlus size={16} />
          </button>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-32">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
      {renderSection("expense", DEFAULT_EXPENSE_CATEGORIES, "bg-red-50")}
      {renderSection("income", DEFAULT_INCOME_CATEGORIES, "bg-green-50")}
    </div>
  );
};

// --- Budgets tab --------------------------------------------------------
const BudgetsTab = () => {
  const [budgets, setBudgets] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_EXPENSE_CATEGORIES);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ category: "", monthlyLimit: "" });

  const load = async () => {
    try {
      setLoading(true);
      const [budgetData, catData] = await Promise.all([fetchBudgets(), fetchCategories()]);
      setBudgets(budgetData);
      setCategories(catData.expenseCategories || DEFAULT_EXPENSE_CATEGORIES);
    } catch (err) {
      notifyError("Failed to load budgets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.category || !form.monthlyLimit) {
      notifyError("Category and monthly limit are required");
      return;
    }
    try {
      await setBudget(form.category, Number(form.monthlyLimit));
      notifySuccess("Budget saved");
      setForm({ category: "", monthlyLimit: "" });
      load();
    } catch (err) {
      notifyError(err.message || "Failed to save budget");
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteBudget(id);
      notifySuccess("Budget removed");
      load();
    } catch (err) {
      notifyError(err.message || "Failed to remove budget");
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-32">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white shadow-lg rounded-xl p-4 sm:p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Set a Monthly Budget</h3>
        <form onSubmit={handleSave} className="flex flex-col sm:flex-row gap-3">
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="flex-1 border border-gray-300 p-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          >
            <option value="">Select category</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={form.monthlyLimit}
            onChange={(e) => setForm({ ...form, monthlyLimit: e.target.value })}
            placeholder="Monthly limit (₹)"
            min="0"
            className="sm:w-48 border border-gray-300 p-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <button type="submit" className="bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 text-sm font-medium">
            Save Budget
          </button>
        </form>
      </div>

      <div className="bg-white shadow-lg rounded-xl p-4 sm:p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Your Budgets</h3>
        {budgets.length === 0 ? (
          <p className="text-gray-500 text-sm">No budgets set yet.</p>
        ) : (
          <div className="space-y-4">
            {budgets.map((b) => {
              const barColor = b.percentUsed >= 100 ? "bg-red-500" : b.percentUsed >= 75 ? "bg-amber-500" : "bg-green-500";
              return (
                <div key={b._id}>
                  <div className="flex justify-between items-center mb-1 gap-2">
                    <span className="text-sm font-medium text-gray-700 truncate">{b.category}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-gray-500">
                        {formatCurrency(b.spent)} / {formatCurrency(b.monthlyLimit)}
                      </span>
                      <button onClick={() => handleDelete(b._id)} className="text-red-500 hover:text-red-700">
                        <FiTrash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2.5">
                    <div
                      className={`h-2.5 rounded-full ${barColor}`}
                      style={{ width: `${Math.min(100, b.percentUsed)}%` }}
                    ></div>
                  </div>
                  {b.percentUsed >= 100 && <p className="text-xs text-red-600 mt-1">Over budget this month</p>}
                  {b.percentUsed >= 75 && b.percentUsed < 100 && (
                    <p className="text-xs text-amber-600 mt-1">Approaching limit</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Recurring tab --------------------------------------------------------
const emptyRecurringForm = {
  type: "expense",
  title: "",
  amount: "",
  category: "",
  party: "",
  paymentMode: "Cash",
  dayOfMonth: "1",
  endDate: "",
  notes: "",
};

const RecurringTab = () => {
  const [items, setItems] = useState([]);
  const [expenseCategories, setExpenseCategories] = useState(DEFAULT_EXPENSE_CATEGORIES);
  const [incomeCategories, setIncomeCategories] = useState(DEFAULT_INCOME_CATEGORIES);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyRecurringForm);
  const [running, setRunning] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const [recurringData, catData] = await Promise.all([fetchRecurring(), fetchCategories()]);
      setItems(recurringData);
      setExpenseCategories(catData.expenseCategories || DEFAULT_EXPENSE_CATEGORIES);
      setIncomeCategories(catData.incomeCategories || DEFAULT_INCOME_CATEGORIES);
    } catch (err) {
      notifyError("Failed to load recurring transactions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const categoryOptions = form.type === "expense" ? expenseCategories : incomeCategories;

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.title || !form.amount || !form.category || !form.dayOfMonth) {
      notifyError("Title, amount, category and day of month are required");
      return;
    }
    try {
      await addRecurring(form);
      notifySuccess("Recurring transaction added");
      setForm(emptyRecurringForm);
      setShowForm(false);
      load();
    } catch (err) {
      notifyError(err.message || "Failed to add recurring transaction");
    }
  };

  const handleToggle = async (item) => {
    try {
      await updateRecurring(item._id, { active: !item.active });
      load();
    } catch (err) {
      notifyError(err.message || "Failed to update");
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteRecurring(id);
      notifySuccess("Recurring transaction deleted");
      load();
    } catch (err) {
      notifyError(err.message || "Failed to delete");
    }
  };

  const handleRunNow = async () => {
    try {
      setRunning(true);
      const result = await runRecurringNow();
      notifySuccess(
        `Done: ${result.recurringCreated} entr${result.recurringCreated === 1 ? "y" : "ies"} created, ${result.itemsFlagged} reminder${result.itemsFlagged === 1 ? "" : "s"} processed`
      );
      load();
    } catch (err) {
      notifyError(err.message || "Failed to run");
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-32">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <p className="text-sm text-gray-600">
          Templates that automatically create an entry every month on the day you choose.
        </p>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={handleRunNow}
            disabled={running}
            className="bg-gray-700 text-white px-3 py-2 rounded-lg hover:bg-gray-800 text-sm flex items-center disabled:opacity-60"
            title="Manually run today's due recurring transactions + reminder emails"
          >
            <FiPlay size={14} className="mr-1.5" /> {running ? "Running..." : "Run Now"}
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 text-sm flex items-center"
          >
            <FiPlus size={14} className="mr-1.5" /> New
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white shadow-lg rounded-xl p-4 sm:p-6 border border-gray-200">
          <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value, category: "" })}
              className="border border-gray-300 p-2.5 rounded-lg text-sm"
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
            <input
              type="text"
              placeholder="Title (e.g. Rent, Salaries)"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="border border-gray-300 p-2.5 rounded-lg text-sm"
              required
            />
            <input
              type="number"
              placeholder="Amount (₹)"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="border border-gray-300 p-2.5 rounded-lg text-sm"
              min="0"
              required
            />
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="border border-gray-300 p-2.5 rounded-lg text-sm"
              required
            >
              <option value="">Select category</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Party (optional)"
              value={form.party}
              onChange={(e) => setForm({ ...form, party: e.target.value })}
              className="border border-gray-300 p-2.5 rounded-lg text-sm"
            />
            <select
              value={form.paymentMode}
              onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}
              className="border border-gray-300 p-2.5 rounded-lg text-sm"
            >
              {DEFAULT_PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Day of month (1-28)</label>
              <input
                type="number"
                min="1"
                max="28"
                value={form.dayOfMonth}
                onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })}
                className="w-full border border-gray-300 p-2.5 rounded-lg text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">End date (optional)</label>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="w-full border border-gray-300 p-2.5 rounded-lg text-sm"
              />
            </div>
            <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 bg-gray-200 rounded-lg text-sm hover:bg-gray-300"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white shadow-lg rounded-xl p-4 sm:p-6 border border-gray-200">
        {items.length === 0 ? (
          <p className="text-gray-500 text-sm">No recurring transactions set up yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Day</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Next Run</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {items.map((item) => (
                  <tr key={item._id} className="hover:bg-gray-50">
                    <td className="px-3 py-3 font-medium text-gray-900 whitespace-nowrap">{item.title}</td>
                    <td className="px-3 py-3 whitespace-nowrap capitalize">{item.type}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">{formatCurrency(item.amount)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{item.dayOfMonth}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {new Date(item.nextRunDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <button
                        onClick={() => handleToggle(item)}
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          item.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {item.active ? <FiPlay size={11} className="mr-1" /> : <FiPause size={11} className="mr-1" />}
                        {item.active ? "Active" : "Paused"}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleDelete(item._id)}
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
  );
};

const Settings = () => {
  const [tab, setTab] = useState("categories");

  return (
    <div className="p-4 sm:p-6 lg:px-12 bg-gradient-to-br from-gray-50 to-gray-100 min-h-screen">
      <ToastContainer />
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-1">Settings</h1>
          <p className="text-gray-600 text-sm sm:text-base">Categories, budgets and recurring transactions</p>
        </div>

        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`shrink-0 flex items-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                tab === id ? "bg-blue-600 text-white shadow-md" : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
              }`}
            >
              <Icon size={16} className="mr-2" /> {label}
            </button>
          ))}
        </div>

        {tab === "categories" && <CategoriesTab />}
        {tab === "budgets" && <BudgetsTab />}
        {tab === "recurring" && <RecurringTab />}
      </div>
    </div>
  );
};

export default Settings;
