import InventoryTransaction from "../models/InventoryTransaction.js";

export const getInventoryTransactions = async (req, res) => {
  try {
    const transactions = await InventoryTransaction.find({ user: req.user.id }).sort({ date: -1 });
    res.json(transactions);
  } catch (error) {
    console.error("Error fetching inventory transactions:", error);
    res.status(500).json({ message: "Error fetching inventory transactions", error: error.message });
  }
};

// Current stock per item: quantity on hand + its book value, using a
// weighted-average purchase rate (total ₹ bought in / total quantity bought
// in) — the standard simple way to value mixed-rate stock without tracking
// individual lots.
export const getStockSummary = async (req, res) => {
  try {
    const transactions = await InventoryTransaction.find({ user: req.user.id });
    const items = new Map();

    for (const t of transactions) {
      const key = t.item.trim().toLowerCase();
      if (!items.has(key)) {
        items.set(key, {
          item: t.item.trim(),
          unit: t.unit,
          totalIn: 0,
          totalOut: 0,
          purchaseValueIn: 0,
          saleValueOut: 0,
        });
      }
      const entry = items.get(key);
      if (t.direction === "in") {
        entry.totalIn += t.quantity;
        entry.purchaseValueIn += t.amount;
      } else {
        entry.totalOut += t.quantity;
        entry.saleValueOut += t.amount;
      }
    }

    const result = Array.from(items.values()).map((e) => {
      const currentStock = Math.max(0, e.totalIn - e.totalOut);
      const avgRate = e.totalIn > 0 ? e.purchaseValueIn / e.totalIn : 0;
      return {
        item: e.item,
        unit: e.unit,
        currentStock,
        avgRate: Math.round(avgRate * 100) / 100,
        stockValue: Math.round(currentStock * avgRate * 100) / 100,
        totalIn: e.totalIn,
        totalOut: e.totalOut,
      };
    });

    res.json(result.sort((a, b) => b.stockValue - a.stockValue));
  } catch (error) {
    console.error("Error building stock summary:", error);
    res.status(500).json({ message: "Error building stock summary", error: error.message });
  }
};

export const addInventoryTransaction = async (req, res) => {
  const { item, direction, quantity, unit, rate, party, date, notes } = req.body;

  if (!item || !direction || !["in", "out"].includes(direction) || !quantity || rate === undefined) {
    return res.status(400).json({ message: "Item, direction (in/out), quantity and rate are required" });
  }

  try {
    const transaction = await InventoryTransaction.create({
      user: req.user.id,
      item,
      direction,
      quantity,
      unit,
      rate,
      party,
      date: date || new Date(),
      notes,
    });
    res.status(201).json(transaction);
  } catch (error) {
    console.error("Error adding inventory transaction:", error);
    res.status(500).json({ message: "Error adding inventory transaction", error: error.message });
  }
};

export const deleteInventoryTransaction = async (req, res) => {
  try {
    const transaction = await InventoryTransaction.findById(req.params.id);
    if (!transaction) return res.status(404).json({ message: "Inventory transaction not found" });
    if (transaction.user.toString() !== req.user.id)
      return res.status(403).json({ message: "Not authorized to delete this inventory transaction" });

    await transaction.deleteOne();
    res.json({ message: "Inventory transaction deleted successfully" });
  } catch (error) {
    console.error("Error deleting inventory transaction:", error);
    res.status(500).json({ message: "Error deleting inventory transaction", error: error.message });
  }
};
