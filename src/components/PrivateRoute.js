import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const PrivateRoute = ({ children, roles = [] }) => {
  const { user } = useAuth();
  const location = useLocation();
  const churchId = location.pathname.split('/')[2];

  if (!user) {
    return <Navigate to={`/church/${churchId}/login`} state={{ from: location }} replace />;
  }

  if (roles.length > 0 && !roles.includes(user.role)) {
    return <Navigate to={`/church/${churchId}`} replace />;
  }

  return children;
};

export default PrivateRoute;