import fs from "fs";
import path from "path";
import { v2 as cloudinary } from "cloudinary";
import { UPLOADS_DIR } from "../middleware/uploadMiddleware.js";

// Where uploaded bills and vehicle documents actually live.
//
// Render's free tier gives the server an EPHEMERAL disk — it is wiped on
// every redeploy AND every time the service spins down after inactivity.
// Anything written to backend/uploads is therefore temporary, which is why
// uploaded bills kept quietly disappearing. Cloudinary's free tier (25GB, no
// credit card) gives us permanent URLs instead.
//
// Google Drive was the obvious first choice, since the app already has a
// Google service account — but service accounts have ZERO Drive storage
// quota of their own, and uploading into a folder that a real user shares
// with them does NOT help: the file still counts against the service
// account, not the folder's owner. The two official fixes (domain-wide
// delegation and Shared Drives) both require paid Google Workspace, which
// this business doesn't have. Hence Cloudinary.
//
// If the Cloudinary variables aren't set, we fall back to the old
// local-disk behaviour so local development — and a server that hasn't been
// configured yet — keep working instead of erroring.

const CLOUDINARY_FOLDER = "expense-tracker-uploads";

export const isCloudStorageConfigured = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );

let configured = false;
const ensureConfigured = () => {
  if (configured) return;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  configured = true;
};

const uploadToCloudinary = (file) =>
  new Promise((resolve, reject) => {
    ensureConfigured();
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        resource_type: "auto", // handles images and PDFs alike
        use_filename: true,
        unique_filename: true,
      },
      (error, result) => (error ? reject(error) : resolve(result.secure_url))
    );
    stream.end(file.buffer);
  });

const saveToLocalDisk = (file) => {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const ext = path.extname(file.originalname).toLowerCase();
  const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), file.buffer);
  return `/uploads/${name}`;
};

// Takes one multer memory-storage file and returns the value to store in the
// sheet: a permanent https:// URL when Cloudinary is set up, or a
// /uploads/... path when it isn't. Returns undefined when no file was sent,
// so callers can spread it into an update object safely.
export const storeFile = async (file) => {
  if (!file) return undefined;
  if (!isCloudStorageConfigured()) return saveToLocalDisk(file);
  try {
    return await uploadToCloudinary(file);
  } catch (error) {
    console.error("Cloudinary upload failed, falling back to local disk:", error.message);
    return saveToLocalDisk(file);
  }
};

// Convenience for multer's .fields() shape — req.files is
// { fieldName: [file] }, and every field is optional.
export const storeFieldFile = async (req, field) => storeFile(req.files?.[field]?.[0]);

// A Cloudinary URL looks like:
//   https://res.cloudinary.com/<cloud>/image/upload/v123/expense-tracker-uploads/bill.jpg
// The public_id needed to delete it is "expense-tracker-uploads/bill" —
// without the extension for image/video, but WITH it for raw uploads.
const publicIdFromUrl = (url) => {
  const match = url.match(/\/(image|video|raw)\/upload\/(?:v\d+\/)?(.+)$/);
  if (!match) return null;
  const [, resourceType, rest] = match;
  const publicId = resourceType === "raw" ? rest : rest.replace(/\.[^./]+$/, "");
  // Never touch anything outside this app's own folder.
  return publicId.startsWith(`${CLOUDINARY_FOLDER}/`) ? { publicId, resourceType } : null;
};

// Best-effort cleanup of a replaced or deleted file. An orphaned file costs
// a few KB of a 25GB allowance; a failed request costs the user their work —
// so nothing in here is ever allowed to throw.
export const deleteStoredFile = async (stored) => {
  if (!stored) return;

  if (!stored.startsWith("http")) {
    fs.unlink(path.join(UPLOADS_DIR, path.basename(stored)), () => {});
    return;
  }

  const target = publicIdFromUrl(stored);
  if (!target || !isCloudStorageConfigured()) return;
  try {
    ensureConfigured();
    await cloudinary.uploader.destroy(target.publicId, { resource_type: target.resourceType });
  } catch (error) {
    console.error("Cloudinary delete failed (ignored):", error.message);
  }
};
