import { API_BASE_URL } from "../api/config";

// Shared version of the billUrl/fileUrl helper that Expenses.jsx and
// Vehicles.jsx each already have inline — pulled out for the new Documents
// page (18 Sep) rather than touching either of those working, already-tested
// copies. Files now live in cloud storage, so this is usually a full https
// URL; older rows still hold a "/uploads/..." path from when files were
// saved on the server's own disk, which resolves against the API origin.
const SERVER_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

export const resolveFileUrl = (file) => {
  if (!file) return null;
  return file.startsWith("http") ? file : `${SERVER_ORIGIN}${file}`;
};

// Best-effort guess at whether a stored file is an image (for a thumbnail)
// vs. some other document (PDF, etc. — shown as a plain link/icon instead).
export const looksLikeImage = (file) => {
  if (!file) return false;
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(file);
};
