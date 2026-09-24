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
  sheetDescription = "For a Sheet you want kept up to date in place. Paste the link of a Google Sheet shared with the app's service account as an Editor — its contents get replaced with a formatted table (bold header, borders, currency).",
  // scopeOptions (23 Sep, per Rishi: "when i share... using combined switch
  // it just prints the worklog page or payment page and dont print both
  // combined") — Labor Wages passes [{key,label}] so this ONE modal can also
  // offer "combined" (Work Log + Payments together), not just whichever tab
  // it was opened from. Omitted entirely by Expenses/Vehicles, which only
  // ever have one sheet to share — nothing changes for them.
  scopeOptions,
  // defaultMode (24 Sep) — lets a caller open this modal straight into the
  // "To a Google Sheet" tab, e.g. a "Push to Google Sheet" entry in the
  // Download menu, instead of always landing on "Email it" first.
  defaultMode = "email",
  // emailFormats (24 Sep, Report tab's own Download/Share) — the Excel-vs-
  // CSV dropdown only makes sense when the caller can actually build both.
  // The Report tab only ever sends CSV (its data comes pre-computed from the
  // frontend, not a server-side workbook builder), so it passes ["csv"] and
  // the dropdown is skipped entirely rather than offering a choice that
  // silently wouldn't change anything.
  emailFormats = ["xlsx", "csv"],
}) => {
  const [status, setStatus] = useState(null);
  const [mode, setMode] = useState(defaultMode); // "email" | "sheet"
  const [scope, setScope] = useState(scopeOptions?.[0]?.key || null);
  // Email format (24 Sep, per Rishi: "give one dropdown where we can choose
  // in which format we are sharing the sheets") — "Email it" can send the
  // formatted .xlsx report (default) or a plain .csv. Only meaningful for
  // email; pushing to a Google Sheet is always live, no format to pick.
  const [format, setFormat] = useState(emailFormats[0]);

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
      const result = await onEmail(email.trim(), note.trim(), scope, format);
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
      const result = await onExport(sheetUrl.trim(), scope);
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

        {scopeOptions && scopeOptions.length > 0 && (
          <div className="mb-4">
            <label className="block text-xs font-medium mb-1.5 text-gray-500 dark:text-gray-400">What to share</label>
            <div className="flex flex-wrap gap-2">
              {scopeOptions.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setScope(o.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                    scope === o.key
                      ? "bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300"
                      : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

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

            {emailFormats.length > 1 && (
              <>
                <label className="block text-xs font-medium mb-1.5 text-gray-500 dark:text-gray-400">Format</label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-900 p-2.5 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  {emailFormats.includes("xlsx") && <option value="xlsx">Excel (.xlsx) — formatted report, ready to print</option>}
                  {emailFormats.includes("csv") && <option value="csv">CSV (.csv) — plain, opens anywhere</option>}
                </select>
              </>
            )}

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
