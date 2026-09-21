import { apiClient } from "./config";

// Custom columns (21 Sep) — one column-definition set per sheet, scoped to
// the logged-in company. Any login (owner or staff) can manage these, not
// just the owner — see backend/routes/columnDefRoutes.js.
//   sheetKey "expenses"    -> the Expense Sheet AND the Vehicle Expense
//                             Sheet (same underlying rows — see
//                             backend/models/columnDefStore.js's header).
//   sheetKey "wageEntries" -> Labor Wages' Work Log tab.
//   sheetKey "payments"    -> Labor Wages' Payments tab.
export const fetchColumns = async (sheetKey) => {
  try {
    const res = await apiClient.get("/columns", { params: { sheet: sheetKey } });
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || "Failed to fetch columns.");
  }
};

export const addColumn = async (sheetKey, { label, type, options }) => {
  try {
    const res = await apiClient.post("/columns", { label, type, options }, { params: { sheet: sheetKey } });
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || "Failed to add that column.");
  }
};

export const updateColumn = async (id, { label, options }) => {
  try {
    const res = await apiClient.put(`/columns/${id}`, { label, options });
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || "Failed to update that column.");
  }
};

export const deleteColumn = async (id) => {
  try {
    const res = await apiClient.delete(`/columns/${id}`);
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || "Failed to delete that column.");
  }
};
