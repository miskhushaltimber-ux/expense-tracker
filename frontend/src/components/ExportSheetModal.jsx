import React, { useEffect, useState } from "react";
import { FiGrid, FiX } from "react-icons/fi";
import { toast } from "react-toastify";

const notifyError = (msg) => toast.error(msg);
const notifySuccess = (msg) => toast.success(msg);

// Generic "email it as .xlsx, or push it into a Google Sheet you own" modal —
// the shell Expenses.jsx's own ExportModal already has, pulled out so
// Vehicles.jsx and LaborWages.jsx can reuse it for their own sheets. Emailing
// is the default because it needs no setup from anyone; the app deliberately
// never creates a Google Sheet itself (service accounts on free Google
// accounts have zero Drive quota) — "to a Sheet" only ever pushes into one
// the user already owns and has shared with the service account.
const ExportSheetModal = ({
  title = "Share the Sheet",
  onClose,
  fetchStatus,
  onEmail,
  onExport,
  emailDescription = "Sends the sheet as a spreadsheet attachment. No setup needed at the other end — in Gmail they can click the file and choose \"Open with Google Sheets\".",
  sheetDescription = "For a Sheet you want kept up to date in place. Paste the link of a Google Sheet shared with the app's service account as an Editor — its contents get replaced.",
}) => {
  const [status, setStatus] = useState(null);
  const [mode, setMode] = useState("email"); // "email" | "sheet"

  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const [sheetUrl, setSheetUrl] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchStatus().then(setStatus).catch(() => {});
  }, [fetchStatus]);

  const handleEmail = async () => {
    if (!email.trim()) {
      notifyError("Enter an email address first");
      return;
    }
    try {
      setSending(true);
      const result = await onEmail(email.trim(), note.trim());
      notifySuccess(result?.message || "Sheet emailed");
      onClose();
    } catch (err) {
      notifyError(err.message || "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const handleExport = async () => {
    if (!sheetUrl.trim()) {
      notifyError("Paste the Google Sheet's link or ID first");
      return;
    }
    try {
      setExporting(true);
      const result = await onExport(sheetUrl.trim());
      notifySuccess(result?.message || "Exported to Google Sheet");
    } catch (err) {
      notifyError(err.message || "Failed to export");
    } finally {
      setExporting(false);
    }
  };

  const tabClass = (active) =>
    `px-4 py-2 rounded-lg text-sm font-medium ${
      active ? "bg-red-600 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
      <div className="bg-white dark:bg-gray-800 p-5 sm:p-6 rounded-xl shadow-xl w-full max-w-md relative border-2 border-gray-200 dark:border-gray-700">
        <div className="flex justify-between items-center mb-4 border-b border-gray-100 dark:border-gray-700 pb-3">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center">
            <FiGrid className="mr-2" /> {title}
          </h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
            <FiX size={20} />
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <button onClick={() => setMode("email")} className={tabClass(mode === "email")}>
            Email it
          </button>
          <button onClick={() => setMode("sheet")} className={tabClass(mode === "sheet")}>
            To a Google Sheet
          </button>
        </div>

        {mode === "email" ? (
          <>
            {status && status.emailConfigured === false && (
              <div className="mb-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs sm:text-sm text-amber-800 dark:text-amber-200">
                Email isn't set up on the server yet — it needs
                <code className="mx-1 px-1 bg-amber-100 dark:bg-amber-900/50 rounded">EMAIL_USER</code> and
                <code className="mx-1 px-1 bg-amber-100 dark:bg-amber-900/50 rounded">EMAIL_APP_PASSWORD</code>
                (the same two the password reset needs). See
                <code className="ml-1 px-1 bg-amber-100 dark:bg-amber-900/50 rounded">backend/.env.example</code>.
              </div>
            )}

            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{emailDescription}</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleEmail()}
              placeholder="name@example.com"
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-900 p-2.5 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Optional message to include..."
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-900 p-2.5 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <button
              onClick={handleEmail}
              disabled={sending}
              className="w-full bg-red-600 text-white px-4 py-2.5 rounded-lg hover:bg-red-700 text-sm font-medium disabled:opacity-60"
            >
              {sending ? "Sending..." : "Send Sheet"}
            </button>
          </>
        ) : (
          <>
            {status && !status.configured && (
              <div className="mb-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs sm:text-sm text-amber-800 dark:text-amber-200">
                Google Sheets sync isn't set up on the server yet — it needs the
                <code className="mx-1 px-1 bg-amber-100 dark:bg-amber-900/50 rounded">GOOGLE_SERVICE_ACCOUNT_KEY</code>
                env var (see <code className="px-1 bg-amber-100 dark:bg-amber-900/50 rounded">backend/.env.example</code>).
              </div>
            )}

            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{sheetDescription}</p>
            <input
              type="text"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-900 p-2.5 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <button
              onClick={handleExport}
              disabled={exporting}
              className="w-full bg-red-600 text-white px-4 py-2.5 rounded-lg hover:bg-red-700 text-sm font-medium disabled:opacity-60"
            >
              {exporting ? "Exporting..." : "Export"}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default ExportSheetModal;
