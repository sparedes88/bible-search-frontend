import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const RequireAuth = ({ children }) => {
    const { user } = useAuth();
    const location = useLocation();
    const churchId = location.pathname.split('/')[2];

    if (!user) {
        // Save the attempted url to redirect back after login
        return <Navigate to={`/church/${churchId}/login`} state={{ from: location }} replace />;
    }

    return children;
};

export default RequireAuth;