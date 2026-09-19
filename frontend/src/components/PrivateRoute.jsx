import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const PrivateRoute = () => {
  const { user } = useAuth();
  
  // If user is not authenticated, redirect to login
  if (!user) {
    return <Navigate to="/login" />;
  }
  
  // Otherwise, render the child routes
  return <Outlet />;
};

export default PrivateRoute;



