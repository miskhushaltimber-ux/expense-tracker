import crypto from "crypto";
import { buildCompanyBackup, listCompaniesWithOwners } from "../utils/backup.js";
import { sendBackupEmail, isEmailConfigured } from "../utils/mailer.js";
import { logAction } from "../utils/auditLog.js";

const fileNameFor = (label) => `backup-${label}-${new Date().toISOString().slice(0, 10)}.json`;

// GET /api/backup/download — owner-only. The owner's own company, as a JSON
// file straight to their browser (Team & Activity page's "Download backup").
export const downloadBackup = async (req, res) => {
  try {
    const backup = await buildCompanyBackup(req.user.companyId);
    logAction({
      companyId: req.user.companyId,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: "created",
      entity: "backup",
      entityLabel: `Downloaded backup (${backup.totalDocs} records)`,
    });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${fileNameFor("manual")}"`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (error) {
    res.status(500).json({ message: error.message || "Couldn't build the backup" });
  }
};

// Constant-time compare so the secret can't be guessed byte by byte.
const secretMatches = (given) => {
  const expected = process.env.BACKUP_CRON_SECRET || "";
  if (!expected || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// POST /api/backup/scheduled — NOT behind a login; called once a day by the
// GitHub Actions workflow (.github/workflows/daily-backup.yml) with the
// BACKUP_CRON_SECRET header. Emails every company owner their own backup.
export const runScheduledBackup = async (req, res) => {
  if (!secretMatches(req.get("x-backup-secret"))) return res.status(401).json({ message: "Not authorized" });
  if (!isEmailConfigured()) return res.status(500).json({ message: "Email isn't configured, can't send backups" });
  const results = [];
  try {
    for (const company of await listCompaniesWithOwners()) {
      if (!company.ownerEmail) {
        results.push({ company: company.id, ok: false, reason: "no owner email" });
        continue;
      }
      try {
        const backup = await buildCompanyBackup(company.id);
        await sendBackupEmail({
          toEmail: company.ownerEmail,
          companyName: company.name,
          fileName: fileNameFor("daily"),
          json: JSON.stringify(backup),
          totalDocs: backup.totalDocs,
        });
        results.push({ company: company.id, ok: true, records: backup.totalDocs });
      } catch (error) {
        results.push({ company: company.id, ok: false, reason: error.message });
      }
    }
    const failed = results.filter((r) => !r.ok).length;
    res.status(failed ? 207 : 200).json({ sent: results.length - failed, failed, results });
  } catch (error) {
    res.status(500).json({ message: error.message || "Scheduled backup failed", results });
  }
};
