import { Firestore } from "@google-cloud/firestore";

// Single shared Firestore client — the app's real database, replacing the
// old Google Sheets one (see firestoreDb.js). Reuses the exact same
// service-account credentials as Sheets did (GOOGLE_SERVICE_ACCOUNT_KEY),
// because Firestore lives in the same Google Cloud project — no new secret
// needed, just one extra IAM role granted to that same service account
// (see backend/.env.example).
//
// One thing Sheets never needed: FIRESTORE_DATABASE_ID. A Google Cloud
// project can hold several Firestore *databases*; unless yours is literally
// named "(default)", this must be set to whatever name you gave it when you
// created it in Google Cloud Console (Firestore Studio shows the name at the
// top, e.g. "Database: expensetracker").
let firestoreClient = null;
let warnedMissingConfig = false;

export const getFirestoreClient = () => {
  if (firestoreClient) return firestoreClient;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    if (!warnedMissingConfig) {
      console.warn(
        "⚠️  Firestore is not configured — set GOOGLE_SERVICE_ACCOUNT_KEY (the same service-account JSON used for Google Sheets) in backend/.env."
      );
      warnedMissingConfig = true;
    }
    return null;
  }
  try {
    const credentials = JSON.parse(raw);
    firestoreClient = new Firestore({
      projectId: credentials.project_id,
      credentials,
      databaseId: process.env.FIRESTORE_DATABASE_ID || "(default)",
    });
    return firestoreClient;
  } catch (error) {
    console.error("GOOGLE_SERVICE_ACCOUNT_KEY is set but isn't valid JSON:", error.message);
    return null;
  }
};

export const isFirestoreConfigured = () => !!getFirestoreClient();
