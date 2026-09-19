import { apiClient } from "./config";

const BASE_URL = "/reports";

// Last N months of income/expense/profit, for the dashboard trend chart.
export const fetchMonthlyTrend = async (months = 6) => {
  try {
    const response = await apiClient.get(`${BASE_URL}/monthly-trend`, { params: { months } });
    return response.data;
  } catch (error) {
    console.error("Error fetching monthly trend:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Failed to fetch the monthly trend.");
  }
};

// Every transaction still marked "Pending", sorted by due date.
export const fetchPendingPayments = async () => {
  try {
    const response = await apiClient.get(`${BASE_URL}/pending-payments`);
    return response.data;
  } catch (error) {
    console.error("Error fetching pending payments:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Failed to fetch pending payments.");
  }
};

// GST collected vs paid. Pass { fy: "2025-2026" } or { month: "2026-09" };
// omit both for the current calendar month.
export const fetchGstSummary = async (params = {}) => {
  try {
    const response = await apiClient.get(`${BASE_URL}/gst-summary`, { params });
    return response.data;
  } catch (error) {
    console.error("Error fetching GST summary:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Failed to fetch the GST summary.");
  }
};

// Full April-March financial year breakdown. Pass fy="2025-2026"; omit for
// the FY containing today.
export const fetchFinancialYearSummary = async (fy) => {
  try {
    const response = await apiClient.get(`${BASE_URL}/financial-year`, { params: fy ? { fy } : {} });
    return response.data;
  } catch (error) {
    console.error("Error fetching financial year summary:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Failed to fetch the financial year summary.");
  }
};
