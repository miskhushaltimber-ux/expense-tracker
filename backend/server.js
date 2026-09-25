import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import userRoutes from "./routes/userRoutes.js";
import expenseRoutes from "./routes/expenseRoutes.js";
import metaRoutes from "./routes/metaRoutes.js";
import importRoutes from "./routes/importRoutes.js";
import sheetsRoutes from "./routes/sheetsRoutes.js";
import vehicleRoutes from "./routes/vehicleRoutes.js";
import budgetRoutes from "./routes/budgetRoutes.js";
import masterRoutes from "./routes/masterRoutes.js";
import labourRoutes from "./routes/labourRoutes.js";
import labourSheetsRoutes from "./routes/labourSheetsRoutes.js";
import teamRoutes from "./routes/teamRoutes.js";
import columnDefRoutes from "./routes/columnDefRoutes.js";
import backupRoutes from "./routes/backupRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import { UPLOADS_DIR } from "./middleware/uploadMiddleware.js";
import { isFirestoreConfigured } from "./utils/firestoreClient.js";
import { runMigration } from "./scripts/migrateSheetsToFirestore.js";
import { ensureUsersSheet } from "./models/userStore.js";
import { ensureCompaniesSheet } from "./models/companyStore.js";
import { ensureExpensesSheet } from "./models/expenseStore.js";
import { ensureVehiclesSheet } from "./models/vehicleStore.js";
import { ensureBudgetsSheet } from "./models/budgetStore.js";
import { ensureMastersSheet } from "./models/masterStore.js";
import {
  ensureMillsSheet,
  ensureContractorsSheet,
  ensureLaborsSheet,
  ensureWageEntriesSheet,
  ensurePaymentsSheet,
} from "./models/labourStore.js";
import { ensureLocationsSheet } from "./models/locationStore.js";
import { ensureAuditLogSheet } from "./utils/auditLog.js";
import { ensureColumnDefsSheet } from "./models/columnDefStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

// Middleware
app.use(express.json()); // ✅ Ensure JSON parsing middleware is before routes
app.use(helmet({ crossOriginResourcePolicy: false })); // allow serving /uploads to the frontend origin

// Extra origins can be added via CORS_ORIGINS (comma-separated) in .env —
// useful once this is deployed somewhere other than localhost.
const extraAllowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Vite (and most dev servers) pick a different port automatically when the
// usual one is busy (5173 -> 5174 -> 5175 ...), so hard-coding one port
// breaks CORS the moment that happens. Instead, always allow any localhost/
// 127.0.0.1 origin regardless of port during local development.
const isLocalhostOrigin = (origin) => /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);

app.use(
  cors({
    origin: (origin, callback) => {
      // requests with no Origin header (curl, server-to-server, Postman) are always allowed
      if (!origin || isLocalhostOrigin(origin) || extraAllowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      console.warn(`⚠️  CORS blocked request from origin: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: "GET,POST,PUT,DELETE",
    credentials: true,
  })
);

// Serve uploaded bill/invoice files
app.use("/uploads", express.static(UPLOADS_DIR));

// API Routes — deliberately just what the sheet page + dashboard need.
app.use("/api/auth", userRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/meta", metaRoutes);
app.use("/api/imports", importRoutes);
app.use("/api/sheets", sheetsRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/budgets", budgetRoutes);
app.use("/api/masters", masterRoutes);
app.use("/api/labour", labourRoutes);
app.use("/api/labour-sheets", labourSheetsRoutes);
app.use("/api/team", teamRoutes);
app.use("/api/columns", columnDefRoutes);
app.use("/api/backup", backupRoutes);
app.use("/api/settings", settingsRoutes);

// Root route — also reports whether the Google Sheets database is actually
// configured, so a single visit to this URL tells you if the backend AND
// its database are both healthy (open http://localhost:3000 directly to check).
app.get("/", (req, res) => {
  res.status(200).json({
    message: "Expense Tracker API is running...",
    database: isFirestoreConfigured() ? "firestore-connected" : "firestore-not-configured",
  });
});

// Multer/file-upload errors land here instead of crashing the process
app.use((err, req, res, next) => {
  if (err) {
    console.error("Unhandled error:", err.message);
    return res.status(400).json({ message: err.message || "Something went wrong" });
  }
  next();
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);

  // The database is Firestore now (previously Google Sheets, previously
  // MongoDB) — make sure every collection is ready before anything tries to
  // read/write it. Firestore creates collections implicitly, so this is
  // mostly a config check rather than real setup work.
  if (isFirestoreConfigured()) {
    try {
      await Promise.all([
        ensureUsersSheet(),
        ensureCompaniesSheet(),
        ensureExpensesSheet(),
        ensureVehiclesSheet(),
        ensureBudgetsSheet(),
        ensureMastersSheet(),
        ensureMillsSheet(),
        ensureContractorsSheet(),
        ensureLaborsSheet(),
        ensureWageEntriesSheet(),
        ensurePaymentsSheet(),
        ensureLocationsSheet(),
        ensureAuditLogSheet(),
        ensureColumnDefsSheet(),
      ]);
      console.log("✅ Firestore database ready (Users + Companies + Expenses + Vehicles + Budgets + Masters + Mills + Contractors + Labors + WageEntries + Payments + Locations + AuditLog + ColumnDefs)");
    } catch (error) {
      console.error("❌ Couldn't prepare the Firestore database:", error.message);
    }

    // One-time, opt-in: set RUN_MIGRATION=true to copy every row out of the
    // old Google Sheet into Firestore once, then remove that env var again.
    // Safe to leave on by accident — each table is skipped once it already
    // has data in Firestore, so this never duplicates rows.
    if (process.env.RUN_MIGRATION === "true") {
      await runMigration();
    }
  } else {
    console.error(
      "❌ Firestore isn't configured yet — set GOOGLE_SERVICE_ACCOUNT_KEY (and FIRESTORE_DATABASE_ID, if your database isn't named \"(default)\") in backend/.env. Nothing can be saved until this is done. See backend/.env.example."
    );
  }
});
