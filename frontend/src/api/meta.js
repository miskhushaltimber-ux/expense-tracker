import { apiClient } from "./config";
import { DEFAULT_EXPENSE_MASTERS } from "../constants/categories";

// Fetches the Master-column suggestion list from the backend. Falls back to
// the local defaults if the server can't be reached, so the sheet still
// works offline / while the backend is starting up.
export const fetchMasters = async () => {
  try {
    const response = await apiClient.get("/meta/masters");
    return response.data.masters || DEFAULT_EXPENSE_MASTERS;
  } catch (error) {
    console.error("Falling back to default masters:", error);
    return DEFAULT_EXPENSE_MASTERS;
  }
};
