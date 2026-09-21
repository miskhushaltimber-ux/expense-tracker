// Team management (19 Sep, multi-user accounts) — everything here is
// owner-only (see routes/teamRoutes.js, gated with requireOwner). Staff
// accounts are created here, never via public signup, so there's no invite
// email/token flow to build or secure: the owner sets a name/email/password
// for the new login and hands it to the employee directly.
import { findUserByEmail, createUser, listUsersByCompany, deleteUserById } from "../models/userStore.js";
import { listAuditLogByCompany } from "../utils/auditLog.js";

const publicTeamMember = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt,
});

export const listTeam = async (req, res) => {
  try {
    const users = await listUsersByCompany(req.user.companyId);
    res.json(users.map(publicTeamMember));
  } catch (error) {
    console.error("Error listing team:", error);
    res.status(500).json({ message: error.message || "Error fetching your team" });
  }
};

export const createStaffAccount = async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: "Name is required" });
  if (!email || !email.trim()) return res.status(400).json({ message: "Email is required" });
  if (!password || password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

  try {
    const existing = await findUserByEmail(email);
    if (existing) return res.status(409).json({ message: "That email is already registered" });

    const user = await createUser({
      name,
      email,
      password,
      companyId: req.user.companyId,
      role: "staff",
    });
    res.status(201).json(publicTeamMember(user));
  } catch (error) {
    console.error("Error adding staff account:", error);
    res.status(500).json({ message: error.message || "Error adding that team member" });
  }
};

export const removeStaff = async (req, res) => {
  try {
    const team = await listUsersByCompany(req.user.companyId);
    const target = team.find((u) => u.id === req.params.id);
    if (!target) return res.status(404).json({ message: "That team member no longer exists" });
    if (target.role === "owner") {
      return res.status(403).json({ message: "The account owner can't be removed" });
    }

    const { error } = await deleteUserById(target.id);
    if (error) return res.status(404).json({ message: "That team member no longer exists" });

    res.json({ message: `${target.name} removed` });
  } catch (error) {
    console.error("Error removing staff account:", error);
    res.status(500).json({ message: error.message || "Error removing that team member" });
  }
};

export const getAuditLog = async (req, res) => {
  try {
    const entries = await listAuditLogByCompany(req.user.companyId);
    res.json(entries);
  } catch (error) {
    console.error("Error fetching audit log:", error);
    res.status(500).json({ message: error.message || "Error fetching the activity log" });
  }
};
