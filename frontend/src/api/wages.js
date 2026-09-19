import { apiClient } from "./config";

const BASE_URL = "/wages";

export const fetchWages = async () => {
  try {
    const response = await apiClient.get(BASE_URL);
    return response.data;
  } catch (error) {
    console.error("Error fetching wage entries:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to fetch wage entries.");
  }
};

export const fetchWageSummary = async () => {
  try {
    const response = await apiClient.get(`${BASE_URL}/summary`);
    return response.data;
  } catch (error) {
    console.error("Error fetching wage summary:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to fetch wage summary.");
  }
};

export const addWageEntry = async (data) => {
  try {
    const response = await apiClient.post(BASE_URL, data);
    return response.data;
  } catch (error) {
    console.error("Error adding wage entry:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to add wage entry.");
  }
};

export const deleteWageEntry = async (id) => {
  try {
    const response = await apiClient.delete(`${BASE_URL}/${id}`);
    return response.data;
  } catch (error) {
    console.error("Error deleting wage entry:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to delete wage entry.");
  }
};
