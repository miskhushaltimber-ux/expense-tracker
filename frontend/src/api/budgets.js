import { apiClient } from "./config";

const BASE_URL = "/budgets";

export const fetchBudgets = async () => {
  try {
    const response = await apiClient.get(BASE_URL);
    return response.data;
  } catch (error) {
    console.error("Error fetching budgets:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to fetch budgets.");
  }
};

// Sends EVERY changed budget in one request. Google Sheets allows 60 writes a
// minute across the whole app, so saving them one at a time would stall the
// first time someone fills the page in.
export const saveBudgets = async (budgets) => {
  try {
    const response = await apiClient.put(BASE_URL, { budgets });
    return response.data;
  } catch (error) {
    console.error("Error saving budgets:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to save budgets.");
  }
};
