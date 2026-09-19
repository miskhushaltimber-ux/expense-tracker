import mongoose from "mongoose";
import { PAYMENT_MODES } from "../constants/categories.js";

// A template that automatically creates a real Expense/Income entry every
// month on `dayOfMonth`, so recurring items (rent, salaries, standing
// supplier orders) don't need to be typed in by hand each time.
const recurringTransactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["expense", "income"], required: true },
    // Used as the created entry's title (expense) or source (income).
    title: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    category: { type: String, required: true, trim: true },
    customCategory: { type: String, trim: true },
    party: { type: String, trim: true },
    paymentMode: { type: String, enum: PAYMENT_MODES, default: "Cash" },
    // Clamped to 1-28 so it's valid in every month, including February.
    dayOfMonth: { type: Number, required: true, min: 1, max: 28 },
    active: { type: Boolean, default: true },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, default: null },
    lastRunDate: { type: Date, default: null },
    nextRunDate: { type: Date, required: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

export default mongoose.model("RecurringTransaction", recurringTransactionSchema);
