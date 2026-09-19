import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = path.join(__dirname, "..", "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// Uploads are held in memory, never written to the server's disk, because
// Render's free tier wipes that disk on every redeploy and spin-down. The
// buffer is handed straight to utils/fileStorage.js, which pushes it to
// permanent cloud storage (see the explanation at the top of that file).
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error("Only JPG, PNG, WEBP or PDF bill files are allowed"));
  }
  cb(null, true);
};

// Accepts a single optional file under the "bill" field name.
export const uploadBill = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
}).single("bill");

// A vehicle can have several files attached at once (RC, insurance, permit,
// and a photo of the number plate) — each optional, each its own named
// field, same file rules as a bill upload.
export const uploadVehicleDocs = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
}).fields([
  { name: "rcFile", maxCount: 1 },
  { name: "insuranceFile", maxCount: 1 },
  { name: "permitFile", maxCount: 1 },
  { name: "plateFile", maxCount: 1 },
]);

// A contractor or a labor can each have up to 3 identity documents attached
// (Aadhar, PAN, and a "green card" if they have one) — same file rules.
export const uploadLabourDocs = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
}).fields([
  { name: "aadharFile", maxCount: 1 },
  { name: "panFile", maxCount: 1 },
  { name: "greenCardFile", maxCount: 1 },
]);

// --- Spreadsheet import (expense/income sheet upload) ---
// Kept in memory only (never written to disk) since we just parse it once
// and discard it — the parsed rows are what gets saved, not the file itself.
const SHEET_MIME_TYPES = new Set([
  "text/csv",
  "application/csv",
  "text/plain", // some browsers/OS send CSV as this
  "application/vnd.ms-excel", // .xls (also sometimes .csv on Windows)
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
]);
const MAX_SHEET_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const sheetFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!SHEET_MIME_TYPES.has(file.mimetype) && ![".csv", ".xls", ".xlsx"].includes(ext)) {
    return cb(new Error("Only .csv, .xls or .xlsx files are allowed"));
  }
  cb(null, true);
};

// Accepts a single file under the "sheet" field name.
export const uploadSheet = multer({
  storage: multer.memoryStorage(),
  fileFilter: sheetFileFilter,
  limits: { fileSize: MAX_SHEET_SIZE_BYTES },
}).single("sheet");
