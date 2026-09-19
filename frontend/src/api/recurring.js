import { apiClient } from "./config";

const BASE_URL = "/recurring";

export const fetchRecurring = async () => {
  try {
    const response = await apiClient.get(BASE_URL);
    return response.data;
  } catch (error) {
    console.error("Error fetching recurring transactions:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to fetch recurring transactions.");
  }
};

export const addRecurring = async (data) => {
  try {
    const response = await apiClient.post(BASE_URL, data);
    return response.data;
  } catch (error) {
    console.error("Error adding recurring transaction:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to add recurring transaction.");
  }
};

export const updateRecurring = async (id, data) => {
  try {
    const response = await apiClient.put(`${BASE_URL}/${id}`, data);
    return response.data;
  } catch (error) {
    console.error("Error updating recurring transaction:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to update recurring transaction.");
  }
};

export const deleteRecurring = async (id) => {
  try {
    const response = await apiClient.delete(`${BASE_URL}/${id}`);
    return response.data;
  } catch (error) {
    console.error("Error deleting recurring transaction:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to delete recurring transaction.");
  }
};

// Manually triggers today's due recurring transactions + reminder emails —
// handy right after setting one up, instead of waiting for the daily job.
export const runRecurringNow = async () => {
  try {
    const response = await apiClient.post(`${BASE_URL}/run-now`);
    return response.data;
  } catch (error) {
    console.error("Error running recurring transactions:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to run recurring transactions.");
  }
};
