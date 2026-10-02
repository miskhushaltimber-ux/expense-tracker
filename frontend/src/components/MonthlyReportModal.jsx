import React, { useEffect, useState } from "react";
import { FiMail, FiX, FiDownload } from "react-icons/fi";
import { toast } from "react-toastify";
import { fetchSettings, updateBossEmail } from "../api/settings";
import { emailMonthlyReport, downloadMonthlyReport } from "../api/reports";

const notifyError = (msg) => toast.error(msg);
const notifySuccess = (msg) => toast.success(msg);

// "YYYY-MM" for LAST month — the report is for a month that's finished, and
// this is opened right as a new one starts (2 Oct, per Rishi: "send monthly
// report to my boss when a new month started"), so last month is what he
// almost always means; the picker still lets him pick any other month.
const lastMonthValue = () => {
  const d = new Date();
  d.setDate(1); // avoid a 31st rolling into the wrong month
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const monthLabel = (value) => {
  const [y, m] = String(value || "").split("-").map(Number);
  if (!y || !m) return "";
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
};

// Team & Activity's "Send Monthly Report" card opens this — one Excel
// workbook (Summary + Expenses + Vehicles + Work Log + Payments, each their
// own tab) for the chosen month, emailed to the boss or downloaded. Scoped
// via AskUserQuestion: a manual send (not automatic on month start) with the
// full per-category workbook (not a totals-only summary) — see
// backend/utils/spreadsheetFile.js's buildMonthlyReportWorkbook.
const MonthlyReportModal = ({ onClose }) => {
  const [month, setMonth] = useState(lastMonthValue());
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [savedBossEmail, setSavedBossEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        if (s.bossEmail) {
          setEmail(s.bossEmail);
          setSavedBossEmail(s.bossEmail);
        }
      })
      .catch(() => {});
  }, []);

  const handleSend = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      notifyError("Enter your boss's email address first");
      return;
    }
    try {
      setSending(true);
      const result = await emailMonthlyReport(trimmed, month, note.trim());
      notifySuccess(result?.message || "Report sent");
      // Remember it for next time — fire-and-forget, never blocks the send
      // itself or shows its own error if it fails.
      if (trimmed !== savedBossEmail) updateBossEmail(trimmed).catch(() => {});
      onClose();
    } catch (err) {
      notifyError(err.message || "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const handleDownload = async () => {
    try {
      setDownloading(true);
      await downloadMonthlyReport(month);
    } catch (err) {
      notifyError(err.message || "Failed to download");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
      <div className="bg-white dark:bg-gray-800 p-5 sm:p-6 rounded-xl shadow-xl w-full max-w-md relative border-2 border-gray-200 dark:border-gray-700">
        <div className="flex justify-between items-center mb-4 border-b border-gray-100 dark:border-gray-700 pb-3">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center">
            <FiMail className="mr-2" /> Monthly Report
          </h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
            <FiX size={20} />
          </button>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          One spreadsheet covering every entry for the month — a summary of totals, plus the full Expense Sheet,
          Vehicle Expense Sheet, Work Log and Payments, each on their own tab.
        </p>

        <label className="block text-xs font-medium mb-1.5 text-gray-500 dark:text-gray-400">Month</label>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          max={lastMonthValue()}
          className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-900 p-2.5 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        {month && <p className="text-xs text-gray-400 dark:text-gray-500 -mt-2 mb-3">{monthLabel(month)}</p>}

        <label className="block text-xs font-medium mb-1.5 text-gray-500 dark:text-gray-400">Boss's email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
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

        <div className="flex gap-2">
          <button
            onClick={handleDownload}
            disabled={downloading}
            title="Download the same workbook instead of emailing it"
            className="flex items-center justify-center gap-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 text-sm font-medium disabled:opacity-60"
          >
            <FiDownload size={15} /> {downloading ? "Preparing…" : "Download"}
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="flex-1 bg-red-600 text-white px-4 py-2.5 rounded-lg hover:bg-red-700 text-sm font-medium disabled:opacity-60"
          >
            {sending ? "Sending..." : "Send Report"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MonthlyReportModal;
