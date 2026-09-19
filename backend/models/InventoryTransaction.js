import mongoose from "mongoose";
import { INVENTORY_UNITS } from "../constants/categories.js";

// Physical stock ledger — tracks quantity/value of timber (and other items)
// on hand. Deliberately NOT linked to Expense/Income: the user already logs
// actual money movement on the Expenses/Income pages, so auto-creating
// entries here would double-count. This module answers "how much stock do
// we have and what is it worth", not "how much cash moved".
const inventoryTransactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    item: { type: String, required: true, trim: true },
    direction: { type: String, enum: ["in", "out"], required: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: INVENTORY_UNITS, default: "CFT" },
    rate: { type: Number, required: true, min: 0 },
    amount: { type: Number, min: 0 }, // quantity * rate, computed pre-save
    party: { type: String, trim: true },
    date: { type: Date, default: Date.now },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

inventoryTransactionSchema.pre("save", function (next) {
  this.amount = (this.quantity || 0) * (this.rate || 0);
  next();
});

export default mongoose.model("InventoryTransaction", inventoryTransactionSchema);
