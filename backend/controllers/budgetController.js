import { listBudgetsByUser, saveBudgetsForUser } from "../models/budgetStore.js";

export const getBudgets = async (req, res) => {
  try {
    const budgets = await listBudgetsByUser(req.user.id);
    res.json(budgets);
  } catch (error) {
    console.error("Error fetching budgets:", error);
    res.status(500).json({ message: error.message || "Error fetching budgets" });
  }
};

// Saves many budgets in one request on purpose. The frontend batches every
// changed row into a single call, because Google Sheets only allows 60 writes
// a minute across the whole app — one request per edited master would burn
// through that the first time sir fills the page in.
export const saveBudgets = async (req, res) => {
  const { budgets } = req.body;

  if (!Array.isArray(budgets)) {
    return res.status(400).json({ message: "Expected a `budgets` array." });
  }
  if (budgets.length > 200) {
    return res.status(400).json({ message: "Too many budgets in one request (limit 200)." });
  }

  // Validate before writing anything, so a single bad row can't leave the
  // sheet half-saved.
  for (const entry of budgets) {
    if (!entry || typeof entry !== "object") {
      return res.status(400).json({ message: "Each budget must be an object." });
    }
    if (!entry.master || !String(entry.master).trim()) {
      return res.status(400).json({ message: "Every budget needs a master name." });
    }
    for (const field of ["monthlyBudget", "yearlyBudget"]) {
      const raw = entry[field];
      if (raw === "" || raw === null || raw === undefined) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        return res
          .status(400)
          .json({ message: `"${entry.master}" has an invalid ${field} — it must be a number, or blank for no budget.` });
      }
    }
  }

  try {
    const saved = await saveBudgetsForUser(req.user.id, budgets);
    res.json(saved);
  } catch (error) {
    console.error("Error saving budgets:", error);
    res.status(500).json({ message: error.message || "Error saving budgets" });
  }
};
