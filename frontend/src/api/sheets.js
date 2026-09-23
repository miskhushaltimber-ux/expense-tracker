import { apiClient } from "./config";

const BASE_URL = "/sheets";

// Triggers a browser download of a blob response, using the filename the
// server sent in Content-Disposition (falls back to a generic name if that
// header is ever missing/blocked).
const downloadBlobResponse = (response, fallbackName) => {
  const disposition = response.headers?.["content-disposition"] || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const fileName = match ? match[1] : fallbackName;
  const url = URL.createObjectURL(response.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// Downloads the same nicely-formatted .xlsx the "Email it" option sends —
// 23 Sep, per Rishi: "downloaded" used to mean a plain, unstyled .csv.
// scope: "vehicles" narrows to the Vehicle Expense Sheet, same as email/export.
export const downloadExpenseSheetXlsx = async (scope) => {
  try {
    const response = await apiClient.get(`${BASE_URL}/download`, { params: { scope }, responseType: "blob" });
    downloadBlobResponse(response, "expenses.xlsx");
  } catch (error) {
    throw new Error("Couldn't download that file. Please try again.");
  }
};

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

// type: "worklog" | "payments" | "combined" (Work Log + Payments as two tabs
// in one workbook — the Excel equivalent of "Download Combined CSV").
export const downloadLabourSheetXlsx = async (type) => {
  try {
    const response = await apiClient.get(`${LABOUR_BASE_URL}/download`, { params: { type }, responseType: "blob" });
    downloadBlobResponse(response, "labour.xlsx");
  } catch (error) {
    throw new Error("Couldn't download that file. Please try again.");
  }
};
