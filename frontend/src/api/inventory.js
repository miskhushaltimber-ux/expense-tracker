import { apiClient } from "./config";

const BASE_URL = "/inventory";

export const fetchInventoryTransactions = async () => {
  try {
    const response = await apiClient.get(BASE_URL);
    return response.data;
  } catch (error) {
    console.error("Error fetching inventory transactions:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to fetch inventory transactions.");
  }
};

export const fetchStockSummary = async () => {
  try {
    const response = await apiClient.get(`${BASE_URL}/summary`);
    return response.data;
  } catch (error) {
    console.error("Error fetching stock summary:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to fetch stock summary.");
  }
};

export const addInventoryTransaction = async (data) => {
  try {
    const response = await apiClient.post(BASE_URL, data);
    return response.data;
  } catch (error) {
    console.error("Error adding inventory transaction:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to add inventory transaction.");
  }
};

export const deleteInventoryTransaction = async (id) => {
  try {
    const response = await apiClient.delete(`${BASE_URL}/${id}`);
    return response.data;
  } catch (error) {
    console.error("Error deleting inventory transaction:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to delete inventory transaction.");
  }
};
