import Category from "../models/Category.js";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "../constants/categories.js";

// A category is valid if it's one of the built-in defaults, or one the user
// added themselves (Settings > Categories).
export const isValidCategory = async (userId, type, category) => {
  const defaults = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  if (defaults.includes(category)) return true;
  const exists = await Category.exists({ user: userId, type, name: category });
  return !!exists;
};

// GST amount is always recomputed server-side from amount*rate — never
// trusted from the client, since it's a derived, auditable number.
export const resolveGst = (gstApplicable, gstRate, amount) => {
  const applicable = gstApplicable === true || gstApplicable === "true";
  const rate = applicable ? Math.max(0, Number(gstRate) || 0) : 0;
  const gstAmount = applicable ? (Number(amount) || 0) * (rate / 100) : 0;
  return { gstApplicable: applicable, gstRate: rate, gstAmount: Math.round(gstAmount * 100) / 100 };
};
