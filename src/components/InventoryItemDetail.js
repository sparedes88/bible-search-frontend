import React, { useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';

const InventoryItemDetail = () => {
  const { id, itemId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    const fetchItem = async () => {
      if (!user) {
        // User is not logged in, redirect to login page with return URL
        // Include the full current URL with any query parameters
        const currentUrl = location.pathname + location.search;
        navigate(`/church/${id}/login?returnUrl=${encodeURIComponent(currentUrl)}`);
        return;
      }

      try {
        const itemRef = doc(db, 'churches', id, 'inventory', itemId);
        const itemDoc = await getDoc(itemRef);
          if (itemDoc.exists()) {
          // Redirect to inventory page with the specific item selected
          // Use selectedItemId instead of itemId to ensure it's properly handled by our new code
          navigate(`/church/${id}/inventory?selectedItemId=${itemId}`);
        } else {
          // Item not found
          navigate(`/church/${id}/inventory`);
        }
      } catch (error) {
        console.error('Error fetching item:', error);
        navigate(`/church/${id}/inventory`);
      }
    };

    fetchItem();
  }, [id, itemId, user, navigate, location]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <div>Loading item details...</div>
    </div>
  );
};

export default InventoryItemDetail;