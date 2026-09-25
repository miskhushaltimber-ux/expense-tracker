import { apiClient } from "./config";

// Account-wide settings — right now just the one linked Google Sheet (25
// Sep, per Rishi: "link a sheet where every new entry updates itself in
// that sheet automatically"). Lives in the Navbar's gear-icon dropdown.
export const fetchSettings = async () => {
  try {
    const response = await apiClient.get("/settings");
    return response.data;
  } catch (error) {
    return { linkedSheetUrl: "", sheetsConfigured: false };
  }
};

// sheetUrl: "" (or omitted) unlinks. Owner-only on the server.
export const updateLinkedSheet = async (sheetUrl) => {
  try {
    const response = await apiClient.put("/settings/sheet", { sheetUrl });
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || "Couldn't update the linked Sheet");
  }
};
