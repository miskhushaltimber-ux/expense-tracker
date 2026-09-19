import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';

// Single source of truth for whether the mobile/tablet drawer is open.
// Desktop (lg+) ignores this entirely — the sidebar is always visible there
// via its own `lg:translate-x-0` class, and content always has `lg:pl-64`.
const DashboardLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-800 w-full overflow-x-hidden">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-col min-h-screen lg:pl-64">
        <header className="sticky top-0 z-20 w-full bg-white dark:bg-gray-800 shadow-sm">
          <Navbar onMenuClick={() => setSidebarOpen(true)} />
        </header>

        <main className="flex-1 w-full min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
