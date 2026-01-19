import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import ChurchHeader from './ChurchHeader';
import ResponseLog from './ResponseLog';
import { SafeToastContainer } from '../utils/toastUtils';
import './MessageLogView.css';

/**
 * Example page showing how to use the ResponseLog component
 */
const MessageLogView = () => {
  const { id, type, entityId } = useParams();
  const [entityData, setEntityData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEntityData = async () => {
      if (!id || !type || !entityId) {
        setLoading(false);
        return;
      }

      try {
        let docRef;
        if (type === 'visitor') {
          docRef = doc(db, `visitors/${id}/visitors/${entityId}`);
        } else if (type === 'member') {
          docRef = doc(db, `users/${entityId}`);
        } else {
          setLoading(false);
          return;
        }

        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setEntityData({ id: docSnap.id, ...docSnap.data() });
        }
      } catch (error) {
        console.error("Error fetching entity data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchEntityData();
  }, [id, type, entityId]);

  return (
    <div className="message-log-view-container">
      <SafeToastContainer />
      <ChurchHeader id={id} />
      
      <div className="content-box">
        <div className="header-with-actions">
          <h2>
            Message Log: {loading ? 'Loading...' : entityData?.name 
              ? `${entityData.name} ${entityData.lastName || ''}`
              : 'Unknown'}
          </h2>
          <div className="action-buttons">
            <button
              onClick={() => window.history.back()}
              className="back-button"
            >
              Back
            </button>
          </div>
        </div>

        <div className="entity-details">
          {entityData && (
            <div className="entity-info">
              <div className="info-item">
                <span className="label">Type:</span>
                <span className="value">{type === 'visitor' ? 'Visitor' : 'Member'}</span>
              </div>
              {entityData.phone && (
                <div className="info-item">
                  <span className="label">Phone:</span>
                  <span className="value">{entityData.phone}</span>
                </div>
              )}
              {entityData.email && (
                <div className="info-item">
                  <span className="label">Email:</span>
                  <span className="value">{entityData.email}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Response Log Component */}
        <ResponseLog 
          churchId={id}
          visitorId={type === 'visitor' ? entityId : null}
          memberId={type === 'member' ? entityId : null}
          limit={50}
        />
        
        <div className="log-info">
          <p>This log shows messages between the church and {type === 'visitor' ? 'visitor' : 'member'}. 
            The timestamps indicate when each message was sent or received.</p>
        </div>
      </div>
    </div>
  );
};

export default MessageLogView;