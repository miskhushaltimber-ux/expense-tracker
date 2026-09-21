import { listBudgetsByUser, saveBudgetsForUser } from "../models/budgetStore.js";
import { logAction } from "../utils/auditLog.js";

export const getBudgets = async (req, res) => {
  try {
    const budgets = await listBudgetsByUser(req.user.companyId);
    res.json(budgets);
  } catch (error) {
    console.error("Error fetching budgets:", error);
    res.status(500).json({ message: error.message || "Error fetching budgets" });
  }
};

// Saves many budgets in one request on purpose — the frontend batches every
// changed row into a single call. Owner-only (see routes/budgetRoutes.js):
// budgets are a planning/admin function, not day-to-day data entry.
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
    const saved = await saveBudgetsForUser(req.user.companyId, budgets);
    if (budgets.length) {
      logAction({
        companyId: req.user.companyId,
        actorId: req.user.id,
        actorName: req.user.name,
        actorRole: req.user.role,
        action: "updated",
        entity: "budget",
        entityLabel: `${budgets.length} budget${budgets.length === 1 ? "" : "s"} saved`,
      });
    }
    res.json(saved);
  } catch (error) {
    console.error("Error saving budgets:", error);
    res.status(500).json({ message: error.message || "Error saving budgets" });
  }
};
