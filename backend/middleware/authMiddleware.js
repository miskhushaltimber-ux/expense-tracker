import jwt from "jsonwebtoken";
import { ensureUserHasCompany } from "../models/userStore.js";

// 19 Sep — multi-user accounts: a JWT issued after this change carries
// { id, name, companyId, role } so every request resolves its scope and
// permissions with zero extra reads (same stateless-token approach the app
// already used for password reset). A token issued BEFORE this change only
// has { id } — protect() falls back to a one-time DB read for those,
// backfilling a company for the user if even their stored row predates this
// feature. That fallback only ever runs for a token minted before the
// rollout; logging out and back in picks up a fresh, fully-populated token
// and skips it entirely from then on.
const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "No token, authorization denied" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.companyId && decoded.role) {
      req.user = decoded; // { id, name, companyId, role }
      return next();
    }

    // Older token — resolve/backfill from the database for this request only.
    const user = await ensureUserHasCompany(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, message: "Token is invalid or expired" });
    }
    req.user = { id: user.id, name: user.name, companyId: user.companyId, role: user.role };
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Token is invalid or expired" });
  }
};

// Gates actions that only the account owner should be able to take —
// deleting/renaming reference data (vehicles, masters, mills, contractors,
// labor, locations), bulk-deleting a ledger, and everything under /api/team.
// Day-to-day data entry (adding/editing/deleting a single expense, wage
// entry or payment) stays open to staff — see status.md's Fifteenth update
// for the full reasoning on where this line was drawn.
export const requireOwner = (req, res, next) => {
  if (req.user?.role !== "owner") {
    return res.status(403).json({ message: "Only the account owner can do this." });
  }
  next();
};

export default protect;
