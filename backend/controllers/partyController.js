import Expense from "../models/Expense.js";
import Income from "../models/Income.js";

// party names are free text, so two entries for "Sharma Timber Traders" and
// "sharma timber traders " should be treated as the same party. We group by
// a normalized (trimmed, lowercased) key but display whichever original
// casing was typed first.
const normalizeParty = (party) => (party || "").trim().toLowerCase();

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Builds the per-party ledger: for each party, how much has actually been
// paid/received (Paid transactions) vs. how much is still outstanding
// (Pending transactions) — the outstanding numbers are the actual "ledger
// balance" a timber trading business cares about day to day.
export const getParties = async (req, res) => {
  try {
    const [expenses, incomes] = await Promise.all([
      Expense.find({ user: req.user.id, party: { $exists: true, $ne: "" } }),
      Income.find({ user: req.user.id, party: { $exists: true, $ne: "" } }),
    ]);

    const parties = new Map();

    const ensureParty = (rawName) => {
      const key = normalizeParty(rawName);
      if (!key) return null;
      if (!parties.has(key)) {
        parties.set(key, {
          party: rawName.trim(),
          totalPaid: 0, // money we've actually paid this party (settled expenses)
          totalReceived: 0, // money we've actually received from this party (settled income)
          pendingPayable: 0, // money we still owe them (pending expenses)
          pendingReceivable: 0, // money they still owe us (pending income)
          transactionCount: 0,
          lastDate: null,
        });
      }
      return parties.get(key);
    };

    for (const e of expenses) {
      const entry = ensureParty(e.party);
      if (!entry) continue;
      if (e.paymentStatus === "Pending") entry.pendingPayable += e.amount;
      else entry.totalPaid += e.amount;
      entry.transactionCount += 1;
      if (!entry.lastDate || e.date > entry.lastDate) entry.lastDate = e.date;
    }

    for (const i of incomes) {
      const entry = ensureParty(i.party);
      if (!entry) continue;
      if (i.paymentStatus === "Pending") entry.pendingReceivable += i.amount;
      else entry.totalReceived += i.amount;
      entry.transactionCount += 1;
      if (!entry.lastDate || i.date > entry.lastDate) entry.lastDate = i.date;
    }

    const result = Array.from(parties.values())
      .map((p) => ({
        ...p,
        // Net balance from the business's point of view: positive = they
        // owe us more than we owe them.
        netBalance: p.pendingReceivable - p.pendingPayable,
      }))
      .sort((a, b) => {
        const volumeA = a.totalPaid + a.totalReceived + a.pendingPayable + a.pendingReceivable;
        const volumeB = b.totalPaid + b.totalReceived + b.pendingPayable + b.pendingReceivable;
        return volumeB - volumeA;
      });

    res.json(result);
  } catch (error) {
    console.error("Error building party ledger:", error);
    res.status(500).json({ message: "Error building party ledger", error: error.message });
  }
};

// Full transaction history (expenses + income, merged) for one party.
export const getPartyTransactions = async (req, res) => {
  const { name } = req.params;
  if (!name || !name.trim()) {
    return res.status(400).json({ message: "Party name is required" });
  }

  try {
    const matcher = new RegExp(`^${escapeRegex(name.trim())}$`, "i");
    const [expenses, incomes] = await Promise.all([
      Expense.find({ user: req.user.id, party: matcher }).sort({ date: -1 }),
      Income.find({ user: req.user.id, party: matcher }).sort({ date: -1 }),
    ]);

    const transactions = [
      ...expenses.map((e) => ({ ...e.toObject(), type: "expense" })),
      ...incomes.map((i) => ({ ...i.toObject(), type: "income" })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    const totals = transactions.reduce(
      (acc, t) => {
        if (t.type === "expense") {
          if (t.paymentStatus === "Pending") acc.pendingPayable += t.amount;
          else acc.totalPaid += t.amount;
        } else {
          if (t.paymentStatus === "Pending") acc.pendingReceivable += t.amount;
          else acc.totalReceived += t.amount;
        }
        return acc;
      },
      { totalPaid: 0, totalReceived: 0, pendingPayable: 0, pendingReceivable: 0 }
    );

    res.json({
      party: transactions[0]?.party || name.trim(),
      transactions,
      totals: { ...totals, netBalance: totals.pendingReceivable - totals.pendingPayable },
    });
  } catch (error) {
    console.error("Error fetching party transactions:", error);
    res.status(500).json({ message: "Error fetching party transactions", error: error.message });
  }
};
