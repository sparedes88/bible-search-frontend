import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const ProtectedRoute = ({ children, requireGlobalAdmin }) => {
  const { user, loading, isGlobalAdmin } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div>Checking authentication...</div>;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireGlobalAdmin && !isGlobalAdmin()) {
    console.log('Access denied: Global admin required');
    return <Navigate to="/" replace />;
  }

  return children;
};

export default ProtectedRoute;