import React, { useState } from "react";
import { Link } from "react-router-dom";
import { forgotPassword } from "../../api/auth";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      await forgotPassword(email.trim());
      // Always show the same "sent" state regardless of whether the email
      // was actually registered — the backend responds the same way either
      // way, so this doesn't leak which emails have accounts.
      setSent(true);
    } catch (err) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-100 dark:bg-gray-800 py-8 px-4">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-sm">
        <h2 className="text-2xl font-semibold mb-4 text-center">Forgot Password</h2>

        {sent ? (
          <div className="text-center">
            <p className="text-gray-700 dark:text-gray-200 mb-4">
              If <span className="font-medium">{email}</span> is registered, a password reset link has been sent to
              it. Check your inbox (and spam folder) — the link works for 15 minutes.
            </p>
            <Link to="/login" className="text-blue-600 dark:text-blue-400">
              Back to Login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Enter the email you signed up with — we'll send a link to reset your password.
            </p>

            {error && <div className="mb-4 text-sm text-red-600 bg-red-50 dark:bg-red-900/30 border border-red-200 rounded-md p-2">{error}</div>}

            <div className="mb-4">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                Email
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full ${
                isLoading ? "bg-blue-400" : "bg-blue-600 hover:bg-blue-700"
              } text-white py-2 px-4 rounded-md transition-colors`}
            >
              {isLoading ? "Sending..." : "Send Reset Link"}
            </button>

            <div className="mt-4 text-center">
              <p>
                Remembered your password? <Link to="/login" className="text-blue-600 dark:text-blue-400">Login</Link>
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
