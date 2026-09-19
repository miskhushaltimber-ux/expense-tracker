import mongoose from "mongoose";

// User-defined categories, layered on top of the built-in defaults in
// constants/categories.js. Kept as a separate collection (rather than an
// array on User) so lookups/uniqueness checks stay simple.
const categorySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["expense", "income"], required: true },
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

categorySchema.index({ user: 1, type: 1, name: 1 }, { unique: true });

export default mongoose.model("Category", categorySchema);
