import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { APP_NAME } from "../../constants/brand";
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    if (!email.trim() || !password.trim()) {
      toast.error("Email and password are required");
      setIsLoading(false);
      return;
    }

    try {
      const response = await login(email, password);
      
      if (response?.success) {
        toast.success("Login successful!");
        navigate("/dashboard");
      } else {
        toast.error(response?.message || "Login failed. Please try again.");
      }
    } catch (error) {
      console.error("Login error:", error);
      toast.error(error?.message || "An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-100 dark:bg-gray-800 py-8 px-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-sm"
      >
        <div className="text-center mb-4">
          <p className="text-blue-600 dark:text-blue-400 font-bold text-lg">{APP_NAME}</p>
          <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-200">Sign in</h2>
        </div>

        <div className="mb-4">
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
            Email
          </label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            required
          />
        </div>

        <div className="mb-4">
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
            Password
          </label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            required
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className={`w-full ${
            isLoading ? "bg-blue-400" : "bg-blue-600 hover:bg-blue-700"
          } text-white py-2 px-4 rounded-md transition-colors`}
        >
          {isLoading ? "Logging in..." : "Login"}
        </button>

        <div className="mt-4 text-center">
          <p>
            Don't have an account? <Link to="/signup" className="text-blue-600 dark:text-blue-400">Sign Up</Link>
          </p>
          <p>
            Forgot your password? <Link to="/forgot-password" className="text-blue-600 dark:text-blue-400">Recover it</Link>
          </p>
        </div>
      </form>
      <ToastContainer />
    </div>
  );
};

export default Login;