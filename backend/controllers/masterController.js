import {
  listMastersByUser,
  createMaster,
  renameMaster,
  deleteMaster,
} from "../models/masterStore.js";
import { countExpensesUsingMaster, renameMasterOnExpenses } from "../models/expenseStore.js";
import { renameMasterOnBudgets } from "../models/budgetStore.js";

export const getMasters = async (req, res) => {
  try {
    res.json({ masters: await listMastersByUser(req.user.id) });
  } catch (error) {
    console.error("Error fetching masters:", error);
    res.status(500).json({ message: error.message || "Error fetching masters" });
  }
};

export const addMaster = async (req, res) => {
  const { name } = req.body;
  try {
    const { master, error } = await createMaster(req.user.id, name);
    if (error === "empty") return res.status(400).json({ message: "A master needs a name." });
    if (error === "duplicate") return res.status(409).json({ message: `"${name.trim()}" is already in the list.` });
    res.status(201).json(master);
  } catch (error) {
    console.error("Error adding master:", error);
    res.status(500).json({ message: error.message || "Error adding master" });
  }
};

// Renaming carries the new name across to everything that referenced the old
// one — every expense row using it, and its budget.
//
// This is not optional tidying. A master's NAME is the only link between an
// expense, its budget and the master itself; leaving the old name behind would
// silently orphan both, with no error anywhere. (Exactly the bug that turned
// up in the budget work when different capitalisation rewrote a master name.)
export const editMaster = async (req, res) => {
  const { name } = req.body;
  try {
    const { master, previousName, error } = await renameMaster(req.params.id, req.user.id, name);
    if (error === "empty") return res.status(400).json({ message: "A master needs a name." });
    if (error === "not_found") return res.status(404).json({ message: "That master no longer exists." });
    if (error === "forbidden") return res.status(403).json({ message: "Not authorized to edit this master." });
    if (error === "duplicate") return res.status(409).json({ message: `"${name.trim()}" is already in the list.` });

    let movedExpenses = 0;
    if (previousName && previousName !== master.name) {
      movedExpenses = await renameMasterOnExpenses(req.user.id, previousName, master.name);
      await renameMasterOnBudgets(req.user.id, previousName, master.name);
    }

    res.json({ master, movedExpenses });
  } catch (error) {
    console.error("Error renaming master:", error);
    res.status(500).json({ message: error.message || "Error renaming master" });
  }
};

// Deleting is refused while any entry still uses the master — Rishi's decision,
// so the sheet can never contain an expense filed under a head that no longer
// exists. The refusal says how many entries are in the way, because "you can't"
// without "why" is useless.
export const removeMaster = async (req, res) => {
  try {
    const { master, error } = await deleteMaster(req.params.id, req.user.id);
    if (error === "not_found") return res.status(404).json({ message: "That master no longer exists." });
    if (error === "forbidden") return res.status(403).json({ message: "Not authorized to delete this master." });

    res.json({ message: `"${master.name}" removed`, master });
  } catch (error) {
    console.error("Error deleting master:", error);
    res.status(500).json({ message: error.message || "Error deleting master" });
  }
};

// Runs before removeMaster so the usage check happens before anything is
// touched. Kept separate so the "in use" answer is a plain 409 the dropdown can
// show as a sentence, rather than an exception.
export const guardMasterInUse = async (req, res, next) => {
  try {
    const masters = await listMastersByUser(req.user.id);
    const target = masters.find((m) => m.id === req.params.id);
    if (!target) return res.status(404).json({ message: "That master no longer exists." });

    const used = await countExpensesUsingMaster(req.user.id, target.name);
    if (used > 0) {
      return res.status(409).json({
        message: `"${target.name}" is used by ${used} ${used === 1 ? "entry" : "entries"} — rename it, or change those entries first.`,
        inUse: used,
      });
    }
    next();
  } catch (error) {
    console.error("Error checking master usage:", error);
    res.status(500).json({ message: error.message || "Error checking whether that master is in use" });
  }
};
