import mongoose from "mongoose";
import { PAYMENT_MODES, PAYMENT_STATUSES } from "../constants/categories.js";

// A dedicated worker-wage register. Each wage entry also creates (and stays
// in sync with) a linked Expense record — under the "Labor Wages" category —
// so it automatically flows into the existing dashboard/reports/CSV export
// without duplicating that logic. `linkedExpense` is how the two stay tied
// together; it's an internal detail the UI doesn't need to show.
const wageEntrySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    workerName: { type: String, required: true, trim: true },
    workDescription: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0 },
    paymentMode: { type: String, enum: PAYMENT_MODES, default: "Cash" },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: "Paid" },
    dueDate: { type: Date, default: null },
    date: { type: Date, default: Date.now },
    notes: { type: String, trim: true },
    linkedExpense: { type: mongoose.Schema.Types.ObjectId, ref: "Expense" },
  },
  { timestamps: true }
);

export default mongoose.model("WageEntry", wageEntrySchema);
