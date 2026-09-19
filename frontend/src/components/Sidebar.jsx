import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { APP_NAME, APP_TAGLINE } from '../constants/brand';
import {
  LogOut,
  LayoutDashboard,
  Sheet,
  PieChart,
  Truck,
  HardHat,
  X,
  Sun,
  Moon,
} from 'lucide-react';

// Vehicle/Labor analytics live as TABS on the Dashboard page itself (18 Sep),
// not as separate nav entries — same as Labor Wages' own Work Log/Payments/
// Report tabs don't get their own sidebar rows either.
const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/dashboard/expenses', label: 'Expense Sheet', icon: Sheet },
  { to: '/dashboard/vehicles', label: 'Vehicles', icon: Truck },
  { to: '/dashboard/labor-wages', label: 'Labor Wages', icon: HardHat },
];

// isOpen/onClose control the mobile/tablet off-canvas drawer only — on
// desktop (lg+) this is always visible via the `lg:translate-x-0` class
// below, regardless of the isOpen prop.
const Sidebar = ({ isOpen = false, onClose = () => {} }) => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();

  const isActive = (path, end) => (end ? location.pathname === path : location.pathname.startsWith(path));

  return (
    <>
      {/* Mobile/tablet backdrop */}
      {isOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/50 z-30" onClick={onClose} aria-hidden="true" />
      )}

      <aside
        className={`bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 shadow-lg w-64 max-w-[85vw] fixed inset-y-0 left-0 z-40 flex flex-col
          transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
      >
        {/* Brand Header */}
        <div className="px-5 sm:px-6 py-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <h2 className="text-blue-600 dark:text-blue-400 font-bold text-lg flex items-center min-w-0">
              <PieChart className="mr-2 shrink-0" size={22} />
              <span className="truncate">{APP_NAME}</span>
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 ml-8">{APP_TAGLINE}</p>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 p-1 shrink-0"
            aria-label="Close menu"
          >
            <X size={22} />
          </button>
        </div>

        {user ? (
          <>
            {/* User Profile */}
            <div className="px-5 sm:px-6 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                  <span className="text-blue-600 dark:text-blue-200 font-semibold text-lg">
                    {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate">{user.name || 'User'}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{user.email || 'user@example.com'}</p>
                </div>
              </div>
            </div>

            {/* Navigation Links */}
            <nav className="flex-1 px-3 sm:px-4 py-4 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
                <Link
                  key={to}
                  to={to}
                  onClick={onClose}
                  className={`flex items-center py-2.5 px-4 rounded-lg transition-all text-sm ${
                    isActive(to, end)
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-900 hover:text-blue-600 dark:hover:text-blue-400'
                  }`}
                >
                  <Icon size={19} className="mr-3 shrink-0" />
                  <span className="truncate">{label}</span>
                </Link>
              ))}
            </nav>

            {/* Bottom Actions */}
            <div className="border-t border-gray-100 dark:border-gray-700 p-3 sm:p-4 shrink-0">
              <button
                onClick={toggleTheme}
                className="flex items-center w-full py-2.5 px-4 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-all text-sm"
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'dark' ? (
                  <Sun size={19} className="mr-3 shrink-0" />
                ) : (
                  <Moon size={19} className="mr-3 shrink-0" />
                )}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
              <button
                onClick={logout}
                className="flex items-center w-full py-2.5 px-4 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all text-sm"
              >
                <LogOut size={19} className="mr-3 shrink-0" />
                Logout
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-gray-400 dark:text-gray-500">Please log in</p>
          </div>
        )}
      </aside>
    </>
  );
};

export default Sidebar;
