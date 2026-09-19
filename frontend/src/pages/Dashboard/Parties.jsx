import React, { useEffect, useState } from "react";
import { fetchParties, fetchPartyTransactions } from "/src/api/parties";
import { FiUsers, FiChevronDown, FiChevronUp, FiClock, FiAlertTriangle } from "react-icons/fi";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    amount || 0
  );

const formatDate = (date) => (date ? new Date(date).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }) : "—");

const isOverdue = (t) => t?.paymentStatus === "Pending" && t?.dueDate && new Date(t.dueDate) < new Date();

const Parties = () => {
  const [parties, setParties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null); // party name currently expanded
  const [detailCache, setDetailCache] = useState({}); // party name -> { transactions, totals }
  const [detailLoading, setDetailLoading] = useState(null);

  const notifyError = (message) => toast.error(message, { position: "top-right", autoClose: 4000 });

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await fetchParties();
        setParties(Array.isArray(data) ? data : []);
        setError(null);
      } catch (err) {
        setError("Failed to load parties");
        notifyError("Error loading party ledger");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const toggleExpand = async (partyName) => {
    if (expanded === partyName) {
      setExpanded(null);
      return;
    }
    setExpanded(partyName);
    if (!detailCache[partyName]) {
      try {
        setDetailLoading(partyName);
        const data = await fetchPartyTransactions(partyName);
        setDetailCache((prev) => ({ ...prev, [partyName]: data }));
      } catch (err) {
        notifyError(err.message || "Failed to load that party's transactions");
        setExpanded(null);
      } finally {
        setDetailLoading(null);
      }
    }
  };

  const totalOutstandingPayable = parties.reduce((sum, p) => sum + (p.pendingPayable || 0), 0);
  const totalOutstandingReceivable = parties.reduce((sum, p) => sum + (p.pendingReceivable || 0), 0);

  return (
    <div className="p-6 sm:px-12 lg:px-20 bg-gradient-to-br from-gray-50 to-gray-100 min-h-screen">
      <ToastContainer />
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Party Ledger</h1>
          <p className="text-gray-600">Every vendor and customer, with what's still outstanding between you</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
          <div className="bg-white shadow-lg rounded-xl p-6 border border-gray-200">
            <h3 className="text-sm font-medium text-gray-500 mb-1">You owe (pending to vendors)</h3>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(totalOutstandingPayable)}</p>
          </div>
          <div className="bg-white shadow-lg rounded-xl p-6 border border-gray-200">
            <h3 className="text-sm font-medium text-gray-500 mb-1">Owed to you (pending from customers)</h3>
            <p className="text-2xl font-bold text-green-600">{formatCurrency(totalOutstandingReceivable)}</p>
          </div>
        </div>

        <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="flex justify-center items-center h-40">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
            </div>
          ) : error ? (
            <div className="bg-red-50 p-4 text-red-600 text-center">{error}</div>
          ) : parties.length === 0 ? (
            <div className="text-center py-14 text-gray-500">
              <FiUsers size={40} className="mx-auto mb-4 text-gray-400" />
              <p className="text-lg">No parties yet.</p>
              <p className="text-sm mt-2">Add a vendor or customer name on an expense or income entry to see them here.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {parties.map((p) => (
                <div key={p.party}>
                  <button
                    onClick={() => toggleExpand(p.party)}
                    className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition text-left"
                  >
                    <div className="flex items-center min-w-0">
                      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center mr-4 shrink-0">
                        <FiUsers className="text-blue-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{p.party}</p>
                        <p className="text-xs text-gray-500">
                          {p.transactionCount} transaction{p.transactionCount === 1 ? "" : "s"} · last on{" "}
                          {formatDate(p.lastDate)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 shrink-0 ml-4">
                      {p.pendingPayable > 0 && (
                        <div className="text-right">
                          <p className="text-xs text-gray-400">You owe</p>
                          <p className="font-semibold text-red-600">{formatCurrency(p.pendingPayable)}</p>
                        </div>
                      )}
                      {p.pendingReceivable > 0 && (
                        <div className="text-right">
                          <p className="text-xs text-gray-400">Owed to you</p>
                          <p className="font-semibold text-green-600">{formatCurrency(p.pendingReceivable)}</p>
                        </div>
                      )}
                      {p.pendingPayable === 0 && p.pendingReceivable === 0 && (
                        <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-500">Settled</span>
                      )}
                      {expanded === p.party ? (
                        <FiChevronUp className="text-gray-400" />
                      ) : (
                        <FiChevronDown className="text-gray-400" />
                      )}
                    </div>
                  </button>

                  {expanded === p.party && (
                    <div className="bg-gray-50 px-6 py-4">
                      {detailLoading === p.party ? (
                        <div className="flex justify-center py-6">
                          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs font-medium text-gray-500 uppercase">
                                <th className="py-2 pr-4">Date</th>
                                <th className="py-2 pr-4">Type</th>
                                <th className="py-2 pr-4">Title</th>
                                <th className="py-2 pr-4">Status</th>
                                <th className="py-2 pr-4 text-right">Amount</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {(detailCache[p.party]?.transactions || []).map((t) => (
                                <tr key={t._id}>
                                  <td className="py-2 pr-4 whitespace-nowrap">{formatDate(t.date)}</td>
                                  <td className="py-2 pr-4 whitespace-nowrap">
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                        t.type === "income" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                                      }`}
                                    >
                                      {t.type === "income" ? "Income" : "Expense"}
                                    </span>
                                  </td>
                                  <td className="py-2 pr-4">{t.type === "income" ? t.source : t.title}</td>
                                  <td className="py-2 pr-4 whitespace-nowrap">
                                    {t.paymentStatus === "Pending" ? (
                                      <span
                                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                          isOverdue(t) ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                                        }`}
                                      >
                                        <FiClock size={11} className="mr-1" />
                                        {isOverdue(t) ? "Overdue" : "Pending"}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                        Paid
                                      </span>
                                    )}
                                  </td>
                                  <td
                                    className={`py-2 pr-4 text-right font-semibold ${
                                      t.type === "income" ? "text-green-600" : "text-red-600"
                                    }`}
                                  >
                                    {t.type === "income" ? "+" : "-"}
                                    {formatCurrency(t.amount)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {(totalOutstandingPayable > 0 || totalOutstandingReceivable > 0) && (
          <div className="mt-6 flex items-start bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
            <FiAlertTriangle size={18} className="mr-2 mt-0.5 shrink-0" />
            <p>
              Balances shown here come from transactions marked "Pending" on the Expenses/Income pages. Mark a
              transaction Paid once it's actually settled to keep this accurate.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Parties;
