import jwt from "jsonwebtoken";
import { findUserByEmail, findUserById, createUser, verifyPassword, updateUserPassword, setUserCompany, ensureUserHasCompany } from "../models/userStore.js";
import { createCompany } from "../models/companyStore.js";
import { sendPasswordResetEmail } from "../utils/mailer.js";

// The JWT carries companyId/role so every request resolves scope and
// permissions with no extra DB read (see authMiddleware.js's protect()) —
// name is included too, purely so the audit log can show a real name
// without a lookup on every write.
const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, name: user.name, companyId: user.companyId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};

const publicUser = (user) => ({
  _id: user.id,
  id: user.id,
  name: user.name,
  email: user.email,
  companyId: user.companyId,
  role: user.role,
  createdAt: user.createdAt,
});

// Register User — always creates a brand-new company with this user as its
// owner. Staff accounts are never created here; the owner adds them from the
// Team page (POST /api/team/staff) once they're already logged in.
const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Missing Details" });
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ success: false, message: "Email already registered" });
    }

    const newUser = await createUser({ name, email, password });
    const company = await createCompany({ name: `${newUser.name}'s Company`, ownerId: newUser.id });
    await setUserCompany(newUser.id, { companyId: company.id, role: "owner" });
    const fullUser = { ...newUser, companyId: company.id, role: "owner" };

    const token = generateToken(fullUser);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user: publicUser(fullUser),
    });
  } catch (error) {
    console.error("❌ Signup Error:", error);
    res.status(500).json({ success: false, message: error.message || "Internal Server Error" });
  }
};

// Login User
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(404).json({ success: false, message: "User does not exist" });
    }

    const isMatch = await verifyPassword(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // A login that predates multi-user accounts won't have a company yet —
    // backfill it here so the very first token issued after this feature is
    // already fully populated, rather than waiting on protect()'s fallback.
    const fullUser = user.companyId ? user : await ensureUserHasCompany(user.id);

    const token = generateToken(fullUser);
    return res.json({ success: true, message: "Login successful", token, user: publicUser(fullUser) });
  } catch (error) {
    console.error("❌ Login Error:", error);
    res.status(500).json({ success: false, message: error.message || "Internal Server Error" });
  }
};

// Get User Profile (protected)
const getUserProfile = async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, user: publicUser(user) });
  } catch (error) {
    console.error("❌ Profile fetch error:", error);
    res.status(500).json({ success: false, message: error.message || "Internal Server Error" });
  }
};

// Request a reset link. Always responds the same way whether or not the
// email is actually registered — otherwise this endpoint could be used to
// check which emails have an account (a real, if minor, privacy leak).
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const user = await findUserByEmail(email);
    if (user) {
      // A short-lived, single-purpose JWT is the reset token — no separate
      // token storage needed, since the Google Sheet has nowhere obviously
      // safe to keep one and JWT already gives us tamper-proof expiry.
      const resetToken = jwt.sign({ id: user.id, purpose: "password-reset" }, process.env.JWT_SECRET, {
        expiresIn: "15m",
      });
      const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
      const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;
      try {
        await sendPasswordResetEmail(user.email, resetUrl);
      } catch (mailError) {
        // Don't leak the "email isn't configured" detail to the client —
        // that would tell an attacker whether the account exists. Log it
        // server-side so whoever's watching the logs can fix the setup.
        console.error("❌ Password reset email failed to send:", mailError.message);
      }
    }

    res.json({ success: true, message: "If that email is registered, a reset link has been sent to it." });
  } catch (error) {
    console.error("❌ Forgot Password Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Completes the reset: verifies the token from the emailed link, then sets
// the new password.
const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ success: false, message: "Missing reset token or new password" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      return res.status(400).json({ success: false, message: "This reset link is invalid or has expired — please request a new one." });
    }
    if (payload.purpose !== "password-reset") {
      return res.status(400).json({ success: false, message: "Invalid reset link" });
    }

    const user = await findUserById(payload.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "That account no longer exists" });
    }

    await updateUserPassword(user.id, password);
    res.json({ success: true, message: "Password updated — you can now log in with your new password." });
  } catch (error) {
    console.error("❌ Reset Password Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

export { registerUser, loginUser, getUserProfile, forgotPassword, resetPassword };
