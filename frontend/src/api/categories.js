import { apiClient } from "./config";

const BASE_URL = "/categories";

export const fetchMyCategories = async () => {
  try {
    const response = await apiClient.get(BASE_URL);
    return response.data;
  } catch (error) {
    console.error("Error fetching categories:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to fetch categories.");
  }
};

export const addCategory = async (type, name) => {
  try {
    const response = await apiClient.post(BASE_URL, { type, name });
    return response.data;
  } catch (error) {
    console.error("Error adding category:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to add category.");
  }
};

export const deleteCategory = async (id) => {
  try {
    const response = await apiClient.delete(`${BASE_URL}/${id}`);
    return response.data;
  } catch (error) {
    console.error("Error deleting category:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to delete category.");
  }
};
