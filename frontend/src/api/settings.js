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

// 2 Oct — saved default recipient for the Monthly Report card on Team &
// Activity, so Rishi doesn't retype his boss's email every month.
// bossEmail: "" (or omitted) clears it. Owner-only on the server.
export const updateBossEmail = async (bossEmail) => {
  try {
    const response = await apiClient.put("/settings/boss-email", { bossEmail });
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || "Couldn't save that email");
  }
};
