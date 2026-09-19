import { apiClient } from "./config";

const BASE_URL = "/parties";

// List of every vendor/customer that's appeared on an expense or income
// entry, with running totals — the "ledger" view.
export const fetchParties = async () => {
  try {
    const response = await apiClient.get(BASE_URL);
    return response.data;
  } catch (error) {
    console.error("Error fetching parties:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Failed to fetch parties.");
  }
};

// Full transaction history (expenses + income, merged) for one party.
export const fetchPartyTransactions = async (name) => {
  try {
    const response = await apiClient.get(`${BASE_URL}/${encodeURIComponent(name)}`);
    return response.data;
  } catch (error) {
    console.error("Error fetching party transactions:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Failed to fetch that party's transactions.");
  }
};
