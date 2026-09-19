import { apiClient } from "./config";

// Get user profile
export const getUserProfile = async () => {
  try {
    const response = await apiClient.get("/auth/profile");
    return response.data;
  } catch (error) {
    console.error("Error getting user profile:", error);
    throw error;
  }
};

// Update user profile (currently: display name + WhatsApp number, used for
// sending payment reminders / low-stock alerts over WhatsApp)
export const updateUserProfile = async (data) => {
  try {
    const response = await apiClient.put("/auth/profile", data);
    return response.data;
  } catch (error) {
    console.error("Error updating user profile:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to update profile.");
  }
};
