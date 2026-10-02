import { apiClient } from "./config";

// Monthly Report (2 Oct, per Rishi: "add an option where i send monthly
// report to my boss when a new month started and he can see every expense
// of the month in one report of the data we entered in the app"). A manual
// button (Team & Activity's "Monthly Report" card) — month: "YYYY-MM".
const BASE_URL = "/reports";

export const emailMonthlyReport = async (email, month, note) => {
  try {
    const response = await apiClient.post(`${BASE_URL}/monthly/email`, { email, month, note });
    return response.data;
  } catch (error) {
    console.error("Error emailing the monthly report:", error.response?.data || error);
    throw new Error(error.response?.data?.message || "Failed to send that report.");
  }
};

// Triggers a browser download of the same workbook the email sends — same
// filename-from-header pattern as api/sheets.js's downloadBlobResponse.
export const downloadMonthlyReport = async (month) => {
  try {
    const response = await apiClient.get(`${BASE_URL}/monthly`, { params: { month }, responseType: "blob" });
    const disposition = response.headers?.["content-disposition"] || "";
    const match = disposition.match(/filename="?([^"]+)"?/i);
    const fileName = match ? match[1] : `monthly-report-${month}.xlsx`;
    const url = URL.createObjectURL(response.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    throw new Error("Couldn't download that report. Please try again.");
  }
};
