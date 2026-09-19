import Category from "../models/Category.js";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "../constants/categories.js";

// Merged list (defaults + this user's custom ones) for a given type, used by
// both /api/meta/categories and the Settings page itself.
export const getMergedCategories = async (userId, type) => {
  const defaults = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const custom = await Category.find({ user: userId, type }).sort({ name: 1 });
  // "Other" is kept last as the escape hatch, custom ones slot in before it.
  const withoutOther = defaults.filter((c) => c !== "Other");
  return [...withoutOther, ...custom.map((c) => c.name), "Other"];
};

// List this user's custom categories (both types), for the Settings page.
export const listCategories = async (req, res) => {
  try {
    const categories = await Category.find({ user: req.user.id }).sort({ type: 1, name: 1 });
    res.json(categories);
  } catch (error) {
    console.error("Error listing categories:", error);
    res.status(500).json({ message: "Error listing categories", error: error.message });
  }
};

export const addCategory = async (req, res) => {
  const { type, name } = req.body;
  if (!type || !["expense", "income"].includes(type)) {
    return res.status(400).json({ message: "type must be 'expense' or 'income'" });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ message: "A category name is required" });
  }

  const trimmedName = name.trim();
  const defaults = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  if (defaults.some((c) => c.toLowerCase() === trimmedName.toLowerCase())) {
    return res.status(400).json({ message: "That category already exists" });
  }

  try {
    const category = await Category.create({ user: req.user.id, type, name: trimmedName });
    res.status(201).json(category);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "That category already exists" });
    }
    console.error("Error adding category:", error);
    res.status(500).json({ message: "Error adding category", error: error.message });
  }
};

export const deleteCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: "Category not found" });
    if (category.user.toString() !== req.user.id)
      return res.status(403).json({ message: "Not authorized to delete this category" });

    await category.deleteOne();
    res.json({ message: "Category deleted successfully" });
  } catch (error) {
    console.error("Error deleting category:", error);
    res.status(500).json({ message: "Error deleting category", error: error.message });
  }
};
