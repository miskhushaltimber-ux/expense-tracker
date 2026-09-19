import React, { createContext, useContext, useEffect, useState } from "react";

// Light/dark theme for the whole app. The choice is remembered per browser,
// and falls back to whatever the person's operating system is set to the
// first time they visit.
const ThemeContext = createContext();

const getInitialTheme = () => {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Private browsing and blocked storage both throw here — not worth
    // breaking the app over, we just fall through to the OS preference.
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
};

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(getInitialTheme);

  // One class on <html> drives every dark: utility in the app.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // Same as above — remembering the choice is a nicety, not a requirement.
    }
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext) || { theme: "light", toggleTheme: () => {} };
