// Account-wide settings — right now, just the one Google Sheet link (25 Sep,
// per Rishi: "add a link google sheet bar in the settings menu where we just
// link one sheet in it"). Lives in the Navbar's gear-icon dropdown, not its
// own routed page — see Navbar.jsx.
import { findCompanyById, setLinkedSheet } from "../models/companyStore.js";
import { isGoogleSheetsConfigured } from "../utils/googleSheets.js";
import { pushToLinkedSheet } from "../utils/sheetSync.js";

export const getSettings = async (req, res) => {
  try {
    const company = await findCompanyById(req.user.companyId);
    res.json({
      linkedSheetUrl: company?.linkedSheetUrl || "",
      sheetsConfigured: isGoogleSheetsConfigured(),
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Couldn't load settings" });
  }
};

// Owner-only (see routes/settingsRoutes.js) — an empty/blank sheetUrl
// unlinks (auto-sync just turns off; nothing is deleted from the Sheet
// itself). A non-empty one replaces whatever was linked before, then
// immediately does a full sync of all three ledgers so the Sheet doesn't sit
// empty/stale until the next real edit.
export const updateLinkedSheet = async (req, res) => {
  const { sheetUrl } = req.body;
  try {
    const { company, error } = await setLinkedSheet(req.user.companyId, sheetUrl);
    if (error === "not_found") return res.status(404).json({ message: "Company not found" });

    if (company.linkedSheetUrl) {
      // Not fire-and-forget here — this one IS the action the user is
      // waiting on ("link this Sheet"), so the response should reflect
      // whether the first sync actually worked (a bad/unshared link should
      // surface immediately, not silently fail in the background).
      await Promise.all([
        pushToLinkedSheet(req.user.companyId, "expenses"),
        pushToLinkedSheet(req.user.companyId, "worklog"),
        pushToLinkedSheet(req.user.companyId, "payments"),
      ]);
    }

    res.json({
      linkedSheetUrl: company.linkedSheetUrl,
      message: company.linkedSheetUrl ? "Sheet linked — every new entry will sync here automatically" : "Sheet unlinked",
    });
  } catch (error) {
    res.status(400).json({ message: error.message || "Couldn't update the linked Sheet" });
  }
};
