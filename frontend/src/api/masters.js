import { apiClient } from "./config";
import { DEFAULT_EXPENSE_MASTERS } from "../constants/categories";

const BASE_URL = "/masters";

// Masters are per-user data now, not a hardcoded list — each account gets its
// own copy of the presets on first use, and can then rename, delete and add to
// them. The local constant survives only as an offline fallback so the sheet
// still offers suggestions if the server is unreachable.
export const fetchMasterCatalog = async () => {
  try {
    const response = await apiClient.get(BASE_URL);
    return response.data.masters || [];
  } catch (error) {
    console.error("Falling back to default masters:", error.response?.data || error);
    return DEFAULT_EXPENSE_MASTERS.map((name) => ({ id: null, name }));
  }
};

export const createMaster = async (name) => {
  try {
    const response = await apiClient.post(BASE_URL, { name });
    return response.data;
  } catch (error) {
    console.error("Error adding master:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to add that master.");
  }
};

export const renameMaster = async (id, name) => {
  try {
    const response = await apiClient.put(`${BASE_URL}/${id}`, { name });
    return response.data;
  } catch (error) {
    console.error("Error renaming master:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to rename that master.");
  }
};

export const deleteMaster = async (id) => {
  try {
    const response = await apiClient.delete(`${BASE_URL}/${id}`);
    return response.data;
  } catch (error) {
    console.error("Error deleting master:", error.response?.data || error);
    // A 409 here is the "still in use" refusal, and its message names how many
    // entries are in the way — pass it through rather than flattening it.
    throw new Error(error.response?.data?.message || "Failed to delete that master.");
  }
};
