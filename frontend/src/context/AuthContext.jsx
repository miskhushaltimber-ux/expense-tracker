import React, { createContext, useContext, useState, useEffect } from "react";
import { loginUser, signupUser } from "../api/auth";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load user from localStorage on startup
  useEffect(() => {
    setLoading(true);
    try {
      const savedUser = localStorage.getItem("user");
      if (savedUser) {
        setUser(JSON.parse(savedUser));
      }
    } catch (err) {
      console.error("Error loading user from storage:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const signup = async (name, email, password) => {
    setLoading(true);
    setError(null);
    try {
      const response = await signupUser({ name, email, password });

      if (response.success && response.user) {
        localStorage.setItem("user", JSON.stringify(response.user));
        localStorage.setItem("token", response.token);
        setUser(response.user);
        return response;
      } else {
        setError(response.message || "Signup failed.");
        return response;
      }
    } catch (error) {
      console.error("Signup error:", error);
      setError(error?.message || "Signup failed.");
      return { success: false, message: error?.message || "Signup failed." };
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      const response = await loginUser({ email, password });

      if (response.success && response.user) {
        localStorage.setItem("user", JSON.stringify(response.user));
        localStorage.setItem("token", response.token);
        setUser(response.user);
        return response;
      } else {
        setError(response.message || "Login failed.");
        return response;
      }
    } catch (error) {
      console.error("Login error:", error);
      setError(error?.message || "Login failed.");
      return { success: false, message: error?.message || "Login failed." };
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    setUser(null);
    setError(null);
  };

  // Merges profile changes (e.g. from Settings > Profile) into the locally
  // held user object, so the rest of the app (Sidebar, etc.) reflects them
  // immediately without a page reload.
  const updateUser = (partialUser) => {
    setUser((prev) => {
      const merged = { ...(prev || {}), ...partialUser };
      localStorage.setItem("user", JSON.stringify(merged));
      return merged;
    });
  };

  return (
    <AuthContext.Provider value={{ user, login, signup, logout, loading, error, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom Hook to Access AuthContext
export const useAuth = () => useContext(AuthContext);
