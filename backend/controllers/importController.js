import { parseSheetToPreview } from "../utils/importParser.js";
import { parseWorkLogSheetToPreview, parsePaymentSheetToPreview } from "../utils/labourImportParser.js";
import { resolveImportDestinations } from "../utils/importDestinations.js";

// Upload a sheet, get back a preview (nothing is saved yet — committing
// happens via POST /api/expenses/bulk, or POST /api/labour/payments/bulk for
// rows routed to a contractor payment, once the user has reviewed/edited
// the rows in the UI).
export const previewImport = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Please choose a .csv, .xls or .xlsx file to upload" });
  }

  try {
    const { rows, warnings, columnMapping } = parseSheetToPreview(req.file.buffer, req.file.originalname);
    const { rows: resolvedRows, warnings: destWarnings, vehicleOptions, contractorOptions } = await resolveImportDestinations(
      rows,
      req.user.id
    );
    res.json({
      rows: resolvedRows,
      warnings: [...warnings, ...destWarnings],
      columnMapping,
      totalRows: resolvedRows.length,
      vehicleOptions,
      contractorOptions,
    });
  } catch (error) {
    console.error("Error parsing import sheet:", error);
    res.status(400).json({ message: "Couldn't read that file. Make sure it's a valid .csv, .xls or .xlsx file." });
  }
};

// Same idea as previewImport, but for the Labor Wages ledgers (Work Log /
// Payments), which have their own column shapes — selected via ?type=.
export const previewLabourImport = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Please choose a .csv, .xls or .xlsx file to upload" });
  }

  const type = req.query.type === "payments" ? "payments" : "worklog";

  try {
    const parse = type === "payments" ? parsePaymentSheetToPreview : parseWorkLogSheetToPreview;
    const { rows, warnings, columnMapping } = parse(req.file.buffer, req.file.originalname);
    res.json({ rows, warnings, columnMapping, totalRows: rows.length });
  } catch (error) {
    console.error("Error parsing labour import sheet:", error);
    res.status(400).json({ message: "Couldn't read that file. Make sure it's a valid .csv, .xls or .xlsx file." });
  }
};
