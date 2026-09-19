import { apiClient } from "./config";

/**
 * Log in a user
 * @param {Object} credentials - { email, password }
 * @returns {Promise} - Resolves to the logged-in user data
 */
export const loginUser = async (credentials) => {
  try {
    const response = await apiClient.post("/auth/login", credentials);
    return response.data;
  } catch (error) {
    console.error("Error logging in:", error);
    throw new Error(error.response?.data?.message || "Login failed.");
  }
};

/**
 * Sign up a new user
 * @param {Object} credentials - { name, email, password }
 * @returns {Promise} - Resolves to the registered user data
 */
export const signupUser = async (credentials) => {
  try {
    const response = await apiClient.post("/auth/register", credentials);
    return response.data;
  } catch (error) {
    console.error("Error signing up:", error);
    throw new Error(error.response?.data?.message || "Signup failed.");
  }
};

/**
 * Request a password-reset email for the given address.
 */
export const forgotPassword = async (email) => {
  try {
    const response = await apiClient.post("/auth/forgot-password", { email });
    return response.data;
  } catch (error) {
    console.error("Error requesting password reset:", error);
    throw new Error(error.response?.data?.message || "Couldn't send the reset email.");
  }
};

/**
 * Complete a password reset using the token from the emailed link.
 */
export const resetPassword = async (token, password) => {
  try {
    const response = await apiClient.post("/auth/reset-password", { token, password });
    return response.data;
  } catch (error) {
    console.error("Error resetting password:", error);
    throw new Error(error.response?.data?.message || "Couldn't reset the password.");
  }
};
