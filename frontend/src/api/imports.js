import { apiClient } from "./config";

const BASE_URL = "/imports";

/**
 * Upload a spreadsheet (.csv, .xls or .xlsx) and get back a preview of the
 * rows it detected. Nothing is saved to the database at this step — saving
 * happens via bulkAddExpenses() in api/expenses.js once reviewed.
 *
 * @param {File} file
 */
export const previewImportSheet = async (file) => {
  try {
    const formData = new FormData();
    formData.append("sheet", file);
    // Do NOT set a Content-Type header manually here — the browser needs to
    // generate its own multipart boundary for a FormData body, and setting
    // "multipart/form-data" ourselves (without that boundary) breaks upload
    // parsing on the server. Axios sets the correct header automatically
    // when it sees a FormData instance.
    const response = await apiClient.post(`${BASE_URL}/preview`, formData);
    return response.data;
  } catch (error) {
    console.error("Error previewing import:", error.response?.data || error.message);
    throw new Error(
      error.response?.data?.message ||
        "Couldn't read that file. Please check it's a valid .csv, .xls or .xlsx file."
    );
  }
};

/**
 * Same idea as previewImportSheet, for the Labor Wages ledgers. `type` is
 * "worklog" or "payments" — picks which column shape the server expects.
 * @param {File} file
 * @param {"worklog"|"payments"} type
 */
export const previewLabourImportSheet = async (file, type) => {
  try {
    const formData = new FormData();
    formData.append("sheet", file);
    const response = await apiClient.post(`${BASE_URL}/labour-preview?type=${type === "payments" ? "payments" : "worklog"}`, formData);
    return response.data;
  } catch (error) {
    console.error("Error previewing labour import:", error.response?.data || error.message);
    throw new Error(
      error.response?.data?.message ||
        "Couldn't read that file. Please check it's a valid .csv, .xls or .xlsx file."
    );
  }
};
