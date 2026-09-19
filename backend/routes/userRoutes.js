import express from "express";
import rateLimit from "express-rate-limit";
import { registerUser, loginUser, getUserProfile, forgotPassword, resetPassword } from "../controllers/userController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

// Basic brute-force protection on login/signup — the app is now reachable
// from the public internet, so these need a limit even though there's
// currently just one small team using it. Per-IP, resets after 15 minutes.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please wait a few minutes and try again." },
});

router.post("/register", authLimiter, registerUser);
router.post("/login", authLimiter, loginUser);
router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password", authLimiter, resetPassword);
router.get("/profile", protect, getUserProfile);

export default router;
