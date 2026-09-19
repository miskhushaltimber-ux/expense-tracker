import { apiClient } from "./config";

const BASE_URL = "/sheets";

// Whether the server has Google Sheets sync configured at all (a service
// account key set) — lets the UI show a helpful message instead of a
// confusing error when it isn't.
export const fetchSheetsStatus = async () => {
  try {
    const response = await apiClient.get(`${BASE_URL}/status`);
    return response.data;
  } catch (error) {
    return { configured: false };
  }
};

// Pushes every expense to the given Google Sheet (full overwrite). scope:
// "vehicles" narrows to only vehicle-tagged expenses — omitted/"all" keeps
// the original whole-sheet behaviour.
export const exportToGoogleSheet = async (sheetUrl, scope) => {
  try {
    const response = await apiClient.post(`${BASE_URL}/export`, { sheetUrl, scope });
    return response.data;
  } catch (error) {
    console.error("Error exporting to Google Sheet:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Failed to export to Google Sheet.");
  }
};

// Reads a Google Sheet and returns a preview of the rows it detected —
// same shape as the file-upload import preview. Nothing is saved yet.
export const previewFromGoogleSheet = async (sheetUrl) => {
  try {
    const response = await apiClient.post(`${BASE_URL}/import-preview`, { sheetUrl });
    return response.data;
  } catch (error) {
    console.error("Error importing from Google Sheet:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Failed to import from Google Sheet.");
  }
};

/**
 * Emails the whole expense sheet as an .xlsx attachment to any address.
 * Needs no Google setup at all on the recipient's side. scope: "vehicles"
 * narrows to only vehicle-tagged expenses.
 */
export const emailExpenseSheet = async (email, note, scope) => {
  try {
    const response = await apiClient.post("/sheets/email", { email, note, scope });
    return response.data;
  } catch (error) {
    console.error("Error emailing the expense sheet:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to send that email.");
  }
};

// --- Labor Wages (Work Log / Payments) ---------------------------------
// Same three flows as above, parameterized by type: "worklog" | "payments".
const LABOUR_BASE_URL = "/labour-sheets";

export const fetchLabourSheetsStatus = async () => {
  try {
    const response = await apiClient.get(`${LABOUR_BASE_URL}/status`);
    return response.data;
  } catch (error) {
    return { configured: false };
  }
};

export const exportLabourToGoogleSheet = async (sheetUrl, type) => {
  try {
    const response = await apiClient.post(`${LABOUR_BASE_URL}/export`, { sheetUrl, type });
    return response.data;
  } catch (error) {
    console.error("Error exporting labour sheet to Google Sheet:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Failed to export to Google Sheet.");
  }
};

export const previewLabourFromGoogleSheet = async (sheetUrl, type) => {
  try {
    const response = await apiClient.post(`${LABOUR_BASE_URL}/import-preview`, { sheetUrl, type });
    return response.data;
  } catch (error) {
    console.error("Error importing labour sheet from Google Sheet:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Failed to import from Google Sheet.");
  }
};

export const emailLabourSheet = async (email, note, type) => {
  try {
    const response = await apiClient.post(`${LABOUR_BASE_URL}/email`, { email, note, type });
    return response.data;
  } catch (error) {
    console.error("Error emailing the labour sheet:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to send that email.");
  }
};
