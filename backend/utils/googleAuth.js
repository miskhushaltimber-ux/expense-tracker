import { google } from "googleapis";

// Single shared Google Sheets API client, used both by sheetsDb.js (the
// app's own database — Users + Expenses tabs) and googleSheets.js (pushing
// to / pulling from any OTHER Sheet the user pastes a link for). Both need
// the exact same service-account auth, so this is the one place it's built.
let sheetsClient = null;
let warnedMissingConfig = false;

export const getSheetsClient = () => {
  if (sheetsClient) return sheetsClient;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    if (!warnedMissingConfig) {
      console.warn(
        "⚠️  Google Sheets is not configured — set GOOGLE_SERVICE_ACCOUNT_KEY (the full service account JSON key, as one line) in backend/.env."
      );
      warnedMissingConfig = true;
    }
    return null;
  }
  try {
    const credentials = JSON.parse(raw);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    sheetsClient = google.sheets({ version: "v4", auth });
    return sheetsClient;
  } catch (error) {
    console.error("GOOGLE_SERVICE_ACCOUNT_KEY is set but isn't valid JSON:", error.message);
    return null;
  }
};

export const isGoogleAuthConfigured = () => !!getSheetsClient();
