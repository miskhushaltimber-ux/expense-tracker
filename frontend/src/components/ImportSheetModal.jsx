import React, { useState } from "react";
import { FiUploadCloud, FiX, FiCheck } from "react-icons/fi";
import { toast } from "react-toastify";

const notifyError = (msg) => toast.error(msg);
const notifySuccess = (msg) => toast.success(msg);

// Generic "upload a file OR pull from a Google Sheet, review rows, commit"
// modal — the shell Expenses.jsx's own ImportModal already has, pulled out
// so Vehicles.jsx (Vehicle Expense Sheet) and LaborWages.jsx (Work Log,
// Payments) can each get the same three-step flow without duplicating it.
//
// The shell owns: mode switching (file/sheet), the preview fetch, the
// include/exclude checkboxes, warnings, and the commit button. Table rows
// are rendered by the caller via `renderRow` (each ledger's columns are
// different enough — expense/master vs contractor/cft/rate vs
// contractor/label/amount — that a one-size table wouldn't read well), and
// `headerCells` supplies that row's column headers.
//
// `extraControls`, if given, renders above the table — e.g. Vehicles.jsx's
// "which vehicle do these rows belong to" picker, since an imported sheet
// has no vehicle column of its own.
const ImportSheetModal = ({
  title = "Import",
  onClose,
  onImported,
  previewFile,
  previewSheet,
  onCommit,
  headerCells,
  renderRow,
  extraControls = null,
  commitNoun = "Rows",
  sheetHint = "Paste the link (or just the ID) of a Google Sheet that's been shared with the app's service account as an Editor.",
}) => {
  const [mode, setMode] = useState("file"); // "file" | "sheet"
  const [sheetUrl, setSheetUrl] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState(null); // { rows, warnings }
  const [committing, setCommitting] = useState(false);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setLoadingPreview(true);
      const data = await previewFile(file);
      setPreview(data);
    } catch (err) {
      notifyError(err.message || "Couldn't read that file");
    } finally {
      setLoadingPreview(false);
      e.target.value = "";
    }
  };

  const handleSheetPreview = async () => {
    if (!sheetUrl.trim()) {
      notifyError("Paste the Google Sheet's link or ID first");
      return;
    }
    try {
      setLoadingPreview(true);
      const data = await previewSheet(sheetUrl.trim());
      setPreview(data);
    } catch (err) {
      notifyError(err.message || "Couldn't read that Google Sheet");
    } finally {
      setLoadingPreview(false);
    }
  };

  const updateRow = (rowNumber, patch) => {
    setPreview((p) => ({
      ...p,
      rows: p.rows.map((r) => (r._rowNumber === rowNumber ? { ...r, ...patch } : r)),
    }));
  };

  const toggleInclude = (rowNumber) => {
    setPreview((p) => ({
      ...p,
      rows: p.rows.map((r) => (r._rowNumber === rowNumber ? { ...r, include: !r.include } : r)),
    }));
  };

  const handleCommit = async () => {
    const toImport = preview.rows.filter((r) => r.include);
    if (toImport.length === 0) {
      notifyError("Nothing selected to import");
      return;
    }
    try {
      setCommitting(true);
      const result = await onCommit(toImport);
      notifySuccess(result?.message || `Imported ${toImport.length} row${toImport.length === 1 ? "" : "s"}`);
      onImported?.();
    } catch (err) {
      notifyError(err.message || "Failed to save imported rows");
    } finally {
      setCommitting(false);
    }
  };

  const includedCount = preview?.rows?.filter((r) => r.include).length || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
      <div className="bg-white dark:bg-gray-800 p-5 sm:p-6 rounded-xl shadow-xl w-full max-w-3xl relative border-2 border-gray-200 dark:border-gray-700 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4 border-b pb-3">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">{title}</h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
            <FiX size={20} />
          </button>
        </div>

        {!preview ? (
          <>
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setMode("file")}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${mode === "file" ? "bg-red-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"}`}
              >
                Upload a File
              </button>
              <button
                onClick={() => setMode("sheet")}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${mode === "sheet" ? "bg-red-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"}`}
              >
                From Google Sheet
              </button>
            </div>

            {mode === "file" ? (
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                  Upload a .csv, .xls or .xlsx file (including a file exported/downloaded from Google Sheets).
                </p>
                <label className="cursor-pointer bg-gray-50 dark:bg-gray-900 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 flex flex-col items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800">
                  <FiUploadCloud size={28} className="text-gray-400 dark:text-gray-500 mb-2" />
                  <span className="text-sm text-gray-600 dark:text-gray-300">Click to choose a file</span>
                  <input type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={handleFileChange} />
                </label>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{sheetHint}</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="flex-1 border border-gray-300 dark:border-gray-600 p-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <button
                    onClick={handleSheetPreview}
                    className="bg-red-600 text-white px-4 py-2.5 rounded-lg hover:bg-red-700 text-sm font-medium"
                  >
                    Fetch
                  </button>
                </div>
              </div>
            )}

            {loadingPreview && (
              <div className="flex justify-center items-center h-24">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-red-500"></div>
              </div>
            )}
          </>
        ) : (
          <>
            {preview.warnings?.length > 0 && (
              <div className="mb-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs sm:text-sm text-amber-800 dark:text-amber-200 space-y-1">
                {preview.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            )}

            {extraControls}

            <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg mb-4">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-10"></th>
                    {headerCells}
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {preview.rows.map((r) => (
                    <tr key={r._rowNumber} className={r.include ? "" : "opacity-40"}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={r.include} onChange={() => toggleInclude(r._rowNumber)} />
                      </td>
                      {renderRow(r, { updateRow })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setPreview(null)}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 text-sm font-medium"
              >
                Back
              </button>
              <button
                onClick={handleCommit}
                disabled={committing}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium disabled:opacity-60 flex items-center"
              >
                <FiCheck size={16} className="mr-1.5" />
                {committing ? "Importing..." : `Import ${includedCount} ${commitNoun}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ImportSheetModal;
