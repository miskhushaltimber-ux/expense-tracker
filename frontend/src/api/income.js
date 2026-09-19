import { apiClient } from "./config";

const BASE_URL = "/incomes";

// Builds multipart form data so an optional bill/receipt file can ride along
// with the rest of the fields in one request.
const toFormData = (incomeData) => {
  const formData = new FormData();
  Object.entries(incomeData).forEach(([key, value]) => {
    if (key === "bill" && value) {
      formData.append("bill", value);
    } else if (value !== undefined && value !== null && key !== "bill") {
      formData.append(key, value);
    }
  });
  return formData;
};

// Add Income (pass a File under `bill` to attach a receipt/invoice)
export const addIncome = async (incomeData) => {
  try {
    const response = await apiClient.post(BASE_URL, toFormData(incomeData));
    return response.data;
  } catch (error) {
    console.error("Error adding income:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Failed to add income.");
  }
};

// Get All Incomes for the logged-in user
export const getIncome = async () => {
  try {
    const response = await apiClient.get(BASE_URL);
    return response.data;
  } catch (error) {
    console.error("Error fetching incomes:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Failed to fetch incomes.");
  }
};

// Category-wise income totals
export const fetchIncomeSummary = async () => {
  try {
    const response = await apiClient.get(`${BASE_URL}/summary`);
    return response.data;
  } catch (error) {
    console.error("Error fetching income summary:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Failed to fetch income summary.");
  }
};

// Update Income
export const updateIncome = async (id, updatedData) => {
  try {
    const response = await apiClient.put(`${BASE_URL}/${id}`, toFormData(updatedData));
    return response.data;
  } catch (error) {
    console.error("Error updating income:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Failed to update income.");
  }
};

// Delete Income
export const deleteIncome = async (id) => {
  try {
    const response = await apiClient.delete(`${BASE_URL}/${id}`);
    return response.data;
  } catch (error) {
    console.error("Error deleting income:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Failed to delete income.");
  }
};
