import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const RequireAuth = ({ children }) => {
    const { user, loading } = useAuth();
    const location = useLocation();
    const churchId = location.pathname.split('/')[2];

    if (loading) {
        return (
            <div style={{
                minHeight: '100vh',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                background: 'linear-gradient(180deg, #F8FAFC 0%, #EEF2FF 100%)'
            }}>
                <div style={{
                    textAlign: 'center',
                    padding: '2rem'
                }}>
                    <div style={{
                        width: '50px',
                        height: '50px',
                        border: '4px solid #E5E7EB',
                        borderTop: '4px solid #4F46E5',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                        margin: '0 auto 1rem'
                    }} />
                    <p style={{ color: '#6b7280', fontSize: '1.1rem' }}>Checking authentication...</p>
                </div>
                <style>{`
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `}</style>
            </div>
        );
    }

    if (!user) {
        // Save the attempted url to redirect back after login
        return <Navigate to={`/church/${churchId}/login`} state={{ from: location }} replace />;
    }

    return children;
};

export default RequireAuth;