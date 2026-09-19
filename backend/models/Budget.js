import mongoose from "mongoose";

// A monthly spending limit per expense category. One budget per
// user+category — setting it again just updates the limit.
const budgetSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    category: { type: String, required: true, trim: true },
    monthlyLimit: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

budgetSchema.index({ user: 1, category: 1 }, { unique: true });

export default mongoose.model("Budget", budgetSchema);
