import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

// Layouts
import DashboardLayout from './layouts/DashboardLayout';
import AuthLayout from './layouts/AuthLayout';

// Pages — lazy-loaded so each route ships its own JS chunk instead of one
// ~890KB bundle for the whole app (18 Sep, performance pass per Rishi:
// "prevent lagging jittering"). Every route below Suspends on the same
// lightweight fallback; layouts and auth wiring stay eager since they're
// needed immediately and are small.
const Login = lazy(() => import('./pages/Auth/Login'));
const Signup = lazy(() => import('./pages/Auth/Signup'));
const ForgotPassword = lazy(() => import('./pages/Auth/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/Auth/ResetPassword'));
const Home = lazy(() => import('./pages/Dashboard/Home'));
const Expenses = lazy(() => import('./pages/Dashboard/Expenses'));
const Vehicles = lazy(() => import('./pages/Dashboard/Vehicles'));
const LaborWages = lazy(() => import('./pages/Dashboard/LaborWages'));
const ManageData = lazy(() => import('./pages/Dashboard/ManageData'));
const Documents = lazy(() => import('./pages/Dashboard/Documents'));
const Team = lazy(() => import('./pages/Dashboard/Team'));

// PrivateRoute component to protect routes
import PrivateRoute from './components/PrivateRoute';

const RouteFallback = () => (
  <div className="flex justify-center items-center h-screen text-sm text-gray-400">Loading…</div>
);

const AppRouter = () => {
  const { loading } = useAuth();

  // Show a loading indicator while checking auth status
  if (loading) {
    return <div className="flex justify-center items-center h-screen">Loading application...</div>;
  }

  return (
    <Router>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<AuthLayout><Login /></AuthLayout>} />
          <Route path="/signup" element={<AuthLayout><Signup /></AuthLayout>} />
          <Route path="/forgot-password" element={<AuthLayout><ForgotPassword /></AuthLayout>} />
          <Route path="/reset-password/:token" element={<AuthLayout><ResetPassword /></AuthLayout>} />

          {/* Protected Routes */}
          <Route element={<PrivateRoute />}>
            <Route path="/dashboard" element={<DashboardLayout />}>
              <Route index element={<Home />} />
              <Route path="expenses" element={<Expenses />} />
              <Route path="vehicles" element={<Vehicles />} />
              <Route path="labor-wages" element={<LaborWages />} />
              <Route path="manage-data" element={<ManageData />} />
              <Route path="documents" element={<Documents />} />
              <Route path="team" element={<Team />} />
            </Route>
          </Route>

          {/* Redirect root to dashboard if authenticated, otherwise to login */}
          <Route path="/" element={<Navigate to="/dashboard" />} />

          {/* Redirect to login if route doesn't exist */}
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      </Suspense>
    </Router>
  );
};

export default AppRouter;
